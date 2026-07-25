import { describe, expect, it, vi, beforeEach } from 'vitest';

// --- Mocks ---

const mockQueryFromD1 = vi.fn();
const mockRebuildSnapshot = vi.fn();

vi.mock('@/lib/database/core', () => ({
  queryFromD1: (...args: unknown[]) => mockQueryFromD1(...args),
}));

vi.mock('@/lib/ai/availability', () => ({
  rebuildSnapshot: (...args: unknown[]) => mockRebuildSnapshot(...args),
}));

// --- Helpers ---

function mockD1Results(rows: Record<string, unknown>[]) {
  return { result: [{ results: rows }] };
}

function mockD1Count(total: number) {
  return { result: [{ results: [{ total }] }] };
}

function mockD1Changes(changes: number) {
  return { result: [{ meta: { changes } }] };
}

// --- Tests ---

describe('admin ai-channel-availability handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET summary view', () => {
    it('返回 summary 视图包含 stats 和 channels', async () => {
      // Mock summary query
      mockQueryFromD1
        .mockResolvedValueOnce(mockD1Results([{
          total_providers: 3,
          total_models: 10,
          total_buckets: 500,
          total_success: 450,
          total_failure: 30,
          total_excluded: 20,
          earliest_bucket: '2026-07-24T00:00:00.000Z',
          latest_bucket: '2026-07-25T12:00:00.000Z',
        }]))
        // Mock 24h bucket query
        .mockResolvedValueOnce(mockD1Results([
          {
            provider_id: 'system', model_id: 'default', bucket_start: '2026-07-25T11:30:00.000Z',
            success_count: 45, failure_count: 2, excluded_count: 5, last_error_class: 'timeout',
          },
          {
            provider_id: 'system', model_id: 'default', bucket_start: '2026-07-25T06:00:00.000Z',
            success_count: 200, failure_count: 10, excluded_count: 15, last_error_class: null,
          },
        ]))
        // Mock error distribution query
        .mockResolvedValueOnce(mockD1Results([
          { last_error_class: 'timeout', count: 30 },
          { last_error_class: 'billing', count: 15 },
        ]))
        // Mock snapshot info query
        .mockResolvedValueOnce(mockD1Results([{
          updated_at: '2026-07-25T12:01:00.000Z',
          source_bucket_max: '2026-07-25T12:00:00.000Z',
        }]));

      const { GET } = await import('@/components/creation/api/admin/ai-channel-availability');
      const req = new Request('https://example.test/api/admin/ai-channel-availability');
      const res = await GET(req);
      const body = await res.json() as any;

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.view).toBe('summary');
      expect(body.summary).toBeDefined();
      expect(body.summary.totalProviders).toBe(3);
      expect(body.summary.totalModels).toBe(10);
      expect(body.summary.overallSuccessRate).toBeCloseTo(0.9375); // 450/(450+30)
      expect(body.channels).toBeInstanceOf(Array);
      expect(body.channels.length).toBeGreaterThan(0);
      expect(body.errorDistribution).toBeInstanceOf(Array);
    });
  });

  describe('GET buckets view', () => {
    it('返回原始桶数据带分页', async () => {
      mockQueryFromD1
        // Count query
        .mockResolvedValueOnce(mockD1Count(100))
        // Data query
        .mockResolvedValueOnce(mockD1Results([
          {
            bucket_start: '2026-07-25T12:30:00.000Z',
            provider_id: 'system',
            model_id: 'default',
            success_count: 12,
            failure_count: 1,
            excluded_count: 3,
            last_error_class: 'timeout',
            updated_at: '2026-07-25T12:34:59.000Z',
          },
        ]));

      const { GET } = await import('@/components/creation/api/admin/ai-channel-availability');
      const req = new Request('https://example.test/api/admin/ai-channel-availability?view=buckets&page=1&limit=50');
      const res = await GET(req);
      const body = await res.json() as any;

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.view).toBe('buckets');
      expect(body.rows).toHaveLength(1);
      expect(body.total).toBe(100);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(50);
      expect(body.totalPages).toBe(2);
      expect(body.rows[0].providerId).toBe('system');
    });

    it('支持 provider 筛选', async () => {
      mockQueryFromD1
        .mockResolvedValueOnce(mockD1Count(5))
        .mockResolvedValueOnce(mockD1Results([]));

      const { GET } = await import('@/components/creation/api/admin/ai-channel-availability');
      const req = new Request('https://example.test/api/admin/ai-channel-availability?view=buckets&provider=system');
      const res = await GET(req);

      expect(res.status).toBe(200);
      // Verify the SQL contains provider_id = ?
      const countCall = mockQueryFromD1.mock.calls[0];
      expect(countCall[0]).toContain('provider_id');
    });

    it('limit 上限为 200', async () => {
      mockQueryFromD1
        .mockResolvedValueOnce(mockD1Count(0))
        .mockResolvedValueOnce(mockD1Results([]));

      const { GET } = await import('@/components/creation/api/admin/ai-channel-availability');
      const req = new Request('https://example.test/api/admin/ai-channel-availability?view=buckets&limit=999');
      const res = await GET(req);
      const body = await res.json() as any;

      expect(res.status).toBe(200);
      expect(body.limit).toBe(200);
    });
  });

  describe('POST cleanup', () => {
    it('清理旧桶数据并返回删除行数', async () => {
      // Batch 1: 1000 rows (full batch → continues)
      // Batch 2: 500 rows (< BATCH_SIZE → breaks)
      mockQueryFromD1
        .mockResolvedValueOnce(mockD1Changes(1000))
        .mockResolvedValueOnce(mockD1Changes(500));

      const { POST } = await import('@/components/creation/api/admin/ai-channel-availability');
      const req = new Request('https://example.test/api/admin/ai-channel-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup', olderThanDays: 7 }),
      });
      const res = await POST(req);
      const body = await res.json() as any;

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.deletedRows).toBe(1500);
      expect(body.cutoffTime).toBeDefined();
      expect(mockQueryFromD1).toHaveBeenCalledTimes(2);
    });

    it('大批量清理会分批执行', async () => {
      // 3 full batches + 1 partial
      mockQueryFromD1
        .mockResolvedValueOnce(mockD1Changes(1000))
        .mockResolvedValueOnce(mockD1Changes(1000))
        .mockResolvedValueOnce(mockD1Changes(1000))
        .mockResolvedValueOnce(mockD1Changes(200));

      const { POST } = await import('@/components/creation/api/admin/ai-channel-availability');
      const req = new Request('https://example.test/api/admin/ai-channel-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup', olderThanDays: 30 }),
      });
      const res = await POST(req);
      const body = await res.json() as any;

      expect(res.status).toBe(200);
      expect(body.deletedRows).toBe(3200);
      expect(mockQueryFromD1).toHaveBeenCalledTimes(4);
    });

    it('olderThanDays 缺失时返回 400', async () => {
      const { POST } = await import('@/components/creation/api/admin/ai-channel-availability');
      const req = new Request('https://example.test/api/admin/ai-channel-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup' }),
      });
      const res = await POST(req);
      const body = await res.json() as any;

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
    });
  });

  describe('POST refresh-snapshot', () => {
    it('强制重建快照并返回新 generatedAt', async () => {
      const generatedAt = '2026-07-25T12:05:00.000Z';
      mockRebuildSnapshot.mockResolvedValue({
        success: true,
        generatedAt,
        windows: { '1h': { durationSeconds: 3600 }, '24h': { durationSeconds: 86400 } },
        minSampleCount: 3,
        entries: [],
      });

      const { POST } = await import('@/components/creation/api/admin/ai-channel-availability');
      const req = new Request('https://example.test/api/admin/ai-channel-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh-snapshot' }),
      });
      const res = await POST(req);
      const body = await res.json() as any;

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.generatedAt).toBe(generatedAt);
      expect(mockRebuildSnapshot).toHaveBeenCalledOnce();
    });
  });

  describe('error handling', () => {
    it('不支持的方法返回 405', async () => {
      const { PUT } = await import('@/components/creation/api/admin/ai-channel-availability');
      if (PUT) {
        const req = new Request('https://example.test/api/admin/ai-channel-availability', { method: 'PUT' });
        const res = await PUT(req);
        expect(res.status).toBe(405);
      }
    });

    it('未知 action 返回 400', async () => {
      const { POST } = await import('@/components/creation/api/admin/ai-channel-availability');
      const req = new Request('https://example.test/api/admin/ai-channel-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unknown' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });
});
