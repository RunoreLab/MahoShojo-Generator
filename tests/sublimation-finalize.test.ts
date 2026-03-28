import { describe, expect, test } from 'bun:test';

import { buildFinalSublimationData } from '@/lib/sublimation/finalize';

const BASE_TEMPLATE_ID = '魔法少女/心之花/魔法少女（问卷生成）';
const NOW_ISO = '2026-03-28T12:34:56.000Z';

const createBaseInput = () => ({
  originalCharacterData: {
    codename: '白百合「旧称号」',
    magicConstruct: { name: '星纱' },
    wonderlandRule: { name: '月庭' },
    blooming: { name: '铃兰繁开' },
    arena_history: {
      attributes: {
        world_line_id: 'world-old',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
        sublimation_count: 1,
        last_sublimation_at: '2026-03-12T00:00:00.000Z',
      },
      entries: [
        { id: 3, type: 'battle', title: '旧战斗', impact: '留下伤痕' },
        { id: 5, type: 'sublimation', title: '一转', impact: '意志觉醒' },
      ],
    },
    current_state: {
      summary: '旧状态',
      fields: [{ label: '体力', type: 'number', value: 30 }],
      updated_at: '2026-03-12T00:00:00.000Z',
    },
  },
  baseOutputData: {
    templateId: BASE_TEMPLATE_ID,
    codename: '白百合「旧称号」',
    magicConstruct: { name: '星纱' },
    wonderlandRule: { name: '月庭' },
    blooming: { name: '铃兰繁开' },
  },
  updatedDataFromAI: {
    templateId: '被污染的 templateId',
    codename: '白百合「新称号」',
  },
  targetTemplate: 'magical-girl' as const,
  allowReshapeNames: false,
  writeArenaHistory: true,
  writeCurrentState: true,
  arenaHistoryRetentionStrategy: 'keep-all' as const,
  sublimationEvent: {
    title: '二转',
    impact: '完成蜕变',
  },
  finalUserGuidance: null,
  hasNarrativeHistory: false,
  hasQuestionnaireLore: false,
  hasNonNativeQuestionnaireLore: false,
  questionnaireSelectionCount: 0,
  isNative: true,
  nowISO: NOW_ISO,
  createWorldLineId: () => 'world-new',
});

describe('buildFinalSublimationData', () => {
  test('writeArenaHistory=true 且 keep-all 时保留原始 battle 历史', () => {
    const result = buildFinalSublimationData(createBaseInput());

    expect(result.arena_history.entries.map((entry: any) => entry.type)).toEqual([
      'battle',
      'sublimation',
      'sublimation',
    ]);
    expect(result.arena_history.entries[0]?.title).toBe('旧战斗');
    expect(result.arena_history.entries[2]?.id).toBe(6);
  });

  test('writeArenaHistory=false 时完整保留原始 arena_history', () => {
    const input = createBaseInput();
    input.writeArenaHistory = false;
    input.updatedDataFromAI.arena_history = {
      attributes: { world_line_id: 'world-ai' },
      entries: [{ id: 99, type: 'battle', title: 'AI 注入', impact: '污染数据' }],
    };

    const result = buildFinalSublimationData(input);

    expect(result.arena_history).toEqual(input.originalCharacterData.arena_history);
    expect(result.arena_history).not.toBe(input.originalCharacterData.arena_history);
  });

  test('writeCurrentState=true 时保留原 fields、允许更新 summary，并写入 nowISO', () => {
    const input = createBaseInput();
    input.updatedDataFromAI.current_state = {
      summary: '新状态摘要',
      fields: [{ label: '体力', type: 'number', value: 999 }],
    };

    const result = buildFinalSublimationData(input);

    expect(result.current_state.summary).toBe('新状态摘要');
    expect(result.current_state.fields).toEqual(input.originalCharacterData.current_state.fields);
    expect(result.current_state.updated_at).toBe(NOW_ISO);
  });

  test('writeArenaHistory=false 且原卡无 history 时，不泄漏 AI 注入的 arena_history', () => {
    const input = createBaseInput();
    delete input.originalCharacterData.arena_history;
    input.writeArenaHistory = false;
    input.updatedDataFromAI.arena_history = {
      attributes: { world_line_id: 'world-ai' },
      entries: [{ id: 1, type: 'battle', title: '注入', impact: '不应出现' }],
    };

    const result = buildFinalSublimationData(input);

    expect('arena_history' in result).toBe(false);
    expect(result.templateId).toBe(BASE_TEMPLATE_ID);
  });
});
