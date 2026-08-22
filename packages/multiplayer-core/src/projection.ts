import {
  parseArenaRoomSharedConfig,
  type DataCardRef,
  type HostLocalCombatantStub,
  type HostLocalMaterialStub,
  type HostLocalScenarioStub,
  type SharedHistorySettings,
  type TeamAssignment,
  type ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import { deepClone, isRecord } from './utils';

/**
 * Minimal source contract for the projection boundary. A Web adapter may carry
 * extra local fields at runtime, but it must first normalize them to these
 * stable keys/refs; this package never guesses a BattleStore mapping.
 */
export interface ArenaRoomNormalizedSource {
  readonly battleMode: ArenaRoomSharedConfig['battleMode'];
  readonly combatants: readonly ({
    readonly key: string;
    readonly ref: DataCardRef;
    readonly characterGuidance?: string;
  } | HostLocalCombatantStub)[];
  readonly teams: readonly TeamAssignment[];
  readonly scenario: {
    readonly key: string;
    readonly ref: DataCardRef;
  } | HostLocalScenarioStub | null;
  readonly auxScenarios: readonly ({ readonly key: string; readonly ref: DataCardRef } | HostLocalScenarioStub)[];
  readonly materials: readonly ({ readonly key: string; readonly ref: DataCardRef } | HostLocalMaterialStub)[];
  readonly userGuidance: ArenaRoomSharedConfig['userGuidance'];
  readonly storyLength: ArenaRoomSharedConfig['storyLength'];
  readonly customStoryLength: ArenaRoomSharedConfig['customStoryLength'];
  readonly selectedLanguage: ArenaRoomSharedConfig['selectedLanguage'];
  readonly historySettings: SharedHistorySettings;
}

const projectDataCardRef = (value: unknown): Record<string, unknown> => {
  const source = isRecord(value) ? value : {};
  return {
    id: source.id,
    kind: source.kind,
    versionToken: source.versionToken,
  };
};

const projectCombatant = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  const key = value.key;
  if (typeof key === 'string' && key.startsWith('host-local:')) {
    const output: Record<string, unknown> = {
      key,
      displayName: value.displayName,
      type: value.type,
      source: 'host-local',
    };
    if (value.characterGuidance !== undefined) output.characterGuidance = value.characterGuidance;
    return output;
  }

  const output: Record<string, unknown> = {
    key,
    ref: projectDataCardRef(value.ref),
  };
  if (value.characterGuidance !== undefined) output.characterGuidance = value.characterGuidance;
  return output;
};

const projectScenarioOrMaterial = (value: unknown): unknown => {
  if (value === null) return null;
  if (!isRecord(value)) return value;
  const key = value.key;
  if (typeof key === 'string' && key.startsWith('host-local:')) {
    const output: Record<string, unknown> = {
      key,
      displayName: value.displayName,
      type: value.type,
      source: 'host-local',
    };
    if (value.guidance !== undefined) output.guidance = value.guidance;
    return output;
  }
  return {
    key,
    ref: projectDataCardRef(value.ref),
  };
};

const projectTeam = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return {
    key: value.key,
    displayName: value.displayName,
    combatantKeys: Array.isArray(value.combatantKeys) ? [...value.combatantKeys] : value.combatantKeys,
  };
};

const projectHistorySettings = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return {
    readArenaHistory: value.readArenaHistory,
    readArenaHistoryLimit: value.readArenaHistoryLimit,
    isArenaHistoryUnlimited: value.isArenaHistoryUnlimited,
    writeArenaHistory: value.writeArenaHistory,
    readCurrentState: value.readCurrentState,
    writeCurrentState: value.writeCurrentState,
    readNarrativeHistory: value.readNarrativeHistory,
    readNarrativeHistoryLimit: value.readNarrativeHistoryLimit,
    isNarrativeHistoryUnlimited: value.isNarrativeHistoryUnlimited,
    writeNarrativeHistory: value.writeNarrativeHistory,
  };
};

const projectConfig = (input: unknown): unknown => {
  if (!isRecord(input)) return input;
  return {
    battleMode: input.battleMode,
    combatants: Array.isArray(input.combatants) ? input.combatants.map(projectCombatant) : input.combatants,
    teams: Array.isArray(input.teams) ? input.teams.map(projectTeam) : input.teams,
    scenario: projectScenarioOrMaterial(input.scenario),
    auxScenarios: Array.isArray(input.auxScenarios) ? input.auxScenarios.map(projectScenarioOrMaterial) : input.auxScenarios,
    materials: Array.isArray(input.materials) ? input.materials.map(projectScenarioOrMaterial) : input.materials,
    userGuidance: input.userGuidance,
    storyLength: input.storyLength,
    customStoryLength: input.customStoryLength,
    selectedLanguage: input.selectedLanguage,
    historySettings: projectHistorySettings(input.historySettings),
  };
};

/**
 * Projects a local/normalized source into the strictly allowlisted room wire shape.
 * The projection deliberately constructs every nested object instead of deleting
 * suspected secrets from a copied object.
 */
export const buildArenaRoomSharedConfig = (input: ArenaRoomNormalizedSource): ArenaRoomSharedConfig => (
  parseArenaRoomSharedConfig(projectConfig(input))
);

/** Parses a wire config and returns a fully detached local working copy. */
export const applyArenaRoomSharedConfig = (input: unknown): ArenaRoomSharedConfig => {
  const parsed = parseArenaRoomSharedConfig(input);
  return deepClone(parsed);
};
