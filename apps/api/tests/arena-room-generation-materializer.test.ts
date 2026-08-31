import { describe, expect, it, vi } from 'vitest';

import {
  ArenaRoomGenerationMaterializationError,
  createArenaRoomGenerationMaterializer,
  type ArenaRoomGenerationCanonicalContent,
} from '#/arena-room/room-generation-materializer';

const historySettings = {
  readArenaHistory: true,
  readArenaHistoryLimit: 3,
  isArenaHistoryUnlimited: false,
  writeArenaHistory: true,
  readCurrentState: true,
  writeCurrentState: false,
  readNarrativeHistory: true,
  readNarrativeHistoryLimit: 7,
  isNarrativeHistoryUnlimited: false,
  writeNarrativeHistory: true,
};

const sharedConfig = () => ({
  battleMode: 'scenario' as const,
  combatants: [
    {
      key: 'data-card:online-character',
      ref: {
        id: 'online-character',
        kind: 'character' as const,
        versionToken: 'character-v1',
      },
      characterGuidance: '接受后的角色引导',
    },
    {
      key: 'preset:M00_white_lily.json',
      ref: {
        id: 'M00_white_lily.json',
        kind: 'character' as const,
        versionToken: `sha256:${'1'.repeat(64)}`,
      },
    },
    {
      key: 'host-local:character:2:local',
      displayName: '本地角色',
      type: 'general-character' as const,
      source: 'host-local' as const,
      characterGuidance: '本地角色引导',
    },
  ],
  teams: [{
    key: 'team:red',
    displayName: '红队',
    combatantKeys: ['data-card:online-character', 'host-local:character:2:local'],
  }],
  scenario: {
    key: 'data-card:online-scenario',
    ref: {
      id: 'online-scenario',
      kind: 'scenario' as const,
      versionToken: 'scenario-v1',
    },
  },
  auxScenarios: [{
    key: 'host-local:scenario:0:aux',
    displayName: '本地辅助情景',
    type: 'scenario' as const,
    source: 'host-local' as const,
  }],
  materials: [{
    key: 'data-card:online-material',
    ref: {
      id: 'online-material',
      kind: 'material' as const,
      versionToken: 'material-v1',
    },
  }],
  userGuidance: '接受后的全局引导',
  storyLength: 'long' as const,
  customStoryLength: '4321',
  selectedLanguage: 'ja-JP',
  historySettings,
});

const canonical = (
  id: string,
  kind: 'character' | 'scenario' | 'material',
  versionToken: string,
  payload: Record<string, unknown>,
  displayName: string,
): ArenaRoomGenerationCanonicalContent => ({
  ref: { id, kind, versionToken },
  payload,
  displayName,
});

const createHarness = () => {
  const online = new Map<string, ArenaRoomGenerationCanonicalContent>([
    ['online-character', canonical(
      'online-character', 'character', 'character-v1',
      { name: '线上角色', content: '角色正文' }, '线上角色',
    )],
    ['online-scenario', canonical(
      'online-scenario', 'scenario', 'scenario-v1',
      { title: '线上情景', content: '情景正文' }, '线上情景',
    )],
    ['online-material', canonical(
      'online-material', 'material', 'material-v1',
      { title: '线上素材', content: '素材正文' }, '线上素材',
    )],
  ]);
  const content = {
    resolveOnline: vi.fn(async ({ ref }: { ref: { id: string } }) => online.get(ref.id)!),
    resolvePreset: vi.fn(async () => canonical(
      'M00_white_lily.json', 'character', `sha256:${'1'.repeat(64)}`,
      { codename: '白百合', magicConstruct: '花' }, '白百合',
    )),
  };
  return {
    content,
    materializer: createArenaRoomGenerationMaterializer({ content }),
  };
};

describe('Arena Room authoritative generation materializer', () => {
  it('仅从 frozen Shared Config 重建角色/引导/队伍/情景/素材/历史语义', async () => {
    const harness = createHarness();
    const config = sharedConfig();
    const payload = await harness.materializer.materialize({
      sharedConfig: config,
      hostAccountUserId: 101,
      hostLocalPayloads: [
        {
          key: 'host-local:character:2:local',
          kind: 'character',
          payload: { name: '本地角色', content: '本地正文' },
        },
        {
          key: 'host-local:scenario:0:aux',
          kind: 'scenario',
          payload: { title: '本地辅助情景', content: '辅助正文' },
        },
      ],
      hostRuntime: {
        customProvider: { apiKey: 'request-only-secret' },
        narrativeHistory: [{ content: '本地历史正文' }],
        isDowngrade: true,
      },
    });

    expect(payload).toMatchObject({
      mode: 'scenario',
      userGuidance: '接受后的全局引导',
      language: 'ja-JP',
      storyLength: 'long',
      customStoryLength: '4321',
      readArenaHistory: true,
      arenaHistoryReadLimit: 3,
      writeArenaHistory: true,
      readCurrentState: true,
      writeCurrentState: false,
      readNarrativeHistory: true,
      narrativeHistoryReadLimit: 7,
      writeNarrativeHistory: true,
      narrativeHistory: [{ content: '本地历史正文' }],
      isDowngrade: true,
      customProvider: { apiKey: 'request-only-secret' },
      teams: { 1: ['线上角色', '本地角色'] },
      teamNames: { 1: '红队' },
      scenario: { title: '线上情景', content: '情景正文' },
      scenarioTitle: '线上情景',
      scenarioFileName: '线上情景.json',
      scenarioSourceDataCardId: 'online-scenario',
      scenarioSourceDataCardUpdatedAt: 'scenario-v1',
      auxScenarios: [{ title: '本地辅助情景', content: '辅助正文' }],
    });
    expect(payload.combatants).toEqual([
      expect.objectContaining({
        type: 'general-character',
        data: { name: '线上角色', content: '角色正文' },
        teamId: 1,
        characterGuidance: '接受后的角色引导',
        sourceDataCardId: 'online-character',
        sourceDataCardUpdatedAt: 'character-v1',
      }),
      expect.objectContaining({
        type: 'magical-girl', data: { codename: '白百合', magicConstruct: '花' }, isPreset: true,
      }),
      expect.objectContaining({
        type: 'general-character', data: { name: '本地角色', content: '本地正文' }, teamId: 1,
      }),
    ]);
    expect(payload.materials).toEqual([
      expect.objectContaining({
        id: 'online-material',
        name: '线上素材',
        content: { title: '线上素材', content: '素材正文' },
        sourceDataCardId: 'online-material',
        sourceDataCardUpdatedAt: 'material-v1',
      }),
    ]);
    expect(harness.content.resolveOnline).toHaveBeenCalledTimes(3);
    expect(harness.content.resolveOnline).toHaveBeenCalledWith(expect.objectContaining({
      hostAccountUserId: 101,
    }));
  });

  it('客户端 stale 同名字段没有进入 materializer 的入口', async () => {
    const harness = createHarness();
    await expect(harness.materializer.materialize({
      sharedConfig: sharedConfig(),
      hostAccountUserId: 101,
      hostLocalPayloads: [
        { key: 'host-local:character:2:local', kind: 'character', payload: { name: '本地角色' } },
        { key: 'host-local:scenario:0:aux', kind: 'scenario', payload: { title: '辅助情景' } },
      ],
      hostRuntime: {
        mode: 'classic',
        combatants: [{ data: { name: '伪造' } }],
      } as never,
    })).rejects.toMatchObject({ code: 'ARENA_ROOM_HOST_RUNTIME_INVALID' });
  });

  it.each([
    ['missing', [
      { key: 'host-local:character:2:local', kind: 'character', payload: { name: '本地角色' } },
    ], 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_MISMATCH'],
    ['extra', [
      { key: 'host-local:character:2:local', kind: 'character', payload: { name: '本地角色' } },
      { key: 'host-local:scenario:0:aux', kind: 'scenario', payload: { title: '辅助情景' } },
      { key: 'host-local:material:9:extra', kind: 'material', payload: { title: '额外' } },
    ], 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_MISMATCH'],
    ['duplicate', [
      { key: 'host-local:character:2:local', kind: 'character', payload: { name: '本地角色' } },
      { key: 'host-local:character:2:local', kind: 'character', payload: { name: '重复' } },
      { key: 'host-local:scenario:0:aux', kind: 'scenario', payload: { title: '辅助情景' } },
    ], 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_MISMATCH'],
    ['kind mismatch', [
      { key: 'host-local:character:2:local', kind: 'scenario', payload: { name: '本地角色' } },
      { key: 'host-local:scenario:0:aux', kind: 'scenario', payload: { title: '辅助情景' } },
    ], 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_KIND_MISMATCH'],
    ['character type mismatch', [
      { key: 'host-local:character:2:local', kind: 'character', payload: { codename: '魔法少女' } },
      { key: 'host-local:scenario:0:aux', kind: 'scenario', payload: { title: '辅助情景' } },
    ], 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_TYPE_MISMATCH'],
  ])('%s host-local payload fail closed', async (_name, hostLocalPayloads, code) => {
    const harness = createHarness();
    await expect(harness.materializer.materialize({
      sharedConfig: sharedConfig(),
      hostAccountUserId: 101,
      hostLocalPayloads: hostLocalPayloads as never,
      hostRuntime: {},
    })).rejects.toMatchObject({ code });
  });

  it('host-local key 跨语义集合复用时 fail closed', async () => {
    const harness = createHarness();
    const config = sharedConfig();
    config.auxScenarios[0]!.key = config.combatants[2]!.key;
    await expect(harness.materializer.materialize({
      sharedConfig: config,
      hostAccountUserId: 101,
      hostLocalPayloads: [{
        key: 'host-local:character:2:local',
        kind: 'scenario',
        payload: { name: '同一 payload 不得同时充当角色与情景' },
      }],
      hostRuntime: {},
    })).rejects.toMatchObject({ code: 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_MISMATCH' });
  });

  it('host-local payload 必须匹配 frozen stub 的安全内容版本', async () => {
    const harness = createHarness();
    const config = sharedConfig();
    Object.assign(config.combatants[2]!, { contentVersion: `sha256:${'0'.repeat(64)}` });
    await expect(harness.materializer.materialize({
      sharedConfig: config,
      hostAccountUserId: 101,
      hostLocalPayloads: [
        { key: 'host-local:character:2:local', kind: 'character', payload: { name: '本地角色' } },
        { key: 'host-local:scenario:0:aux', kind: 'scenario', payload: { title: '辅助情景' } },
      ],
      hostRuntime: {},
    })).rejects.toMatchObject({ code: 'ARENA_ROOM_HOST_LOCAL_CONTENT_VERSION_MISMATCH' });
  });

  it('canonical resolver 的 exact ref 不一致时 fail closed', async () => {
    const harness = createHarness();
    harness.content.resolveOnline.mockResolvedValueOnce(canonical(
      'online-character', 'character', 'stale-version', { name: '旧角色' }, '旧角色',
    ));
    await expect(harness.materializer.materialize({
      sharedConfig: sharedConfig(),
      hostAccountUserId: 101,
      hostLocalPayloads: [
        { key: 'host-local:character:2:local', kind: 'character', payload: { name: '本地角色' } },
        { key: 'host-local:scenario:0:aux', kind: 'scenario', payload: { title: '辅助情景' } },
      ],
      hostRuntime: {},
    })).rejects.toBeInstanceOf(ArenaRoomGenerationMaterializationError);
  });
});
