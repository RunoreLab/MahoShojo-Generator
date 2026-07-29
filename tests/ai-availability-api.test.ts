import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock modules
const mockRebuildSnapshot = vi.fn();

vi.mock('@/lib/ai/availability', () => ({
  rebuildSnapshot: (...args: unknown[]) => mockRebuildSnapshot(...args),
}));

vi.mock('@/lib/edge-cache', () => ({
  withEdgeCache: async (_req: Request, _opts: unknown, handler: () => Promise<Response>) => handler(),
}));

describe('GET /api/ai/channel-availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回 200 和正确结构', async () => {
    const mockResponse = {
      success: true,
      generatedAt: new Date().toISOString(),
      windows: { '1h': { durationSeconds: 3600 }, '24h': { durationSeconds: 86400 } },
      minSampleCount: 3,
      entries: [
        {
          providerId: 'system',
          modelId: 'default',
          primary: { window: '1h', successRate: 0.95, status: 'healthy' },
        },
      ],
    };
    mockRebuildSnapshot.mockResolvedValue(mockResponse);

    const { GET } = await import('@/app/api/ai/channel-availability/route');
    const req = new Request('http://localhost/api/ai/channel-availability', { method: 'GET' });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].providerId).toBe('system');
    expect(body.minSampleCount).toBe(3);
    // 不含 sampleCount
    expect(body.entries[0]).not.toHaveProperty('sampleCount');
  });

  it('HEAD 也返回 200', async () => {
    mockRebuildSnapshot.mockResolvedValue({
      success: true,
      generatedAt: new Date().toISOString(),
      windows: { '1h': { durationSeconds: 3600 }, '24h': { durationSeconds: 86400 } },
      minSampleCount: 3,
      entries: [],
    });

    const { HEAD } = await import('@/app/api/ai/channel-availability/route');
    const req = new Request('http://localhost/api/ai/channel-availability', { method: 'HEAD' });
    const res = await HEAD(req);
    expect(res.status).toBe(200);
  });

  it('不支持的方法未导出', async () => {
    const route = await import('@/app/api/ai/channel-availability/route');
    expect(route.POST).toBeUndefined();
    expect(route.PUT).toBeUndefined();
    expect(route.DELETE).toBeUndefined();
  });

  it('响应包含 Cache-Control header', async () => {
    mockRebuildSnapshot.mockResolvedValue({
      success: true,
      generatedAt: new Date().toISOString(),
      windows: { '1h': { durationSeconds: 3600 }, '24h': { durationSeconds: 86400 } },
      minSampleCount: 3,
      entries: [],
    });

    const { GET } = await import('@/app/api/ai/channel-availability/route');
    const req = new Request('http://localhost/api/ai/channel-availability', { method: 'GET' });
    const res = await GET(req);
    expect(res.headers.get('Cache-Control')).toContain('max-age=45');
    expect(res.headers.get('Cloudflare-CDN-Cache-Control')).toContain('s-maxage=45');
  });

  it('空数据时返回全 unknown entries', async () => {
    mockRebuildSnapshot.mockResolvedValue({
      success: true,
      generatedAt: new Date().toISOString(),
      windows: { '1h': { durationSeconds: 3600 }, '24h': { durationSeconds: 86400 } },
      minSampleCount: 3,
      entries: [],
    });

    const { GET } = await import('@/app/api/ai/channel-availability/route');
    const req = new Request('http://localhost/api/ai/channel-availability', { method: 'GET' });
    const res = await GET(req);
    const body = await res.json();
    expect(body.entries).toEqual([]);
  });
});
