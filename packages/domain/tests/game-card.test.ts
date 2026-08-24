import { describe, expect, it } from 'vitest';

import {
  GAME_CARD_GENERATION_CONFIG,
  GAME_CARD_SYSTEM_PROMPT,
  GameCardFaceDataSchema,
  buildGameCardGenerationPrompt,
} from '@mahoshojo/domain/game-card';

const faceData = {
  cardName: '测试卡牌',
  cardType: 'character',
  rarity: 'common',
  cost: 20,
  element: 'neutral',
  attack: 999_999_999,
  defense: 999_999_999,
  hp: 999_999_999,
  effects: [{ type: '被动', description: '测试效果' }],
  traits: ['测试'],
  flavorText: '测试文本',
  powerLevel: 'S',
  description: '测试卡面',
  themeColor: '#ffffff',
  extension: { retained: true },
};

describe('game card domain contract', () => {
  it('持有 canonical 卡面 schema 并保留 catchall 与既有上限语义', () => {
    expect(GameCardFaceDataSchema.parse(faceData)).toEqual(faceData);
    const { element, ...withoutElement } = faceData;
    expect(element).toBe('neutral');
    expect(() => GameCardFaceDataSchema.parse(withoutElement)).toThrow();
    expect(() => GameCardFaceDataSchema.parse({ ...faceData, cost: 21 })).toThrow();
    expect(() => GameCardFaceDataSchema.parse({ ...faceData, hp: 0 })).toThrow();
  });

  it('持有 canonical 生成 prompt/config 且不设任务级 token 上限', () => {
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
