import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJsonWithBoundedRetry, fetchWithBoundedRetry } from '@/lib/bounded-fetch';

type AbortSignalStaticPatch = {
  any?: (signals: readonly AbortSignal[]) => AbortSignal;
  timeout?: (milliseconds: number) => AbortSignal;
};

type AbortSignalPrototypePatch = {
  throwIfAborted?: () => void;
};

// 模拟缺少 AbortSignal.any / timeout / throwIfAborted 的旧浏览器或 WebView。
const stripModernAbortSignalApis = (): (() => void) => {
  const statics = AbortSignal as unknown as AbortSignalStaticPatch;
  const prototype = AbortSignal.prototype as AbortSignalPrototypePatch;
  const originalAny = statics.any;
  const originalTimeout = statics.timeout;
  const originalThrowIfAborted = prototype.throwIfAborted;
  statics.any = undefined;
  statics.timeout = undefined;
  prototype.throwIfAborted = undefined;
  return () => {
    statics.any = originalAny;
    statics.timeout = originalTimeout;
    prototype.throwIfAborted = originalThrowIfAborted;
  };
};

const createHangingFetcher = (onCall?: () => void) => vi.fn(
  (_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    onCall?.();
    const signal = init?.signal;
    const rejectWithSignalReason = () => {
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    };
    if (signal?.aborted) {
      rejectWithSignalReason();
      return;
    }
    signal?.addEventListener('abort', rejectWithSignalReason, { once: true });
  }),
);

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

describe('bounded-fetch 旧 WebView 兼容性', () => {
  let restoreAbortSignalApis: () => void;

  beforeEach(() => {
    restoreAbortSignalApis = stripModernAbortSignalApis();
  });

  afterEach(() => {
    restoreAbortSignalApis();
  });

  it('调用前已外部 abort 则不发起请求', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(async () => Response.json({ success: true }));

    await expect(
      fetchJsonWithBoundedRetry('/x', { fetcher, signal: controller.signal, backoffMs: 0 }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('外部 abort 立即失败且不重试', async () => {
    const controller = new AbortController();
    const fetcher = createHangingFetcher();

    const pending = fetchJsonWithBoundedRetry('/x', {
      fetcher,
      signal: controller.signal,
      backoffMs: 0,
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('30 秒超时在旧环境仍中止挂起请求并重试至失败', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = createHangingFetcher();
      const pending = fetchJsonWithBoundedRetry('/x', {
        fetcher,
        maxAttempts: 2,
        backoffMs: 0,
        timeoutMs: 30_000,
      });
      const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('503 会重试一次后返回最终响应', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response(null, { status: 503 }) : Response.json({ success: true });
    });

    const result = await fetchJsonWithBoundedRetry('/x', { fetcher, backoffMs: 0 });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('response.json() 阶段 TimeoutError 会重试一次', async () => {
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
      return Response.json({ success: true });
    });

    const result = await fetchJsonWithBoundedRetry('/x', { fetcher, backoffMs: 0 });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('fetchWithBoundedRetry 在旧环境仍完成 503 重试', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response(null, { status: 503 }) : Response.json({ ok: true });
    });

    const res = await fetchWithBoundedRetry('/x', { fetcher });
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('确定性编程 TypeError 不会被当作网络错误重试', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      throw new TypeError('AbortSignal.any is not a function');
    });

    await expect(
      fetchJsonWithBoundedRetry('/x', { fetcher, backoffMs: 0 }),
    ).rejects.toThrow('AbortSignal.any is not a function');
    expect(calls).toBe(1);
  });
});
