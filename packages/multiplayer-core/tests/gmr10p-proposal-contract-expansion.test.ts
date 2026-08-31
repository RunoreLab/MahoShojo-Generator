import { ArenaProposalChangeSchema } from '@mahoshojo/contracts/arena-room';
import { describe, expect, it } from 'vitest';

import {
  applyArenaProposal,
  detectProposalConflicts,
  diffArenaSharedConfig,
  validateProposalChanges,
} from '../src/index';
import { mergeCollaborativeChanges } from '../src/provenance';

const config = () => ({
  battleMode: 'classic' as const,
  combatants: [
    { key: 'data-card:c1', ref: { id: 'c1', kind: 'character' as const, versionToken: 'v1' } },
    { key: 'data-card:c2', ref: { id: 'c2', kind: 'character' as const, versionToken: 'v1' } },
  ],
  teams: [{ key: 'team:a', displayName: 'A', combatantKeys: ['data-card:c1'] }],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'default' as const,
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings: {
    readArenaHistory: true,
    readArenaHistoryLimit: 3,
    isArenaHistoryUnlimited: false,
    writeArenaHistory: true,
    readCurrentState: true,
    writeCurrentState: true,
    readNarrativeHistory: false,
    readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false,
    writeNarrativeHistory: false,
  },
});

const proposal = (changes: readonly unknown[]) => ({
  proposalVersion: 1,
  proposalId: 'proposal-gmr10p-d',
  roomId: 'room-1',
  authorUserId: 'member-1',
  baseRevision: 4,
  status: 'submitted' as const,
  changes,
  createdAt: '2026-08-31T00:00:00.000Z',
});

describe('GMR-10P-D Proposal 共享配置扩面', () => {
  it('contract 接受 language 与 team structure typed changes', () => {
    const changes = [
      {
        changeId: 'language',
        type: 'setSelectedLanguage',
        value: 'en-US',
        expectedBase: { kind: 'value', value: 'zh-CN' },
      },
      {
        changeId: 'team-add',
        type: 'addTeam',
        teamKey: 'team:b',
        displayName: 'B',
        expectedBase: { kind: 'absent' },
      },
      {
        changeId: 'team-rename',
        type: 'renameTeam',
        teamKey: 'team:a',
        value: 'Alpha',
        expectedBase: { kind: 'value', value: 'A' },
      },
      {
        changeId: 'team-remove',
        type: 'removeTeam',
        teamKey: 'team:a',
        expectedBase: {
          kind: 'present',
          ref: { key: 'team:a', displayName: 'A', combatantKeys: ['data-card:c1'] },
        },
      },
    ];

    for (const change of changes) expect(ArenaProposalChangeSchema.safeParse(change).success).toBe(true);
  });

  it('diff/apply 精确往返 language、team add/rename/remove 与 assignment dependency', () => {
    const base = config();
    const working = {
      ...base,
      selectedLanguage: 'en-US',
      teams: [{
        key: 'team:b',
        displayName: 'Bravo',
        combatantKeys: ['data-card:c2'],
      }],
    };

    const changes = diffArenaSharedConfig(base, working);
    expect(changes.map((change) => change.type)).toEqual([
      'addTeam',
      'removeTeam',
      'assignTeam',
      'setSelectedLanguage',
    ]);
    const addTeam = changes.find((change) => change.type === 'addTeam');
    const assignment = changes.find((change) => change.type === 'assignTeam');
    expect(assignment?.dependsOn).toContain(addTeam?.changeId);
    expect(validateProposalChanges(changes).valid).toBe(true);

    const result = applyArenaProposal(
      { roomId: 'room-1', config: base, revision: 4 },
      proposal(changes),
    );
    expect(result.status).toBe('accepted');
    expect(result.config).toEqual(working);
    expect(result.revision).toBe(5);
  });

  it('common team rename 使用 expectedBase 并在 authority 漂移后冲突', () => {
    const base = config();
    const changes = diffArenaSharedConfig(base, {
      ...base,
      teams: [{ ...base.teams[0], displayName: 'Alpha' }],
    });
    expect(changes).toEqual([
      expect.objectContaining({
        type: 'renameTeam',
        teamKey: 'team:a',
        value: 'Alpha',
        expectedBase: { kind: 'value', value: 'A' },
      }),
    ]);
    expect(detectProposalConflicts({
      ...base,
      teams: [{ ...base.teams[0], displayName: 'Authority rename' }],
    }, changes)).toEqual([
      expect.objectContaining({
        changeId: changes[0]!.changeId,
        code: 'precondition-failed',
        target: 'team:team:a:displayName',
      }),
    ]);
  });

  it('team removal 的 expectedBase 绑定完整权威 team，漂移时 fail closed', () => {
    const base = config();
    const changes = diffArenaSharedConfig(base, { ...base, teams: [] });
    const remove = changes.find((change) => change.type === 'removeTeam');
    expect(remove).toMatchObject({
      teamKey: 'team:a',
      expectedBase: { kind: 'present', ref: base.teams[0] },
    });
    expect(detectProposalConflicts({
      ...base,
      teams: [{ ...base.teams[0], combatantKeys: ['data-card:c1', 'data-card:c2'] }],
    }, remove ? [remove] : [])).toEqual([
      expect.objectContaining({ code: 'precondition-failed', target: 'team:team:a' }),
    ]);
  });

  it('team reorder 与 team 内 reorder 仍明确拒绝', () => {
    const base = {
      ...config(),
      teams: [
        { key: 'team:a', displayName: 'A', combatantKeys: ['data-card:c1', 'data-card:c2'] },
        { key: 'team:b', displayName: 'B', combatantKeys: [] },
      ],
    };
    expect(() => diffArenaSharedConfig(base, {
      ...base,
      teams: [base.teams[1], base.teams[0]],
    })).toThrow(/reorder/i);
    expect(() => diffArenaSharedConfig(base, {
      ...base,
      teams: [{ ...base.teams[0], combatantKeys: ['data-card:c2', 'data-card:c1'] }, base.teams[1]],
    })).toThrow(/reorder/i);
  });

  it('team rename 不会抹掉既有 team creation provenance', () => {
    const base = config();
    const withTeam = {
      ...base,
      teams: [...base.teams, { key: 'team:b', displayName: 'B', combatantKeys: [] }],
    };
    const add = diffArenaSharedConfig(base, withTeam);
    const renamed = {
      ...withTeam,
      teams: [withTeam.teams[0], { ...withTeam.teams[1], displayName: 'Bravo' }],
    };
    const rename = diffArenaSharedConfig(withTeam, renamed);

    expect(mergeCollaborativeChanges({
      previousChanges: add,
      acceptedChanges: rename,
      previousConfig: withTeam,
      nextConfig: renamed,
    }).map((change) => change.type)).toEqual(['addTeam', 'renameTeam']);
  });
});
