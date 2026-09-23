import { describe, expect, it, vi } from 'vitest';
import { fetchWithBoundedRetry } from '@/lib/bounded-fetch';

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
