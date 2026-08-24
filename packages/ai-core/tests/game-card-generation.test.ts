import { describe, expect, it } from 'vitest';

import {
  GAME_CARD_GENERATION_CONFIG,
  GAME_CARD_SYSTEM_PROMPT,
  buildGameCardGenerationPrompt,
} from '@mahoshojo/ai-core/game-card-generation';
import { GameCardFaceDataSchema } from '@mahoshojo/contracts/game-card';

describe('game card generation policy', () => {
  it('持有 canonical Prompt/config 且不设任务级 token 上限', () => {
    expect(GAME_CARD_GENERATION_CONFIG).toMatchObject({
      systemPrompt: GAME_CARD_SYSTEM_PROMPT,
      temperature: 0.7,
      schema: GameCardFaceDataSchema,
      taskName: 'generate-game-card',
    });
    expect(GAME_CARD_GENERATION_CONFIG.maxOutputTokens).toBeUndefined();
    expect(buildGameCardGenerationPrompt({
      sourceCardJson: '{"name":"小满"}',
      customInstructions: '  保持简洁  ',
    })).toBe([
      '请根据以下数据卡内容，生成一张卡牌游戏风格的卡面元数据。\n',
      '--- 数据卡内容 ---',
      '{"name":"小满"}',
      '\n--- 用户附加要求 ---',
      '保持简洁',
      '\n--- 要求 ---',
      '1. 仔细分析数据卡内容，提取角色的核心特征、能力和定位',
      '2. 将其转化为卡牌游戏术语和数值',
      '3. 确保卡面信息忠实于原始设定，不凭空捏造核心设定',
      '4. themeColor 必须是有效的 hex 颜色值（如 "#ff6b9d"）',
      '5. effects 数组至少包含 1 个效果，通常 2-4 个',
      '6. traits 数组至少包含 1 个关键词，通常 2-5 个',
    ].join('\n'));
  });
});
