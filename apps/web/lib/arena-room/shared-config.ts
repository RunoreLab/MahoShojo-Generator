import {
  ARENA_CANONICAL_CAPABILITIES,
  ArenaRoomHostLocalPayloadSchema,
  type ArenaRoomHttpErrorCode,
  type ArenaRoomHostLocalPayload,
  type ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';
import {
  buildArenaRoomSharedConfig,
  type ArenaRoomNormalizedSource,
} from '@mahoshojo/multiplayer-core';

import type {
  AuxiliaryScenarioState,
  BattleMode,
  BattleSettings,
  BattleTeam,
  Combatant,
  ScenarioState,
  StoryLengthOption,
} from '@/components/arena/types';
import type { ArenaMaterialState } from '@/lib/arena/materials';

export type ArenaRoomBattleStateSource = {
  battleMode: BattleMode;
  combatants: Combatant[];
  teams: BattleTeam[];
  scenario: ScenarioState;
  auxScenarios: AuxiliaryScenarioState[];
  materials: ArenaMaterialState[];
  storyLength: StoryLengthOption;
  customStoryLength: string;
  selectedLanguage: string;
  settings: BattleSettings;
  userProviderConfig?: unknown;
};

type DataCardKind = 'character' | 'material' | 'scenario';
type NormalizedCombatant = ArenaRoomNormalizedSource['combatants'][number];
type NormalizedScenario = Exclude<ArenaRoomNormalizedSource['scenario'], null>;
type NormalizedMaterial = ArenaRoomNormalizedSource['materials'][number];

export type ArenaRoomHostLocalContentDigest = Readonly<{
  key: string;
  digest: string;
}>;

export type ArenaRoomHostWorkspaceBundle = Readonly<{
  sharedConfig: ArenaRoomSharedConfig;
  hostLocalPayloads: readonly ArenaRoomHostLocalPayload[];
  hostLocalContentDigests: readonly ArenaRoomHostLocalContentDigest[];
}>;

export type ArenaRoomShareabilityIssueCode =
  | 'ROOM_COMBATANT_LIMIT'
  | 'ROOM_REFERENCE_LIMIT'
  | Extract<ArenaRoomHttpErrorCode, 'ROOM_GENERATION_RANDOM_COMBATANT_UNRESOLVED'>
  | 'ROOM_REFERENCE_ID_REQUIRED'
  | 'ROOM_REFERENCE_VERSION_REQUIRED'
  | 'ROOM_PRESET_ID_REQUIRED'
  | 'ROOM_PAYLOAD_NON_FINITE_NUMBER'
  | 'ROOM_PAYLOAD_CIRCULAR_REFERENCE'
  | 'ROOM_PAYLOAD_JSON_INVALID'
  | 'ROOM_CONFIG_SCHEMA_INVALID';

export type ArenaRoomShareabilityIssue = Readonly<{
  code: ArenaRoomShareabilityIssueCode;
  target: string;
  message: string;
  action: string;
}>;

export class ArenaRoomShareabilityError extends Error {
  public readonly issues: readonly ArenaRoomShareabilityIssue[];

  public constructor(issues: readonly ArenaRoomShareabilityIssue[]) {
    super(issues.length > 0
      ? `当前竞技场配置有不能共享到多人房间的内容：${issues.map((issue) => issue.message).join('；')}`
      : '当前竞技场配置有不能共享到多人房间的内容');
    this.name = 'ArenaRoomShareabilityError';
    this.issues = Object.freeze([...issues]);
  }
}

export type ArenaRoomHostWorkspaceBundleBuildResult =
  | Readonly<{ ok: true; bundle: ArenaRoomHostWorkspaceBundle }>
  | Readonly<{ ok: false; issues: readonly ArenaRoomShareabilityIssue[] }>;

class ArenaRoomNormalizationError extends Error {
  public constructor(
    public readonly code: ArenaRoomShareabilityIssueCode,
    message: string,
    public readonly action: string,
  ) {
    super(message);
    this.name = 'ArenaRoomNormalizationError';
  }
}

const normalizationError = (
  code: ArenaRoomShareabilityIssueCode,
  message: string,
  action: string,
): never => {
  throw new ArenaRoomNormalizationError(code, message, action);
};

const shareabilityIssueFrom = (
  error: unknown,
  target: string,
): ArenaRoomShareabilityIssue => {
  if (error instanceof ArenaRoomNormalizationError) {
    return Object.freeze({
      code: error.code,
      target,
      message: error.message,
      action: error.action,
    });
  }
  return Object.freeze({
    code: 'ROOM_CONFIG_SCHEMA_INVALID',
    target,
    message: '该内容不符合多人房间的共享格式。',
    action: '请重新选择或导入该内容后再同步。',
  });
};

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const displayNameFrom = (value: unknown, fallback: string): string => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ['codename', 'name', 'title']) {
      const found = text(record[key]);
      if (found) return found;
    }
  }
  return text(fallback) || '未命名条目';
};

const stableJsonValue = (value: unknown, seen: WeakSet<object>): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return normalizationError(
        'ROOM_PAYLOAD_NON_FINITE_NUMBER',
        '内容包含无法共享的非有限数字。',
        '请将 NaN 或 Infinity 改为有限数字。',
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return normalizationError(
        'ROOM_PAYLOAD_CIRCULAR_REFERENCE',
        '内容包含无法共享的循环引用。',
        '请移除循环引用后再同步。',
      );
    }
    seen.add(value);
    const result = value.map((entry) => (
      entry === undefined ? null : stableJsonValue(entry, seen)
    ));
    seen.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return normalizationError(
        'ROOM_PAYLOAD_CIRCULAR_REFERENCE',
        '内容包含无法共享的循环引用。',
        '请移除循环引用后再同步。',
      );
    }
    seen.add(value);
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      result[key] = stableJsonValue(record[key], seen);
    }
    seen.delete(value);
    return result;
  }
  return normalizationError(
    'ROOM_PAYLOAD_JSON_INVALID',
    '内容包含无法共享的值。',
    '请只保留字符串、数字、布尔值、空值、数组或对象。',
  );
};

const contentDigest = async (value: unknown): Promise<string> => {
  const canonical = JSON.stringify(stableJsonValue(value, new WeakSet()));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (byte) => (
    byte.toString(16).padStart(2, '0')
  )).join('');
  return `sha256:${hex}`;
};

const localKey = (kind: DataCardKind, label: string, index: number): string => {
  let hash = 0x811c9dc5;
  for (let position = 0; position < label.length; position += 1) {
    hash ^= label.charCodeAt(position);
    hash = Math.imul(hash, 0x01000193);
  }
  return `host-local:${kind}:${index}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const dataCardEntry = (
  kind: DataCardKind,
  id: string | undefined,
  versionToken: string | undefined,
): { readonly key: string; readonly ref: { id: string; kind: DataCardKind; versionToken: string } } => {
  const normalizedId = text(id);
  const normalizedVersion = text(versionToken);
  if (!normalizedId) {
    return normalizationError(
      'ROOM_REFERENCE_ID_REQUIRED',
      '在线内容引用缺少稳定标识。',
      '请重新从在线数据卡选择该内容。',
    );
  }
  if (!normalizedVersion) {
    return normalizationError(
      'ROOM_REFERENCE_VERSION_REQUIRED',
      '在线内容引用缺少版本信息。',
      '请刷新或重新选择该在线数据卡。',
    );
  }
  return {
    key: `data-card:${normalizedId}`,
    ref: { id: normalizedId, kind, versionToken: normalizedVersion },
  };
};

const presetEntry = async (
  kind: DataCardKind,
  id: string | null,
  payload: unknown,
): Promise<{
  readonly key: string;
  readonly ref: { id: string; kind: DataCardKind; versionToken: string };
}> => {
  const normalizedId = text(id);
  if (!normalizedId) {
    return normalizationError(
      'ROOM_PRESET_ID_REQUIRED',
      '预置内容缺少稳定标识。',
      '请重新选择该预置内容。',
    );
  }
  return {
    key: `preset:${normalizedId}`,
    ref: { id: normalizedId, kind, versionToken: await contentDigest(payload) },
  };
};

const normalizeCombatant = async (
  combatant: Combatant,
  index: number,
): Promise<NormalizedCombatant> => {
  if (!('data' in combatant)) {
    return normalizationError(
      'ROOM_GENERATION_RANDOM_COMBATANT_UNRESOLVED',
      '随机角色占位符还没有实际角色内容。',
      '请先生成或选择具体角色，再同步到房间。',
    );
  }
  const guidance = text(combatant.characterGuidance);
  if (text(combatant.sourceDataCardId)) {
    return {
      ...dataCardEntry(
        'character',
        combatant.sourceDataCardId,
        combatant.sourceDataCardUpdatedAt,
      ),
      ...(guidance ? { characterGuidance: guidance } : {}),
    };
  }
  if (combatant.isPreset) {
    return {
      ...await presetEntry('character', combatant.filename, combatant.data),
      ...(guidance ? { characterGuidance: guidance } : {}),
    };
  }
  const displayName = displayNameFrom(combatant.data, combatant.filename);
  return {
    key: text(combatant.arenaRoomKey) || localKey('character', combatant.filename || displayName, index),
    displayName,
    type: combatant.type,
    source: 'host-local',
    contentVersion: await contentDigest(combatant.data),
    ...(guidance ? { characterGuidance: guidance } : {}),
  };
};

const normalizeScenario = async (
  scenario: ScenarioState | AuxiliaryScenarioState,
  index: number,
): Promise<NormalizedScenario> => {
  if (text(scenario.sourceDataCardId)) {
    return dataCardEntry(
      'scenario',
      scenario.sourceDataCardId,
      scenario.sourceDataCardUpdatedAt,
    );
  }
  if (scenario.isNative) {
    return presetEntry('scenario', scenario.fileName, scenario.content);
  }
  const displayName = displayNameFrom(scenario.content, scenario.fileName ?? '本地情景');
  return {
    key: text(scenario.arenaRoomKey) || localKey('scenario', scenario.fileName ?? displayName, index),
    displayName,
    type: 'scenario',
    source: 'host-local',
    contentVersion: await contentDigest(scenario.content),
  };
};

const normalizeMaterial = async (
  material: ArenaMaterialState,
  index: number,
): Promise<NormalizedMaterial> => {
  if (text(material.sourceDataCardId)) {
    return dataCardEntry(
      'material',
      material.sourceDataCardId,
      material.sourceDataCardUpdatedAt,
    );
  }
  if (material.isNative) {
    return presetEntry('material', material.fileName, material.content);
  }
  const displayName = text(material.name) || material.fileName || '本地素材';
  return {
    key: text(material.arenaRoomKey) || localKey('material', material.id || displayName, index),
    displayName,
    type: 'material',
    source: 'host-local',
    contentVersion: await contentDigest(material.content),
  };
};

export const buildArenaRoomHostWorkspaceBundleFromBattleState = async (
  source: ArenaRoomBattleStateSource,
): Promise<ArenaRoomHostWorkspaceBundle> => {
  const result = await tryBuildArenaRoomHostWorkspaceBundleFromBattleState(source);
  if (!result.ok) throw new ArenaRoomShareabilityError(result.issues);
  return result.bundle;
};

const normalizeEntries = async <TInput, TOutput>(
  entries: readonly TInput[],
  normalize: (entry: TInput, index: number) => Promise<TOutput>,
  target: string,
): Promise<Readonly<{
  values: readonly TOutput[];
  issues: readonly ArenaRoomShareabilityIssue[];
}>> => {
  const settled = await Promise.all(entries.map(async (entry, index) => {
    try {
      return { value: await normalize(entry, index), issue: null } as const;
    } catch (error) {
      return { value: null, issue: shareabilityIssueFrom(error, `${target}[${index}]`) } as const;
    }
  }));
  return {
    values: settled.flatMap((entry) => entry.value === null ? [] : [entry.value]),
    issues: settled.flatMap((entry) => entry.issue === null ? [] : [entry.issue]),
  };
};

const buildArenaRoomHostWorkspaceBundle = async (
  source: ArenaRoomBattleStateSource,
): Promise<ArenaRoomHostWorkspaceBundleBuildResult> => {
  const limitIssues: ArenaRoomShareabilityIssue[] = [];
  if (source.combatants.length > ARENA_CANONICAL_CAPABILITIES.maxCombatants) {
    limitIssues.push(Object.freeze({
      code: 'ROOM_COMBATANT_LIMIT',
      target: 'combatants',
      message: `当前有 ${source.combatants.length} 位角色，多人竞技场最多支持 ${ARENA_CANONICAL_CAPABILITIES.maxCombatants} 位。`,
      action: '请移除多余角色后再同步。',
    }));
  }
  const referenceCount = source.auxScenarios.length + source.materials.length;
  if (referenceCount > ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity) {
    limitIssues.push(Object.freeze({
      code: 'ROOM_REFERENCE_LIMIT',
      target: 'auxScenarios,materials',
      message: `当前共有 ${referenceCount} 个辅助情景与素材，累计最多支持 ${ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity} 个。`,
      action: '请移除多余的辅助情景或素材后再同步。',
    }));
  }

  const [combatantResult, scenarioResult, auxScenarioResult, materialResult] = await Promise.all([
    normalizeEntries(source.combatants, normalizeCombatant, 'combatants'),
    source.battleMode === 'scenario' && source.scenario.content !== null
      ? normalizeEntries([source.scenario], normalizeScenario, 'scenario')
      : Promise.resolve({ values: [] as readonly NormalizedScenario[], issues: [] as readonly ArenaRoomShareabilityIssue[] }),
    normalizeEntries(source.auxScenarios, normalizeScenario, 'auxScenarios'),
    normalizeEntries(source.materials, normalizeMaterial, 'materials'),
  ]);
  const issues = [
    ...limitIssues,
    ...combatantResult.issues,
    ...scenarioResult.issues,
    ...auxScenarioResult.issues,
    ...materialResult.issues,
  ];
  if (issues.length > 0) return Object.freeze({ ok: false, issues: Object.freeze(issues) });

  const combatants = combatantResult.values;
  const scenario = scenarioResult.values[0] ?? null;
  const auxScenarios = auxScenarioResult.values;
  const materials = materialResult.values;
  const combatantKeysByTeam = new Map<number, string[]>();
  source.combatants.forEach((combatant, index) => {
    if (!('data' in combatant) || combatant.teamId === undefined || combatant.teamId === null) {
      return;
    }
    const keys = combatantKeysByTeam.get(combatant.teamId) ?? [];
    keys.push(combatants[index]!.key);
    combatantKeysByTeam.set(combatant.teamId, keys);
  });
  const customStoryLength = text(source.customStoryLength) || null;

  let sharedConfig: ArenaRoomSharedConfig;
  try {
    sharedConfig = buildArenaRoomSharedConfig({
      battleMode: source.battleMode,
      combatants,
      teams: source.teams.map((team) => ({
        key: text(team.roomKey) || `team:${team.id}`,
        displayName: text(team.name) || `队伍 ${team.id}`,
        combatantKeys: combatantKeysByTeam.get(team.id) ?? [],
      })),
      scenario,
      auxScenarios,
      materials,
      userGuidance: source.settings.userGuidance,
      storyLength: source.storyLength,
      customStoryLength,
      selectedLanguage: source.selectedLanguage,
      historySettings: {
        readArenaHistory: source.settings.readArenaHistory,
        readArenaHistoryLimit: source.settings.readArenaHistoryLimit,
        isArenaHistoryUnlimited: source.settings.isArenaHistoryUnlimited,
        writeArenaHistory: source.settings.writeArenaHistory,
        readCurrentState: source.settings.readCurrentState,
        writeCurrentState: source.settings.writeCurrentState,
        readNarrativeHistory: source.settings.readNarrativeHistory,
        readNarrativeHistoryLimit: source.settings.readNarrativeHistoryLimit,
        isNarrativeHistoryUnlimited: source.settings.isNarrativeHistoryUnlimited,
        writeNarrativeHistory: source.settings.writeNarrativeHistory,
      },
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([shareabilityIssueFrom(error, 'sharedConfig')]),
    });
  }

  const hostLocalPayloads: ArenaRoomHostLocalPayload[] = [];
  const addHostLocalPayload = (
    key: string,
    kind: DataCardKind,
    payload: unknown,
  ): void => {
    const canonicalPayload = stableJsonValue(payload, new WeakSet());
    hostLocalPayloads.push(ArenaRoomHostLocalPayloadSchema.parse({
      key,
      kind,
      payload: canonicalPayload,
    }));
  };
  source.combatants.forEach((combatant, index) => {
    const entry = combatants[index];
    if (entry && 'source' in entry && 'data' in combatant) {
      addHostLocalPayload(entry.key, 'character', combatant.data);
    }
  });
  if (scenario && 'source' in scenario && source.scenario.content !== null) {
    addHostLocalPayload(scenario.key, 'scenario', source.scenario.content);
  }
  source.auxScenarios.forEach((auxScenario, index) => {
    const entry = auxScenarios[index];
    if (entry && 'source' in entry) {
      addHostLocalPayload(entry.key, 'scenario', auxScenario.content);
    }
  });
  source.materials.forEach((material, index) => {
    const entry = materials[index];
    if (entry && 'source' in entry) {
      addHostLocalPayload(entry.key, 'material', material.content);
    }
  });
  const hostLocalContentDigests = await Promise.all(hostLocalPayloads.map(async (entry) => ({
    key: entry.key,
    digest: await contentDigest(entry.payload),
  })));

  return Object.freeze({
    ok: true,
    bundle: Object.freeze({
      sharedConfig,
      hostLocalPayloads: Object.freeze(hostLocalPayloads),
      hostLocalContentDigests: Object.freeze(hostLocalContentDigests),
    }),
  });
};

export const tryBuildArenaRoomHostWorkspaceBundleFromBattleState = async (
  source: ArenaRoomBattleStateSource,
): Promise<ArenaRoomHostWorkspaceBundleBuildResult> => buildArenaRoomHostWorkspaceBundle(source);

export const createArenaRoomCanonicalEmptyDraftBundle = (): ArenaRoomHostWorkspaceBundle => Object.freeze({
  sharedConfig: buildArenaRoomSharedConfig({
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
    historySettings: {
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
    },
  }),
  hostLocalPayloads: Object.freeze([]),
  hostLocalContentDigests: Object.freeze([]),
});

export const buildArenaRoomSharedConfigFromBattleState = async (
  source: ArenaRoomBattleStateSource,
): Promise<ArenaRoomSharedConfig> => (
  await buildArenaRoomHostWorkspaceBundleFromBattleState(source)
).sharedConfig;
