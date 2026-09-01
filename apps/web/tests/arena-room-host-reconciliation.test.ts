import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import M01Centaurea from '@/public/presets/M01_centaurea.json';
import S01QueenWill from '@/public/scenario-presets/S01_queen_will.json';
import {
  applyArenaRoomAuthorityToBattleStore,
} from '@/lib/arena-room/host-reconciliation';
import { ARENA_ROOM_PRESET_CATALOG } from '@/lib/arena-room/generated/arena-room-preset-catalog';
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
    const verifyOrigin = vi.fn(async () => false);

    await applyArenaRoomAuthorityToBattleStore(target, {
      currentBundle: baselineBundle,
      loadPublicCard,
      verifyOrigin,
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
      isValid: false,
      teamId: synchronized.teams[0]!.id,
    });
    expect(synchronized.scenario.isNative).toBe(false);
    expect(synchronized.scenario.isPreset).toBe(false);
    expect(synchronized.auxScenarios[0]!.isNative).toBe(false);
    expect(synchronized.auxScenarios[0]!.isPreset).toBe(false);
    expect(synchronized.materials[0]!.isNative).toBe(false);
    expect(synchronized.materials[0]!.isPreset).toBe(false);
    expect(loadPublicCard).toHaveBeenCalledTimes(4);
    expect(verifyOrigin).toHaveBeenCalledTimes(4);

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

  it('显式同步房间时用 published host-local payload 放弃本地正文冲突', async () => {
    const published = await buildArenaRoomHostWorkspaceBundleFromBattleState(
      useBattleStore.getState(),
    );
    useBattleStore.setState((state) => ({
      combatants: state.combatants.map((combatant) => 'data' in combatant
        ? { ...combatant, data: { name: '未发布的本地修改' } }
        : combatant),
    }));
    const dirtyBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
      useBattleStore.getState(),
    );

    const verifyOrigin = vi.fn(async () => false);
    await applyArenaRoomAuthorityToBattleStore(published.sharedConfig, {
      currentBundle: dirtyBundle,
      hostLocalPayloads: published.hostLocalPayloads,
      verifyOrigin,
      loadPublicCard: async () => {
        throw new Error('不应读取 online card');
      },
    });

    const restored = useBattleStore.getState();
    expect(restored.combatants[0]).toMatchObject({
      data: { name: '房主本地角色' },
      isValid: false,
      arenaRoomKey: published.sharedConfig.combatants[0]!.key,
    });
    expect(verifyOrigin).toHaveBeenCalledWith({ name: '房主本地角色' });
    const rebuilt = await buildArenaRoomHostWorkspaceBundleFromBattleState(restored);
    expect(rebuilt.sharedConfig).toEqual(published.sharedConfig);
  });

  it('成员新增的 canonical 角色与情景 preset 可 materialize 到房主 Arena 编辑区', async () => {
    const baselineBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
      useBattleStore.getState(),
    );
    const characterPreset = ARENA_ROOM_PRESET_CATALOG.find((entry) => (
      entry.kind === 'character' && entry.id === 'M01_centaurea.json'
    ));
    const scenarioPreset = ARENA_ROOM_PRESET_CATALOG.find((entry) => (
      entry.kind === 'scenario' && entry.id === 'S01_queen_will.json'
    ));
    expect(characterPreset).toBeDefined();
    expect(scenarioPreset).toBeDefined();
    const target: ArenaRoomSharedConfig = {
      ...baselineBundle.sharedConfig,
      battleMode: 'scenario',
      combatants: [...baselineBundle.sharedConfig.combatants, {
        key: `preset:${characterPreset!.id}`,
        ref: {
          id: characterPreset!.id,
          kind: 'character',
          versionToken: characterPreset!.versionToken,
        },
      }],
      scenario: {
        key: `preset:${scenarioPreset!.id}`,
        ref: {
          id: scenarioPreset!.id,
          kind: 'scenario',
          versionToken: scenarioPreset!.versionToken,
        },
      },
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/presets/${characterPreset!.id}`)) {
        return new Response(JSON.stringify(M01Centaurea), { status: 200 });
      }
      if (url.endsWith(`/scenario-presets/${scenarioPreset!.id}`)) {
        return new Response(JSON.stringify(S01QueenWill), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    const verifyOrigin = vi.fn(async () => false);

    try {
      await applyArenaRoomAuthorityToBattleStore(target, {
        currentBundle: baselineBundle,
        verifyOrigin,
        loadPublicCard: async () => {
          throw new Error('不应读取 online card');
        },
      });
    } finally {
      fetchSpy.mockRestore();
    }

    const synchronized = useBattleStore.getState();
    expect(synchronized.combatants.at(-1)).toMatchObject({
      filename: characterPreset!.id,
      isPreset: true,
      isValid: true,
    });
    expect(synchronized.scenario).toMatchObject({
      fileName: scenarioPreset!.id,
      isNative: true,
      isPreset: true,
    });
    expect(verifyOrigin).not.toHaveBeenCalled();
    const rebuilt = await buildArenaRoomHostWorkspaceBundleFromBattleState(synchronized);
    expect(rebuilt.sharedConfig).toEqual(target);
  });

  it('preset 响应正文与 frozen versionToken 不一致时 fail closed 且不写入 BattleStore', async () => {
    const before = useBattleStore.getState();
    const baselineBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(before);
    const characterPreset = ARENA_ROOM_PRESET_CATALOG.find((entry) => (
      entry.kind === 'character' && entry.id === 'M01_centaurea.json'
    ));
    expect(characterPreset).toBeDefined();
    const target: ArenaRoomSharedConfig = {
      ...baselineBundle.sharedConfig,
      combatants: [...baselineBundle.sharedConfig.combatants, {
        key: `preset:${characterPreset!.id}`,
        ref: {
          id: characterPreset!.id,
          kind: 'character',
          versionToken: characterPreset!.versionToken,
        },
      }],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ...M01Centaurea,
      codename: '被篡改的预设正文',
    }), { status: 200 }));

    try {
      await expect(applyArenaRoomAuthorityToBattleStore(target, {
        currentBundle: baselineBundle,
        loadPublicCard: async () => {
          throw new Error('不应读取 online card');
        },
      })).rejects.toThrow(/正文.*版本/u);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(useBattleStore.getState().combatants).toBe(before.combatants);
  });

  it('Room reconciliation 只清理已删除来源的判定事件，保留手工项与仍有效来源', async () => {
    useBattleStore.setState((state) => ({
      battleMode: 'scenario',
      combatants: [...state.combatants, {
        type: 'general-character',
        data: { name: '将被删除的角色' },
        filename: '将删除角色.json',
        isValid: true,
        isPreset: false,
      }],
      scenario: {
        content: { title: '将被替换的情景' },
        fileName: '旧情景.json',
        isNative: false,
      },
      adjudicationEvents: [{
        id: 'manual-event',
        description: '房主手工判定',
        type: 'binary',
      }, {
        id: 'retained-event',
        description: '仍有效角色来源',
        type: 'binary',
        sourceKey: 'file:房主本地角色.json',
      }, {
        id: 'removed-event',
        description: '已删除角色来源',
        type: 'binary',
        sourceKey: 'file:将删除角色.json',
      }, {
        id: 'replaced-scenario-event',
        description: '已替换情景来源',
        type: 'binary',
        sourceKey: 'file:旧情景.json',
      }],
    }));
    const baselineBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
      useBattleStore.getState(),
    );
    const target: ArenaRoomSharedConfig = {
      ...baselineBundle.sharedConfig,
      combatants: [baselineBundle.sharedConfig.combatants[0]!],
      scenario: null,
    };

    await applyArenaRoomAuthorityToBattleStore(target, {
      currentBundle: baselineBundle,
      loadPublicCard: async () => {
        throw new Error('不应读取 online card');
      },
    });

    expect(useBattleStore.getState().adjudicationEvents.map((event) => event.id)).toEqual([
      'manual-event',
      'retained-event',
    ]);
  });

  it('混合随机占位符时按可共享角色序列重建，不错配正文或判定来源', async () => {
    useBattleStore.setState({
      combatants: [{
        type: 'random-magical-girl',
        id: 'random-before-real-combatants',
        filename: '随机魔法少女',
      }, {
        type: 'general-character',
        data: { name: '保留角色 A' },
        filename: 'A.json',
        isValid: false,
        isPreset: false,
        adjudicationSourceKey: 'file:A.json',
      }, {
        type: 'general-character',
        data: { name: '删除角色 B' },
        filename: 'B.json',
        isValid: false,
        isPreset: false,
        adjudicationSourceKey: 'file:B.json',
      }],
      adjudicationEvents: [{
        id: 'manual-mixed',
        description: '手工判定',
        type: 'binary',
      }, {
        id: 'retained-a',
        description: '角色 A 判定',
        type: 'binary',
        sourceKey: 'file:A.json',
      }, {
        id: 'removed-b',
        description: '角色 B 判定',
        type: 'binary',
        sourceKey: 'file:B.json',
      }],
    });
    const baselineBundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(
      useBattleStore.getState(),
    );
    expect(baselineBundle.sharedConfig.combatants).toHaveLength(2);
    const target: ArenaRoomSharedConfig = {
      ...baselineBundle.sharedConfig,
      combatants: [baselineBundle.sharedConfig.combatants[0]!],
    };

    await applyArenaRoomAuthorityToBattleStore(target, {
      currentBundle: baselineBundle,
      loadPublicCard: async () => {
        throw new Error('不应读取 online card');
      },
    });

    const synchronized = useBattleStore.getState();
    expect(synchronized.combatants).toEqual([
      expect.objectContaining({ data: { name: '保留角色 A' }, filename: 'A.json' }),
    ]);
    expect(synchronized.adjudicationEvents.map((event) => event.id)).toEqual([
      'manual-mixed',
      'retained-a',
    ]);
  });
});
