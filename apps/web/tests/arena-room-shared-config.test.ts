import { describe, expect, it } from 'vitest';

import {
  ArenaRoomShareabilityError,
  buildArenaRoomHostWorkspaceBundleFromBattleState,
  buildArenaRoomSharedConfigFromBattleState,
  tryBuildArenaRoomHostWorkspaceBundleFromBattleState,
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

  it('本地正文变化会改变公开内容版本与 workspace digest，但不会偷渡正文', async () => {
    const first = await buildArenaRoomHostWorkspaceBundleFromBattleState(source());
    const changedSource = source();
    if ('data' in changedSource.combatants[2]!) {
      changedSource.combatants[2]!.data = { name: '本地残兽', secret: '已修改正文' };
    }
    const changed = await buildArenaRoomHostWorkspaceBundleFromBattleState(changedSource);

    const localKey = first.hostLocalPayloads[0]!.key;
    const firstDigest = first.hostLocalContentDigests.find((entry) => entry.key === localKey)?.digest;
    const changedDigest = changed.hostLocalContentDigests.find((entry) => entry.key === localKey)?.digest;
    expect(changedDigest).not.toBe(firstDigest);
    expect(changed.sharedConfig).not.toEqual(first.sharedConfig);
    expect(changed.sharedConfig.combatants[2]).toMatchObject({
      key: localKey,
      contentVersion: changedDigest,
    });
    expect(JSON.stringify(changed.sharedConfig)).not.toContain('已修改正文');
  });

  it('允许空角色草稿和未签名的本地角色进入普通多人房间', async () => {
    const empty = source();
    empty.battleMode = 'classic';
    empty.combatants = [];
    empty.teams = [];
    empty.scenario = { content: null, fileName: null, isNative: false };
    expect((await buildArenaRoomSharedConfigFromBattleState(empty)).combatants).toEqual([]);

    const unsignedLocal = source();
    unsignedLocal.combatants = [{
      type: 'magical-girl',
      data: { name: '未签名本地角色' },
      filename: 'unsigned-local.json',
      isValid: false,
      isPreset: false,
    }];
    await expect(buildArenaRoomSharedConfigFromBattleState(unsignedLocal))
      .resolves.toMatchObject({ combatants: [{ displayName: '未签名本地角色' }] });
  });

  it('随机占位符不是可共享性问题，其他引用问题仍能稳定定位', async () => {
    const missingVersion = source();
    if ('data' in missingVersion.combatants[1]!) {
      delete missingVersion.combatants[1]!.sourceDataCardUpdatedAt;
    }
    missingVersion.combatants.unshift({
      type: 'random-magical-girl',
      id: 'random-1',
      filename: 'random',
    });

    const result = await tryBuildArenaRoomHostWorkspaceBundleFromBattleState(missingVersion);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected shareability issues');
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'ROOM_REFERENCE_VERSION_REQUIRED',
        target: 'combatants[2]',
        message: expect.stringContaining('缺少版本'),
        action: expect.any(String),
      }),
    ]);
    await expect(buildArenaRoomSharedConfigFromBattleState(missingVersion)).rejects.toMatchObject({
      name: 'ArenaRoomShareabilityError',
      message: expect.stringContaining('缺少版本'),
      issues: [expect.objectContaining({ code: 'ROOM_REFERENCE_VERSION_REQUIRED' })],
    } satisfies Partial<ArenaRoomShareabilityError>);
  });

  it('混合角色投影只省略随机占位符，保留正常角色、队伍引用与其他设置', async () => {
    const mixed = source();
    mixed.combatants = [{
      type: 'random-magical-girl',
      id: 'random-first',
      filename: '随机魔法少女',
      teamId: 1,
    }, {
      type: 'canshou',
      data: { name: '可共享的正常角色' },
      filename: 'normal.json',
      isValid: false,
      isPreset: false,
      teamId: 1,
    }, {
      type: 'random-canshou',
      id: 'random-last',
      filename: '随机残兽',
      teamId: 1,
    }];
    mixed.settings.userGuidance = '保留本地设置';

    const bundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(mixed);

    expect(bundle.sharedConfig).toMatchObject({
      battleMode: 'scenario',
      combatants: [{
        key: expect.stringMatching(/^host-local:character:/u),
        displayName: '可共享的正常角色',
      }],
      teams: [{
        key: 'team:1',
        combatantKeys: [expect.stringMatching(/^host-local:character:/u)],
      }],
      scenario: expect.objectContaining({ displayName: '本地情景' }),
      userGuidance: '保留本地设置',
    });
    expect(bundle.sharedConfig.teams[0]!.combatantKeys).toEqual([
      bundle.sharedConfig.combatants[0]!.key,
    ]);
    expect(bundle.hostLocalPayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: bundle.sharedConfig.combatants[0]!.key,
        kind: 'character',
        payload: { name: '可共享的正常角色' },
      }),
    ]));
  });

  it('纯随机角色草稿也可建房，投影为空角色但不丢失模式和设置', async () => {
    const randomOnly = source();
    randomOnly.combatants = [{
      type: 'random-magical-girl',
      id: 'random-only',
      filename: '随机魔法少女',
      teamId: 1,
    }];
    randomOnly.settings.userGuidance = '建房后再生成角色';

    const bundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(randomOnly);

    expect(bundle.sharedConfig).toMatchObject({
      battleMode: 'scenario',
      combatants: [],
      teams: [{ key: 'team:1', combatantKeys: [] }],
      scenario: expect.objectContaining({ displayName: '本地情景' }),
      userGuidance: '建房后再生成角色',
    });
    expect(bundle.hostLocalPayloads.some((entry) => entry.kind === 'character')).toBe(false);
  });

  it('角色数与 canonical runtime 的 32 位容量一致', async () => {
    const atLimit = source();
    atLimit.battleMode = 'daily';
    atLimit.teams = [];
    atLimit.combatants = Array.from({ length: 32 }, (_, index) => ({
      type: 'magical-girl' as const,
      data: { name: `本地 ${index}` },
      filename: `local-${index}.json`,
      isValid: true,
      isPreset: false,
    }));
    await expect(buildArenaRoomSharedConfigFromBattleState(atLimit))
      .resolves.toMatchObject({ combatants: expect.arrayContaining([expect.any(Object)]) });

    const overflow = source();
    overflow.combatants = Array.from({ length: 33 }, (_, index) => ({
      type: 'magical-girl' as const,
      data: { name: `本地 ${index}` },
      filename: `local-${index}.json`,
      isValid: true,
      isPreset: false,
    }));
    const result = await tryBuildArenaRoomHostWorkspaceBundleFromBattleState(overflow);
    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({
        code: 'ROOM_COMBATANT_LIMIT',
        target: 'combatants',
      })],
    });
  });

  it('辅助情景与素材不再各自限制 10 个，而是共享 256 个引用的累计预算', async () => {
    const withinBudget = source();
    withinBudget.auxScenarios = Array.from({ length: 11 }, (_, index) => ({
      id: `aux-${index}`,
      content: { title: `辅助情景 ${index}` },
      fileName: `aux-${index}.json`,
      isNative: false,
    }));
    withinBudget.materials = Array.from({ length: 11 }, (_, index) => ({
      id: `material-${index}`,
      name: `素材 ${index}`,
      content: {},
      fileName: null,
      sourceKind: 'raw-json',
      sourceType: 'raw-json',
      isNative: false,
    }));
    await expect(buildArenaRoomSharedConfigFromBattleState(withinBudget)).resolves.toMatchObject({
      auxScenarios: expect.arrayContaining([expect.any(Object)]),
      materials: expect.arrayContaining([expect.any(Object)]),
    });

    const overflow = source();
    overflow.auxScenarios = Array.from({ length: 128 }, (_, index) => ({
      id: `aux-${index}`,
      content: { title: `辅助情景 ${index}` },
      fileName: `aux-${index}.json`,
      isNative: false,
    }));
    overflow.materials = Array.from({ length: 129 }, (_, index) => ({
      id: `material-${index}`,
      name: `素材 ${index}`,
      content: {},
      fileName: null,
      sourceKind: 'raw-json',
      sourceType: 'raw-json',
      isNative: false,
    }));
    const result = await tryBuildArenaRoomHostWorkspaceBundleFromBattleState(overflow);
    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({
        code: 'ROOM_REFERENCE_LIMIT',
        target: 'auxScenarios,materials',
      })],
    });
  });
});
