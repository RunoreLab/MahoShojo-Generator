import { describe, expect, it } from 'vitest';

import {
  buildArenaRoomHostWorkspaceBundleFromBattleState,
  buildArenaRoomSharedConfigFromBattleState,
  type ArenaRoomBattleStateSource,
} from '@/lib/arena-room/shared-config';

const settings = {
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
  streamTransport: 'sse' as const,
  userGuidance: '保持紧凑',
};

const source = (): ArenaRoomBattleStateSource => ({
  battleMode: 'scenario',
  combatants: [
    {
      type: 'magical-girl',
      data: { name: '预设角色', nested: { power: 3 } },
      filename: 'M01.json',
      isValid: true,
      isPreset: true,
      teamId: 1,
      characterGuidance: '保护队友',
    },
    {
      type: 'general-character',
      data: { name: '在线角色', apiKey: 'must-not-leak' },
      filename: 'online.json',
      isValid: true,
      isPreset: false,
      sourceDataCardId: 'character-2',
      sourceDataCardUpdatedAt: '2026-08-28T00:00:00.000Z',
      teamId: 1,
    },
    {
      type: 'canshou',
      data: { name: '本地残兽', secret: 'host-only-payload' },
      filename: 'local.json',
      isValid: true,
      isPreset: false,
    },
  ],
  teams: [{ id: 1, name: '第一队', isCollapsed: false }],
  scenario: {
    content: { title: '本地情景', hidden: 'host-only' },
    fileName: 'scenario.json',
    isNative: false,
  },
  auxScenarios: [{
    id: 'aux-1',
    content: { title: '在线辅助情景' },
    fileName: 'aux.json',
    isNative: false,
    sourceDataCardId: 'scenario-2',
    sourceDataCardUpdatedAt: '2026-08-28T00:01:00.000Z',
  }],
  materials: [{
    id: 'material-1',
    name: '本地素材',
    content: { secret: 'host-only-material' },
    fileName: 'material.json',
    sourceKind: 'raw-json',
    sourceType: 'raw-json',
    isNative: false,
  }],
  storyLength: 'standard',
  customStoryLength: '',
  selectedLanguage: 'zh-CN',
  settings,
  userProviderConfig: { apiKey: 'provider-secret' },
});

describe('Arena Room Battle store projection', () => {
  it('只构造 allowlist refs/stubs，绝不复制本地 payload 或 provider secret', async () => {
    const input = source();
    const before = structuredClone(input);
    const projected = await buildArenaRoomSharedConfigFromBattleState(input);

    expect(projected).toMatchObject({
      combatants: [
        {
          key: 'preset:M01.json',
          ref: { id: 'M01.json', kind: 'character' },
          characterGuidance: '保护队友',
        },
        {
          key: 'data-card:character-2',
          ref: {
            id: 'character-2',
            kind: 'character',
            versionToken: '2026-08-28T00:00:00.000Z',
          },
        },
        {
          key: expect.stringMatching(/^host-local:character:/u),
          displayName: '本地残兽',
          type: 'canshou',
          source: 'host-local',
        },
      ],
      teams: [{
        key: 'team:1',
        displayName: '第一队',
        combatantKeys: ['preset:M01.json', 'data-card:character-2'],
      }],
      scenario: {
        key: expect.stringMatching(/^host-local:scenario:/u),
        displayName: '本地情景',
        type: 'scenario',
        source: 'host-local',
      },
      auxScenarios: [{
        key: 'data-card:scenario-2',
        ref: {
          id: 'scenario-2',
          kind: 'scenario',
          versionToken: '2026-08-28T00:01:00.000Z',
        },
      }],
      materials: [{
        key: expect.stringMatching(/^host-local:material:/u),
        displayName: '本地素材',
        type: 'material',
        source: 'host-local',
      }],
      userGuidance: '保持紧凑',
      customStoryLength: null,
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('provider-secret');
    expect(serialized).not.toContain('host-only');
    expect(serialized).not.toContain('apiKey');
    expect(input).toEqual(before);
  });

  it('preset versionToken 是确定性 content digest，内容变化会改变版本', async () => {
    const first = await buildArenaRoomSharedConfigFromBattleState(source());
    const repeated = await buildArenaRoomSharedConfigFromBattleState(source());
    const changedInput = source();
    if ('data' in changedInput.combatants[0]!) {
      changedInput.combatants[0]!.data = { name: '预设角色', nested: { power: 4 } };
    }
    const changed = await buildArenaRoomSharedConfigFromBattleState(changedInput);
    const firstVersion = 'ref' in first.combatants[0]! ? first.combatants[0]!.ref.versionToken : '';
    const repeatedVersion = 'ref' in repeated.combatants[0]!
      ? repeated.combatants[0]!.ref.versionToken
      : '';
    const changedVersion = 'ref' in changed.combatants[0]!
      ? changed.combatants[0]!.ref.versionToken
      : '';
    expect(firstVersion).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(repeatedVersion).toBe(firstVersion);
    expect(changedVersion).not.toBe(firstVersion);
  });

  it('host workspace bundle 只携带 frozen config 实际引用的本地正文与内容摘要', async () => {
    const bundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(source());

    expect(bundle.hostLocalPayloads).toEqual([
      {
        key: expect.stringMatching(/^host-local:character:/u),
        kind: 'character',
        payload: { name: '本地残兽', secret: 'host-only-payload' },
      },
      {
        key: expect.stringMatching(/^host-local:scenario:/u),
        kind: 'scenario',
        payload: { title: '本地情景', hidden: 'host-only' },
      },
      {
        key: expect.stringMatching(/^host-local:material:/u),
        kind: 'material',
        payload: { secret: 'host-only-material' },
      },
    ]);
    expect(bundle.hostLocalContentDigests).toHaveLength(3);
    expect(bundle.hostLocalContentDigests.every((entry) => (
      /^sha256:[0-9a-f]{64}$/u.test(entry.digest)
    ))).toBe(true);
    expect(JSON.stringify(bundle.sharedConfig)).not.toContain('host-only');
    expect(JSON.stringify(bundle.hostLocalPayloads)).not.toContain('provider-secret');
  });

  it('本地正文变化会改变 workspace digest，但不会偷渡进 safe SharedConfig', async () => {
    const first = await buildArenaRoomHostWorkspaceBundleFromBattleState(source());
    const changedSource = source();
    if ('data' in changedSource.combatants[2]!) {
      changedSource.combatants[2]!.data = { name: '本地残兽', secret: '已修改正文' };
    }
    const changed = await buildArenaRoomHostWorkspaceBundleFromBattleState(changedSource);

    expect(changed.sharedConfig).toEqual(first.sharedConfig);
    const localKey = first.hostLocalPayloads[0]!.key;
    expect(changed.hostLocalContentDigests.find((entry) => entry.key === localKey)?.digest)
      .not.toBe(first.hostLocalContentDigests.find((entry) => entry.key === localKey)?.digest);
  });

  it('在线 ref 缺 version、random placeholder、重复 key 与超限 roster 均拒绝', async () => {
    const missingVersion = source();
    if ('data' in missingVersion.combatants[1]!) {
      delete missingVersion.combatants[1]!.sourceDataCardUpdatedAt;
    }
    await expect(buildArenaRoomSharedConfigFromBattleState(missingVersion)).rejects.toThrow();

    const random = source();
    random.combatants = [{
      type: 'random-magical-girl',
      id: 'random-1',
      filename: 'random',
    }];
    await expect(buildArenaRoomSharedConfigFromBattleState(random)).rejects.toThrow(/随机占位符/u);

    const overflow = source();
    overflow.combatants = Array.from({ length: 11 }, (_, index) => ({
      type: 'magical-girl' as const,
      data: { name: `本地 ${index}` },
      filename: `local-${index}.json`,
      isValid: true,
      isPreset: false,
    }));
    await expect(buildArenaRoomSharedConfigFromBattleState(overflow)).rejects.toThrow();
  });

  it('单人引用项放宽后仍明确拒绝超过多人 wire contract 的投影', async () => {
    const tooManyAuxScenarios = source();
    tooManyAuxScenarios.auxScenarios = Array.from({ length: 11 }, (_, index) => ({
      id: `aux-${index}`,
      content: { title: `辅助情景 ${index}` },
      fileName: `aux-${index}.json`,
      isNative: false,
    }));
    await expect(buildArenaRoomSharedConfigFromBattleState(tooManyAuxScenarios))
      .rejects.toThrow('多人房间最多支持 10 个辅助情景');

    const tooManyMaterials = source();
    tooManyMaterials.materials = Array.from({ length: 11 }, (_, index) => ({
      id: `material-${index}`,
      name: `素材 ${index}`,
      content: {},
      fileName: null,
      sourceKind: 'raw-json',
      sourceType: 'raw-json',
      isNative: false,
    }));
    await expect(buildArenaRoomSharedConfigFromBattleState(tooManyMaterials))
      .rejects.toThrow('多人房间最多支持 10 个素材');
  });
});
