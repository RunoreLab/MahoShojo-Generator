import { describe, expect, test } from 'vitest';

import { isStrictRankedModelBlacklisted, STRICT_RANKED_MODEL_FALLBACKS } from '@/lib/arena/ranked-model-policy';

describe('ranked-model-policy: strict ranked', () => {
  /**
   * 原来这里还逐条抄了一遍 `STRICT_RANKED_MODEL_FALLBACKS` 的字面量（六条模型 id 与顺序），
   * 本轮删掉。那是 `packages/domain/src/arena-ranked-model-policy.ts` 的**逐字转抄**：
   * 生产常量改了它会红，而生产常量本来就是权威——转抄不构成第二条约束，只构成第二处
   * 会各自腐烂的副本。模型清单本身属于 provider 元数据，会随模型上下架变动，
   * 不该由门禁钉住。
   *
   * 原先还有一条「config.DATA_CARD_AUTO_REVIEW.modelFallbacks 必须等于该名单」的接线断言，
   * 随自动审查 legacy 通路移除（r1：未配置新后端即无 AI 审查）一并删去——该字段已不复存在。
   * 真正有长期保护需要的只剩名单里没有黑名单模型。
   */
  test('严格排位默认模型回退名单不包含黑名单模型', () => {
    for (const modelId of STRICT_RANKED_MODEL_FALLBACKS) {
      expect(isStrictRankedModelBlacklisted(modelId)).toBe(false);
    }
  });
});
