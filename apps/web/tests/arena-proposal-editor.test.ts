import { describe, expect, it } from 'vitest';

import type {
  ArenaProposalChange,
  ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import {
  ArenaProposalEditorError,
  assertArenaProposalSelection,
  buildArenaProposalSubmitIntent,
  createArenaProposalEditor,
  editWorkingConfig,
  previewArenaProposal,
  replaceWorkingConfig,
  resetArenaProposalEditor,
  syncArenaProposalEditor,
  type ArenaProposalEditorSnapshot,
} from '@/lib/arena-room/proposal-editor';

const historySettings = () => ({
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
});

const combatant = (id: string, guidance?: string) => ({
  key: `data-card:${id}`,
  ref: { id, kind: 'character' as const, versionToken: `${id}-v1` },
  ...(guidance === undefined ? {} : { characterGuidance: guidance }),
});

const config = (overrides: Partial<ArenaRoomSharedConfig> = {}): ArenaRoomSharedConfig => ({
  battleMode: 'classic',
  combatants: [combatant('c1')],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'default',
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings: historySettings(),
  ...overrides,
});

const snapshot = (
  overrides: Partial<ArenaProposalEditorSnapshot> = {},
): ArenaProposalEditorSnapshot => ({
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  revision: 1,
  sharedConfig: config(),
  ...overrides,
});

const thrown = (run: () => unknown): ArenaProposalEditorError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ArenaProposalEditorError) return error;
    throw error;
  }
  throw new Error('expected ArenaProposalEditorError');
};

describe('Arena proposal local editor model', () => {
  it('creates detached baseline and working copies from a projected snapshot', () => {
    const source = snapshot();
    const editor = createArenaProposalEditor(source);

    expect(editor.roomId).toBe('room-1');
    expect(editor.baselineEpoch).toBe('epoch-1');
    expect(editor.baselineRevision).toBe(1);
    expect(editor.baselineConfig).toEqual(source.sharedConfig);
    expect(editor.baselineConfig).not.toBe(source.sharedConfig);
    expect(editor.workingConfig).toEqual(source.sharedConfig);
    expect(editor.workingConfig).not.toBe(editor.baselineConfig);
    expect(editor.dirty).toBe(false);
    expect(editor.stale).toBe(false);
    expect(editor.replacementRequired).toBe(false);

    const sourceCombatant = source.sharedConfig.combatants[0];
    const workingCombatant = editor.workingConfig.combatants[0];
    expect(workingCombatant).not.toBe(sourceCombatant);
  });

  it('replaces and edits only a detached local working copy', () => {
    const editor = createArenaProposalEditor(snapshot());
    const edited = editWorkingConfig(editor, (draft) => ({
      ...draft,
      userGuidance: '成员建议',
    }));

    expect(editor.dirty).toBe(false);
    expect(editor.workingConfig.userGuidance).toBe('');
    expect(edited.dirty).toBe(true);
    expect(edited.baselineConfig.userGuidance).toBe('');
    expect(edited.workingConfig.userGuidance).toBe('成员建议');

    const replaced = replaceWorkingConfig(edited, {
      ...edited.workingConfig,
      battleMode: 'scenario',
    });
    expect(replaced.dirty).toBe(true);
    expect(replaced.workingConfig.battleMode).toBe('scenario');
    expect(edited.workingConfig.battleMode).toBe('classic');
  });

  it('computes typed diff and expectedBase without any network-shaped fields', () => {
    const editor = editWorkingConfig(createArenaProposalEditor(snapshot()), (draft) => ({
      ...draft,
      userGuidance: '成员建议',
    }));

    const preview = previewArenaProposal(editor);
    expect(preview.selectedChangeIds).toEqual(['change-1']);
    expect(preview.changes).toEqual([{
      changeId: 'change-1',
      type: 'setUserGuidance',
      value: '成员建议',
      expectedBase: { kind: 'value', value: '' },
    }]);
  });

  it('builds a minimal submit intent containing only client proposal fields', () => {
    const editor = editWorkingConfig(createArenaProposalEditor(snapshot()), (draft) => ({
      ...draft,
      userGuidance: '仅安全摘要',
    }));

    const intent = buildArenaProposalSubmitIntent(editor, 'proposal-1');

    expect(Object.keys(intent)).toEqual([
      'proposalId',
      'expectedRoomEpoch',
      'baseRevision',
      'changes',
    ]);
    expect(intent).toEqual({
      proposalId: 'proposal-1',
      expectedRoomEpoch: 'epoch-1',
      baseRevision: 1,
      changes: [{
        changeId: 'change-1',
        type: 'setUserGuidance',
        value: '仅安全摘要',
        expectedBase: { kind: 'value', value: '' },
      }],
    });
    expect(JSON.stringify(intent)).not.toContain('authorUserId');
    expect(JSON.stringify(intent)).not.toContain('status');
    expect(JSON.stringify(intent)).not.toContain('createdAt');
    expect(JSON.stringify(intent)).not.toContain('provider');
    expect(JSON.stringify(intent)).not.toContain('payload');
    expect(thrown(() => buildArenaProposalSubmitIntent(editor, ' proposal-1 ')).code)
      .toBe('invalid-proposal-id');
  });

  it('uses selected changes and rejects a missing dependency closure', () => {
    const editor = editWorkingConfig(createArenaProposalEditor(snapshot()), (draft) => ({
      ...draft,
      combatants: [...draft.combatants, combatant('c2', '新增角色引导')],
    }));

    const preview = previewArenaProposal(editor);
    expect(preview.changes).toHaveLength(2);
    expect(preview.changes[1]).toMatchObject({
      type: 'setCharacterGuidance',
      dependsOn: ['change-1'],
    });

    const error = thrown(() => previewArenaProposal(editor, ['change-2']));
    expect(error.code).toBe('selection-invalid');
    expect(error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'dependency-not-selected',
        changeId: 'change-2',
        dependencyId: 'change-1',
      }),
    ]));
  });

  it('rejects partial atomic-group selections through the core validator', () => {
    const changes: ArenaProposalChange[] = [
      {
        changeId: 'mode',
        type: 'setBattleMode',
        value: 'daily',
        expectedBase: { kind: 'value', value: 'classic' },
        atomicGroupId: 'mode-and-guidance',
      },
      {
        changeId: 'guidance',
        type: 'setUserGuidance',
        value: '一起接受',
        expectedBase: { kind: 'value', value: '' },
        atomicGroupId: 'mode-and-guidance',
      },
    ];

    const error = thrown(() => assertArenaProposalSelection(changes, ['mode']));
    expect(error.code).toBe('selection-invalid');
    expect(error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'atomic-group-partial',
        atomicGroupId: 'mode-and-guidance',
      }),
    ]));
    expect(assertArenaProposalSelection(changes, ['mode', 'guidance']).selectedChangeIds)
      .toEqual(['mode', 'guidance']);
  });

  it('reports empty and unsupported edits explicitly', () => {
    const clean = createArenaProposalEditor(snapshot());
    expect(thrown(() => previewArenaProposal(clean)).code).toBe('empty-proposal');

    const twoCombatants = createArenaProposalEditor(snapshot({
      sharedConfig: config({
        combatants: [combatant('c1'), combatant('c2')],
      }),
    }));
    const reordered = editWorkingConfig(twoCombatants, (draft) => ({
      ...draft,
      combatants: [draft.combatants[1]!, draft.combatants[0]!],
    }));
    const error = thrown(() => previewArenaProposal(reordered));
    expect(error.code).toBe('unsupported-change');
    expect(error.message).toMatch(/reorder/u);
  });

  it('keeps a dirty same-epoch draft and marks it stale when revision advances', () => {
    const dirty = editWorkingConfig(createArenaProposalEditor(snapshot()), (draft) => ({
      ...draft,
      userGuidance: '本地未提交',
    }));
    const incoming = snapshot({
      revision: 2,
      sharedConfig: config({ storyLength: 'short' }),
    });

    const synced = syncArenaProposalEditor(dirty, incoming);

    expect(synced.baselineRevision).toBe(1);
    expect(synced.baselineConfig.storyLength).toBe('default');
    expect(synced.workingConfig.userGuidance).toBe('本地未提交');
    expect(synced.stale).toBe(true);
    expect(synced.dirty).toBe(true);
    expect(synced.replacementRequired).toBe(false);
    expect(buildArenaProposalSubmitIntent(synced, 'proposal-stale').baseRevision).toBe(1);
  });

  it('automatically rebuilds a clean draft and supports explicit reset', () => {
    const clean = createArenaProposalEditor(snapshot());
    const incoming = snapshot({
      revision: 2,
      sharedConfig: config({ storyLength: 'short' }),
    });

    const synced = syncArenaProposalEditor(clean, incoming);
    expect(synced.baselineRevision).toBe(2);
    expect(synced.baselineConfig.storyLength).toBe('short');
    expect(synced.workingConfig.storyLength).toBe('short');
    expect(synced.dirty).toBe(false);
    expect(synced.stale).toBe(false);

    const dirty = editWorkingConfig(clean, (draft) => ({ ...draft, userGuidance: '丢弃此草稿' }));
    expect(dirty.dirty).toBe(true);
    const reset = resetArenaProposalEditor(incoming);
    expect(reset.baselineRevision).toBe(2);
    expect(reset.workingConfig.userGuidance).toBe('');
    expect(reset.workingConfig.storyLength).toBe('short');
    expect(reset.dirty).toBe(false);
    expect(reset.stale).toBe(false);
  });

  it('requires replacement/resync on a new room epoch and blocks old submit intent', () => {
    const editor = createArenaProposalEditor(snapshot());
    const nextEpoch = snapshot({ roomEpoch: 'epoch-2', revision: 0 });
    const marked = syncArenaProposalEditor(editor, nextEpoch);

    expect(marked.baselineEpoch).toBe('epoch-1');
    expect(marked.replacementRequired).toBe(true);
    expect(marked.stale).toBe(true);
    expect(thrown(() => previewArenaProposal(marked)).code).toBe('replacement-required');
    expect(thrown(() => buildArenaProposalSubmitIntent(marked, 'old-proposal')).code)
      .toBe('replacement-required');

    const rebuilt = resetArenaProposalEditor(nextEpoch);
    expect(rebuilt.baselineEpoch).toBe('epoch-2');
    expect(rebuilt.baselineRevision).toBe(0);
    expect(rebuilt.replacementRequired).toBe(false);
  });

  it('ignores an older same-epoch snapshot instead of rolling back the draft', () => {
    const editor = createArenaProposalEditor(snapshot({ revision: 2 }));
    const older = snapshot({
      revision: 1,
      sharedConfig: config({ storyLength: 'long' }),
    });

    const result = syncArenaProposalEditor(editor, older);
    expect(result).toBe(editor);
    expect(result.baselineRevision).toBe(2);
    expect(result.workingConfig.storyLength).toBe('default');
  });
});
