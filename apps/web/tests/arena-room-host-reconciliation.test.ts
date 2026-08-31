import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import {
  applyArenaRoomAuthorityToBattleStore,
} from '@/lib/arena-room/host-reconciliation';
import { buildArenaRoomHostWorkspaceBundleFromBattleState } from '@/lib/arena-room/shared-config';

const publicRow = (id: string, type: 'character' | 'scenario' | 'material') => ({
  id,
  name: `公开 ${id}`,
  type,
  data: JSON.stringify(type === 'character'
    ? { name: `角色 ${id}` }
    : { title: `内容 ${id}`, description: '公开内容' }),
  is_public: 1,
  updated_at: `version-${id}`,
  username: '公开作者',
});

beforeEach(() => {
  useBattleStore.setState((state) => ({
    battleMode: 'classic',
    combatants: [{
      type: 'general-character',
      data: { name: '房主本地角色' },
      filename: '房主本地角色.json',
      isValid: true,
      isPreset: false,
      characterGuidance: '',
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
      userGuidance: '',
    },
    adjudicationEvents: [],
  }));
});

describe('Arena room host reconciliation', () => {
  it('把新 authority 确定性 materialize 到 host BattleStore，并保留 opaque team key', async () => {
    const current = useBattleStore.getState();
    const baselineBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(current);
    const local = baselineBundle.sharedConfig.combatants[0]!;
    const target: ArenaRoomSharedConfig = {
      ...baselineBundle.sharedConfig,
      battleMode: 'scenario',
      combatants: [
        { ...local, characterGuidance: '守住后排' },
        {
          key: 'data-card:character-public',
          ref: {
            id: 'character-public',
            kind: 'character',
            versionToken: 'version-character-public',
          },
        },
      ],
      teams: [{
        key: 'team:proposal-opaque',
        displayName: '提案队伍',
        combatantKeys: [local.key, 'data-card:character-public'],
      }],
      scenario: {
        key: 'data-card:scenario-main',
        ref: {
          id: 'scenario-main',
          kind: 'scenario',
          versionToken: 'version-scenario-main',
        },
      },
      auxScenarios: [{
        key: 'data-card:scenario-aux',
        ref: {
          id: 'scenario-aux',
          kind: 'scenario',
          versionToken: 'version-scenario-aux',
        },
      }],
      materials: [{
        key: 'data-card:material-public',
        ref: {
          id: 'material-public',
          kind: 'material',
          versionToken: 'version-material-public',
        },
      }],
      userGuidance: '按房间权威推进',
      storyLength: 'standard',
      selectedLanguage: 'en-US',
      historySettings: {
        ...baselineBundle.sharedConfig.historySettings,
        readNarrativeHistory: true,
      },
    };
    const loadPublicCard = vi.fn(async (id: string) => {
      const type = id.startsWith('character')
        ? 'character'
        : id.startsWith('material') ? 'material' : 'scenario';
      return publicRow(id, type);
    });

    await applyArenaRoomAuthorityToBattleStore(target, {
      currentBundle: baselineBundle,
      loadPublicCard,
    });

    const synchronized = useBattleStore.getState();
    expect(synchronized).toMatchObject({
      battleMode: 'scenario',
      storyLength: 'standard',
      selectedLanguage: 'en-US',
      settings: {
        userGuidance: '按房间权威推进',
        readNarrativeHistory: true,
      },
      teams: [{
        roomKey: 'team:proposal-opaque',
        name: '提案队伍',
      }],
    });
    expect(synchronized.combatants).toHaveLength(2);
    expect(synchronized.combatants[0]).toMatchObject({
      characterGuidance: '守住后排',
      teamId: synchronized.teams[0]!.id,
    });
    expect(synchronized.combatants[1]).toMatchObject({
      sourceDataCardId: 'character-public',
      sourceDataCardUpdatedAt: 'version-character-public',
      teamId: synchronized.teams[0]!.id,
    });
    expect(loadPublicCard).toHaveBeenCalledTimes(4);

    const rebuilt = await buildArenaRoomHostWorkspaceBundleFromBattleState(synchronized);
    expect(rebuilt.sharedConfig).toEqual(target);
  });

  it('线上 ref 版本漂移时 fail closed，且不写入 BattleStore', async () => {
    const before = useBattleStore.getState();
    const baselineBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(before);
    const target: ArenaRoomSharedConfig = {
      ...baselineBundle.sharedConfig,
      combatants: [...baselineBundle.sharedConfig.combatants, {
        key: 'data-card:character-stale',
        ref: {
          id: 'character-stale',
          kind: 'character',
          versionToken: 'expected-version',
        },
      }],
    };

    await expect(applyArenaRoomAuthorityToBattleStore(target, {
      currentBundle: baselineBundle,
      loadPublicCard: async () => ({
        ...publicRow('character-stale', 'character'),
        updated_at: 'different-version',
      }),
    })).rejects.toThrow(/版本/u);
    expect(useBattleStore.getState().combatants).toBe(before.combatants);
  });
});
