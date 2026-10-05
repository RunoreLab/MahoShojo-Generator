import { describe, expect, it } from 'vitest';
import type { ArenaProposalChange, ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';
import { applyArenaProposal, previewArenaProposalApplication, ResolveArenaRoomProposalCommandSchema } from '../src/index';
import { baseConfig, guidanceChange, proposal, createRoomCommand, joinMemberCommand,
  hostAuthority, memberAuthority, NEXT_TIMESTAMP, transitionArenaRoomAt } from './state-machine-fixtures';

const run = (config: ArenaRoomSharedConfig, changes: ArenaProposalChange[], overrideChangeIds: string[] = [],
  selected = changes.map((change) => change.changeId)) => {
  const state = { roomId: 'room-1', config, revision: 4 };
  return { result: applyArenaProposal(state, proposal(changes), selected, { overrideChangeIds }),
    preview: previewArenaProposalApplication(state, proposal(changes), selected, { overrideChangeIds }) };
};
const characterGuidance = (): ArenaProposalChange => ({
  changeId: 'character-guidance', type: 'setCharacterGuidance', combatantKey: 'data-card:character-1',
  value: 'B', expectedBase: { kind: 'value', value: 'A' },
});

describe('房主逐项覆盖 staged apply', () => {
  it('角色 A→B、当前C：普通接受拒绝，明确覆盖只改变该字段且保留原提案', () => {
    const config = { ...baseConfig(), userGuidance: '无关内容',
      combatants: [{ ...baseConfig().combatants[0]!, characterGuidance: 'C' }] };
    const change = characterGuidance(); const before = structuredClone(config);
    expect(run(config, [change]).result.status).toBe('rejected');
    const { result, preview } = run(config, [change], [change.changeId]);
    expect(result).toMatchObject({ status: 'accepted', revision: 5, conflicts: [] });
    expect(result.config.combatants[0]?.characterGuidance).toBe('B');
    expect(result.config.userGuidance).toBe('无关内容');
    expect(preview.plan[0]).toMatchObject({ outcome: 'overridden', overrideAllowed: true });
    expect(config).toEqual(before); expect(change.expectedBase).toEqual({ kind: 'value', value: 'A' });
  });
  it('混合覆盖与正常选项原子部分接受，不覆盖未选项目', () => {
    const changes: ArenaProposalChange[] = [guidanceChange('B'), {
      changeId: 'language', type: 'setSelectedLanguage', value: 'en-US',
      expectedBase: { kind: 'value', value: 'zh-CN' },
    }, { changeId: 'mode', type: 'setBattleMode', value: 'daily', expectedBase: { kind: 'value', value: 'classic' } }];
    const { result } = run({ ...baseConfig(), userGuidance: 'C' }, changes, ['guidance-1'], ['guidance-1', 'language']);
    expect(result).toMatchObject({ status: 'partially_accepted', revision: 5, rejectedChangeIds: ['mode'] });
    expect(result.config).toMatchObject({ userGuidance: 'B', selectedLanguage: 'en-US', battleMode: 'classic' });
  });
  it('已是B与已删除目标是 no-op，不增加 revision', () => {
    const { result } = run({ ...baseConfig(), userGuidance: 'B' }, [guidanceChange('B')], ['guidance-1']);
    expect(result).toMatchObject({ status: 'accepted', revision: 4, satisfiedChangeIds: ['guidance-1'] });
    const removal: ArenaProposalChange = { changeId: 'remove', type: 'removeCombatant',
      combatantKey: 'data-card:character-1', expectedBase: { kind: 'present', ref: baseConfig().combatants[0]!.ref } };
    expect(run({ ...baseConfig(), combatants: [] }, [removal], ['remove']).result)
      .toMatchObject({ status: 'accepted', revision: 4, satisfiedChangeIds: ['remove'] });
  });
  it.each([['unknown'], ['guidance-1', 'guidance-1']])('纯函数也拒绝非法 override ID %j', (...ids) => {
    expect(run(baseConfig(), [guidanceChange()], ids).result.status).toBe('rejected');
  });
  it('override 不能跳过目标存在性，且其他有效修改不部分写入', () => {
    const config = { ...baseConfig(), combatants: [] };
    const { result, preview } = run(config, [guidanceChange('B'), characterGuidance()], ['character-guidance']);
    expect(result).toMatchObject({ status: 'rejected', revision: 4, config });
    expect(preview.plan[1]).toMatchObject({ outcome: 'conflict', overrideAllowed: false, overrideBlockedReason: 'target-missing' });
  });
  it('分队不能覆盖到已不存在的队伍', () => {
    const change: ArenaProposalChange = { changeId: 'assign', type: 'assignTeam', combatantKey: 'data-card:character-1',
      teamKey: 'team:missing', expectedBase: { kind: 'value', value: 'team:old' } };
    expect(run(baseConfig(), [change], ['assign']).preview.plan[0])
      .toMatchObject({ outcome: 'conflict', overrideBlockedReason: 'target-missing' });
  });
  it('在线卡版本漂移不构成冲突，但新增 key 碰撞不可覆盖', () => {
    const ref = baseConfig().combatants[0]!.ref;
    const current = { ...baseConfig(), combatants: [{ key: 'data-card:character-1', ref: { ...ref, versionToken: 'v2' } }] };
    const remove: ArenaProposalChange = { changeId: 'remove', type: 'removeCombatant',
      combatantKey: 'data-card:character-1', expectedBase: { kind: 'present', ref } };
    expect(run(current, [remove], ['remove']).preview.plan[0])
      .toMatchObject({ outcome: 'applicable' });
    const add: ArenaProposalChange = { changeId: 'add', type: 'addTeam', teamKey: 'team:one', displayName: 'B', expectedBase: { kind: 'absent' } };
    expect(run({ ...baseConfig(), teams: [{ key: 'team:one', displayName: 'C', combatantKeys: [] }] }, [add], ['add']).result.status).toBe('rejected');
  });
  it('旧全列表重排不能通过 override 删除房主新增角色', () => {
    const current = { ...baseConfig(), combatants: [...baseConfig().combatants,
      { key: 'data-card:character-2', ref: { id: 'character-2', kind: 'character' as const, versionToken: 'v1' } },
      { key: 'data-card:character-3', ref: { id: 'character-3', kind: 'character' as const, versionToken: 'v1' } }] };
    const reorder: ArenaProposalChange = { changeId: 'order', type: 'reorderCombatants',
      value: ['data-card:character-2', 'data-card:character-1'],
      expectedBase: { kind: 'value', value: ['data-card:character-1', 'data-card:character-2'] } };
    const { result, preview } = run(current, [reorder], ['order']);
    expect(result).toMatchObject({ status: 'rejected', config: current });
    expect(preview.plan[0]).toMatchObject({ overrideAllowed: false, overrideBlockedReason: 'unsupported-change' });
  });
  it('依赖与联动组仍需完整选择，schema 无效时 preview/apply 一起拒绝', () => {
    const changes: ArenaProposalChange[] = [{ ...guidanceChange('B'), atomicGroupId: 'group' },
      { changeId: 'mode', type: 'setBattleMode', value: 'daily', expectedBase: { kind: 'value', value: 'classic' },
        dependsOn: ['guidance-1'], atomicGroupId: 'group' }];
    expect(run(baseConfig(), changes, ['mode'], ['mode']).result.status).toBe('rejected');
    const invalid = { ...guidanceChange('B'), value: 7 } as unknown as ArenaProposalChange;
    expect(run(baseConfig(), [invalid], ['guidance-1']).result.status).toBe('rejected');
    expect(run(baseConfig(), [invalid], ['guidance-1']).preview.status).toBe('rejected');
  });
});

const next = (result: ReturnType<typeof transitionArenaRoomAt>) => {
  if (!result.ok) throw new Error(result.reason);
  return result.nextState;
};
const pendingState = () => {
  const created = next(transitionArenaRoomAt(null, createRoomCommand(), hostAuthority()));
  const joined = next(transitionArenaRoomAt(created, joinMemberCommand(), memberAuthority()));
  const submitted = next(transitionArenaRoomAt(joined, { type: 'submit-proposal', expectedRoomEpoch: 'epoch-1',
    proposal: proposal([guidanceChange('B')]), timestamp: NEXT_TIMESTAMP }, memberAuthority()));
  return next(transitionArenaRoomAt(submitted, { type: 'publish-config', expectedRoomEpoch: 'epoch-1',
    expectedRevision: 0, expectedControlSeq: submitted.snapshot.controlSeq,
    sharedConfig: { ...baseConfig(), userGuidance: 'C' }, timestamp: NEXT_TIMESTAMP }, hostAuthority()));
};
const resolution = { type: 'resolve-proposal', expectedRoomEpoch: 'epoch-1', expectedRevision: 1,
  proposalId: 'proposal-1', resolution: 'accept-selected', selectedChangeIds: ['guidance-1'],
  overrideChangeIds: ['guidance-1'], timestamp: NEXT_TIMESTAMP };
describe('房主覆盖的原子 authority 边界', () => {
  it('接受覆盖保持 provenance、单次 revision 和终态防重放', () => {
    const state = pendingState(); const before = structuredClone(state);
    const accepted = next(transitionArenaRoomAt(state, resolution, hostAuthority()));
    expect(accepted.snapshot).toMatchObject({ revision: 2, sharedConfig: { userGuidance: 'B' }, proposals: [] });
    expect(accepted.collaborativeChanges).toContainEqual(guidanceChange('B'));
    expect(transitionArenaRoomAt(accepted, { ...resolution, expectedRevision: 2 }, hostAuthority()).ok).toBe(false);
    expect(state).toEqual(before);
  });
  it.each([{ expectedRevision: 0 }, { expectedRevision: 2 }, { expectedRoomEpoch: 'old-epoch' }])('拒绝过期审阅且不写入 %j', (patch) => {
    const state = pendingState(); const before = structuredClone(state);
    expect(transitionArenaRoomAt(state, { ...resolution, ...patch }, hostAuthority()).ok).toBe(false);
    expect(state).toEqual(before);
  });
  it('member 无法执行 host override，直接 actor 调用不能绕过 canonical DTO', () => {
    expect(transitionArenaRoomAt(pendingState(), resolution, memberAuthority()).ok).toBe(false);
    for (const patch of [{ expectedRevision: undefined }, { selectedChangeIds: undefined },
      { overrideChangeIds: ['unknown'] }, { overrideChangeIds: ['guidance-1', 'guidance-1'] },
      { resolution: 'reject', selectedChangeIds: undefined }]) {
      expect(ResolveArenaRoomProposalCommandSchema.safeParse({ ...resolution, ...patch }).success).toBe(false);
      expect(transitionArenaRoomAt(pendingState(), { ...resolution, ...patch }, hostAuthority()).ok).toBe(false);
    }
  });
});
