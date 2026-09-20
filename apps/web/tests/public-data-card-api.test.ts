import { describe, expect, it, vi } from 'vitest';

import { fetchPublicDataCardRowById } from '@/lib/public-card-cache/public-data-card-api';

describe('public data card API freshness', () => {
  it('房间 fresh 读取使用独立 URL 并禁止浏览器复用缓存，普通读取保留稳定 URL', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ success: true, card: { id: 'card/a' } }),
    );
    await fetchPublicDataCardRowById('card/a', { fetcher });
    await fetchPublicDataCardRowById('card/a', { fetcher, fresh: true });
    await fetchPublicDataCardRowById('card/a', { fetcher, fresh: true });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/public-data-cards?id=card%2Fa');
    expect(fetcher.mock.calls[0]![1]?.cache).toBeUndefined();
    expect(fetcher.mock.calls[1]![0]).toMatch(/^\/api\/public-data-cards\?id=card%2Fa&refresh=/u);
    expect(fetcher.mock.calls[2]![0]).not.toBe(fetcher.mock.calls[1]![0]);
    expect(fetcher.mock.calls[1]![1]?.cache).toBe('no-store');
  });
});
