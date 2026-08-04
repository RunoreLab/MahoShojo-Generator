import { describe, expect, test } from 'vitest';
import type { GameCardFaceData, ImageTransform } from '@/lib/schemas/game-card';
import {
  buildGameCardForgeDocument,
  parseGameCardForgeImport,
  serializeGameCardForgeDocument,
} from '@/lib/card-forge/document';

const faceData: GameCardFaceData = {
  cardName: '蔷薇荆棘',
  cardType: 'character',
  rarity: 'epic',
  cost: 5,
  element: 'dark',
  attack: 7,
  defense: 4,
  hp: 8,
  effects: [{ type: '被动', description: '荆棘缠绕' }],
  traits: ['控制'],
  flavorText: '盛放于黑夜。',
  powerLevel: 'S',
  description: '测试卡牌',
  themeColor: '#8b5cf6',
};

const transform: ImageTransform = { scale: 1.25, x: 0.2, y: -0.3 };
const imageDataUrl = 'data:image/png;base64,aGVsbG8=';

describe('card forge document', () => {
  test('round-trips face data, embedded image and crop state', () => {
    const json = serializeGameCardForgeDocument({
      faceData,
      imageDataUrl,
      imageSource: 'generated',
      imageAspectRatio: '3:4',
      imageTransform: transform,
      createdAt: '2026-08-04T09:00:00.000Z',
    });

    const imported = parseGameCardForgeImport(JSON.parse(json));

    expect(imported).toEqual({
      faceData,
      imageUrl: imageDataUrl,
      imageSource: 'generated',
      imageAspectRatio: '3:4',
      imageTransform: transform,
    });
  });

  test('exports and imports a card without an illustration', () => {
    const imported = parseGameCardForgeImport(buildGameCardForgeDocument({
      faceData,
      imageDataUrl: null,
      imageSource: null,
      imageAspectRatio: '4:3',
      imageTransform: { scale: 1, x: 0, y: 0 },
    }));

    expect(imported.imageUrl).toBeNull();
    expect(imported.imageSource).toBeNull();
  });

  test('imports the current metadata format and keeps a reachable image URL', () => {
    const imported = parseGameCardForgeImport({
      templateId: '卡牌工坊/游戏卡面',
      faceData,
      imageUrl: 'https://cdn.example.test/card.png',
      imageSource: 'uploaded',
      imageAspectRatio: '16:9',
      imageTransform: transform,
    });

    expect(imported.imageUrl).toBe('https://cdn.example.test/card.png');
    expect(imported.imageAspectRatio).toBe('16:9');
    expect(imported.imageTransform).toEqual(transform);
  });

  test('imports a direct card face JSON without an illustration', () => {
    expect(parseGameCardForgeImport(faceData)).toMatchObject({
      faceData,
      imageUrl: null,
      imageSource: null,
    });
  });

  test('rejects invalid documents without returning partial state', () => {
    expect(() => parseGameCardForgeImport({ faceData: { cardName: '缺字段' } })).toThrow();
    expect(() => parseGameCardForgeImport({
      documentType: 'maho-shojo-game-card-forge',
      documentVersion: 1,
      faceData,
      illustration: {
        dataUrl: 'data:text/plain;base64,SGk=',
        source: 'uploaded',
        aspectRatio: '4:3',
        transform: { scale: 1, x: 0, y: 0 },
      },
    })).toThrow();
  });
});
