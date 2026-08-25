import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChannelAvailabilityResponse } from '@/lib/ai/availability/rebuild-snapshot';

// Mock DB
const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock('@/lib/db/drizzle', () => ({
  getDrizzleDbFromRuntime: () => ({
    select: mockSelect,
    insert: mockInsert,
  }),
}));

// Mock AI_PROVIDER_CATALOG to have known entries
vi.mock('@/lib/ai/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/constants')>();
  return {
    ...actual,
    AI_PROVIDER_CATALOG: [
      {
        id: 'system',
        name: '系统',
        description: '',
        docsUrl: '',
        baseUrl: '',
        type: 'openai' as const,
        models: [
          { value: 'default', label: '默认', description: '' },
          { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: '' },
        ],
      },
      {
        id: 'kourichat',
        name: 'KouriChat',
        description: '',
        docsUrl: '',
        baseUrl: 'https://api.kourichat.com',
        type: 'openai' as const,
        models: [
          { value: 'gpt-4o', label: 'GPT-4o', description: '' },
        ],
      },
    ],
  };
});

describe('snapshot 聚合逻辑', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it('空桶 → catalog 全 unknown', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const { rebuildSnapshot } = await import('@/lib/ai/availability/rebuild-snapshot');
    const result = await rebuildSnapshot();

    expect(result.success).toBe(true);
    // 应包含 catalog 所有条目（system:default, system:deepseek-v4-flash, kourichat:gpt-4o）
    expect(result.entries.length).toBe(3);
    for (const entry of result.entries) {
      expect(entry.primary.status).toBe('unknown');
      expect(entry.primary.successRate).toBeNull();
    }
  });

  it('1h 有足够样本 → primary 为 1h', async () => {
    const now = new Date();
    const recentBucket = new Date(now.getTime() - 30 * 60 * 1000).toISOString(); // 30min ago

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { bucketStart: recentBucket, providerId: 'system', modelId: 'default', successCount: 90, failureCount: 10 },
        ]),
      }),
    });

    const { rebuildSnapshot } = await import('@/lib/ai/availability/rebuild-snapshot');
    const result = await rebuildSnapshot();

    const defaultEntry = result.entries.find(e => e.providerId === 'system' && e.modelId === 'default');
    expect(defaultEntry).toBeDefined();
    expect(defaultEntry!.primary.window).toBe('1h');
    expect(defaultEntry!.primary.successRate).toBeCloseTo(0.90);
    expect(defaultEntry!.primary.status).toBe('healthy');
    expect(defaultEntry!.reference).toBeUndefined();
  });

  it('1h 样本不足、24h 有足够 → primary unknown + reference 24h', async () => {
    const now = new Date();
    const oldBucket = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(); // 12h ago
    const recentButSmallBucket = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          // 1h: 只有 2 个样本（不足 MIN_SAMPLE_COUNT=3）
          { bucketStart: recentButSmallBucket, providerId: 'system', modelId: 'default', successCount: 2, failureCount: 0 },
          // 24h: 有足够样本
          { bucketStart: oldBucket, providerId: 'system', modelId: 'default', successCount: 80, failureCount: 20 },
        ]),
      }),
    });

    const { rebuildSnapshot } = await import('@/lib/ai/availability/rebuild-snapshot');
    const result = await rebuildSnapshot();

    const defaultEntry = result.entries.find(e => e.providerId === 'system' && e.modelId === 'default');
    expect(defaultEntry).toBeDefined();
    expect(defaultEntry!.primary.window).toBe('none');
    expect(defaultEntry!.primary.status).toBe('unknown');
    expect(defaultEntry!.reference).toBeDefined();
    expect(defaultEntry!.reference!.window).toBe('24h');
    expect(defaultEntry!.reference!.successRate).toBeCloseTo(0.80);
    expect(defaultEntry!.reference!.status).toBe('degraded');
  });

  it('1h 和 24h 都不足 → 完全 unknown', async () => {
    const now = new Date();
    const recentBucket = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { bucketStart: recentBucket, providerId: 'system', modelId: 'default', successCount: 1, failureCount: 0 },
        ]),
      }),
    });

    const { rebuildSnapshot } = await import('@/lib/ai/availability/rebuild-snapshot');
    const result = await rebuildSnapshot();

    const defaultEntry = result.entries.find(e => e.providerId === 'system' && e.modelId === 'default');
    expect(defaultEntry).toBeDefined();
    expect(defaultEntry!.primary.status).toBe('unknown');
    expect(defaultEntry!.reference).toBeUndefined();
  });

  it('自定义 model（不在 catalog 中）在 24h 有样本时 included', async () => {
    const now = new Date();
    const oldBucket = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { bucketStart: oldBucket, providerId: 'kourichat', modelId: 'custom-xyz', successCount: 10, failureCount: 0 },
        ]),
      }),
    });

    const { rebuildSnapshot } = await import('@/lib/ai/availability/rebuild-snapshot');
    const result = await rebuildSnapshot();

    const customEntry = result.entries.find(e => e.providerId === 'kourichat' && e.modelId === 'custom-xyz');
    expect(customEntry).toBeDefined();
    // 12h old bucket is outside 1h window, so primary is unknown; healthy appears in reference
    expect(customEntry!.primary.status).toBe('unknown');
    expect(customEntry!.reference).toBeDefined();
    expect(customEntry!.reference!.status).toBe('healthy');
  });

  it('自定义 model 样本不足（<3）不 included', async () => {
    const now = new Date();
    const oldBucket = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { bucketStart: oldBucket, providerId: 'kourichat', modelId: 'custom-xyz', successCount: 1, failureCount: 0 },
        ]),
      }),
    });

    const { rebuildSnapshot } = await import('@/lib/ai/availability/rebuild-snapshot');
    const result = await rebuildSnapshot();

    const customEntry = result.entries.find(e => e.providerId === 'kourichat' && e.modelId === 'custom-xyz');
    expect(customEntry).toBeUndefined();
  });

  it('响应不含 sampleCount / excludedCount', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const { rebuildSnapshot } = await import('@/lib/ai/availability/rebuild-snapshot');
    const result = await rebuildSnapshot();

    for (const entry of result.entries) {
      expect(entry).not.toHaveProperty('sampleCount');
      expect(entry).not.toHaveProperty('excludedCount');
    }
  });
});
