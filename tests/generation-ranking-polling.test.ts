import { describe, expect, test } from 'vitest';

import {
  GENERATION_RANKING_MAX_ATTEMPTS,
  GENERATION_RANKING_MAX_DURATION_MS,
  getGenerationRankingRefetchInterval,
  shouldEnableGenerationRankingRecovery,
} from '@/components/arena/utils/generation-ranking-polling';

describe('generation ranking polling', () => {
  test('SSE 已写入终态结果时不再发起恢复查询', () => {
    expect(shouldEnableGenerationRankingRecovery({
      generationId: 'generation-1',
      isGenerating: false,
      hasTerminalRanking: true,
    })).toBe(false);
    expect(shouldEnableGenerationRankingRecovery({
      generationId: 'generation-1',
      isGenerating: false,
      hasTerminalRanking: false,
    })).toBe(true);
  });

  test('仅在生成结束且 generationId 存在时启用', () => {
    expect(getGenerationRankingRefetchInterval({ enabled: false, pending: true, attemptCount: 1, elapsedMs: 0 })).toBe(false);
    expect(getGenerationRankingRefetchInterval({ enabled: true, pending: true, attemptCount: 1, elapsedMs: 0 })).toBe(2_000);
  });

  test('pending 按 2、5、10、20 秒退避', () => {
    expect([1, 2, 3, 4, 5].map((attemptCount) => getGenerationRankingRefetchInterval({
      enabled: true,
      pending: true,
      attemptCount,
      elapsedMs: 1_000,
    }))).toEqual([2_000, 5_000, 10_000, 20_000, 20_000]);
  });

  test('终态、8 次请求或 60 秒后停止', () => {
    expect(getGenerationRankingRefetchInterval({ enabled: true, pending: false, attemptCount: 1, elapsedMs: 0 })).toBe(false);
    expect(getGenerationRankingRefetchInterval({
      enabled: true,
      pending: true,
      attemptCount: GENERATION_RANKING_MAX_ATTEMPTS,
      elapsedMs: 1_000,
    })).toBe(false);
    expect(getGenerationRankingRefetchInterval({
      enabled: true,
      pending: true,
      attemptCount: 2,
      elapsedMs: GENERATION_RANKING_MAX_DURATION_MS,
    })).toBe(false);
  });
});
