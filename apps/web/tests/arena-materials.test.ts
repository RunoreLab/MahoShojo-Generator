import { describe, expect, test } from 'vitest';

import {
  buildArenaMaterialState,
  normalizeArenaMaterialsForRequest,
} from '@/lib/arena/materials';

describe('arena materials', () => {
  test('原生验签与预设来源分开保存', () => {
    const signedLocal = buildArenaMaterialState({
      payload: { title: '签名本地素材' },
      fileName: 'signed-local.json',
      isNative: true,
    });
    const explicitPreset = buildArenaMaterialState({
      payload: { title: '明确预设素材' },
      fileName: 'preset.json',
      isNative: false,
      isPreset: true,
    });

    expect(signedLocal).toMatchObject({ isNative: true, isPreset: false });
    expect(explicitPreset).toMatchObject({ isNative: false, isPreset: true });
    expect(normalizeArenaMaterialsForRequest([explicitPreset]))
      .toEqual([expect.objectContaining({ isNative: false, isPreset: true })]);
  });

  test('任意万途 Card 包括 character 都可作为素材', () => {
    const card = {
      cardKind: 'character',
      name: '星轨记录员',
      content: '她记录每一条列车到站时的愿望。',
      fields: { role: 'archivist' },
    };

    const material = buildArenaMaterialState({
      payload: card,
      fileName: '星轨记录员.json',
      sourceDataCardId: 'card-1',
      sourceDataCardUpdatedAt: '2026-05-13T06:00:00.000Z',
    });

    expect(material.sourceKind).toBe('wantu-card');
    expect(material.sourceType).toBe('character');
    expect(material.name).toBe('星轨记录员');
    expect(material.content).toEqual(card);
  });

  test('本仓库数据卡保留原始 payload 和类型元信息', () => {
    const material = buildArenaMaterialState({
      payload: {
        templateId: '通用情景',
        title: '雨夜站台',
        content: '末班车停在没有编号的月台。',
        _cardId: 'scenario-1',
        _cardName: '雨夜站台卡',
        _updatedAt: '2026-05-13T07:00:00.000Z',
      },
      sourceType: 'scenario',
    });

    expect(material.sourceKind).toBe('mahoshojo-data-card');
    expect(material.sourceType).toBe('scenario');
    expect(material.sourceDataCardId).toBe('scenario-1');
    expect(material.sourceDataCardUpdatedAt).toBe('2026-05-13T07:00:00.000Z');
    expect(material.content).toEqual({
      templateId: '通用情景',
      title: '雨夜站台',
      content: '末班车停在没有编号的月台。',
    });
  });

  test('请求侧素材规范化不再按旧的单类 10 项静默截断', () => {
    const raw = Array.from({ length: 12 }, (_, index) => ({
      id: `m-${index}`,
      name: `素材 ${index}`,
      content: { index },
      sourceKind: 'raw-json',
      sourceType: 'raw-json',
    }));

    const normalized = normalizeArenaMaterialsForRequest(raw);

    expect(normalized).toHaveLength(12);
    expect(normalized[0]?.name).toBe('素材 0');
    expect(normalized[11]?.name).toBe('素材 11');
    expect(normalizeArenaMaterialsForRequest(undefined)).toEqual([]);
  });
});
