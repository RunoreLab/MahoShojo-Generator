import { describe, expect, test } from 'bun:test';

import { config } from '@/lib/config';
import { isStrictRankedModelBlacklisted, STRICT_RANKED_MODEL_FALLBACKS } from '@/lib/arena/ranked-model-policy';

describe('ranked-model-policy: strict ranked', () => {
  test('严格排位默认模型回退名单顺序稳定，并与数据卡自动预审查一致', () => {
    expect(Array.from(STRICT_RANKED_MODEL_FALLBACKS)).toEqual([
      'gemma-3-27b-it',
      'gemini-2.5-flash-lite',
      'glm-4.7',
      'gemma-3-12b-it',
      'gemini-2.5-flash',
    ]);

    expect(config.DATA_CARD_AUTO_REVIEW.modelFallbacks).toEqual(Array.from(STRICT_RANKED_MODEL_FALLBACKS));
  });

  test('严格排位默认模型回退名单不包含黑名单模型', () => {
    for (const modelId of STRICT_RANKED_MODEL_FALLBACKS) {
      expect(isStrictRankedModelBlacklisted(modelId)).toBe(false);
    }
  });
});

