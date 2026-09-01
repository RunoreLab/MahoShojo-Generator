import { describe, expect, it } from 'vitest';

import {
  applyUnsignedPostBattleRepair,
  patchGenerationCharacterEffect,
} from '@mahoshojo/domain/arena-character-repair';

const generationId = 'generation-repair-001';
const nowISO = '2026-09-01T05:30:00.000Z';

const historyEntry = (impact: string, id = generationId) => ({
  id: 1,
  type: 'classic',
  title: '终局战报',
  participants: ['同名角色', '同名角色'],
  winner: '同名角色',
  impact,
  metadata: {
    generation_id: id,
    base_revision_hash: 'a'.repeat(64),
  },
});

describe('Arena generation effect patch', () => {
  it('只替换同 generation 的唯一 effect，并保留 history 长度和 current state fields', () => {
    const characterData = {
      name: '角色 A',
      arena_history: {
        attributes: { updated_at: 'before' },
        entries: [historyEntry('旧影响')],
      },
      current_state: {
        summary: '旧状态',
        fields: [{ id: 'mood', value: '平静' }],
        generation_id: generationId,
        base_revision_hash: 'a'.repeat(64),
        updated_at: 'before',
      },
    };

    const result = patchGenerationCharacterEffect({
      characterData,
      generationId,
      patch: {
        combatantIndex: 0,
        characterName: '角色 A',
        impact: '新影响',
        currentStateSummary: '新状态',
      },
      nowISO,
    });

    expect(result).toMatchObject({ ok: true, status: 'updated', createdFields: [] });
    if (!result.ok) throw new Error('expected repair patch to succeed');
    expect(result.characterData.arena_history.entries).toHaveLength(1);
    expect(result.characterData.arena_history.entries[0]).toMatchObject({
      impact: '新影响',
      metadata: {
        generation_id: generationId,
        base_revision_hash: 'a'.repeat(64),
      },
    });
    expect(result.characterData.current_state).toMatchObject({
      summary: '新状态',
      fields: [{ id: 'mood', value: '平静' }],
      generation_id: generationId,
      base_revision_hash: 'a'.repeat(64),
      updated_at: nowISO,
    });
    expect(characterData.arena_history.entries[0].impact).toBe('旧影响');
    expect(characterData.current_state.summary).toBe('旧状态');
  });

  it('同 generation history 重复或 current state 属于其它 generation 时 fail closed', () => {
    const ambiguous = patchGenerationCharacterEffect({
      characterData: {
        name: '角色 A',
        arena_history: {
          attributes: {},
          entries: [historyEntry('一'), historyEntry('二')],
        },
      },
      generationId,
      patch: { combatantIndex: 0, characterName: '角色 A', impact: '新影响' },
      nowISO,
    });
    expect(ambiguous).toMatchObject({
      ok: false,
      reason: 'ambiguous-generation-effect',
      issues: [{ field: 'impact', combatantIndex: 0 }],
    });

    const otherGeneration = patchGenerationCharacterEffect({
      characterData: {
        name: '角色 A',
        current_state: { summary: '后续状态', generation_id: 'generation-later' },
      },
      generationId,
      patch: {
        combatantIndex: 0,
        characterName: '角色 A',
        currentStateSummary: '不得覆盖',
      },
      nowISO,
    });
    expect(otherGeneration).toMatchObject({
      ok: false,
      reason: 'generation-effect-not-found',
      issues: [{ field: 'currentStateSummary', combatantIndex: 0 }],
    });
  });

  it('只有显式 allow-create 且提供 history context 时才创建缺失 effect', () => {
    const rejected = patchGenerationCharacterEffect({
      characterData: { name: '角色 A' },
      generationId,
      patch: {
        combatantIndex: 0,
        characterName: '角色 A',
        impact: '新影响',
        currentStateSummary: '新状态',
      },
      nowISO,
    });
    expect(rejected).toMatchObject({ ok: false, reason: 'generation-effect-not-found' });

    const created = patchGenerationCharacterEffect({
      characterData: { name: '角色 A' },
      generationId,
      patch: {
        combatantIndex: 0,
        characterName: '角色 A',
        impact: '新影响',
        currentStateSummary: '新状态',
      },
      nowISO,
      allowCreateMissingEffects: true,
      createHistoryEntry: {
        type: 'classic',
        title: '终局战报',
        participants: ['角色 A'],
        winner: '角色 A',
        metadata: { user_guidance: null },
      },
    });

    expect(created).toMatchObject({
      ok: true,
      status: 'updated',
      createdFields: ['impact', 'currentStateSummary'],
    });
    if (!created.ok) throw new Error('expected missing effects to be created');
    expect(created.characterData.arena_history.entries[0]).toMatchObject({
      id: 1,
      impact: '新影响',
      metadata: { generation_id: generationId, user_guidance: null },
    });
    expect(created.characterData.current_state).toMatchObject({
      summary: '新状态',
      fields: [],
      generation_id: generationId,
      updated_at: nowISO,
    });
  });
});

describe('Arena unsigned post-battle repair', () => {
  it('按 roster index 修复重名角色，只降级真实修改的角色并清除 canonical identity', () => {
    const combatants = [
      {
        type: 'magical-girl',
        filename: 'preset-a.json',
        isValid: true,
        isPreset: true,
        sourceDataCardId: 'card-a',
        sourceDataCardUpdatedAt: 'before',
        arenaRoomKey: 'room:character:a',
        adjudicationSourceKey: 'data-card:card-a',
        data: {
          name: '同名角色',
          signature: 'top-a',
          arena_history: { attributes: {}, entries: [historyEntry('A 旧影响')] },
        },
      },
      {
        type: 'magical-girl',
        filename: 'preset-b.json',
        isValid: true,
        isPreset: true,
        isNative: true,
        sourceDataCardId: 'card-b',
        sourceDataCardUpdatedAt: 'before',
        arenaRoomKey: 'room:character:b',
        adjudicationSourceKey: 'data-card:card-b',
        sourceDataCardName: '来源卡 B',
        data: {
          name: '同名角色',
          signature: 'top-b',
          isNative: true,
          isPreset: true,
          sourceDataCardId: 'nested-card-b',
          metadata: { signature: 'legacy-b', note: '保留' },
          arena_history: { attributes: {}, entries: [historyEntry('B 旧影响')] },
        },
      },
    ];

    const result = applyUnsignedPostBattleRepair({
      combatants,
      generationId,
      patches: [{ combatantIndex: 1, characterName: '同名角色', impact: '仅修改 B' }],
      nowISO,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'updated',
      changedCombatantIndices: [1],
      createdEffects: [],
    });
    if (!result.ok) throw new Error('expected unsigned repair to succeed');
    expect(result.combatants[0]).toEqual(combatants[0]);
    expect(result.combatants[1]).toMatchObject({
      filename: 'preset-b.json',
      isValid: false,
      isPreset: false,
      isNative: false,
      sourceDataCardName: '来源卡 B',
    });
    expect(result.combatants[1]).not.toHaveProperty('sourceDataCardId');
    expect(result.combatants[1]).not.toHaveProperty('sourceDataCardUpdatedAt');
    expect(result.combatants[1]).not.toHaveProperty('arenaRoomKey');
    expect(result.combatants[1]).not.toHaveProperty('adjudicationSourceKey');
    expect(result.combatants[1]!.data).not.toHaveProperty('signature');
    expect(result.combatants[1]!.data).not.toHaveProperty('isNative');
    expect(result.combatants[1]!.data).not.toHaveProperty('isPreset');
    expect(result.combatants[1]!.data).not.toHaveProperty('sourceDataCardId');
    expect(result.combatants[1]!.data.metadata).toEqual({ note: '保留' });
    expect(result.combatants[1]!.data.arena_history.entries[0].impact).toBe('仅修改 B');
    expect(result.updatedCharacters).toEqual([result.combatants[1]!.data]);
    expect(combatants[1]!.data.signature).toBe('top-b');
    expect(combatants[1]!.data.metadata!.signature).toBe('legacy-b');
  });

  it('同值 patch 返回 no-op 并保留原签名与 identity', () => {
    const combatants = [{
      isValid: true,
      isPreset: true,
      sourceDataCardId: 'card-a',
      data: {
        name: '角色 A',
        signature: 'signed',
        arena_history: { attributes: {}, entries: [historyEntry('相同影响')] },
      },
    }];

    const result = applyUnsignedPostBattleRepair({
      combatants,
      generationId,
      patches: [{ combatantIndex: 0, characterName: '角色 A', impact: '相同影响' }],
      nowISO,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'no-op',
      changedCombatantIndices: [],
      updatedCharacters: [],
    });
    if (!result.ok) throw new Error('expected no-op repair result');
    expect(result.combatants).toEqual(combatants);
  });

  it('名称与 index 不一致或同一 index 重复时原子拒绝，不修改其它角色', () => {
    const combatants = [
      { data: { name: '角色 A', arena_history: { attributes: {}, entries: [historyEntry('A')] } } },
      { data: { name: '角色 B', arena_history: { attributes: {}, entries: [historyEntry('B')] } } },
    ];

    const mismatch = applyUnsignedPostBattleRepair({
      combatants,
      generationId,
      patches: [{ combatantIndex: 1, characterName: '角色 A', impact: '错误目标' }],
      nowISO,
    });
    expect(mismatch).toMatchObject({ ok: false, reason: 'invalid-repair-patch' });

    const duplicate = applyUnsignedPostBattleRepair({
      combatants,
      generationId,
      patches: [
        { combatantIndex: 0, characterName: '角色 A', impact: '一' },
        { combatantIndex: 0, characterName: '角色 A', impact: '二' },
      ],
      nowISO,
    });
    expect(duplicate).toMatchObject({ ok: false, reason: 'invalid-repair-patch' });
    expect(combatants[0].data.arena_history.entries[0].impact).toBe('A');
    expect(combatants[1].data.arena_history.entries[0].impact).toBe('B');
  });

  it('根入口导出同一份 repair API', async () => {
    const root = await import('@mahoshojo/domain');
    expect(root.applyUnsignedPostBattleRepair).toBe(applyUnsignedPostBattleRepair);
  });
});
