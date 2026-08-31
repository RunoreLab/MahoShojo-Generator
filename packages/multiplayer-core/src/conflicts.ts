import {
  ArenaProposalChangeSchema,
  parseArenaRoomSharedConfig,
  type ArenaProposalChange,
  type ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import { deepClone, deepEqual, hasVersionDrift } from './utils';

export type ProposalConflictCode = 'precondition-failed' | 'reference-changed' | 'invalid-change';

export interface ArenaProposalConflict {
  readonly changeId: string;
  readonly code: ProposalConflictCode;
  readonly target: string;
  readonly expectedBase?: unknown;
  readonly current?: unknown;
  readonly message: string;
}

type SemanticValue =
  | { readonly kind: 'absent' }
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'ref'; readonly ref: unknown };

const absent = (): SemanticValue => ({ kind: 'absent' });
const value = (input: unknown): SemanticValue => ({ kind: 'value', value: deepClone(input) });
const reference = (input: unknown): SemanticValue => ({ kind: 'ref', ref: deepClone(input) });

const currentCombatant = (config: ArenaRoomSharedConfig, key: string) => config.combatants.find((entry) => entry.key === key);
const currentAuxScenario = (config: ArenaRoomSharedConfig, key: string) => config.auxScenarios.find((entry) => entry.key === key);
const currentMaterial = (config: ArenaRoomSharedConfig, key: string) => config.materials.find((entry) => entry.key === key);
const currentTeam = (config: ArenaRoomSharedConfig, key: string) => config.teams.find((entry) => entry.key === key);

const entryReference = (entry: unknown): unknown => {
  if (entry && typeof entry === 'object' && !Array.isArray(entry) && 'ref' in entry) {
    return deepClone((entry as { ref: unknown }).ref);
  }
  return deepClone(entry);
};

const currentAssignment = (config: ArenaRoomSharedConfig, combatantKey: string): string | null | undefined => {
  if (!currentCombatant(config, combatantKey)) return undefined;
  for (const team of config.teams) {
    if (team.combatantKeys.includes(combatantKey)) return team.key;
  }
  return null;
};

const currentSemanticValue = (config: ArenaRoomSharedConfig, change: ArenaProposalChange): SemanticValue => {
  switch (change.type) {
    case 'addCombatant': {
      const entry = currentCombatant(config, `data-card:${change.ref.id}`);
      return entry ? { kind: 'ref', ref: entryReference(entry) } : absent();
    }
    case 'removeCombatant': {
      const entry = currentCombatant(config, change.combatantKey);
      return entry ? { kind: 'ref', ref: entryReference(entry) } : absent();
    }
    case 'setCharacterGuidance': {
      const entry = currentCombatant(config, change.combatantKey);
      return entry ? value(entry.characterGuidance ?? null) : absent();
    }
    case 'assignTeam': {
      const assignment = currentAssignment(config, change.combatantKey);
      return assignment === undefined ? absent() : value(assignment);
    }
    case 'addTeam': {
      const team = currentTeam(config, change.teamKey);
      return team ? reference(team) : absent();
    }
    case 'removeTeam': {
      const team = currentTeam(config, change.teamKey);
      return team ? reference(team) : absent();
    }
    case 'renameTeam': {
      const team = currentTeam(config, change.teamKey);
      return team ? value(team.displayName) : absent();
    }
    case 'reorderCombatants':
      return value(config.combatants.map((entry) => entry.key));
    case 'reorderTeams':
      return value(config.teams.map((team) => team.key));
    case 'reorderTeamCombatants': {
      const team = currentTeam(config, change.teamKey);
      return team ? value(team.combatantKeys) : absent();
    }
    case 'setBattleMode':
      return value(config.battleMode);
    case 'setSelectedLanguage':
      return value(config.selectedLanguage);
    case 'setScenario':
      return reference(config.scenario === null ? null : entryReference(config.scenario));
    case 'addAuxScenario': {
      const entry = currentAuxScenario(config, `data-card:${change.ref.id}`);
      return entry ? { kind: 'ref', ref: entryReference(entry) } : absent();
    }
    case 'removeAuxScenario': {
      const entry = currentAuxScenario(config, change.scenarioKey);
      return entry ? { kind: 'ref', ref: entryReference(entry) } : absent();
    }
    case 'reorderAuxScenarios':
      return value(config.auxScenarios.map((entry) => entry.key));
    case 'addMaterial': {
      const entry = currentMaterial(config, `data-card:${change.ref.id}`);
      return entry ? { kind: 'ref', ref: entryReference(entry) } : absent();
    }
    case 'removeMaterial': {
      const entry = currentMaterial(config, change.materialKey);
      return entry ? { kind: 'ref', ref: entryReference(entry) } : absent();
    }
    case 'reorderMaterials':
      return value(config.materials.map((entry) => entry.key));
    case 'setUserGuidance':
      return value(config.userGuidance);
    case 'setStoryLength':
      return value({ storyLength: config.storyLength, customStoryLength: config.customStoryLength });
    case 'setHistorySettings':
      return value(config.historySettings);
  }
};

const targetOf = (change: ArenaProposalChange): string => {
  switch (change.type) {
    case 'addCombatant': return `combatant:data-card:${change.ref.id}`;
    case 'removeCombatant':
    case 'setCharacterGuidance':
    case 'assignTeam': return `combatant:${change.combatantKey}`;
    case 'addTeam':
    case 'removeTeam': return `team:${change.teamKey}`;
    case 'renameTeam': return `team:${change.teamKey}:displayName`;
    case 'reorderCombatants': return 'combatants:order';
    case 'reorderTeams': return 'teams:order';
    case 'reorderTeamCombatants': return `team:${change.teamKey}:combatants:order`;
    case 'setBattleMode': return 'battleMode';
    case 'setSelectedLanguage': return 'selectedLanguage';
    case 'setScenario': return 'scenario';
    case 'addAuxScenario': return `auxScenario:data-card:${change.ref.id}`;
    case 'removeAuxScenario': return `auxScenario:${change.scenarioKey}`;
    case 'reorderAuxScenarios': return 'auxScenarios:order';
    case 'addMaterial': return `material:data-card:${change.ref.id}`;
    case 'removeMaterial': return `material:${change.materialKey}`;
    case 'reorderMaterials': return 'materials:order';
    case 'setUserGuidance': return 'userGuidance';
    case 'setStoryLength': return 'storyLength';
    case 'setHistorySettings': return 'historySettings';
  }
};

const currentForReport = (semantic: SemanticValue, expected: unknown): unknown => {
  if (semantic.kind === 'absent') return { kind: 'absent' };
  if (semantic.kind === 'value') return { kind: 'value', value: deepClone(semantic.value) };
  const expectedKind = expected && typeof expected === 'object' && !Array.isArray(expected) && 'kind' in expected
    ? (expected as { kind?: unknown }).kind
    : undefined;
  return { kind: expectedKind === 'ref' ? 'ref' : 'present', ref: deepClone(semantic.ref) };
};

const expectedForReport = (change: ArenaProposalChange): unknown => deepClone(change.expectedBase);

const conflictFor = (
  change: ArenaProposalChange,
  code: Exclude<ProposalConflictCode, 'invalid-change'>,
  current: SemanticValue,
): ArenaProposalConflict => ({
  changeId: change.changeId,
  code,
  target: targetOf(change),
  expectedBase: expectedForReport(change),
  current: currentForReport(current, change.expectedBase),
  message: code === 'reference-changed'
    ? 'online reference versionToken changed'
    : 'current semantic value does not satisfy expectedBase',
});

const compare = (change: ArenaProposalChange, current: SemanticValue): ArenaProposalConflict | null => {
  const expected = change.expectedBase;
  if (expected.kind === 'absent') {
    return current.kind === 'absent' ? null : conflictFor(change, 'precondition-failed', current);
  }
  if (expected.kind === 'value') {
    return current.kind === 'value' && deepEqual(expected.value, current.value)
      ? null
      : conflictFor(change, 'precondition-failed', current);
  }
  const expectedRef = expected.kind === 'ref' ? expected.ref : expected.ref;
  if (current.kind !== 'ref') return conflictFor(change, 'precondition-failed', current);
  if (hasVersionDrift(expectedRef, current.ref)) return conflictFor(change, 'reference-changed', current);
  return deepEqual(expectedRef, current.ref) ? null : conflictFor(change, 'precondition-failed', current);
};

/** Compares each change's typed expectedBase to the current semantic target. */
export const detectProposalConflicts = (
  currentInput: unknown,
  changesInput: unknown,
): ArenaProposalConflict[] => {
  const current = parseArenaRoomSharedConfig(currentInput);
  if (!Array.isArray(changesInput)) {
    return [{
      changeId: 'unknown',
      code: 'invalid-change',
      target: 'proposal',
      message: 'changes must be an array',
    }];
  }
  const conflicts: ArenaProposalConflict[] = [];
  for (const item of changesInput) {
    const parsed = ArenaProposalChangeSchema.safeParse(item);
    if (!parsed.success) {
      const changeId = item && typeof item === 'object' && !Array.isArray(item) && 'changeId' in item && typeof item.changeId === 'string'
        ? item.changeId
        : 'unknown';
      conflicts.push({
        changeId,
        code: 'invalid-change',
        target: 'proposal',
        message: 'change does not satisfy ArenaProposalChangeSchema',
      });
      continue;
    }
    const change = parsed.data;
    const conflict = compare(change, currentSemanticValue(current, change));
    if (conflict) conflicts.push(conflict);
  }
  return conflicts;
};
