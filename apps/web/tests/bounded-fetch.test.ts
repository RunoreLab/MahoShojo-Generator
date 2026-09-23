import { describe, expect, it, vi } from 'vitest';
import { fetchJsonWithBoundedRetry, fetchWithBoundedRetry } from '@/lib/bounded-fetch';

describe('fetchWithBoundedRetry', () => {
  it('TimeoutError 会重试一次', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    await expect(fetchWithBoundedRetry('/x', { fetcher })).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it('503 会重试一次后返回最终响应', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response(null, { status: 503 }) : Response.json({ ok: true });
    });
    const res = await fetchWithBoundedRetry('/x', { fetcher });
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('fetchJsonWithBoundedRetry', () => {
  it('第一次 200 response 的 json() 抛 TimeoutError，第二次成功', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new DOMException('The operation timed out.', 'TimeoutError');
          },
          body: null,
        } as unknown as Response;
      }
      return Response.json({ success: true, cards: [{ id: 'a' }] });
    });

    const result = await fetchJsonWithBoundedRetry<{ success: boolean; cards: Array<{ id: string }> }>('/x', {
      fetcher,
      backoffMs: 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.success).toBe(true);
      expect(result.data.cards).toEqual([{ id: 'a' }]);
    }
    expect(calls).toBe(2);
  });

  it('最终 503 返回 failure 并带 JSON 错误体', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return Response.json({ success: false, error: '数据卡存储暂不可用' }, { status: 503 });
    });

    const result = await fetchJsonWithBoundedRetry('/x', { fetcher, backoffMs: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.data).toEqual({ success: false, error: '数据卡存储暂不可用' });
    }
    expect(calls).toBe(2);
  });

  it('404 不重试并返回 failure', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return Response.json({ success: false, error: '数据卡不存在' }, { status: 404 });
    });

    const result = await fetchJsonWithBoundedRetry('/x', { fetcher, backoffMs: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.data).toEqual({ success: false, error: '数据卡不存在' });
    }
    expect(calls).toBe(1);
  });

  it('非 JSON 错误体回退到 bodyText', async () => {
    const fetcher = vi.fn(async () => new Response('bad gateway', {
      status: 502,
      headers: { 'Content-Type': 'text/plain' },
    }));

    const result = await fetchJsonWithBoundedRetry('/x', { fetcher, maxAttempts: 1, backoffMs: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.bodyText).toBe('bad gateway');
      expect(result.data).toBeUndefined();
    }
  });
});
