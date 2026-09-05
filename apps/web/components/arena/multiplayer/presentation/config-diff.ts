import type {
  ArenaRoomSharedConfig,
  BattleMode,
  StoryLength,
} from '@mahoshojo/contracts/arena-room';

import { areArenaRoomSharedConfigsEqual } from '@/lib/arena-room/host-workspace';
import {
  dataCardReferenceRequest,
  presetReferenceRequest,
  shortReferenceId,
  type ArenaRoomReferenceRequest,
} from '@/lib/arena-room/reference-presentation';
import { hasCustomStoryLength } from '@/lib/story-length';

/** 房间配置语义 diff 的单条展示项。 */
export type ArenaConfigDiffEntry = {
  /** 稳定 key，供渲染层作为列表 key 使用。 */
  readonly id: string;
  readonly category: '角色' | '行动引导' | '队伍' | '主情景' | '辅助情景' | '素材' | '模式与故事' | '共享历史设置' | '其他';
  readonly tone: 'add' | 'remove' | 'change';
  readonly label: string;
};

export const arenaBattleModeCopy: Readonly<Record<BattleMode, string>> = {
  classic: '经典模式',
  kizuna: '羁绊模式',
  daily: '日常模式',
  scenario: '情景模式',
};

export const arenaStoryLengthCopy: Readonly<Record<StoryLength, string>> = {
  default: '默认',
  short: '简短',
  standard: '标准',
  detailed: '详细',
  long: '长篇',
};

export const arenaStoryLengthValueCopy = (
  storyLength: StoryLength,
  customStoryLength: string | null,
): string => {
  if (hasCustomStoryLength(customStoryLength)) return `自定义（${customStoryLength?.trim()} 字）`;
  return arenaStoryLengthCopy[storyLength];
};

export const arenaLanguageCopy = (code: string): string => (
  code === 'zh-CN' ? '简体中文' : code === 'en-US' ? 'English' : code
);

const fallbackKeyLabel = (key: string): string => {
  if (key.startsWith('preset:')) return `预设:${shortReferenceId(key.slice('preset:'.length))}`;
  if (key.startsWith('data-card:')) return `在线:${shortReferenceId(key.slice('data-card:'.length))}`;
  return shortReferenceId(key);
};

type SharedRefEntry = {
  readonly key: string;
  readonly ref: {
    readonly id: string;
    readonly kind: ArenaRoomReferenceRequest['kind'];
    readonly versionToken: string;
  };
};

/**
 * 由引用条目本身构造名称请求：kind 取 ref 的 canonical 值，versionToken
 * 绑定房间引用身份；渲染层不得再从 key 二次推导，避免丢失版本或错配 kind。
 */
const referenceRequestOfEntry = (
  key: string,
  ref: SharedRefEntry['ref'],
): ArenaRoomReferenceRequest | null => {
  if (key.startsWith('preset:')) return presetReferenceRequest(ref.kind, ref.id, ref.versionToken);
  if (key.startsWith('data-card:')) return dataCardReferenceRequest(ref.kind, { id: ref.id, versionToken: ref.versionToken });
  return null;
};

/** 收集两侧配置中所有引用条目的名称请求（绑定房间引用版本）。 */
export const collectArenaRoomConfigDiffReferenceRequests = (
  configs: readonly (ArenaRoomSharedConfig | null)[],
): ArenaRoomReferenceRequest[] => {
  const requests: ArenaRoomReferenceRequest[] = [];
  const push = (request: ArenaRoomReferenceRequest | null): void => {
    if (request) requests.push(request);
  };
  for (const config of configs) {
    if (!config) continue;
    for (const entry of config.combatants) {
      if ('ref' in entry) push(referenceRequestOfEntry(entry.key, entry.ref));
    }
    if (config.scenario && 'ref' in config.scenario) {
      push(referenceRequestOfEntry(config.scenario.key, config.scenario.ref));
    }
    for (const entry of config.auxScenarios) {
      if ('ref' in entry) push(referenceRequestOfEntry(entry.key, entry.ref));
    }
    for (const entry of config.materials) {
      if ('ref' in entry) push(referenceRequestOfEntry(entry.key, entry.ref));
    }
  }
  return requests;
};

const sameMembers = (a: readonly string[], b: readonly string[]): boolean => (
  a.length === b.length && new Set(a).size === new Set(b).size && a.every((key) => b.includes(key))
);

const sameOrder = (a: readonly string[], b: readonly string[]): boolean => (
  a.length === b.length && a.every((key, index) => key === b[index])
);

/** 主情景/辅助情景/素材条目的展示名：本地条目用 displayName，引用条目走名称解析。 */
type ReferenceEntry = ArenaRoomSharedConfig['auxScenarios'][number] | ArenaRoomSharedConfig['materials'][number];

const entryName = (
  entry: ArenaRoomSharedConfig['scenario'] | ReferenceEntry,
  resolveReferenceName: (request: ArenaRoomReferenceRequest) => string | undefined,
): string => {
  if (!entry) return '未设置';
  if (!('ref' in entry)) return entry.displayName;
  const request = referenceRequestOfEntry(entry.key, entry.ref);
  return (request ? resolveReferenceName(request) : undefined) ?? fallbackKeyLabel(entry.key);
};

const scenarioIdentity = (
  entry: ArenaRoomSharedConfig['scenario'],
): string | null => (entry ? entry.key : null);

/**
 * 房间配置 vs 本地编辑草稿的语义化 diff：
 * 输出“发生了什么变化”的产品级条目，而不是两侧原始 JSON。
 * 名称解析失败时回退缩写 ID（技术详情可看完整 key）。
 *
 * 不变量：只要 `areArenaRoomSharedConfigsEqual(roomConfig, localConfig)` 为 false，
 * 返回值至少包含一条；无法结构化描述时回退「其他房间设置发生了变化」，
 * 绝不出现“配置有差异但没有可展示差异”的自相矛盾状态。
 */
export const buildArenaRoomConfigDiffEntries = (
  roomConfig: ArenaRoomSharedConfig,
  localConfig: ArenaRoomSharedConfig | null,
  resolveReferenceName: (request: ArenaRoomReferenceRequest) => string | undefined,
): readonly ArenaConfigDiffEntry[] => {
  if (!localConfig) return [];
  const entries: ArenaConfigDiffEntry[] = [];

  // 角色：新增 / 移除 / 行动引导 / 数据卡版本 / 名称 / 顺序
  const roomCombatantKeys = roomConfig.combatants.map((entry) => entry.key);
  const localCombatantKeys = localConfig.combatants.map((entry) => entry.key);
  const combatantName = (
    entry: ArenaRoomSharedConfig['combatants'][number],
  ): string => (
    'ref' in entry
      ? (() => {
        const request = referenceRequestOfEntry(entry.key, entry.ref);
        return (request ? resolveReferenceName(request) : undefined) ?? fallbackKeyLabel(entry.key);
      })()
      : entry.displayName
  );
  localCombatantKeys.forEach((key, index) => {
    if (!roomCombatantKeys.includes(key)) {
      entries.push({ id: `combatant:add:${key}`, category: '角色', tone: 'add', label: `新增「${combatantName(localConfig.combatants[index]!)}」` });
    }
  });
  roomCombatantKeys.forEach((key, index) => {
    if (!localCombatantKeys.includes(key)) {
      entries.push({ id: `combatant:remove:${key}`, category: '角色', tone: 'remove', label: `移除「${combatantName(roomConfig.combatants[index]!)}」` });
    }
  });
  for (const entry of localConfig.combatants) {
    const previous = roomConfig.combatants.find((item) => item.key === entry.key);
    if (!previous) continue;
    const nextGuidance = entry.characterGuidance ?? '';
    const previousGuidance = previous.characterGuidance ?? '';
    if (nextGuidance !== previousGuidance) {
      entries.push({
        id: `guidance:${entry.key}`,
        category: '行动引导',
        tone: 'change',
        label: `修改「${combatantName(entry)}」的行动引导`,
      });
    }
    if ('ref' in entry && 'ref' in previous && entry.ref.versionToken !== previous.ref.versionToken) {
      entries.push({
        id: `combatant:version:${entry.key}`,
        category: '角色',
        tone: 'change',
        label: `更新了「${combatantName(entry)}」的数据卡版本`,
      });
    }
    if (!('ref' in entry) && !('ref' in previous) && previous.displayName !== entry.displayName) {
      entries.push({
        id: `combatant:rename:${entry.key}`,
        category: '角色',
        tone: 'change',
        label: `重命名「${previous.displayName}」为「${entry.displayName}」`,
      });
    }
  }
  if (sameMembers(roomCombatantKeys, localCombatantKeys) && !sameOrder(roomCombatantKeys, localCombatantKeys)) {
    entries.push({ id: 'combatants:order', category: '角色', tone: 'change', label: '调整了角色顺序' });
  }

  // 队伍：新增 / 移除 / 改名 / 成员调整 / 顺序
  for (const team of localConfig.teams) {
    const previous = roomConfig.teams.find((item) => item.key === team.key);
    if (!previous) {
      entries.push({ id: `team:add:${team.key}`, category: '队伍', tone: 'add', label: `新增队伍「${team.displayName}」` });
      continue;
    }
    if (previous.displayName !== team.displayName) {
      entries.push({ id: `team:rename:${team.key}`, category: '队伍', tone: 'change', label: `队伍「${previous.displayName}」改名为「${team.displayName}」` });
    }
    if (!sameOrder(previous.combatantKeys, team.combatantKeys)) {
      entries.push({ id: `team:members:${team.key}`, category: '队伍', tone: 'change', label: `调整了队伍「${team.displayName}」的成员` });
    }
  }
  for (const team of roomConfig.teams) {
    if (!localConfig.teams.some((item) => item.key === team.key)) {
      entries.push({ id: `team:remove:${team.key}`, category: '队伍', tone: 'remove', label: `移除队伍「${team.displayName}」` });
    }
  }
  const roomTeamKeys = roomConfig.teams.map((team) => team.key);
  const localTeamKeys = localConfig.teams.map((team) => team.key);
  if (sameMembers(roomTeamKeys, localTeamKeys) && !sameOrder(roomTeamKeys, localTeamKeys)) {
    entries.push({ id: 'teams:order', category: '队伍', tone: 'change', label: '调整了队伍顺序' });
  }

  // 主情景：切换 / 数据卡版本 / 名称
  if (scenarioIdentity(roomConfig.scenario) !== scenarioIdentity(localConfig.scenario)) {
    entries.push({
      id: 'scenario',
      category: '主情景',
      tone: roomConfig.scenario ? 'change' : 'add',
      label: roomConfig.scenario
        ? `主情景：${entryName(roomConfig.scenario, resolveReferenceName)} → ${entryName(localConfig.scenario, resolveReferenceName)}`
        : `主情景设为「${entryName(localConfig.scenario, resolveReferenceName)}」`,
    });
  } else if (roomConfig.scenario && localConfig.scenario) {
    if (
      'ref' in roomConfig.scenario
      && 'ref' in localConfig.scenario
      && roomConfig.scenario.ref.versionToken !== localConfig.scenario.ref.versionToken
    ) {
      entries.push({
        id: 'scenario:version',
        category: '主情景',
        tone: 'change',
        label: `更新了「${entryName(localConfig.scenario, resolveReferenceName)}」的数据卡版本`,
      });
    } else if (
      !('ref' in roomConfig.scenario)
      && !('ref' in localConfig.scenario)
      && roomConfig.scenario.displayName !== localConfig.scenario.displayName
    ) {
      entries.push({
        id: 'scenario:rename',
        category: '主情景',
        tone: 'change',
        label: `重命名「${roomConfig.scenario.displayName}」为「${localConfig.scenario.displayName}」`,
      });
    }
  }

  // 辅助情景 / 素材：新增 / 移除 / 数据卡版本 / 名称 / 顺序
  const referenceListDiff = (
    listName: ArenaConfigDiffEntry['category'],
    roomEntries: readonly ReferenceEntry[],
    localEntries: readonly ReferenceEntry[],
    prefix: string,
    orderLabel: string,
  ): void => {
    const roomKeys = roomEntries.map((entry) => entry.key);
    const localKeys = localEntries.map((entry) => entry.key);
    for (const entry of localEntries) {
      if (!roomKeys.includes(entry.key)) {
        entries.push({ id: `${prefix}:add:${entry.key}`, category: listName, tone: 'add', label: `新增「${entryName(entry, resolveReferenceName)}」` });
      }
    }
    for (const entry of roomEntries) {
      if (!localKeys.includes(entry.key)) {
        entries.push({ id: `${prefix}:remove:${entry.key}`, category: listName, tone: 'remove', label: `移除「${entryName(entry, resolveReferenceName)}」` });
      }
    }
    for (const entry of localEntries) {
      const previous = roomEntries.find((item) => item.key === entry.key);
      if (!previous) continue;
      if ('ref' in entry && 'ref' in previous && entry.ref.versionToken !== previous.ref.versionToken) {
        entries.push({
          id: `${prefix}:version:${entry.key}`,
          category: listName,
          tone: 'change',
          label: `更新了「${entryName(entry, resolveReferenceName)}」的数据卡版本`,
        });
      }
      if (!('ref' in entry) && !('ref' in previous) && previous.displayName !== entry.displayName) {
        entries.push({
          id: `${prefix}:rename:${entry.key}`,
          category: listName,
          tone: 'change',
          label: `重命名「${previous.displayName}」为「${entry.displayName}」`,
        });
      }
    }
    if (sameMembers(roomKeys, localKeys) && !sameOrder(roomKeys, localKeys)) {
      entries.push({ id: `${prefix}:order`, category: listName, tone: 'change', label: orderLabel });
    }
  };
  referenceListDiff('辅助情景', roomConfig.auxScenarios, localConfig.auxScenarios, 'aux-scenario', '调整了辅助情景顺序');
  referenceListDiff('素材', roomConfig.materials, localConfig.materials, 'material', '调整了素材顺序');

  // 模式与故事
  if (roomConfig.battleMode !== localConfig.battleMode) {
    entries.push({
      id: 'battle-mode',
      category: '模式与故事',
      tone: 'change',
      label: `战斗模式：${arenaBattleModeCopy[roomConfig.battleMode]} → ${arenaBattleModeCopy[localConfig.battleMode]}`,
    });
  }
  if (roomConfig.userGuidance !== localConfig.userGuidance) {
    entries.push({ id: 'user-guidance', category: '模式与故事', tone: 'change', label: '修改了全局行动引导' });
  }
  if (roomConfig.storyLength !== localConfig.storyLength
    || (roomConfig.customStoryLength ?? '') !== (localConfig.customStoryLength ?? '')) {
    entries.push({
      id: 'story-length',
      category: '模式与故事',
      tone: 'change',
      label: `故事长度：${arenaStoryLengthValueCopy(roomConfig.storyLength, roomConfig.customStoryLength)} → ${arenaStoryLengthValueCopy(localConfig.storyLength, localConfig.customStoryLength)}`,
    });
  }
  if (roomConfig.selectedLanguage !== localConfig.selectedLanguage) {
    entries.push({
      id: 'language',
      category: '模式与故事',
      tone: 'change',
      label: `生成语言：${arenaLanguageCopy(roomConfig.selectedLanguage)} → ${arenaLanguageCopy(localConfig.selectedLanguage)}`,
    });
  }

  // 共享历史读写设置
  if (JSON.stringify(roomConfig.historySettings) !== JSON.stringify(localConfig.historySettings)) {
    entries.push({ id: 'history-settings', category: '共享历史设置', tone: 'change', label: '修改了共享历史读取/写入设置' });
  }

  // 不变量兜底：存在未结构化的语义差异时，绝不返回空列表。
  if (entries.length === 0 && !areArenaRoomSharedConfigsEqual(roomConfig, localConfig)) {
    entries.push({ id: 'config:other', category: '其他', tone: 'change', label: '其他房间设置发生了变化' });
  }

  return entries;
};
