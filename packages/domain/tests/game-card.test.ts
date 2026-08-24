import { describe, expect, it } from 'vitest';

import {
  GAME_CARD_FORGE_DOCUMENT_TYPE,
  GAME_CARD_FORGE_DOCUMENT_VERSION,
  GameCardForgeDocumentSchema,
} from '@mahoshojo/domain/game-card';
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

describe('game card domain document', () => {
  it('使用 canonical 卡面 contract 校验版本化 Forge document', () => {
    expect(GameCardForgeDocumentSchema.parse({
      documentType: GAME_CARD_FORGE_DOCUMENT_TYPE,
      documentVersion: GAME_CARD_FORGE_DOCUMENT_VERSION,
      faceData: GameCardFaceDataSchema.parse(faceData),
      illustration: null,
    })).toMatchObject({
      documentType: 'maho-shojo-game-card-forge',
      documentVersion: 1,
      faceData,
      illustration: null,
    });
  });
});
