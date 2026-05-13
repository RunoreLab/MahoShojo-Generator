import { describe, expect, it } from 'bun:test';

import {
  buildWantuCharacterExportPayload,
  getWantuCharacterExportModeFromPreference,
  parseStoredWantuRoundTripExportPreference,
  resolveWantuCharacterImport,
} from '@/lib/wantu-card/character-manager';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas';

describe('wantu-card character manager helpers', () => {
  it('ignores regular Mahoshojo data cards during import detection', () => {
    const result = resolveWantuCharacterImport({
      templateId: GENERAL_CHARACTER_TEMPLATE_ID,
      name: '雾灯',
      content: '普通通用角色。',
    });

    expect(result.kind).toBe('not-wantu');
  });

  it('imports Wantu character cards as editable general characters', () => {
    const wantuCard = {
      cardKind: 'character',
      name: '白塔信使',
      content: '负责在封锁城区之间传递口信。',
      fields: {
        strength: 2,
        customStats: { oath: 'never-lost' },
      },
      meta: { author: 'wantu' },
    };

    const result = resolveWantuCharacterImport(wantuCard);

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.selectedTemplate).toBe('general');
    expect(result.validationResult.success).toBe(true);
    expect(result.restored).toBe(false);
    expect(result.data).toMatchObject({
      templateId: GENERAL_CHARACTER_TEMPLATE_ID,
      name: '白塔信使',
      content: '负责在封锁城区之间传递口信。',
      wantuCard,
    });
    expect(result.message).toContain('成功导入万途角色卡为通用角色');
  });

  it('restores the Mahoshojo payload only when explicitly requested', () => {
    const originalData = {
      codename: '旧日余辉',
      magicConstruct: { name: '余辉灯' },
      templateId: '魔法少女/心之花/魔法少女（问卷生成）',
    };
    const wantuCard = {
      cardKind: 'character',
      name: '旧日余辉',
      content: '万途互通正文。',
      _mahoshojo: {
        version: 1,
        originalTemplate: 'magical-girl',
        originalData,
      },
    };

    const interop = resolveWantuCharacterImport(wantuCard);
    expect(interop.kind).toBe('success');
    if (interop.kind !== 'success') return;
    expect(interop.restored).toBe(false);
    expect(interop.selectedTemplate).toBe('general');
    expect(interop.warnings).toHaveLength(1);

    const restored = resolveWantuCharacterImport(wantuCard, { restoreOriginal: true });
    expect(restored.kind).toBe('success');
    if (restored.kind !== 'success') return;
    expect(restored.restored).toBe(true);
    expect(restored.selectedTemplate).toBe('magical-girl');
    expect(restored.data).toEqual(originalData);
  });

  it('rejects non-character Wantu cards in the character manager import flow', () => {
    const result = resolveWantuCharacterImport({
      cardKind: 'location',
      name: '灰潮车站',
      content: '终年有盐雾穿过废弃站台。',
    });

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.error).toContain('仅支持导入万途 character');
  });

  it('builds Wantu character export payloads with safe filenames', () => {
    const result = buildWantuCharacterExportPayload(
      {
        templateId: GENERAL_CHARACTER_TEMPLATE_ID,
        name: '流浪/写手',
        content: '在城市的雨夜记录每一次奇迹。',
      },
      { mode: 'roundTrip', source: { id: 'card-1', type: 'data_card' } },
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.fileName).toBe('万途角色卡_流浪_写手_往返.json');
    expect(result.card).toMatchObject({
      cardKind: 'character',
      name: '流浪/写手',
      content: '在城市的雨夜记录每一次奇迹。',
      _mahoshojo: {
        version: 1,
        originalTemplate: 'general',
        source: { id: 'card-1', type: 'data_card' },
      },
    });
    expect(JSON.parse(result.json)).toEqual(result.card);
  });

  it('defaults Wantu export to interop unless round-trip preference is enabled', () => {
    expect(parseStoredWantuRoundTripExportPreference(null)).toBe(false);
    expect(parseStoredWantuRoundTripExportPreference('false')).toBe(false);
    expect(parseStoredWantuRoundTripExportPreference('true')).toBe(true);
    expect(parseStoredWantuRoundTripExportPreference('broken')).toBe(false);

    expect(getWantuCharacterExportModeFromPreference(false)).toBe('interop');
    expect(getWantuCharacterExportModeFromPreference(true)).toBe('roundTrip');
  });
});
