import { describe, expect, it } from 'vitest';

import {
  applySublimationArenaHistoryStrategy,
  buildFinalSublimationData,
  buildSublimationHistoryEntry,
  convertSublimationCharacterCard,
  createBlankSublimationCharacterCard,
  inferSublimationSourceTemplate,
} from '../src/sublimation';

describe('Sublimation domain authority', () => {
  it('角色卡转换保留 authority metadata，且移除旧 signature/templateId', () => {
    const source = {
      codename: '白百合',
      magicConstruct: { name: '星纱', form: '丝带' },
      arena_history: { entries: [{ id: 1, type: 'battle' }] },
      current_state: { summary: '负伤' },
      signature: 'old-signature',
      templateId: '魔法少女/心之花/魔法少女（问卷生成）',
    };

    expect(inferSublimationSourceTemplate(source)).toBe('magical-girl');
    const converted = convertSublimationCharacterCard(source, 'general', 'magical-girl');

    expect(converted.data).toEqual(expect.objectContaining({
      templateId: '通用角色',
      name: '白百合',
      arena_history: source.arena_history,
      current_state: source.current_state,
    }));
    expect(converted.data).not.toHaveProperty('signature');
    expect(converted.data.content).toContain('magicConstruct');
  });

  it('空白模板和 magical-girl 转换保留现有默认与 unmatched appendix 行为', () => {
    expect(createBlankSublimationCharacterCard('canshou')).toEqual(expect.objectContaining({
      name: '未命名残兽',
      templateId: '魔法少女/心之花/残兽（问卷生成）',
    }));

    const converted = convertSublimationCharacterCard({
      name: '旧卡',
      content: '自由文本',
      unknownField: '应进入预测依据',
    }, 'magical-girl', 'general');
    expect(converted.data.analysis).toEqual(expect.objectContaining({
      predictionBasis: expect.stringContaining('unknownField'),
    }));
    expect(converted.warnings).toEqual(['部分字段已追加至预测依据。']);
  });

  it('Arena retention canonicalize id 并由 finalize 阻断关闭字段的 AI 注入', () => {
    const history = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: {
        attributes: { world_line_id: 'world-old', sublimation_count: 1 },
        entries: [{ id: '8', type: 'sublimation' }, { id: 'dirty', type: 'battle' }],
      },
      strategy: 'keep-sublimation-only',
      newEntry: buildSublimationHistoryEntry({
        title: '二转',
        impact: '蜕变',
        participantsName: '白百合',
        finalUserGuidance: null,
        hasQuestionnaireLore: false,
        questionnaireSelectionCount: 0,
        nonNativeDataInvolved: false,
      }),
      nowISO: '2026-08-26T00:00:00.000Z',
      createWorldLineId: () => 'world-new',
    });
    expect(history.entries.map((entry) => entry.id)).toEqual([8, 9]);

    const finalized = buildFinalSublimationData({
      originalCharacterData: { codename: '白百合', arena_history: null, current_state: null },
      baseOutputData: { codename: '白百合' },
      updatedDataFromAI: {
        arena_history: { entries: [{ id: 1, type: 'battle' }] },
        current_state: { summary: '注入' },
      },
      targetTemplate: 'magical-girl',
      allowReshapeNames: false,
      writeArenaHistory: false,
      writeCurrentState: false,
      arenaHistoryRetentionStrategy: 'keep-all',
      sublimationEvent: { title: '二转', impact: '蜕变' },
      finalUserGuidance: null,
      hasNarrativeHistory: false,
      hasQuestionnaireLore: false,
      hasNonNativeQuestionnaireLore: false,
      questionnaireSelectionCount: 0,
      isNative: true,
      nowISO: '2026-08-26T00:00:00.000Z',
    });
    expect(finalized).not.toHaveProperty('arena_history');
    expect(finalized).not.toHaveProperty('current_state');
    expect(finalized.templateId).toBe('魔法少女/心之花/魔法少女（问卷生成）');
  });
});
