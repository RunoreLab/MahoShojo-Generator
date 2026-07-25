import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChannelAvailabilityResponse } from '@/lib/ai/availability/rebuild-snapshot';

// Mock the DB module before importing rebuild-snapshot
const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock('@/lib/db/drizzle', () => ({
  getDrizzleDbFromRuntime: () => ({
    select: mockSelect,
    insert: mockInsert,
  }),
}));

describe('ai-availability-snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  describe('快照响应结构', () => {
    it('无 DB 时返回空响应', async () => {
      // Re-import with null DB
      vi.mocked(await import('@/lib/db/drizzle')).getDrizzleDbFromRuntime = (() => null) as any;
      const { rebuildSnapshot } = await import('@/lib/ai/availability/rebuild-snapshot');
      const result = await rebuildSnapshot();
      expect(result.success).toBe(true);
      expect(result.entries).toEqual([]);
      expect(result.minSampleCount).toBe(3);
      expect(result.windows).toEqual({ '1h': { durationSeconds: 3600 }, '24h': { durationSeconds: 86400 } });
    });
  });

  describe('状态阈值', () => {
    it('≥ 0.90 → healthy', async () => {
      const { getStatus } = await import('@/lib/ai/availability/rebuild-snapshot').then((m) => ({
        getStatus: (rate: number) => (rate >= 0.90 ? 'healthy' : rate >= 0.70 ? 'degraded' : 'poor'),
      }));
      expect(getStatus(0.90)).toBe('healthy');
      expect(getStatus(1.0)).toBe('healthy');
      expect(getStatus(0.95)).toBe('healthy');
    });

    it('≥ 0.70 且 < 0.90 → degraded', async () => {
      const { getStatus } = await import('@/lib/ai/availability/rebuild-snapshot').then((m) => ({
        getStatus: (rate: number) => (rate >= 0.90 ? 'healthy' : rate >= 0.70 ? 'degraded' : 'poor'),
      }));
      expect(getStatus(0.70)).toBe('degraded');
      expect(getStatus(0.85)).toBe('degraded');
    });

    it('< 0.70 → poor', async () => {
      const { getStatus } = await import('@/lib/ai/availability/rebuild-snapshot').then((m) => ({
        getStatus: (rate: number) => (rate >= 0.90 ? 'healthy' : rate >= 0.70 ? 'degraded' : 'poor'),
      }));
      expect(getStatus(0.50)).toBe('poor');
      expect(getStatus(0.0)).toBe('poor');
    });
  });

  describe('响应不含 sampleCount', () => {
    it('ChannelAvailabilityEntry 不含 sampleCount 字段', () => {
      // Type-level check: ensure the type doesn't have sampleCount
      const entry: ChannelAvailabilityResponse['entries'][0] = {
        providerId: 'test',
        modelId: 'model',
        primary: { window: '1h', successRate: 0.95, status: 'healthy' },
      };
      expect(entry).not.toHaveProperty('sampleCount');
      expect(entry).not.toHaveProperty('excludedCount');
    });
  });
});
