import { describe, expect, test } from 'vitest';

import { gameCardGenerationConfig } from '@/lib/game-card/config';
import { GameCardFaceDataSchema } from '@/lib/schemas/game-card';

const faceData = {
  cardName: '高数值卡',
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
};

describe('卡牌工坊上限策略', () => {
  test('卡面属性允许显示九位数值', () => {
    expect(GameCardFaceDataSchema.parse(faceData)).toMatchObject({
      attack: 999_999_999,
      defense: 999_999_999,
      hp: 999_999_999,
    });
  });

  test('卡牌生成任务不再固定 AI 输出 token 上限', () => {
    expect(gameCardGenerationConfig.maxOutputTokens).toBeUndefined();
  });
});
