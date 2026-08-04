import { describe, expect, test } from 'vitest';

import { applyShieldWordsToGameCardFaceData } from '@/lib/card-forge/content-safety';

describe('card forge content safety', () => {
  test('递归遮罩卡面中的屏蔽词并保留数值字段', () => {
    const result = applyShieldWordsToGameCardFaceData({
      cardName: '来自中国',
      cardType: 'character',
      rarity: 'common',
      cost: 20,
      element: 'neutral',
      attack: 999_999_999,
      defense: null,
      hp: 999_999_999,
      effects: [{ type: '被动', description: '守护中国' }],
      traits: ['中国守护者'],
      flavorText: '安全文本',
      powerLevel: 'S',
      description: '测试卡面',
      themeColor: '#ffffff',
      metadata: { note: '来自中国' },
    });

    expect(result.hasShieldWords).toBe(true);
    expect(result.faceData.cardName).toBe('来自【国度】');
    expect(result.faceData.effects[0]?.description).toBe('守护【国度】');
    expect(result.faceData.traits[0]).toBe('【国度】守护者');
    expect(result.faceData.metadata).toEqual({ note: '来自【国度】' });
    expect(result.faceData.attack).toBe(999_999_999);
  });
});
