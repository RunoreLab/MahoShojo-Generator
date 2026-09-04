import {
  ArenaProposalChangeSchema,
  parseArenaRoomSharedConfig,
  type ArenaProposalChange,
  type ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import { canonicalResourceKey, deepClone, deepEqual, hasVersionDrift } from './utils';

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
  | { readonly kind: 'ref'; readonly ref: unknown; readonly targetKey?: string };

const absent = (): SemanticValue => ({ kind: 'absent' });
const value = (input: unknown): SemanticValue => ({ kind: 'value', value: deepClone(input) });
const reference = (input: unknown, targetKey?: string): SemanticValue => ({
  kind: 'ref',
  ref: deepClone(input),
  ...(targetKey === undefined ? {} : { targetKey }),
});

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

/**
 * The semantic value a change intends to produce once applied. Compared with
 * the current semantic value this detects "another mutation already achieved
 * this change" (postcondition satisfied), which is a safe no-op rather than a
 * conflict.
 */
const proposedSemanticValue = (change: ArenaProposalChange): SemanticValue => {
  switch (change.type) {
    case 'addCombatant':
      return reference(change.ref, canonicalResourceKey(change.ref.id, change.key));
    case 'removeCombatant':
    case 'removeAuxScenario':
    case 'removeMaterial':
    case 'removeTeam':
      return absent();
    case 'setCharacterGuidance':
      return value(change.value);
    case 'assignTeam':
      return value(change.teamKey);
    case 'addTeam':
      return reference({ key: change.teamKey, displayName: change.displayName, combatantKeys: [] });
    case 'renameTeam':
      return value(change.value);
    case 'reorderCombatants':
      return value(change.value);
    case 'reorderTeams':
      return value(change.value);
    case 'reorderTeamCombatants':
      return value(change.value);
    case 'setBattleMode':
      return value(change.value);
    case 'setSelectedLanguage':
      return value(change.value);
    case 'setScenario':
      return change.ref === null
        ? reference(null)
        : reference(change.ref, canonicalResourceKey(change.ref.id, change.key));
    case 'addAuxScenario':
      return reference(change.ref, canonicalResourceKey(change.ref.id, change.key));
    case 'reorderAuxScenarios':
      return value(change.value);
    case 'addMaterial':
      return reference(change.ref, canonicalResourceKey(change.ref.id, change.key));
    case 'reorderMaterials':
      return value(change.value);
    case 'setUserGuidance':
      return value(change.value);
    case 'setStoryLength':
      return value({ storyLength: change.value, customStoryLength: change.customStoryLength ?? null });
    case 'setHistorySettings':
      return value(change.value);
  }
};

const currentSemanticValue = (config: ArenaRoomSharedConfig, change: ArenaProposalChange): SemanticValue => {
  switch (change.type) {
    case 'addCombatant': {
      const entry = currentCombatant(config, canonicalResourceKey(change.ref.id, change.key));
      return entry ? reference(entryReference(entry), entry.key) : absent();
    }
    case 'removeCombatant': {
      const entry = currentCombatant(config, change.combatantKey);
      return entry ? reference(entryReference(entry), entry.key) : absent();
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
      return reference(config.scenario === null ? null : entryReference(config.scenario), config.scenario?.key);
    case 'addAuxScenario': {
      const entry = currentAuxScenario(config, canonicalResourceKey(change.ref.id, change.key));
      return entry ? reference(entryReference(entry), entry.key) : absent();
    }
    case 'removeAuxScenario': {
      const entry = currentAuxScenario(config, change.scenarioKey);
      return entry ? reference(entryReference(entry), entry.key) : absent();
    }
    case 'reorderAuxScenarios':
      return value(config.auxScenarios.map((entry) => entry.key));
    case 'addMaterial': {
      const entry = currentMaterial(config, canonicalResourceKey(change.ref.id, change.key));
      return entry ? reference(entryReference(entry), entry.key) : absent();
    }
    case 'removeMaterial': {
      const entry = currentMaterial(config, change.materialKey);
      return entry ? reference(entryReference(entry), entry.key) : absent();
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
    case 'addCombatant': return `combatant:${canonicalResourceKey(change.ref.id, change.key)}`;
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
    case 'addAuxScenario': return `auxScenario:${canonicalResourceKey(change.ref.id, change.key)}`;
    case 'removeAuxScenario': return `auxScenario:${change.scenarioKey}`;
    case 'reorderAuxScenarios': return 'auxScenarios:order';
    case 'addMaterial': return `material:${canonicalResourceKey(change.ref.id, change.key)}`;
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
  return {
    kind: expectedKind === 'ref' ? 'ref' : 'present',
    ref: deepClone(semantic.ref),
    ...(semantic.targetKey === undefined ? {} : { key: semantic.targetKey }),
  };
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

type SemanticMatchFailure = 'kind' | 'key' | 'drift' | 'value';

type SemanticMatchResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SemanticMatchFailure };

type ExpectedSemanticValue =
  | { readonly kind: 'absent' }
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'present' | 'ref'; readonly ref: unknown; readonly key?: string; readonly targetKey?: string };

type ReferenceSemanticValue = Extract<ExpectedSemanticValue, { readonly ref: unknown }>;

const refMatchesExpected = (
  expected: ReferenceSemanticValue,
  current: SemanticValue,
): SemanticMatchResult => {
  const expectedRef = expected.ref;
  if (current.kind !== 'ref') return { ok: false, reason: 'kind' };
  // Prefer an already-canonicalized target key (typed expectedBase.key, or the
  // proposed semantic value's targetKey produced by canonicalResourceKey) over
  // re-deriving the namespace from ref.id, whose default assumes data-card and
  // would misjudge preset references (preset:<id> vs data-card:<id>).
  const expectedKey = 'key' in expected && typeof expected.key === 'string'
    ? expected.key
    : 'targetKey' in expected && typeof expected.targetKey === 'string'
      ? expected.targetKey
      : expectedRef && typeof expectedRef === 'object' && 'id' in expectedRef
          ? canonicalResourceKey((expectedRef as { id: string }).id)
          : expectedRef && typeof expectedRef === 'object' && 'source' in expectedRef
            && (expectedRef as { source?: unknown }).source === 'host-local'
            && 'key' in expectedRef
            ? (expectedRef as { key: string }).key
            : undefined;
  if (expectedKey !== undefined && current.targetKey !== expectedKey) {
    return { ok: false, reason: 'key' };
  }
  if (hasVersionDrift(expectedRef, current.ref)) return { ok: false, reason: 'drift' };
  return deepEqual(expectedRef, current.ref) ? { ok: true } : { ok: false, reason: 'value' };
};

const semanticMatches = (
  expected: ExpectedSemanticValue,
  current: SemanticValue,
): SemanticMatchResult => {
  if (expected.kind === 'absent') {
    return current.kind === 'absent' ? { ok: true } : { ok: false, reason: 'kind' };
  }
  if (expected.kind === 'value') {
    return current.kind === 'value' && deepEqual(expected.value, current.value)
      ? { ok: true }
      : { ok: false, reason: 'value' };
  }
  return refMatchesExpected(expected, current);
};

/**
 * Three-way merge semantics for one change:
 * - CURRENT == BASE -> applicable as proposed;
 * - CURRENT == PROPOSED -> already satisfied by another mutation, a safe no-op;
 * - otherwise -> a real conflict that the host must review.
 */
const compare = (
  change: ArenaProposalChange,
  current: SemanticValue,
): ArenaProposalConflict | { readonly satisfied: true } | null => {
  const baseResult = semanticMatches(change.expectedBase, current);
  if (baseResult.ok) return null;
  if (semanticMatches(proposedSemanticValue(change), current).ok) {
    return { satisfied: true };
  }
  return conflictFor(
    change,
    baseResult.reason === 'drift' ? 'reference-changed' : 'precondition-failed',
    current,
  );
};

export type ArenaProposalChangeOutcome =
  | 'applicable'
  | 'satisfied'
  | 'conflict'
  | 'invalid-change'
  | 'unselected';

export interface ArenaProposalChangeAnalysis {
  readonly changeId: string;
  readonly target: string;
  readonly outcome: ArenaProposalChangeOutcome;
  readonly conflict?: ArenaProposalConflict;
}

/**
 * Staged-independent per-change analysis. Callers that need dependency-aware
 * results (add combatant -> guidance on the added combatant) must run this on
 * each staged intermediate state, like applyArenaProposal does.
 */
export const analyzeProposalChanges = (
  currentInput: unknown,
  changesInput: unknown,
): ArenaProposalChangeAnalysis[] => {
  const current = parseArenaRoomSharedConfig(currentInput);
  if (!Array.isArray(changesInput)) {
    return [{
      changeId: 'unknown',
      target: 'proposal',
      outcome: 'invalid-change',
      conflict: {
        changeId: 'unknown',
        code: 'invalid-change',
        target: 'proposal',
        message: 'changes must be an array',
      },
    }];
  }
  const analyses: ArenaProposalChangeAnalysis[] = [];
  for (const item of changesInput) {
    const parsed = ArenaProposalChangeSchema.safeParse(item);
    if (!parsed.success) {
      const changeId = item && typeof item === 'object' && !Array.isArray(item) && 'changeId' in item && typeof item.changeId === 'string'
        ? item.changeId
        : 'unknown';
      analyses.push({
        changeId,
        target: 'proposal',
        outcome: 'invalid-change',
        conflict: {
          changeId,
          code: 'invalid-change',
          target: 'proposal',
          message: 'change does not satisfy ArenaProposalChangeSchema',
        },
      });
      continue;
    }
    const change = parsed.data;
    const target = targetOf(change);
    const result = compare(change, currentSemanticValue(current, change));
    analyses.push(result === null
      ? { changeId: change.changeId, target, outcome: 'applicable' }
      : 'satisfied' in result
        ? { changeId: change.changeId, target, outcome: 'satisfied' }
        : { changeId: change.changeId, target, outcome: 'conflict', conflict: result });
  }
  return analyses;
};

/** Compares each change's typed expectedBase to the current semantic target. */
export const detectProposalConflicts = (
  currentInput: unknown,
  changesInput: unknown,
): ArenaProposalConflict[] => (
  analyzeProposalChanges(currentInput, changesInput)
    .flatMap((analysis) => (analysis.outcome === 'conflict' && analysis.conflict ? [analysis.conflict] : []))
);
