import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';
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
    if (!Number.isFinite(value)) throw new Error('preset payload 包含非有限数字');
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('preset payload 不能包含循环引用');
    seen.add(value);
    const result = value.map((entry) => (
      entry === undefined ? null : stableJsonValue(entry, seen)
    ));
    seen.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new Error('preset payload 不能包含循环引用');
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
  throw new Error('preset payload 必须是 JSON value');
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
  if (!normalizedId || !normalizedVersion) {
    throw new Error(`${kind} 在线 data-card 缺少 id 或 versionToken`);
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
  if (!normalizedId) throw new Error(`${kind} preset 缺少 canonical id`);
  return {
    key: `preset:${normalizedId}`,
    ref: { id: normalizedId, kind, versionToken: await contentDigest(payload) },
  };
};

const normalizeCombatant = async (
  combatant: Combatant,
  index: number,
): Promise<NormalizedCombatant> => {
  if (!('data' in combatant)) throw new Error('随机占位符不能进入多人房间');
  if (!combatant.isValid) throw new Error('无效角色不能进入多人房间');
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
    key: localKey('character', combatant.filename || displayName, index),
    displayName,
    type: combatant.type,
    source: 'host-local',
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
    key: localKey('scenario', scenario.fileName ?? displayName, index),
    displayName,
    type: 'scenario',
    source: 'host-local',
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
    key: localKey('material', material.id || displayName, index),
    displayName,
    type: 'material',
    source: 'host-local',
  };
};

export const buildArenaRoomSharedConfigFromBattleState = async (
  source: ArenaRoomBattleStateSource,
): Promise<ArenaRoomSharedConfig> => {
  const combatants = await Promise.all(source.combatants.map(normalizeCombatant));
  const scenario = source.battleMode === 'scenario' && source.scenario.content !== null
    ? await normalizeScenario(source.scenario, 0)
    : null;
  const auxScenarios = await Promise.all(source.auxScenarios.map(normalizeScenario));
  const materials = await Promise.all(source.materials.map(normalizeMaterial));
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

  return buildArenaRoomSharedConfig({
    battleMode: source.battleMode,
    combatants,
    teams: source.teams.map((team) => ({
      key: `team:${team.id}`,
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
};
