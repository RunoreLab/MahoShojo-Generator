import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import {
  ArenaEditorSessionProvider,
  createRoomHostArenaEditorSession,
  createRoomProposalArenaEditorSession,
  createSingleArenaEditorSession,
  useArenaEditorSelector,
} from '@/components/arena/editor';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

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

const config = (
  overrides: Partial<ArenaRoomSharedConfig> = {},
): ArenaRoomSharedConfig => ({
  battleMode: 'classic',
  combatants: [{
    key: 'host-local:character:1',
    displayName: '房主本地角色',
    type: 'general-character',
    source: 'host-local',
    contentVersion: `sha256:${'a'.repeat(64)}`,
    characterGuidance: '安全角色引导',
  }],
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
  overrides: Partial<{
    roomId: string;
    roomEpoch: string;
    revision: number;
    sharedConfig: ArenaRoomSharedConfig;
  }> = {},
) => ({
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  revision: 3,
  sharedConfig: config(),
  ...overrides,
});

const forbiddenProposalKeys = new Set([
  'apiKey',
  'content',
  'data',
  'fileName',
  'filename',
  'credential',
  'payload',
  'provider',
  'userProviderConfig',
]);

const collectKeys = (value: unknown, result = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, result));
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    result.add(key);
    collectKeys(entry, result);
  });
  return result;
};

describe('Arena editor scoped sessions', () => {
  it('creates a detached safe proposal store without polluting the singleton BattleStore', () => {
    useBattleStore.setState({ battleMode: 'classic' });
    const source = snapshot({
      sharedConfig: config({
        battleMode: 'daily',
        combatants: [
          config().combatants[0]!,
          {
            key: 'data-card:character-2',
            ref: { id: 'character-2', kind: 'character', versionToken: 'v2' },
          },
        ],
        materials: [{
          key: 'data-card:material-1',
          ref: { id: 'material-1', kind: 'material', versionToken: 'v1' },
        }],
      }),
    });
    const session = createRoomProposalArenaEditorSession(source);

    expect(session.mode).toBe('room-proposal');
    expect(session.capabilities).toMatchObject({
      canUploadLocalPayload: false,
      canPasteLocalPayload: false,
      canBrowsePrivateCards: false,
      canAddPresetRefs: false,
      canEditSharedConfig: true,
      canStartGeneration: false,
    });
    expect(session.store.getState()).toMatchObject({
      battleMode: 'daily',
      dirty: false,
      stale: false,
      replacementRequired: false,
      combatants: [{
        key: 'host-local:character:1',
        name: '房主本地角色',
        access: 'stub',
      }, {
        key: 'data-card:character-2',
        name: 'character-2',
        type: null,
        access: 'reference',
      }],
    });

    session.update((draft) => ({
      ...draft,
      battleMode: 'kizuna',
      userGuidance: '成员 working copy',
    }));

    expect(session.store.getState()).toMatchObject({
      battleMode: 'kizuna',
      userGuidance: '成员 working copy',
      dirty: true,
    });
    expect(useBattleStore.getState().battleMode).toBe('classic');
    expect(source.sharedConfig.battleMode).toBe('daily');
    expect([...collectKeys(session.store.getState())].filter((key) => forbiddenProposalKeys.has(key)))
      .toEqual([]);
  });

  it('strictly rejects payload-shaped or provider-shaped proposal snapshot fields', () => {
    const unsafe = {
      ...snapshot(),
      sharedConfig: {
        ...config(),
        userProviderConfig: { apiKey: 'secret' },
      },
    };

    expect(() => createRoomProposalArenaEditorSession(unsafe as never)).toThrow();
  });

  it('exports defensive copies and tracks sync, replacement, reset and disposal', () => {
    const session = createRoomProposalArenaEditorSession(snapshot());
    let notifications = 0;
    const unsubscribe = session.store.subscribe(() => {
      notifications += 1;
    });

    session.update((draft) => ({ ...draft, storyLength: 'long' }));
    session.sync(snapshot({
      revision: 4,
      sharedConfig: config({ selectedLanguage: 'ja-JP' }),
    }));
    expect(session.store.getState()).toMatchObject({
      baselineRevision: 3,
      storyLength: 'long',
      dirty: true,
      stale: true,
      replacementRequired: false,
    });

    const exported = session.exportSharedConfig();
    expect(exported.storyLength).toBe('long');
    exported.userGuidance = '不得反写';
    expect(session.store.getState().userGuidance).toBe('');

    session.sync(snapshot({ roomEpoch: 'epoch-2', revision: 0 }));
    expect(session.store.getState()).toMatchObject({
      baselineEpoch: 'epoch-1',
      replacementRequired: true,
      stale: true,
    });

    session.replace(snapshot({
      roomEpoch: 'epoch-2',
      revision: 0,
      sharedConfig: config({ battleMode: 'scenario' }),
    }));
    expect(session.store.getState()).toMatchObject({
      baselineEpoch: 'epoch-2',
      baselineRevision: 0,
      battleMode: 'scenario',
      dirty: false,
      stale: false,
      replacementRequired: false,
    });

    session.dispose();
    expect(session.store.getState().disposed).toBe(true);
    expect(() => session.update((draft) => draft)).toThrow(/disposed/u);
    expect(notifications).toBeGreaterThanOrEqual(5);
    unsubscribe();
  });

  it('single session proxies the existing BattleStore as its sole authority', () => {
    useBattleStore.setState({
      battleMode: 'classic',
      storyLength: 'default',
      selectedLanguage: 'zh-CN',
      settings: {
        ...useBattleStore.getState().settings,
        userGuidance: '',
      },
    });
    const session = createSingleArenaEditorSession();
    let notifications = 0;
    const unsubscribe = session.store.subscribe(() => {
      notifications += 1;
    });

    session.store.getState().actions.setBattleMode('daily');
    session.store.getState().actions.setUserGuidance('单人权威');

    expect(useBattleStore.getState()).toMatchObject({
      battleMode: 'daily',
      settings: { userGuidance: '单人权威' },
    });
    expect(session.store.getState()).toMatchObject({
      battleMode: 'daily',
      userGuidance: '单人权威',
    });

    useBattleStore.getState().setStoryLength('short');
    expect(session.store.getState().storyLength).toBe('short');
    expect(notifications).toBeGreaterThanOrEqual(3);
    unsubscribe();
  });

  it('room-host decorates single behavior with room authority and workspace metadata', () => {
    useBattleStore.setState((state) => ({
      battleMode: 'classic',
      combatants: [{
        type: 'general-character',
        data: { name: '房主本地角色' },
        filename: '房主本地角色',
        isValid: true,
        isPreset: false,
        adjudicationSourceKey: 'host-local:character:1',
        characterGuidance: '安全角色引导',
      }],
      teams: [],
      scenario: { content: null, fileName: null, isNative: false },
      auxScenarios: [],
      materials: [],
      storyLength: 'default',
      customStoryLength: '',
      selectedLanguage: 'zh-CN',
      settings: {
        ...state.settings,
        ...historySettings(),
        userGuidance: '',
      },
    }));
    const session = createRoomHostArenaEditorSession({
      authority: snapshot(),
      workspaceStatus: { kind: 'clean' },
    });

    expect(session.capabilities).toMatchObject({
      canUploadLocalPayload: true,
      canBrowsePrivateCards: true,
      canPublishRoomConfig: true,
      canStartGeneration: true,
    });
    expect(session.store.getState()).toMatchObject({
      mode: 'room-host',
      baselineRevision: 3,
      workspaceStatus: { kind: 'clean' },
      dirty: false,
    });

    session.store.getState().actions.setBattleMode('kizuna');
    expect(useBattleStore.getState().battleMode).toBe('kizuna');
    expect(session.store.getState()).toMatchObject({
      dirty: true,
      workspaceStatus: { kind: 'dirty', reasons: ['shared-config'] },
    });

    session.store.getState().actions.setBattleMode('classic');
    expect(session.store.getState()).toMatchObject({
      dirty: false,
      workspaceStatus: { kind: 'clean' },
    });
    session.store.getState().actions.setBattleMode('kizuna');

    session.syncAuthority({
      authority: snapshot({ revision: 4, sharedConfig: config({ battleMode: 'daily' }) }),
      workspaceStatus: { kind: 'dirty', reasons: ['shared-config'] },
    });
    expect(session.store.getState()).toMatchObject({
      baselineRevision: 4,
      workspaceStatus: { kind: 'dirty', reasons: ['shared-config'] },
      dirty: true,
      battleMode: 'kizuna',
    });

    expect(() => createRoomHostArenaEditorSession({
      authority: snapshot({ revision: -1 }),
    })).toThrow();
  });

  it('injects either session through one Context selector API', () => {
    const session = createRoomProposalArenaEditorSession(snapshot({
      sharedConfig: config({ battleMode: 'daily' }),
    }));
    const Mode = () => {
      const mode = useArenaEditorSelector((state) => state.mode);
      const battleMode = useArenaEditorSelector((state) => state.battleMode);
      return <span>{`${mode}:${battleMode}`}</span>;
    };

    expect(renderToStaticMarkup(
      <ArenaEditorSessionProvider session={session}>
        <Mode />
      </ArenaEditorSessionProvider>,
    )).toContain('room-proposal:daily');
  });
});
