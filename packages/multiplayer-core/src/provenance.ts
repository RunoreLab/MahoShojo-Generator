import type {
  ArenaProposalChange,
  ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import { canonicalDataCardKey, deepClone, deepEqual } from './utils';

const assignmentOf = (config: ArenaRoomSharedConfig, combatantKey: string): string | null => {
  for (const team of config.teams) {
    if (team.combatantKeys.includes(combatantKey)) return team.key;
  }
  return null;
};

const refMatches = (
  entry: unknown,
  expectedRef: unknown,
): boolean => typeof entry === 'object'
  && entry !== null
  && 'ref' in entry
  && deepEqual(entry.ref, expectedRef);

/** A semantic target is replaced as one unit when a later accepted change owns it. */
const collaborativeTarget = (change: ArenaProposalChange): string => {
  switch (change.type) {
    case 'addCombatant':
    case 'removeCombatant':
      return `combatant:${change.type === 'addCombatant' ? canonicalDataCardKey(change.ref.id) : change.combatantKey}`;
    case 'setCharacterGuidance':
      return `combatant-guidance:${change.combatantKey}`;
    case 'assignTeam':
      return `combatant-team:${change.combatantKey}`;
    case 'setBattleMode':
      return 'battle-mode';
    case 'setScenario':
      return 'scenario';
    case 'addAuxScenario':
    case 'removeAuxScenario':
      return `aux-scenario:${change.type === 'addAuxScenario' ? canonicalDataCardKey(change.ref.id) : change.scenarioKey}`;
    case 'addMaterial':
    case 'removeMaterial':
      return `material:${change.type === 'addMaterial' ? canonicalDataCardKey(change.ref.id) : change.materialKey}`;
    case 'setUserGuidance':
      return 'user-guidance';
    case 'setStoryLength':
      return 'story-length';
    case 'setHistorySettings':
      return 'history-settings';
  }
};

/** Whether an accepted third-party semantic effect still exists in this config. */
export const hasCollaborativeChangeEffect = (
  config: ArenaRoomSharedConfig,
  change: ArenaProposalChange,
): boolean => {
  switch (change.type) {
    case 'addCombatant':
      return refMatches(
        config.combatants.find((entry) => entry.key === canonicalDataCardKey(change.ref.id)),
        change.ref,
      );
    case 'removeCombatant':
      return !config.combatants.some((entry) => entry.key === change.combatantKey);
    case 'setCharacterGuidance': {
      const entry = config.combatants.find((candidate) => candidate.key === change.combatantKey);
      return entry !== undefined && (entry.characterGuidance ?? null) === change.value;
    }
    case 'assignTeam':
      return config.combatants.some((entry) => entry.key === change.combatantKey)
        && assignmentOf(config, change.combatantKey) === change.teamKey;
    case 'setBattleMode':
      return config.battleMode === change.value;
    case 'setScenario':
      return change.ref === null
        ? config.scenario === null
        : refMatches(config.scenario ?? undefined, change.ref);
    case 'addAuxScenario':
      return refMatches(
        config.auxScenarios.find((entry) => entry.key === canonicalDataCardKey(change.ref.id)),
        change.ref,
      );
    case 'removeAuxScenario':
      return !config.auxScenarios.some((entry) => entry.key === change.scenarioKey);
    case 'addMaterial':
      return refMatches(
        config.materials.find((entry) => entry.key === canonicalDataCardKey(change.ref.id)),
        change.ref,
      );
    case 'removeMaterial':
      return !config.materials.some((entry) => entry.key === change.materialKey);
    case 'setUserGuidance':
      return config.userGuidance === change.value;
    case 'setStoryLength':
      return config.storyLength === change.value
        && (!Object.prototype.hasOwnProperty.call(change, 'customStoryLength')
          || config.customStoryLength === (change.customStoryLength ?? null));
    case 'setHistorySettings':
      return deepEqual(config.historySettings, change.value);
  }
};

export const retainCollaborativeChanges = (
  changes: readonly ArenaProposalChange[],
  config: ArenaRoomSharedConfig,
): ArenaProposalChange[] => changes
  .filter((change) => hasCollaborativeChangeEffect(config, change))
  .map((change) => deepClone(change));

/**
 * Carries forward surviving provenance and adds only selected changes that
 * caused a new semantic effect. A later accepted change owns the same target.
 */
export const mergeCollaborativeChanges = (input: {
  readonly previousChanges: readonly ArenaProposalChange[];
  readonly acceptedChanges: readonly ArenaProposalChange[];
  readonly previousConfig: ArenaRoomSharedConfig;
  readonly nextConfig: ArenaRoomSharedConfig;
}): ArenaProposalChange[] => {
  const next = retainCollaborativeChanges(input.previousChanges, input.nextConfig);
  for (const change of input.acceptedChanges) {
    if (hasCollaborativeChangeEffect(input.previousConfig, change)
      || !hasCollaborativeChangeEffect(input.nextConfig, change)) continue;
    const target = collaborativeTarget(change);
    const previousIndex = next.findIndex((candidate) => collaborativeTarget(candidate) === target);
    if (previousIndex >= 0) next.splice(previousIndex, 1);
    next.push(deepClone(change));
  }
  return next;
};
