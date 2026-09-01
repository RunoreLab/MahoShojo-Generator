import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  normalizeArenaRepairDraft,
  prepareAndApplyArenaCombatantRepair,
} from '@/lib/arena/combatant-repair';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

const generationId = 'generation-client-repair-001';
const effect = (impact: string) => ({
  id: 1,
  type: 'classic',
  title: '终局战报',
  participants: ['同名角色', '同名角色'],
  winner: '同名角色',
  impact,
  metadata: { generation_id: generationId },
});

describe('Arena 客户端 repair 草稿归一化', () => {
  it('允许只修复 roster 子集，并把唯一名称绑定为 index patch', async () => {
    const patches = await normalizeArenaRepairDraft({
      draft: JSON.stringify({
        impacts: [{ characterName: '角色 B', impact: '  B 的修复  ' }],
      }),
      combatants: [
        { data: { name: '角色 A' } },
        { data: { name: '角色 B' } },
      ],
    });

    expect(patches).toEqual([
      { combatantIndex: 1, characterName: '角色 B', impact: 'B 的修复' },
    ]);
  });

  it('同名角色必须显式提供 index，且名称仍需与 index 一致', async () => {
    const combatants = [
      { data: { name: '同名角色' } },
      { data: { name: '同名角色' } },
    ];

    await expect(normalizeArenaRepairDraft({
      draft: JSON.stringify([{ characterName: '同名角色', impact: '不明确' }]),
      combatants,
    })).rejects.toThrow('存在重名');

    await expect(normalizeArenaRepairDraft({
      draft: JSON.stringify([{
        combatantIndex: 1,
        characterName: '错误名称',
        impact: '不得错绑',
      }]),
      combatants,
    })).rejects.toThrow('与 combatantIndex');

    await expect(normalizeArenaRepairDraft({
      draft: JSON.stringify([{
        combatantIndex: 1,
        characterName: '同名角色',
        current_state_summary: '精确修复第二位',
      }]),
      combatants,
    })).resolves.toEqual([{
      combatantIndex: 1,
      characterName: '同名角色',
      currentStateSummary: '精确修复第二位',
    }]);
  });
});

describe('Arena 客户端 repair 确认编排', () => {
  it('canonical 角色未确认时不应用，也不创建缺失 effect', async () => {
    const combatants = [{
      type: 'magical-girl',
      filename: 'preset.json',
      isValid: true,
      isPreset: true,
      sourceDataCardId: 'card-a',
      data: {
        name: '角色 A',
        signature: 'signed',
        arena_history: { attributes: {}, entries: [effect('旧影响')] },
      },
    }];
    const confirmTrustDowngrade = vi.fn().mockResolvedValue(false);
    const confirmCreateMissingEffects = vi.fn().mockResolvedValue(true);

    const result = await prepareAndApplyArenaCombatantRepair({
      combatants,
      generationId,
      patches: [{ combatantIndex: 0, characterName: '角色 A', impact: '新影响' }],
      nowISO: '2026-09-01T06:00:00.000Z',
      createHistoryEntry: {
        type: 'classic',
        title: '终局战报',
        participants: ['角色 A'],
        winner: '角色 A',
      },
      verifyNative: vi.fn().mockResolvedValue(true),
      confirmTrustDowngrade,
      confirmCreateMissingEffects,
    });

    expect(result).toEqual({ ok: false, reason: 'trust-downgrade-cancelled' });
    expect(confirmTrustDowngrade).toHaveBeenCalledWith(['角色 A']);
    expect(confirmCreateMissingEffects).not.toHaveBeenCalled();
    expect(combatants[0]!.data.signature).toBe('signed');
    expect(combatants[0]!.data.arena_history.entries[0].impact).toBe('旧影响');
  });

  it('缺失 effect 只有二次确认后才创建，并产出 unsigned derivative', async () => {
    const confirmations: string[] = [];
    const combatants = [{
      type: 'general-character',
      filename: 'local.json',
      isValid: false,
      isPreset: false,
      data: { name: '角色 A' },
    }];

    const cancelled = await prepareAndApplyArenaCombatantRepair({
      combatants,
      generationId,
      patches: [{ combatantIndex: 0, characterName: '角色 A', impact: '新影响' }],
      nowISO: '2026-09-01T06:00:00.000Z',
      createHistoryEntry: {
        type: 'classic',
        title: '终局战报',
        participants: ['角色 A'],
        winner: '角色 A',
      },
      verifyNative: vi.fn().mockResolvedValue(false),
      confirmTrustDowngrade: vi.fn().mockResolvedValue(true),
      confirmCreateMissingEffects: async () => {
        confirmations.push('missing');
        return false;
      },
    });
    expect(cancelled).toEqual({ ok: false, reason: 'missing-effect-cancelled' });

    const applied = await prepareAndApplyArenaCombatantRepair({
      combatants,
      generationId,
      patches: [{ combatantIndex: 0, characterName: '角色 A', impact: '新影响' }],
      nowISO: '2026-09-01T06:00:00.000Z',
      createHistoryEntry: {
        type: 'classic',
        title: '终局战报',
        participants: ['角色 A'],
        winner: '角色 A',
      },
      verifyNative: vi.fn().mockResolvedValue(false),
      confirmTrustDowngrade: vi.fn().mockResolvedValue(true),
      confirmCreateMissingEffects: async () => {
        confirmations.push('missing');
        return true;
      },
    });

    expect(confirmations).toEqual(['missing', 'missing']);
    expect(applied).toMatchObject({
      ok: true,
      status: 'updated',
      changedCombatantIndices: [0],
      createdEffects: [{ combatantIndex: 0, fields: ['impact'] }],
    });
    if (!applied.ok) throw new Error('expected repair to be applied');
    expect(applied.combatants[0]).toMatchObject({ isValid: false, isPreset: false });
    expect(applied.combatants[0]!.data).not.toHaveProperty('signature');
  });
});

describe('Arena repair UI contract', () => {
  it('新 generation 会清除旧 repair 标记，同 generation 重设则保留', () => {
    const state = useBattleStore.getState();
    state.setLastGenerationId(generationId);
    state.setRepairAppliedGenerationId(generationId);
    state.setLastGenerationId(generationId);
    expect(useBattleStore.getState().repairAppliedGenerationId).toBe(generationId);

    state.setLastGenerationId('generation-client-repair-002');
    expect(useBattleStore.getState().repairAppliedGenerationId).toBeNull();
    useBattleStore.getState().setLastGenerationId(null);
  });

  it('保留权威重试并新增显式草稿与应用动作', () => {
    const hookSource = readFileSync('components/arena/hooks/useCombatantRepair.ts', 'utf8');
    const resultSource = readFileSync('components/arena/components/BattleResult.tsx', 'utf8');

    expect(hookSource).toContain("fetch('/api/arena/repair-combatant-meta'");
    expect(hookSource).not.toContain('/api/arena/redo-combatant-updates');
    expect(hookSource).toContain('applyArenaRepairDraft');
    expect(hookSource).toContain('setRepairAppliedGenerationId');
    expect(resultSource).toContain('重试角色更新');
    expect(resultSource).toContain('AI 重新生成修复草稿');
    expect(resultSource).toContain('应用修复');
    expect(resultSource).toContain('创建非原生可编辑版本');
  });
});
