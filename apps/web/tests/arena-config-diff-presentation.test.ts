import { describe, expect, it } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import { arenaRoomReferenceRequestKey, type ArenaRoomReferenceRequest } from '@/lib/arena-room/reference-presentation';

import {
  arenaBattleModeCopy,
  arenaStoryLengthValueCopy,
  buildArenaRoomConfigDiffEntries,
  collectArenaRoomConfigDiffReferenceRequests,
} from '@/components/arena/multiplayer/presentation/config-diff';

const historySettings = {
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
};

const baseConfig = (overrides: Partial<ArenaRoomSharedConfig> = {}): ArenaRoomSharedConfig => ({
  battleMode: 'classic',
  combatants: [],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'default',
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings,
  ...overrides,
});

/** 名称按 (source, kind, id, versionToken) 完整身份解析；未登记的请求回退 undefined。 */
const resolveNameOf = (
  known: readonly (ArenaRoomReferenceRequest & { readonly name: string })[],
): (request: ArenaRoomReferenceRequest) => string | undefined => {
  const namesByKey = new Map(known.map((entry) => [arenaRoomReferenceRequestKey(entry), entry.name]));
  return (request) => namesByKey.get(arenaRoomReferenceRequestKey(request));
};

const alice = (versionToken = 'v1'): ArenaRoomReferenceRequest => ({
  source: 'data-card',
  kind: 'character',
  id: 'alice',
  versionToken,
});

const presetScenario = (versionToken?: string): ArenaRoomReferenceRequest => ({
  source: 'preset',
  kind: 'scenario',
  id: 's1',
  ...(versionToken === undefined ? {} : { versionToken }),
});

const named = (request: ArenaRoomReferenceRequest, name: string) => ({ ...request, name });

describe('arena room config diff presentation', () => {
  it('模式/语言/长度映射为产品术语', () => {
    expect(arenaBattleModeCopy.classic).toBe('经典模式');
    expect(arenaStoryLengthValueCopy('standard', null)).toBe('标准');
    expect(arenaStoryLengthValueCopy('long', '2500')).toBe('自定义（2500 字）');
  });

  it('角色新增/移除使用可读名称，未解析时回退缩写 ID', () => {
    const room = baseConfig({
      combatants: [{ key: 'data-card:alice-id-123456', ref: { id: 'alice-id-123456', kind: 'character', versionToken: 'v1' } }],
    });
    const local = baseConfig({
      combatants: [
        { key: 'data-card:alice', ref: { id: 'alice', kind: 'character', versionToken: 'v1' } },
        { key: 'host-local:character:1', displayName: '晓美焰', type: 'magical-girl', source: 'host-local' },
      ],
    });
    const entries = buildArenaRoomConfigDiffEntries(room, local, resolveNameOf([named(alice(), '爱丽丝')]));
    expect(entries).toContainEqual(expect.objectContaining({ category: '角色', tone: 'add', label: '新增「爱丽丝」' }));
    expect(entries).toContainEqual(expect.objectContaining({ category: '角色', tone: 'add', label: '新增「晓美焰」' }));
    expect(entries).toContainEqual(expect.objectContaining({
      category: '角色',
      tone: 'remove',
      label: expect.stringContaining('移除「在线:alice-id-12'),
    }));
  });

  it('行动引导变化输出修改条目而不是 JSON', () => {
    const combatant = { key: 'data-card:alice', ref: { id: 'alice', kind: 'character' as const, versionToken: 'v1' } };
    const room = baseConfig({ combatants: [{ ...combatant, characterGuidance: '向东探索' }] });
    const local = baseConfig({ combatants: [{ ...combatant, characterGuidance: '保护队友' }] });
    const entries = buildArenaRoomConfigDiffEntries(room, local, resolveNameOf([named(alice(), '爱丽丝')]));
    expect(entries).toContainEqual(expect.objectContaining({
      category: '行动引导',
      tone: 'change',
      label: '修改「爱丽丝」的行动引导',
    }));
    expect(JSON.stringify(entries)).not.toContain('向东探索');
  });

  it('主情景与模式变化输出前后对照', () => {
    const room = baseConfig({
      scenario: { key: 'data-card:old', ref: { id: 'old', kind: 'scenario', versionToken: 'v1' } },
      battleMode: 'classic',
    });
    const local = baseConfig({
      scenario: { key: 'data-card:alice', ref: { id: 'alice', kind: 'scenario', versionToken: 'v1' } },
      battleMode: 'scenario',
    });
    const entries = buildArenaRoomConfigDiffEntries(room, local, resolveNameOf([named({ ...alice(), kind: 'scenario' }, '爱丽丝')]));
    expect(entries).toContainEqual(expect.objectContaining({
      category: '主情景',
      label: '主情景：在线:old → 爱丽丝',
    }));
    expect(entries).toContainEqual(expect.objectContaining({
      category: '模式与故事',
      label: '战斗模式：经典模式 → 情景模式',
    }));
  });

  it('在线卡仅版本变化时，名称请求携带 versionToken 且输出版本条目', () => {
    const room = baseConfig({
      combatants: [{ key: 'data-card:alice', ref: { id: 'alice', kind: 'character', versionToken: 'v1' } }],
    });
    const local = baseConfig({
      combatants: [{ key: 'data-card:alice', ref: { id: 'alice', kind: 'character', versionToken: 'v2' } }],
    });
    const entries = buildArenaRoomConfigDiffEntries(room, local, resolveNameOf([named(alice('v2'), '爱丽丝')]));
    expect(entries).toContainEqual(expect.objectContaining({
      category: '角色',
      tone: 'change',
      label: '更新了「爱丽丝」的数据卡版本',
    }));
    expect(entries).not.toContainEqual(expect.objectContaining({ category: '角色', tone: 'add' }));
    expect(entries).not.toContainEqual(expect.objectContaining({ category: '角色', tone: 'remove' }));
  });

  it('预设情景按 kind=scenario 的请求解析名称，而不是回退缩写 ID', () => {
    const room = baseConfig();
    const local = baseConfig({
      scenario: { key: 'preset:s1', ref: { id: 's1', kind: 'scenario', versionToken: 'cv1' } },
    });
    const entries = buildArenaRoomConfigDiffEntries(room, local, resolveNameOf([named(presetScenario('cv1'), '谨遵女王之意')]));
    expect(entries).toContainEqual(expect.objectContaining({
      category: '主情景',
      label: '主情景设为「谨遵女王之意」',
    }));
  });

  it('仅版本差异且名称无法解析时，仍输出可读条目（不出现空差异）', () => {
    const room = baseConfig({
      combatants: [{ key: 'data-card:alice', ref: { id: 'alice', kind: 'character', versionToken: 'v1' } }],
    });
    const local = baseConfig({
      combatants: [{ key: 'data-card:alice', ref: { id: 'alice', kind: 'character', versionToken: 'v2' } }],
    });
    const entries = buildArenaRoomConfigDiffEntries(room, local, resolveNameOf([]));
    expect(entries).toEqual([
      expect.objectContaining({
        category: '角色',
        tone: 'change',
        label: '更新了「在线:alice」的数据卡版本',
      }),
    ]);
  });

  it('仅队伍顺序变化时输出可读条目', () => {
    const member = { key: 'data-card:alice', ref: { id: 'alice', kind: 'character' as const, versionToken: 'v1' } };
    const teamA = { key: 'team:a', displayName: 'A 队', combatantKeys: ['data-card:alice'] };
    const teamB = { key: 'team:b', displayName: 'B 队', combatantKeys: [] };
    const room = baseConfig({ combatants: [member], teams: [teamA, teamB] });
    const local = baseConfig({ combatants: [member], teams: [teamB, teamA] });
    const entries = buildArenaRoomConfigDiffEntries(room, local, resolveNameOf([]));
    expect(entries).toEqual([
      expect.objectContaining({ category: '队伍', tone: 'change', label: '调整了队伍顺序' }),
    ]);
  });

  it('房主本地角色重命名输出可读条目', () => {
    const room = baseConfig({
      combatants: [{ key: 'host-local:character:1', displayName: '旧名', type: 'magical-girl', source: 'host-local' }],
    });
    const local = baseConfig({
      combatants: [{ key: 'host-local:character:1', displayName: '新名', type: 'magical-girl', source: 'host-local' }],
    });
    const entries = buildArenaRoomConfigDiffEntries(room, local, resolveNameOf([]));
    expect(entries).toContainEqual(expect.objectContaining({
      category: '角色',
      tone: 'change',
      label: '重命名「旧名」为「新名」',
    }));
  });

  it('未结构化的语义差异回退为兜底条目，而不是空列表', () => {
    const room = baseConfig({
      auxScenarios: [{ key: 'host-local:scenario:1', displayName: '情景', type: 'scenario', source: 'host-local', guidance: '旧引导' }],
    });
    const local = baseConfig({
      auxScenarios: [{ key: 'host-local:scenario:1', displayName: '情景', type: 'scenario', source: 'host-local', guidance: '新引导' }],
    });
    const entries = buildArenaRoomConfigDiffEntries(room, local, resolveNameOf([]));
    expect(entries).toEqual([
      expect.objectContaining({ category: '其他', label: '其他房间设置发生了变化' }),
    ]);
  });

  it('配置相等时不输出兜底条目', () => {
    const config = baseConfig();
    expect(buildArenaRoomConfigDiffEntries(config, structuredClone(config), resolveNameOf([]))).toEqual([]);
  });

  it('引用请求收集保留 kind 与 versionToken，预设回退策展目录', () => {
    const config = baseConfig({
      combatants: [{ key: 'data-card:alice', ref: { id: 'alice', kind: 'character', versionToken: 'v2' } }],
      scenario: { key: 'preset:s1', ref: { id: 's1', kind: 'scenario', versionToken: 'cv9' } },
      materials: [{ key: 'data-card:m1', ref: { id: 'm1', kind: 'material', versionToken: 'mv1' } }],
    });
    const requests = collectArenaRoomConfigDiffReferenceRequests([config]);
    expect(requests).toContainEqual({ source: 'data-card', kind: 'character', id: 'alice', versionToken: 'v2' });
    expect(requests).toContainEqual({ source: 'data-card', kind: 'material', id: 'm1', versionToken: 'mv1' });
    const scenarioRequest = requests.find((request) => request.kind === 'scenario');
    expect(scenarioRequest).toMatchObject({ source: 'preset', kind: 'scenario', id: 's1' });
    expect(typeof scenarioRequest?.versionToken).toBe('string');
  });

  it('顺序不变仅顺序变化时输出一条顺序调整', () => {
    const a = { key: 'data-card:alice', ref: { id: 'alice', kind: 'character' as const, versionToken: 'v1' } };
    const b = { key: 'data-card:bob', ref: { id: 'bob', kind: 'character' as const, versionToken: 'v1' } };
    const room = baseConfig({ combatants: [a, b] });
    const local = baseConfig({ combatants: [b, a] });
    const entries = buildArenaRoomConfigDiffEntries(room, local, resolveNameOf([]));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ category: '角色', tone: 'change', label: '调整了角色顺序' });
  });

  it('队伍改名与成员调整分别成条目', () => {
    const member = { key: 'data-card:alice', ref: { id: 'alice', kind: 'character' as const, versionToken: 'v1' } };
    const room = baseConfig({
      combatants: [member],
      teams: [{ key: 'team:1', displayName: '守护队', combatantKeys: [] }],
    });
    const local = baseConfig({
      combatants: [member],
      teams: [{ key: 'team:1', displayName: '黎明队', combatantKeys: ['data-card:alice'] }],
    });
    const entries = buildArenaRoomConfigDiffEntries(room, local, resolveNameOf([]));
    expect(entries).toContainEqual(expect.objectContaining({ category: '队伍', label: '队伍「守护队」改名为「黎明队」' }));
    expect(entries).toContainEqual(expect.objectContaining({ category: '队伍', label: '调整了队伍「黎明队」的成员' }));
  });

  it('本地草稿为空时不产生条目', () => {
    const room = baseConfig();
    expect(buildArenaRoomConfigDiffEntries(room, null, resolveNameOf([]))).toEqual([]);
  });
});
