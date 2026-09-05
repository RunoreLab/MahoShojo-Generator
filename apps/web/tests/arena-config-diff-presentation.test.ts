import { describe, expect, it } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import {
  arenaBattleModeCopy,
  arenaStoryLengthValueCopy,
  buildArenaRoomConfigDiffEntries,
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

const labels = (key: string): string | undefined => (
  key === 'data-card:alice' ? '爱丽丝' : undefined
);

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
    const entries = buildArenaRoomConfigDiffEntries(room, local, labels);
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
    const entries = buildArenaRoomConfigDiffEntries(room, local, labels);
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
    const entries = buildArenaRoomConfigDiffEntries(room, local, labels);
    expect(entries).toContainEqual(expect.objectContaining({
      category: '主情景',
      label: '主情景：在线:old → 爱丽丝',
    }));
    expect(entries).toContainEqual(expect.objectContaining({
      category: '模式与故事',
      label: '战斗模式：经典模式 → 情景模式',
    }));
  });

  it('顺序不变仅顺序变化时输出一条顺序调整', () => {
    const a = { key: 'data-card:alice', ref: { id: 'alice', kind: 'character' as const, versionToken: 'v1' } };
    const b = { key: 'data-card:bob', ref: { id: 'bob', kind: 'character' as const, versionToken: 'v1' } };
    const room = baseConfig({ combatants: [a, b] });
    const local = baseConfig({ combatants: [b, a] });
    const entries = buildArenaRoomConfigDiffEntries(room, local, labels);
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
    const entries = buildArenaRoomConfigDiffEntries(room, local, labels);
    expect(entries).toContainEqual(expect.objectContaining({ category: '队伍', label: '队伍「守护队」改名为「黎明队」' }));
    expect(entries).toContainEqual(expect.objectContaining({ category: '队伍', label: '调整了队伍「黎明队」的成员' }));
  });

  it('本地草稿为空时不产生条目', () => {
    const room = baseConfig();
    expect(buildArenaRoomConfigDiffEntries(room, null, labels)).toEqual([]);
  });
});
