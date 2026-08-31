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

import type { ArenaRoomHostWorkspaceBundle } from './shared-config';

type SharedEntry = ArenaRoomSharedConfig['combatants'][number];
type SharedScenarioEntry = NonNullable<ArenaRoomSharedConfig['scenario']>;
type SharedMaterialEntry = ArenaRoomSharedConfig['materials'][number];

export type ArenaRoomPublicCardLoader = (id: string) => Promise<unknown>;

export type ArenaRoomAuthorityMaterializationOptions = Readonly<{
  currentBundle: ArenaRoomHostWorkspaceBundle;
  loadPublicCard: ArenaRoomPublicCardLoader;
  hostLocalPayloads?: readonly ArenaRoomHostLocalPayload[];
}>;

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
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
    throw new Error(`在线数据卡 ${ref.id} 版本与房间 authority 不一致`);
  }
  const kindMatches = ref.kind === 'material' || payloadType === ref.kind;
  if (!kindMatches || !isPublicVisibility(payload._isPublic)) {
    throw new Error(`在线数据卡 ${ref.id} 类型或公开状态不满足房间 authority`);
  }
  const cleaned = stripBattleSelectionTransportMeta(payload);
  if (!isRecord(cleaned)) throw new Error(`在线数据卡 ${ref.id} 正文无效`);
  return payload;
};

const publicCombatant = async (
  entry: Extract<SharedEntry, { ref: unknown }>,
  loadPublicCard: ArenaRoomPublicCardLoader,
): Promise<CombatantData> => {
  const payload = await loadExactPublicPayload(entry.ref, loadPublicCard);
  const cleaned = stripBattleSelectionTransportMeta(payload);
  const source = mapDataCardRuntimeSourceInfo(payload);
  const displayName = getCombatantDisplayName(cleaned);
  return {
    type: inferCombatantType(cleaned),
    data: cloneJson(cleaned),
    filename: `${source.sourceDataCardName || displayName}.json`,
    isValid: true,
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

const publicScenario = async (
  entry: Extract<SharedScenarioEntry, { ref: unknown }>,
  loadPublicCard: ArenaRoomPublicCardLoader,
): Promise<ScenarioState> => {
  const payload = await loadExactPublicPayload(entry.ref, loadPublicCard);
  const cleaned = stripBattleSelectionTransportMeta(payload);
  const source = mapDataCardRuntimeSourceInfo(payload);
  return {
    content: cloneJson(cleaned),
    fileName: `${source.sourceDataCardName || entry.ref.id}.json`,
    isNative: false,
    sourceDataCardId: entry.ref.id,
    sourceDataCardUpdatedAt: entry.ref.versionToken,
    sourceDataCardName: source.sourceDataCardName,
    sourceDataCardDescription: source.sourceDataCardDescription,
    sourceDataCardCreatedAt: source.sourceDataCardCreatedAt,
    sourceIsPublic: true,
    sourceAuthor: source.sourceAuthor,
  };
};

const publicMaterial = async (
  entry: Extract<SharedMaterialEntry, { ref: unknown }>,
  loadPublicCard: ArenaRoomPublicCardLoader,
): Promise<ArenaMaterialState> => {
  const payload = await loadExactPublicPayload(entry.ref, loadPublicCard);
  const source = mapDataCardRuntimeSourceInfo(payload);
  return buildArenaMaterialState({
    payload,
    id: `material-card-${entry.ref.id}`,
    sourceDataCardId: entry.ref.id,
    sourceDataCardUpdatedAt: entry.ref.versionToken,
    sourceDataCardName: source.sourceDataCardName,
    isNative: false,
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
  const currentConfig = options.currentBundle.sharedConfig;
  const currentCombatants = existingByNormalizedKey(currentConfig.combatants, current.combatants);
  const currentAuxScenarios = existingByNormalizedKey(currentConfig.auxScenarios, current.auxScenarios);
  const currentMaterials = existingByNormalizedKey(currentConfig.materials, current.materials);
  const hostLocalPayloads = new Map(
    (options.hostLocalPayloads ?? []).map((entry) => [entry.key, entry] as const),
  );

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
      combatant = await publicCombatant(entry, options.loadPublicCard);
    } else if (!('ref' in entry)) {
      const localPayload = hostLocalPayloads.get(entry.key);
      if (!localPayload || localPayload.kind !== 'character') {
        throw new Error(`房间角色 ${entry.key} 缺少可确定 materialize 的本地来源`);
      }
      combatant = {
        type: entry.type,
        data: cloneJson(localPayload.payload),
        filename: `${entry.displayName}.json`,
        isValid: true,
        isPreset: false,
        arenaRoomKey: entry.key,
      };
    } else {
      throw new Error(`房间角色 ${entry.key} 缺少可确定 materialize 的本地来源`);
    }
    if (!('data' in combatant)) throw new Error(`房间角色 ${entry.key} 不能是随机占位符`);
    return {
      ...combatant,
      characterGuidance: entry.characterGuidance ?? '',
      teamId: assignedTeamByCombatant.get(entry.key),
    };
  }));

  let scenario: ScenarioState = { content: null, fileName: null, isNative: false };
  if (config.scenario) {
    const existing = currentConfig.scenario && current.scenario.content !== null
      ? { normalized: currentConfig.scenario, value: current.scenario }
      : null;
    if (existing && sameSource(config.scenario, existing.normalized)) {
      scenario = cloneJson(existing.value);
    } else if ('ref' in config.scenario && config.scenario.key.startsWith('data-card:')) {
      scenario = await publicScenario(config.scenario, options.loadPublicCard);
    } else if (!('ref' in config.scenario)) {
      const localPayload = hostLocalPayloads.get(config.scenario.key);
      if (!localPayload || localPayload.kind !== 'scenario' || !isRecord(localPayload.payload)) {
        throw new Error(`房间主情景 ${config.scenario.key} 缺少可确定 materialize 的本地来源`);
      }
      scenario = {
        content: cloneJson(localPayload.payload),
        fileName: `${config.scenario.displayName}.json`,
        isNative: false,
        arenaRoomKey: config.scenario.key,
      };
    } else {
      throw new Error(`房间主情景 ${config.scenario.key} 缺少可确定 materialize 的本地来源`);
    }
  }

  const auxScenarios: AuxiliaryScenarioState[] = await Promise.all(config.auxScenarios.map(async (entry) => {
    const existing = currentAuxScenarios.get(entry.key);
    let resolved: ScenarioState | AuxiliaryScenarioState | null = null;
    if (existing && sameSource(entry, existing.normalized)) {
      resolved = cloneJson(existing.value);
    } else if ('ref' in entry && entry.key.startsWith('data-card:')) {
      resolved = await publicScenario(entry, options.loadPublicCard);
    } else if (!('ref' in entry)) {
      const localPayload = hostLocalPayloads.get(entry.key);
      if (localPayload?.kind === 'scenario' && isRecord(localPayload.payload)) {
        resolved = {
          content: cloneJson(localPayload.payload),
          fileName: `${entry.displayName}.json`,
          isNative: false,
          arenaRoomKey: entry.key,
        };
      }
    }
    if (!resolved?.content) {
      throw new Error(`房间辅助情景 ${entry.key} 缺少可确定 materialize 的本地来源`);
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
      return publicMaterial(entry, options.loadPublicCard);
    }
    if (!('ref' in entry)) {
      const localPayload = hostLocalPayloads.get(entry.key);
      if (localPayload?.kind === 'material') {
        return {
          ...buildArenaMaterialState({
            payload: localPayload.payload,
            id: `room-material-${entry.key}`,
            sourceDataCardName: entry.displayName,
            isNative: false,
          }),
          arenaRoomKey: entry.key,
        };
      }
    }
    throw new Error(`房间素材 ${entry.key} 缺少可确定 materialize 的本地来源`);
  }));

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
    adjudicationEvents: [],
  }));
};
