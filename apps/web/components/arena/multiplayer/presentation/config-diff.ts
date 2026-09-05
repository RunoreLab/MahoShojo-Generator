import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import {
  dataCardReferenceRequest,
  presetReferenceRequest,
  shortReferenceId,
  type ArenaRoomReferenceRequest,
} from '@/lib/arena-room/reference-presentation';

import {
  arenaBattleModeCopy,
  arenaLanguageCopy,
  arenaStoryLengthValueCopy,
} from './value-copy';

/** 房间配置语义 diff 的单条展示项。 */
export type ArenaConfigDiffEntry = {
  /** 稳定 key，供渲染层作为列表 key 使用。 */
  readonly id: string;
  readonly category: '角色' | '行动引导' | '队伍' | '主情景' | '辅助情景' | '素材' | '模式与故事' | '共享历史设置' | '其他';
  readonly tone: 'add' | 'remove' | 'change';
  readonly label: string;
};

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

/**
 * 语义 diff 已逐字段覆盖的顶层 key。
 * SharedConfig 新增字段时必须同步扩展结构化 diff 或本清单，否则编译失败，
 * 防止 presentation 静默落后于 schema。
 */
const structuredConfigKeys = {
  battleMode: true,
  combatants: true,
  teams: true,
  scenario: true,
  auxScenarios: true,
  materials: true,
  userGuidance: true,
  storyLength: true,
  customStoryLength: true,
  selectedLanguage: true,
  historySettings: true,
} as const satisfies Record<keyof ArenaRoomSharedConfig, boolean>;

/**
 * 条目中被语义 diff 完整表达的字段：key（配对身份）、ref（版本条目）、
 * displayName（重命名）、characterGuidance（行动引导）。
 * 其余字段（如 host-local 的 type/contentVersion/guidance）一律按“未表达”处理，
 * 包括未来新增的字段（fail-closed：宁可多报，不可漏报）。
 */
const representedEntryFields: ReadonlySet<string> = new Set([
  'key',
  'ref',
  'displayName',
  'characterGuidance',
]);

const fieldMismatch = (a: unknown, b: unknown): boolean => (
  JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)
);

/** 同 key 配对条目之间，是否存在语义 diff 未表达的字段差异。 */
const hasUnrepresentedEntryFieldDifference = (roomEntry: object, localEntry: object): boolean => {
  const roomRecord = roomEntry as Record<string, unknown>;
  const localRecord = localEntry as Record<string, unknown>;
  for (const key of new Set([...Object.keys(roomRecord), ...Object.keys(localRecord)])) {
    if (representedEntryFields.has(key)) continue;
    if (fieldMismatch(roomRecord[key], localRecord[key])) return true;
  }
  return false;
};

/**
 * 顶层是否存在语义 diff 未覆盖的字段差异。
 * 当前所有顶层 key 都已覆盖，本检查只对“schema 新增而 presentation 未跟上”的
 * 未来字段兜底；清单由 structuredConfigKeys 的 satisfies 约束保证不落后于 schema。
 */
const hasUnhandledConfigKeyDifference = (
  roomConfig: ArenaRoomSharedConfig,
  localConfig: ArenaRoomSharedConfig,
): boolean => {
  const roomRecord = roomConfig as unknown as Record<string, unknown>;
  const localRecord = localConfig as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(roomRecord), ...Object.keys(localRecord)])) {
    if (key in structuredConfigKeys) continue;
    if (fieldMismatch(roomRecord[key], localRecord[key])) return true;
  }
  return false;
};

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
 * 不变量（双层）：
 * 1. 两侧配置不等时，返回值至少包含一条，绝不出现“配置有差异但没有可展示差异”；
 * 2. 只要存在任何未被结构化条目表达的字段差异（如同 key 条目的
 *    guidance/contentVersion/type 变化），就显式追加「其他/另有其他房间设置发生了变化」，
 *    即使已有其它结构化条目——不静默漏报。
 */
export const buildArenaRoomConfigDiffEntries = (
  roomConfig: ArenaRoomSharedConfig,
  localConfig: ArenaRoomSharedConfig | null,
  resolveReferenceName: (request: ArenaRoomReferenceRequest) => string | undefined,
): readonly ArenaConfigDiffEntry[] => {
  if (!localConfig) return [];
  const entries: ArenaConfigDiffEntry[] = [];
  let hasUnrepresentedDifference = hasUnhandledConfigKeyDifference(roomConfig, localConfig);

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
    if (hasUnrepresentedEntryFieldDifference(previous, entry)) {
      hasUnrepresentedDifference = true;
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
    if (hasUnrepresentedEntryFieldDifference(roomConfig.scenario, localConfig.scenario)) {
      hasUnrepresentedDifference = true;
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
      if (hasUnrepresentedEntryFieldDifference(previous, entry)) {
        hasUnrepresentedDifference = true;
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

  // 不变量兜底：存在语义 diff 未表达的字段差异时，显式追加兜底条目。
  // 即使已有其它结构化条目也不省略，防止用户据不完整的差异清单做出覆盖决策。
  if (hasUnrepresentedDifference) {
    entries.push({
      id: 'config:other',
      category: '其他',
      tone: 'change',
      label: entries.length === 0
        ? '其他房间设置发生了变化'
        : '另有其他房间设置发生了变化',
    });
  }

  return entries;
};
