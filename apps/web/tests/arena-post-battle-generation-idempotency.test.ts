import { beforeEach, describe, expect, it, vi } from 'vitest';

const signatureMocks = vi.hoisted(() => ({
  generateSignature: vi.fn(),
  verifySignature: vi.fn(),
}));

vi.mock('@/lib/signature', () => signatureMocks);

import { applyPostBattleUpdates } from '@/lib/arena/service';

describe('Arena post-battle generation idempotency', () => {
  beforeEach(() => {
    signatureMocks.generateSignature.mockReset();
    signatureMocks.verifySignature.mockReset();
  });

  it('does not append history or rewrite current state twice for one generation', async () => {
    const combatants = [{
      type: 'magical-girl',
      isNative: false,
      data: { name: 'A', templateId: 'magical-girl' },
    }];
    const report = {
      headline: '终局战报',
      mode: 'daily',
      officialReport: { winner: 'A' },
    } as never;
    const impacts = [{
      characterName: 'A',
      impact: '成长',
      currentStateSummary: '平静',
    }];
    const options = {
      writeArenaHistory: true,
      writeCurrentState: true,
      generationId: 'generation-1',
      combatantIndices: [0],
    };

    const first = await applyPostBattleUpdates(combatants, report, impacts, null, null, options);
    const second = await applyPostBattleUpdates([
      { ...combatants[0], data: first[0].data },
    ], report, impacts, null, null, options);

    expect(first[0]).toMatchObject({ combatantIndex: 0 });
    expect(first[0].data.arena_history.entries).toHaveLength(1);
    expect(first[0].data.arena_history.entries[0].metadata.generation_id).toBe('generation-1');
    expect(first[0].data.arena_history.entries[0].metadata).not.toHaveProperty('base_revision_hash');
    expect(first[0].data.current_state.generation_id).toBe('generation-1');
    expect(first[0].data.current_state).not.toHaveProperty('base_revision_hash');
    expect(second).toEqual([]);
  });

  it('局部更新沿用完整 frozen roster 上下文并同步 native 降级', async () => {
    const result = await applyPostBattleUpdates([{
      type: 'magical-girl',
      isNative: true,
      characterGuidance: '生成时冻结的引导',
      data: { name: '双生', templateId: 'magical-girl:twin', signature: 'old-signature' },
    }], {
      headline: '终局战报',
      mode: 'classic',
      officialReport: { winner: '双生' },
    } as never, [{ characterName: '双生', impact: '成长' }], null, null, {
      writeArenaHistory: true,
      writeCurrentState: false,
      generationId: 'generation-2',
      combatantIndices: [0],
      participantNames: ['双生', '双生'],
      nonNativeDataInvolved: true,
      conflictingNativeNames: ['双生'],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ combatantIndex: 0, isNative: false });
    expect(result[0]!.data).not.toHaveProperty('signature');
    expect(result[0]!.data.arena_history.entries[0]).toMatchObject({
      participants: ['双生', '双生'],
      metadata: {
        character_guidance: '生成时冻结的引导',
        non_native_data_involved: true,
      },
    });
  });

  it.each([
    {
      label: '签名服务未配置',
      arrange: () => signatureMocks.generateSignature.mockResolvedValueOnce(null),
    },
    {
      label: '签名服务异常',
      arrange: () => signatureMocks.generateSignature.mockRejectedValueOnce(new Error('sign failed')),
    },
  ])('$label 时降级为非原生并继续低风险更新', async ({ arrange }) => {
    arrange();

    const result = await applyPostBattleUpdates([{
      type: 'magical-girl',
      isNative: true,
      data: { name: '角色 A', templateId: 'magical-girl:a', signature: 'old-signature' },
    }], {
      headline: '终局战报',
      mode: 'classic',
      officialReport: { winner: '角色 A' },
    } as never, [{ characterName: '角色 A', impact: '成长' }], null, null, {
      writeArenaHistory: true,
      writeCurrentState: false,
      generationId: 'generation-signing-fallback',
      combatantIndices: [0],
      scenarioNativeOverride: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ combatantIndex: 0, isNative: false });
    expect(result[0]!.data).not.toHaveProperty('signature');
    expect(result[0]!.data.arena_history.entries[0].metadata.generation_id)
      .toBe('generation-signing-fallback');
  });
});
