import { describe, expect, test } from 'vitest';

import { config } from '@/lib/config';
import { isStrictRankedModelBlacklisted, STRICT_RANKED_MODEL_FALLBACKS } from '@/lib/arena/ranked-model-policy';

describe('ranked-model-policy: strict ranked', () => {
  /**
   * 原来这里还逐条抄了一遍 `STRICT_RANKED_MODEL_FALLBACKS` 的字面量（六条模型 id 与顺序），
   * 本轮删掉。那是 `packages/domain/src/arena-ranked-model-policy.ts` 的**逐字转抄**：
   * 生产常量改了它会红，而生产常量本来就是权威——转抄不构成第二条约束，只构成第二处
   * 会各自腐烂的副本。模型清单本身属于 provider 元数据，会随模型上下架变动，
   * 不该由门禁钉住。
   *
   * 真正有长期保护需要的只剩两条，都不是「清单里有哪些模型」：
   * 下面第 17 行的**跨模块接线**（配置里的回退名单必须就是这个名单），以及名单里
   * 没有黑名单模型。
   */
  test('严格排位默认模型回退名单与数据卡自动预审查一致', () => {
    expect(config.DATA_CARD_AUTO_REVIEW.modelFallbacks).toEqual(Array.from(STRICT_RANKED_MODEL_FALLBACKS));
  });

  test('严格排位默认模型回退名单不包含黑名单模型', () => {
    for (const modelId of STRICT_RANKED_MODEL_FALLBACKS) {
      expect(isStrictRankedModelBlacklisted(modelId)).toBe(false);
    }
  });
});
