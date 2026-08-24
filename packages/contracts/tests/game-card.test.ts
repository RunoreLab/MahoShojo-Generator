import { describe, expect, it } from 'vitest';

import { GameCardFaceDataSchema } from '@mahoshojo/contracts/game-card';

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

describe('game card wire contract', () => {
  it('保留 catchall 与既有数值边界', () => {
    expect(GameCardFaceDataSchema.parse(faceData)).toEqual(faceData);
    const { element, ...withoutElement } = faceData;
    expect(element).toBe('neutral');
    expect(() => GameCardFaceDataSchema.parse(withoutElement)).toThrow();
    expect(() => GameCardFaceDataSchema.parse({ ...faceData, cost: 21 })).toThrow();
    expect(() => GameCardFaceDataSchema.parse({ ...faceData, hp: 0 })).toThrow();
  });
});
