import { describe, expect, it } from 'bun:test';
import {
  fromWantuCharacterCard,
  parseWantuCard,
  toArenaMaterialCandidate,
  toWantuCharacterCard,
} from '@/lib/wantu-card/adapter';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas';

const buildState = {
  primaryRuleId: 'arena-trpg-lite',
  rules: [
    {
      ruleId: 'arena-trpg-lite',
      version: '1.0.0',
      blockResults: { powerLevel: 'seed' },
      derived: { HP: 30 },
      validationSummary: { valid: true },
    },
  ],
};

describe('wantu-card adapter', () => {
  it('exports general character cards as Wantu character cards', () => {
    const source = {
      templateId: GENERAL_CHARACTER_TEMPLATE_ID,
      name: '流浪写手',
      content: '在城市的雨夜记录每一次奇迹。',
      buildState,
      current_state: { summary: '轻伤，仍保持清醒。' },
      privateNote: '只在本仓库保留的备注',
    };

    const card = toWantuCharacterCard(source);

    expect(card.cardKind).toBe('character');
    expect(card.name).toBe('流浪写手');
    expect(card.content).toBe('在城市的雨夜记录每一次奇迹。');
    expect(card.fields?.mahoshojoBuildState).toEqual(buildState);
    expect(card.fields?.mahoshojoCurrentState).toEqual({ summary: '轻伤，仍保持清醒。' });
    expect(card.fields?.mahoshojoExtra).toEqual({ privateNote: '只在本仓库保留的备注' });
  });

  it('exports magical girl cards with structured markdown and original fields', () => {
    const source = {
      codename: '星夜绽放',
      appearance: {
        outfit: '层叠的星辰斗篷',
        colorScheme: '深蓝与银白',
      },
      magicConstruct: {
        name: '群星笔记',
        form: '悬浮手账',
        basicAbilities: ['记录轨迹', '折叠星光'],
      },
      wonderlandRule: {
        name: '夜幕索引',
        description: '被记录的约定会在星光下显形。',
      },
      analysis: {
        personalityAnalysis: '沉静且坚定',
      },
      userAnswers: [{ question: '愿望', answer: '保存所有道别' }],
      buildState,
      templateId: '魔法少女/心之花/魔法少女（问卷生成）',
    };

    const card = toWantuCharacterCard(source);

    expect(card.cardKind).toBe('character');
    expect(card.name).toBe('星夜绽放');
    expect(card.content).toContain('## 外观');
    expect(card.content).toContain('层叠的星辰斗篷');
    expect(card.content).toContain('## 魔法构装');
    expect(card.content).toContain('群星笔记');
    expect(card.content).toContain('沉静且坚定');
    expect(card.fields?.mahoshojoMagicalGirl).toMatchObject({
      codename: '星夜绽放',
      magicConstruct: { name: '群星笔记' },
    });
    expect(card.fields?.mahoshojoUserAnswers).toEqual(source.userAnswers);
    expect(card.fields?.mahoshojoBuildState).toEqual(buildState);
  });

  it('exports canshou cards with structured markdown and original fields', () => {
    const source = {
      name: '雾骨鲸',
      appearance: '鲸形轮廓在灰雾中断续浮现。',
      materialAndSkin: '半透明骨片与潮湿雾气。',
      coreConcept: '被遗忘的迁徙',
      coreEmotion: '怅惘',
      attackMethod: '以低频鸣叫震碎记忆锚点。',
      specialAbility: '短暂折叠路径，让敌人走回原地。',
      researcherNotes: '不应在密闭区域追踪。',
      templateId: '魔法少女/心之花/残兽（问卷生成）',
    };

    const card = toWantuCharacterCard(source);

    expect(card.cardKind).toBe('character');
    expect(card.name).toBe('雾骨鲸');
    expect(card.content).toContain('## 外观');
    expect(card.content).toContain('鲸形轮廓');
    expect(card.content).toContain('## 攻击方式');
    expect(card.content).toContain('低频鸣叫');
    expect(card.fields?.mahoshojoCanshou).toMatchObject({
      name: '雾骨鲸',
      coreConcept: '被遗忘的迁徙',
    });
  });

  it('imports Wantu character cards as general characters and preserves Wantu extensions', () => {
    const wantuCard = {
      cardKind: 'character',
      name: '白塔信使',
      content: '负责在封锁城区之间传递口信。',
      fields: {
        strength: 2,
        customStats: { oath: 'never-lost' },
      },
      meta: { author: 'wantu' },
      references: [{ id: 'loc-1', relationship: 'home' }],
      visualAssets: [{ url: 'https://example.test/asset.png' }],
      generationHints: { tone: 'quiet' },
      topLevelUnknown: { keep: true },
    };

    const imported = fromWantuCharacterCard(wantuCard);

    expect(imported.success).toBe(true);
    if (!imported.success) return;
    expect(imported.restored).toBe(false);
    expect(imported.data).toMatchObject({
      templateId: GENERAL_CHARACTER_TEMPLATE_ID,
      name: '白塔信使',
      content: '负责在封锁城区之间传递口信。',
    });
    expect(imported.data.wantuCard).toEqual(wantuCard);

    const exported = toWantuCharacterCard({
      ...imported.data,
      name: '白塔信使（修订）',
      content: '修订后的角色正文。',
    });
    expect(exported.name).toBe('白塔信使（修订）');
    expect(exported.content).toBe('修订后的角色正文。');
    expect(exported.fields).toEqual(wantuCard.fields);
    expect(exported.meta).toEqual(wantuCard.meta);
    expect(exported.references).toEqual(wantuCard.references);
    expect(exported.visualAssets).toEqual(wantuCard.visualAssets);
    expect(exported.generationHints).toEqual(wantuCard.generationHints);
    expect(exported.topLevelUnknown).toEqual(wantuCard.topLevelUnknown);
  });

  it('restores original Mahoshojo payload only when round-trip restore is requested', () => {
    const originalData = {
      codename: '旧日余辉',
      magicConstruct: { name: '余辉灯' },
      templateId: '魔法少女/心之花/魔法少女（问卷生成）',
    };
    const wantuCard = {
      cardKind: 'character',
      name: '旧日余辉',
      content: '万途互通正文。',
      fields: { influence: 4 },
      _mahoshojo: {
        version: 1,
        originalTemplate: 'magical-girl',
        originalData,
      },
    };

    const interop = fromWantuCharacterCard(wantuCard);
    expect(interop.success).toBe(true);
    if (!interop.success) return;
    expect(interop.restored).toBe(false);
    expect(interop.data.templateId).toBe(GENERAL_CHARACTER_TEMPLATE_ID);

    const restored = fromWantuCharacterCard(wantuCard, { restoreOriginal: true });
    expect(restored.success).toBe(true);
    if (!restored.success) return;
    expect(restored.restored).toBe(true);
    expect(restored.data).toEqual(originalData);
  });

  it('exports round-trip mode with the original Mahoshojo payload', () => {
    const source = {
      templateId: GENERAL_CHARACTER_TEMPLATE_ID,
      name: '线索保管人',
      content: '将每一条线索编号收藏。',
      arena_history: { entries: [{ id: 1, title: '初战' }] },
    };

    const card = toWantuCharacterCard(source, {
      mode: 'roundTrip',
      source: { id: 'card-1', type: 'data_card' },
    });

    expect(card._mahoshojo).toEqual({
      version: 1,
      originalTemplate: 'general',
      originalData: source,
      source: { id: 'card-1', type: 'data_card' },
    });
  });

  it('projects non-character Wantu cards as arena material candidates', () => {
    const location = {
      cardKind: 'location',
      name: '灰潮车站',
      content: '终年有盐雾穿过废弃站台。',
      fields: { hazard: 'salt-fog' },
    };

    const material = toArenaMaterialCandidate(location, {
      fileName: '灰潮车站.json',
      sourceDataCardId: 'loc-1',
      sourceDataCardUpdatedAt: '2026-05-13T06:00:00.000Z',
    });

    expect(material.success).toBe(true);
    if (!material.success) return;
    expect(material.data).toEqual({
      id: 'loc-1',
      kind: 'location',
      name: '灰潮车站',
      content: location,
      fileName: '灰潮车站.json',
      sourceDataCardId: 'loc-1',
      sourceDataCardUpdatedAt: '2026-05-13T06:00:00.000Z',
    });
  });

  it('returns clear errors for invalid Wantu cards', () => {
    const badKind = parseWantuCard({
      cardKind: 'vehicle',
      name: '不支持的载具卡',
      content: '首版不支持。',
    });
    expect(badKind.success).toBe(false);
    if (!badKind.success) {
      expect(badKind.error).toContain('cardKind');
      expect(badKind.error).toContain('vehicle');
    }

    const missingContent = fromWantuCharacterCard({
      cardKind: 'character',
      name: '缺少正文',
    });
    expect(missingContent.success).toBe(false);
    if (!missingContent.success) {
      expect(missingContent.error).toContain('content');
    }
  });
});
