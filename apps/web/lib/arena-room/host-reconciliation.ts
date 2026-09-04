import {
  ArenaRoomSharedConfigSchema,
  type ArenaRoomHostLocalPayload,
  type ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import type {
  AuxiliaryScenarioState,
  BattleStoreState,
  BattleTeam,
  Combatant,
  CombatantData,
  ScenarioState,
} from '@/components/arena/types';
import {
  getCombatantDisplayName,
  inferCombatantType,
} from '@/components/arena/utils/characterValidator';
import {
  isPublicVisibility,
  mapDataCardRuntimeSourceInfo,
  mapPublicDataCardRowToBattleSelectionPayload,
  stripBattleSelectionTransportMeta,
} from '@/lib/data-card-read-mappers';
import {
  buildArenaMaterialState,
  type ArenaMaterialState,
} from '@/lib/arena/materials';
import { verifyArenaContentOrigin } from '@/lib/arena/verify-origin';
import {
  buildAdjudicationSourceKey,
  filterAdjudicationEventsBySources,
} from '@/lib/arena/adjudication-events';

import { ARENA_ROOM_PRESET_CATALOG } from './generated/arena-room-preset-catalog';
import {
  computeArenaRoomContentDigest,
  type ArenaRoomHostWorkspaceBundle,
} from './shared-config';

type SharedEntry = ArenaRoomSharedConfig['combatants'][number];
type SharedScenarioEntry = NonNullable<ArenaRoomSharedConfig['scenario']>;
type SharedMaterialEntry = ArenaRoomSharedConfig['materials'][number];

export type ArenaRoomPublicCardLoader = (id: string) => Promise<unknown>;
export type ArenaRoomOriginVerifier = (payload: unknown) => Promise<boolean>;

export type ArenaRoomAuthorityMaterializationOptions = Readonly<{
  currentBundle: ArenaRoomHostWorkspaceBundle;
  loadPublicCard: ArenaRoomPublicCardLoader;
  hostLocalPayloads?: readonly ArenaRoomHostLocalPayload[];
  verifyOrigin?: ArenaRoomOriginVerifier;
  commitIf?: () => boolean;
}>;

/** fence 中止：同步期间共享配置相关状态发生变化。可重试，重试会重新判定 dirty/clean。 */
export class ArenaRoomReconciliationAbortError extends Error {
  constructor(message = '房间配置同步期间状态已变化，未覆盖新的本地修改') {
    super(message);
    this.name = 'ArenaRoomReconciliationAbortError';
  }
}

/** 暂时性失败：如在线数据卡读取暂时不可用。可重试；「已不存在」等终态失败不使用此类。 */
export class ArenaRoomReconciliationTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArenaRoomReconciliationTransientError';
  }
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const combatantAdjudicationSourceKey = (combatant: Combatant): string => (
  text('adjudicationSourceKey' in combatant ? combatant.adjudicationSourceKey : '')
  || buildAdjudicationSourceKey({
    sourceDataCardId: 'sourceDataCardId' in combatant ? text(combatant.sourceDataCardId) : '',
    sourceFileName: 'filename' in combatant ? text(combatant.filename) : '',
    sourceLabel: 'sourceDataCardName' in combatant
      ? text(combatant.sourceDataCardName) || text(combatant.filename)
      : 'filename' in combatant ? text(combatant.filename) : '',
  })
  || ''
);

const scenarioAdjudicationSourceKey = (
  scenario: ScenarioState | AuxiliaryScenarioState,
): string => (
  text(scenario.adjudicationSourceKey)
  || buildAdjudicationSourceKey({
    sourceDataCardId: text(scenario.sourceDataCardId),
    sourceFileName: text(scenario.fileName),
    sourceLabel: text(scenario.sourceDataCardName) || text(scenario.fileName),
  })
  || ''
);

const sameReference = (
  left: SharedEntry | SharedScenarioEntry | SharedMaterialEntry,
  right: SharedEntry | SharedScenarioEntry | SharedMaterialEntry,
): boolean => {
  if (!('ref' in left) || !('ref' in right)) return false;
  return left.key === right.key
    && left.ref.id === right.ref.id
    && left.ref.kind === right.ref.kind
    && left.ref.versionToken === right.ref.versionToken;
};

const sameHostLocal = (
  left: SharedEntry | SharedScenarioEntry | SharedMaterialEntry,
  right: SharedEntry | SharedScenarioEntry | SharedMaterialEntry,
): boolean => (
  !('ref' in left)
  && !('ref' in right)
  && left.key === right.key
  && left.contentVersion === right.contentVersion
);

const sameSource = (
  left: SharedEntry | SharedScenarioEntry | SharedMaterialEntry,
  right: SharedEntry | SharedScenarioEntry | SharedMaterialEntry,
): boolean => sameReference(left, right) || sameHostLocal(left, right);

const loadExactPublicPayload = async (
  ref: { readonly id: string; readonly kind: string; readonly versionToken: string },
  loadPublicCard: ArenaRoomPublicCardLoader,
): Promise<Record<string, unknown>> => {
  const row = await loadPublicCard(ref.id);
  const payload = mapPublicDataCardRowToBattleSelectionPayload(row);
  const source = mapDataCardRuntimeSourceInfo(payload);
  const payloadType = isRecord(payload) && typeof payload._cardType === 'string'
    ? payload._cardType
    : '';
  if (source.sourceDataCardId !== ref.id || source.sourceDataCardUpdatedAt !== ref.versionToken) {
    throw new Error(`在线数据卡 ${ref.id} 的版本与当前房间配置不一致`);
  }
  const kindMatches = ref.kind === 'material' || payloadType === ref.kind;
  if (!kindMatches || !isPublicVisibility(payload._isPublic)) {
    throw new Error(`在线数据卡 ${ref.id} 的类型或公开状态不满足当前房间配置`);
  }
  const cleaned = stripBattleSelectionTransportMeta(payload);
  if (!isRecord(cleaned)) throw new Error(`在线数据卡 ${ref.id} 正文无效`);
  return payload;
};

const loadExactPresetPayload = async (
  ref: { readonly id: string; readonly kind: string; readonly versionToken: string },
): Promise<Record<string, unknown>> => {
  const catalogEntry = ARENA_ROOM_PRESET_CATALOG.find((entry) => (
    entry.id === ref.id && entry.kind === ref.kind
  ));
  if (!catalogEntry || catalogEntry.versionToken !== ref.versionToken) {
    throw new Error(`预设内容 ${ref.id} 的版本与当前房间配置不一致`);
  }
  const basePath = ref.kind === 'character'
    ? '/presets/'
    : ref.kind === 'scenario' ? '/scenario-presets/' : null;
  if (!basePath) throw new Error(`房间暂不支持 ${ref.kind} 类型的预设内容`);
  const response = await fetch(`${basePath}${encodeURIComponent(ref.id)}`);
  if (!response.ok) throw new Error(`预设内容 ${ref.id} 暂时无法读取`);
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error(`预设内容 ${ref.id} 正文无效`);
  if (await computeArenaRoomContentDigest(payload) !== ref.versionToken) {
    throw new Error(`预设内容 ${ref.id} 的正文与当前房间配置版本不一致`);
  }
  return payload;
};

const publicCombatant = async (
  entry: Extract<SharedEntry, { ref: unknown }>,
  loadPublicCard: ArenaRoomPublicCardLoader,
  verifyOrigin: ArenaRoomOriginVerifier,
): Promise<CombatantData> => {
  const payload = await loadExactPublicPayload(entry.ref, loadPublicCard);
  const cleaned = stripBattleSelectionTransportMeta(payload);
  const source = mapDataCardRuntimeSourceInfo(payload);
  const displayName = getCombatantDisplayName(cleaned);
  return {
    type: inferCombatantType(cleaned),
    data: cloneJson(cleaned),
    filename: `${source.sourceDataCardName || displayName}.json`,
    isValid: await verifyOrigin(cleaned),
    isPreset: false,
    isNonStandard: false,
    sourceDataCardId: entry.ref.id,
    sourceDataCardUpdatedAt: entry.ref.versionToken,
    sourceDataCardName: source.sourceDataCardName,
    sourceDataCardDescription: source.sourceDataCardDescription,
    sourceDataCardCreatedAt: source.sourceDataCardCreatedAt,
    sourceIsPublic: true,
    sourceAuthor: source.sourceAuthor,
    sourceDataCardUsageCount: source.sourceDataCardUsageCount,
    sourceDataCardLikeCount: source.sourceDataCardLikeCount,
    sourceDataCardFavoriteCount: source.sourceDataCardFavoriteCount,
  };
};

const presetCombatant = async (
  entry: Extract<SharedEntry, { ref: unknown }>,
): Promise<CombatantData> => {
  const payload = await loadExactPresetPayload(entry.ref);
  const adjudicationSourceKey = buildAdjudicationSourceKey({
    sourceFileName: entry.ref.id,
  });
  return {
    type: inferCombatantType(payload),
    data: cloneJson(payload),
    filename: entry.ref.id,
    isValid: true,
    isPreset: true,
    isNonStandard: false,
    ...(adjudicationSourceKey ? { adjudicationSourceKey } : {}),
  };
};

const publicScenario = async (
  entry: Extract<SharedScenarioEntry, { ref: unknown }>,
  loadPublicCard: ArenaRoomPublicCardLoader,
  verifyOrigin: ArenaRoomOriginVerifier,
): Promise<ScenarioState> => {
  const payload = await loadExactPublicPayload(entry.ref, loadPublicCard);
  const cleaned = stripBattleSelectionTransportMeta(payload);
  const source = mapDataCardRuntimeSourceInfo(payload);
  return {
    content: cloneJson(cleaned),
    fileName: `${source.sourceDataCardName || entry.ref.id}.json`,
    isNative: await verifyOrigin(cleaned),
    isPreset: false,
    sourceDataCardId: entry.ref.id,
    sourceDataCardUpdatedAt: entry.ref.versionToken,
    sourceDataCardName: source.sourceDataCardName,
    sourceDataCardDescription: source.sourceDataCardDescription,
    sourceDataCardCreatedAt: source.sourceDataCardCreatedAt,
    sourceIsPublic: true,
    sourceAuthor: source.sourceAuthor,
  };
};

const presetScenario = async (
  entry: Extract<SharedScenarioEntry, { ref: unknown }>,
): Promise<ScenarioState> => {
  const payload = await loadExactPresetPayload(entry.ref);
  const adjudicationSourceKey = buildAdjudicationSourceKey({
    sourceFileName: entry.ref.id,
  });
  return {
    content: cloneJson(payload),
    fileName: entry.ref.id,
    isNative: true,
    isPreset: true,
    ...(adjudicationSourceKey ? { adjudicationSourceKey } : {}),
  };
};

const publicMaterial = async (
  entry: Extract<SharedMaterialEntry, { ref: unknown }>,
  loadPublicCard: ArenaRoomPublicCardLoader,
  verifyOrigin: ArenaRoomOriginVerifier,
): Promise<ArenaMaterialState> => {
  const payload = await loadExactPublicPayload(entry.ref, loadPublicCard);
  const cleaned = stripBattleSelectionTransportMeta(payload);
  const source = mapDataCardRuntimeSourceInfo(payload);
  return buildArenaMaterialState({
    payload,
    id: `material-card-${entry.ref.id}`,
    sourceDataCardId: entry.ref.id,
    sourceDataCardUpdatedAt: entry.ref.versionToken,
    sourceDataCardName: source.sourceDataCardName,
    isNative: await verifyOrigin(cleaned),
    isPreset: false,
  });
};

const existingByNormalizedKey = <TEntry extends { readonly key: string }, TValue>(
  entries: readonly TEntry[],
  values: readonly TValue[],
): Map<string, { readonly normalized: TEntry; readonly value: TValue }> => new Map(
  entries.flatMap((entry, index) => {
    const value = values[index];
    return value === undefined ? [] : [[entry.key, { normalized: entry, value }] as const];
  }),
);

const nextTeamId = (used: Set<number>): number => {
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  used.add(candidate);
  return candidate;
};

export const applyArenaRoomAuthorityToBattleStore = async (
  input: ArenaRoomSharedConfig,
  options: ArenaRoomAuthorityMaterializationOptions,
): Promise<void> => {
  const config = ArenaRoomSharedConfigSchema.parse(input);
  const current = useBattleStore.getState();
  const verifyOrigin = options.verifyOrigin ?? verifyArenaContentOrigin;
  const currentConfig = options.currentBundle.sharedConfig;
  // shared config 不包含随机占位符，所有按序配对必须使用同样的可共享角色投影。
  const currentShareableCombatants = current.combatants.filter(
    (combatant): combatant is CombatantData => 'data' in combatant,
  );
  const currentCombatants = existingByNormalizedKey(
    currentConfig.combatants,
    currentShareableCombatants,
  );
  const currentAuxScenarios = existingByNormalizedKey(currentConfig.auxScenarios, current.auxScenarios);
  const currentMaterials = existingByNormalizedKey(currentConfig.materials, current.materials);
  const hostLocalPayloads = new Map(
    (options.hostLocalPayloads ?? []).map((entry) => [entry.key, entry] as const),
  );
  const invalidAdjudicationSourceKeys = new Set<string>();
  currentConfig.combatants.forEach((entry, index) => {
    const next = config.combatants.find((candidate) => candidate.key === entry.key);
    if (next && sameSource(entry, next)) return;
    const sourceKey = currentShareableCombatants[index]
      ? combatantAdjudicationSourceKey(currentShareableCombatants[index]!)
      : '';
    if (sourceKey) invalidAdjudicationSourceKeys.add(sourceKey);
  });
  if (currentConfig.scenario && (!config.scenario || !sameSource(currentConfig.scenario, config.scenario))) {
    const sourceKey = scenarioAdjudicationSourceKey(current.scenario);
    if (sourceKey) invalidAdjudicationSourceKeys.add(sourceKey);
  }
  currentConfig.auxScenarios.forEach((entry, index) => {
    const next = config.auxScenarios.find((candidate) => candidate.key === entry.key);
    if (next && sameSource(entry, next)) return;
    const sourceKey = current.auxScenarios[index]
      ? scenarioAdjudicationSourceKey(current.auxScenarios[index]!)
      : '';
    if (sourceKey) invalidAdjudicationSourceKeys.add(sourceKey);
  });

  const usedTeamIds = new Set(current.teams.map((team) => team.id));
  const currentTeams = existingByNormalizedKey(currentConfig.teams, current.teams);
  const teamIdByKey = new Map<string, number>();
  const teams: BattleTeam[] = config.teams.map((team) => {
    const existing = currentTeams.get(team.key)?.value;
    const id = existing?.id ?? nextTeamId(usedTeamIds);
    teamIdByKey.set(team.key, id);
    return {
      id,
      roomKey: team.key,
      name: team.displayName,
      isCollapsed: existing?.isCollapsed ?? false,
    };
  });
  const assignedTeamByCombatant = new Map<string, number>();
  config.teams.forEach((team) => {
    const teamId = teamIdByKey.get(team.key);
    if (teamId === undefined) return;
    team.combatantKeys.forEach((key) => assignedTeamByCombatant.set(key, teamId));
  });

  const combatants: Combatant[] = await Promise.all(config.combatants.map(async (entry) => {
    const existing = currentCombatants.get(entry.key);
    let combatant: Combatant;
    if (existing && sameSource(entry, existing.normalized)) {
      combatant = cloneJson(existing.value);
    } else if ('ref' in entry && entry.key.startsWith('data-card:')) {
      combatant = await publicCombatant(entry, options.loadPublicCard, verifyOrigin);
    } else if ('ref' in entry && entry.key.startsWith('preset:')) {
      combatant = await presetCombatant(entry);
    } else if (!('ref' in entry)) {
      const localPayload = hostLocalPayloads.get(entry.key);
      if (!localPayload || localPayload.kind !== 'character') {
        throw new Error(`房间角色 ${entry.key} 缺少可恢复的本地正文`);
      }
      combatant = {
        type: entry.type,
        data: cloneJson(localPayload.payload),
        filename: `${entry.displayName}.json`,
        isValid: await verifyOrigin(localPayload.payload),
        isPreset: false,
        arenaRoomKey: entry.key,
      };
    } else {
      throw new Error(`房间角色 ${entry.key} 缺少可恢复的本地正文`);
    }
    if (!('data' in combatant)) throw new Error(`房间角色 ${entry.key} 不能是随机占位符`);
    return {
      ...combatant,
      characterGuidance: entry.characterGuidance ?? '',
      teamId: assignedTeamByCombatant.get(entry.key),
    };
  }));

  let scenario: ScenarioState = {
    content: null,
    fileName: null,
    isNative: false,
    isPreset: false,
  };
  if (config.scenario) {
    const existing = currentConfig.scenario && current.scenario.content !== null
      ? { normalized: currentConfig.scenario, value: current.scenario }
      : null;
    if (existing && sameSource(config.scenario, existing.normalized)) {
      scenario = cloneJson(existing.value);
    } else if ('ref' in config.scenario && config.scenario.key.startsWith('data-card:')) {
      scenario = await publicScenario(config.scenario, options.loadPublicCard, verifyOrigin);
    } else if ('ref' in config.scenario && config.scenario.key.startsWith('preset:')) {
      scenario = await presetScenario(config.scenario);
    } else if (!('ref' in config.scenario)) {
      const localPayload = hostLocalPayloads.get(config.scenario.key);
      if (!localPayload || localPayload.kind !== 'scenario' || !isRecord(localPayload.payload)) {
        throw new Error(`房间主情景 ${config.scenario.key} 缺少可恢复的本地正文`);
      }
      scenario = {
        content: cloneJson(localPayload.payload),
        fileName: `${config.scenario.displayName}.json`,
        isNative: await verifyOrigin(localPayload.payload),
        isPreset: false,
        arenaRoomKey: config.scenario.key,
      };
    } else {
      throw new Error(`房间主情景 ${config.scenario.key} 缺少可恢复的本地正文`);
    }
  }

  const auxScenarios: AuxiliaryScenarioState[] = await Promise.all(config.auxScenarios.map(async (entry) => {
    const existing = currentAuxScenarios.get(entry.key);
    let resolved: ScenarioState | AuxiliaryScenarioState | null = null;
    if (existing && sameSource(entry, existing.normalized)) {
      resolved = cloneJson(existing.value);
    } else if ('ref' in entry && entry.key.startsWith('data-card:')) {
      resolved = await publicScenario(entry, options.loadPublicCard, verifyOrigin);
    } else if ('ref' in entry && entry.key.startsWith('preset:')) {
      resolved = await presetScenario(entry);
    } else if (!('ref' in entry)) {
      const localPayload = hostLocalPayloads.get(entry.key);
      if (localPayload?.kind === 'scenario' && isRecord(localPayload.payload)) {
        resolved = {
          content: cloneJson(localPayload.payload),
          fileName: `${entry.displayName}.json`,
          isNative: await verifyOrigin(localPayload.payload),
          isPreset: false,
          arenaRoomKey: entry.key,
        };
      }
    }
    if (!resolved?.content) {
      throw new Error(`房间辅助情景 ${entry.key} 缺少可恢复的本地正文`);
    }
    return {
      ...resolved,
      id: 'id' in resolved && typeof resolved.id === 'string'
        ? resolved.id
        : `aux-scenario-card-${entry.key}`,
      content: resolved.content,
    };
  }));

  const materials: ArenaMaterialState[] = await Promise.all(config.materials.map(async (entry) => {
    const existing = currentMaterials.get(entry.key);
    if (existing && sameSource(entry, existing.normalized)) return cloneJson(existing.value);
    if ('ref' in entry && entry.key.startsWith('data-card:')) {
      return publicMaterial(entry, options.loadPublicCard, verifyOrigin);
    }
    if (!('ref' in entry)) {
      const localPayload = hostLocalPayloads.get(entry.key);
      if (localPayload?.kind === 'material') {
        return {
          ...buildArenaMaterialState({
            payload: localPayload.payload,
            id: `room-material-${entry.key}`,
            sourceDataCardName: entry.displayName,
            isNative: await verifyOrigin(localPayload.payload),
            isPreset: false,
          }),
          arenaRoomKey: entry.key,
        };
      }
    }
    throw new Error(`房间素材 ${entry.key} 缺少可恢复的本地正文`);
  }));

  if (options.commitIf && !options.commitIf()) {
    throw new ArenaRoomReconciliationAbortError('房间配置同步期间状态已变化，未覆盖新的本地修改');
  }
  useBattleStore.setState((state): Partial<BattleStoreState> => ({
    battleMode: config.battleMode,
    combatants,
    teams,
    scenario,
    auxScenarios,
    materials,
    storyLength: config.storyLength,
    customStoryLength: config.customStoryLength ?? '',
    selectedLanguage: config.selectedLanguage,
    settings: {
      ...state.settings,
      ...config.historySettings,
      userGuidance: config.userGuidance,
    },
    adjudicationEvents: filterAdjudicationEventsBySources(
      state.adjudicationEvents,
      [...invalidAdjudicationSourceKeys],
    ),
  }));
};
