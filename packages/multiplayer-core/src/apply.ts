import {
  ArenaProposalSchema,
  ArenaRoomSharedConfigSchema,
  OpaqueKeySchema,
  RoomRevisionSchema,
  parseArenaRoomSharedConfig,
  type ArenaProposal,
  type ArenaProposalChange,
  type ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import { ArenaMultiplayerCoreError } from './errors';
import {
  analyzeProposalChanges,
  type ArenaProposalChangeAnalysis,
  type ArenaProposalConflict,
} from './conflicts';
import { validateProposalChanges, type ProposalSelectionIssue, type ProposalSelectionValidation } from './selection';
import { canonicalResourceKey, deepClone } from './utils';

export interface ArenaProposalState {
  readonly roomId: string;
  readonly config: unknown;
  readonly revision: number;
}

export interface ArenaProposalApplyResult {
  readonly status: 'accepted' | 'partially_accepted' | 'rejected';
  readonly config: ArenaRoomSharedConfig;
  readonly revision: number;
  readonly acceptedChangeIds: readonly string[];
  readonly satisfiedChangeIds: readonly string[];
  readonly rejectedChangeIds: readonly string[];
  readonly conflicts: readonly ArenaProposalConflict[];
  readonly issues: readonly ProposalSelectionIssue[];
}

export interface ArenaProposalApplicationPreview {
  readonly status: 'accepted' | 'partially_accepted' | 'rejected';
  readonly plan: readonly ArenaProposalChangeAnalysis[];
  readonly acceptedChangeIds: readonly string[];
  readonly satisfiedChangeIds: readonly string[];
  readonly conflicts: readonly ArenaProposalConflict[];
  readonly issues: readonly ProposalSelectionIssue[];
}

const parseState = (input: unknown): ArenaProposalState => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ArenaMultiplayerCoreError('invalid-input', 'applyArenaProposal requires a state object');
  }
  const state = input as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(state, 'roomId')
    || !Object.prototype.hasOwnProperty.call(state, 'config')
    || !Object.prototype.hasOwnProperty.call(state, 'revision')) {
    throw new ArenaMultiplayerCoreError('invalid-input', 'state must contain roomId, config, and revision');
  }
  const parsedRoomId = OpaqueKeySchema.safeParse(state.roomId);
  if (!parsedRoomId.success) {
    throw new ArenaMultiplayerCoreError('invalid-input', 'state roomId must be a non-empty opaque key');
  }
  const parsedRevision = RoomRevisionSchema.safeParse(state.revision);
  if (!parsedRevision.success) {
    throw new ArenaMultiplayerCoreError('invalid-input', 'state revision must be a nonnegative integer');
  }
  return {
    roomId: parsedRoomId.data,
    config: state.config,
    revision: parsedRevision.data,
  };
};

const rejected = (
  config: ArenaRoomSharedConfig,
  revision: number,
  ids: readonly string[],
  issues: readonly ProposalSelectionIssue[] = [],
  conflicts: readonly ArenaProposalConflict[] = [],
): ArenaProposalApplyResult => ({
  status: 'rejected',
  config: deepClone(config),
  revision,
  acceptedChangeIds: [],
  satisfiedChangeIds: [],
  rejectedChangeIds: [...ids],
  conflicts: [...conflicts],
  issues: [...issues],
});

const changeTargetExists = (config: ArenaRoomSharedConfig, change: ArenaProposalChange): boolean => {
  switch (change.type) {
    case 'setCharacterGuidance':
    case 'assignTeam':
      return config.combatants.some((entry) => entry.key === change.combatantKey);
    case 'removeCombatant':
      return config.combatants.some((entry) => entry.key === change.combatantKey);
    case 'removeAuxScenario':
      return config.auxScenarios.some((entry) => entry.key === change.scenarioKey);
    case 'removeMaterial':
      return config.materials.some((entry) => entry.key === change.materialKey);
    case 'removeTeam':
    case 'renameTeam':
    case 'reorderTeamCombatants':
      return config.teams.some((team) => team.key === change.teamKey);
    default:
      return true;
  }
};

const reorderByKeys = <Entry extends { readonly key: string }>(
  entries: readonly Entry[],
  orderedKeys: readonly string[],
): Entry[] => {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  return orderedKeys.map((key) => {
    const entry = byKey.get(key);
    if (!entry) throw new ArenaMultiplayerCoreError('unsupported-change', `reorder key ${key} is absent`);
    return entry;
  });
};

const applyChange = (config: ArenaRoomSharedConfig, change: ArenaProposalChange): void => {
  switch (change.type) {
    case 'addCombatant': {
      config.combatants.push({ key: canonicalResourceKey(change.ref.id, change.key), ref: deepClone(change.ref) });
      return;
    }
    case 'removeCombatant': {
      config.combatants = config.combatants.filter((entry) => entry.key !== change.combatantKey);
      config.teams = config.teams.map((team) => ({
        ...team,
        combatantKeys: team.combatantKeys.filter((key) => key !== change.combatantKey),
      }));
      return;
    }
    case 'setCharacterGuidance': {
      config.combatants = config.combatants.map((entry) => {
        if (entry.key !== change.combatantKey) return entry;
        if (change.value === null) {
          const next = { ...entry };
          delete next.characterGuidance;
          return next;
        }
        return { ...entry, characterGuidance: change.value };
      });
      return;
    }
    case 'assignTeam': {
      const existingTeam = change.teamKey === null ? undefined : config.teams.find((team) => team.key === change.teamKey);
      if (change.teamKey !== null && !existingTeam) {
        throw new ArenaMultiplayerCoreError('unsupported-change', `team ${change.teamKey} does not exist`);
      }
      if (change.teamKey !== null && existingTeam?.combatantKeys.includes(change.combatantKey)) return;
      config.teams = config.teams.map((team) => ({
        ...team,
        combatantKeys: team.combatantKeys.filter((key) => key !== change.combatantKey),
      }));
      if (change.teamKey !== null) {
        config.teams = config.teams.map((team) => team.key === change.teamKey
          ? { ...team, combatantKeys: [...team.combatantKeys, change.combatantKey] }
          : team);
      }
      return;
    }
    case 'addTeam':
      if (config.teams.some((team) => team.key === change.teamKey)) {
        throw new ArenaMultiplayerCoreError('unsupported-change', `team ${change.teamKey} already exists`);
      }
      config.teams.push({ key: change.teamKey, displayName: change.displayName, combatantKeys: [] });
      return;
    case 'removeTeam':
      config.teams = config.teams.filter((team) => team.key !== change.teamKey);
      return;
    case 'renameTeam':
      config.teams = config.teams.map((team) => team.key === change.teamKey
        ? { ...team, displayName: change.value }
        : team);
      return;
    case 'reorderCombatants':
      config.combatants = reorderByKeys(config.combatants, change.value);
      return;
    case 'reorderTeams':
      config.teams = reorderByKeys(config.teams, change.value);
      return;
    case 'reorderTeamCombatants':
      config.teams = config.teams.map((team) => team.key === change.teamKey
        ? { ...team, combatantKeys: [...change.value] }
        : team);
      return;
    case 'setBattleMode':
      config.battleMode = change.value;
      return;
    case 'setSelectedLanguage':
      config.selectedLanguage = change.value;
      return;
    case 'setScenario':
      config.scenario = change.ref === null
        ? null
        : { key: canonicalResourceKey(change.ref.id, change.key), ref: deepClone(change.ref) };
      return;
    case 'addAuxScenario':
      config.auxScenarios.push({ key: canonicalResourceKey(change.ref.id, change.key), ref: deepClone(change.ref) });
      return;
    case 'removeAuxScenario':
      config.auxScenarios = config.auxScenarios.filter((entry) => entry.key !== change.scenarioKey);
      return;
    case 'reorderAuxScenarios':
      config.auxScenarios = reorderByKeys(config.auxScenarios, change.value);
      return;
    case 'addMaterial':
      config.materials.push({ key: canonicalResourceKey(change.ref.id, change.key), ref: deepClone(change.ref) });
      return;
    case 'removeMaterial':
      config.materials = config.materials.filter((entry) => entry.key !== change.materialKey);
      return;
    case 'reorderMaterials':
      config.materials = reorderByKeys(config.materials, change.value);
      return;
    case 'setUserGuidance':
      config.userGuidance = change.value;
      return;
    case 'setStoryLength':
      config.storyLength = change.value;
      if (Object.prototype.hasOwnProperty.call(change, 'customStoryLength')) {
        config.customStoryLength = change.customStoryLength ?? null;
      }
      return;
    case 'setHistorySettings':
      config.historySettings = deepClone(change.value);
      return;
  }
};

const topologicalOrder = (
  changes: readonly ArenaProposalChange[],
  selectedIds: readonly string[],
): ArenaProposalChange[] => {
  const byId = new Map(changes.map((change) => [change.changeId, change]));
  const selectedSet = new Set(selectedIds);
  const output: ArenaProposalChange[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id) || !selectedSet.has(id)) return;
    visited.add(id);
    const change = byId.get(id);
    if (!change) return;
    for (const dependency of change.dependsOn ?? []) visit(dependency);
    output.push(change);
  };
  for (const id of selectedIds) visit(id);
  return output;
};

const parseProposal = (input: unknown): ArenaProposal | null => {
  const parsed = ArenaProposalSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

const collectIds = (input: unknown): string[] => (
  input && typeof input === 'object' && !Array.isArray(input) && 'changes' in input && Array.isArray(input.changes)
    ? input.changes.flatMap((change) => (
      change && typeof change === 'object' && !Array.isArray(change) && 'changeId' in change && typeof change.changeId === 'string'
        ? [change.changeId]
        : []
    ))
    : []
);

/** Applies one complete Proposal as one immutable revision transition. */
type StagedAnalysis = Readonly<{
  working: ArenaRoomSharedConfig;
  plan: readonly ArenaProposalChangeAnalysis[];
  conflicts: readonly ArenaProposalConflict[];
  applicableChangeIds: readonly string[];
  satisfiedChangeIds: readonly string[];
}>;

const guardProposal = (
  state: ArenaProposalState,
  proposalInput: unknown,
  selectedChangeIds?: readonly string[],
): { proposal: ArenaProposal; validation: ProposalSelectionValidation } | ArenaProposalApplyResult => {
  const config = parseArenaRoomSharedConfig(state.config);
  const proposal = parseProposal(proposalInput);
  const allIds = collectIds(proposalInput);
  if (!proposal) {
    return rejected(config, state.revision, allIds, [{
      code: 'invalid-proposal',
      message: 'proposal does not satisfy ArenaProposalSchema',
    }]);
  }
  if (proposal.roomId !== state.roomId) {
    return rejected(config, state.revision, proposal.changes.map((change) => change.changeId), [{
      code: 'proposal-room-mismatch',
      message: 'proposal roomId does not match state roomId',
    }]);
  }
  if (proposal.status !== 'submitted') {
    return rejected(config, state.revision, proposal.changes.map((change) => change.changeId), [{
      code: 'invalid-proposal-status',
      message: 'only submitted proposals can be applied',
    }]);
  }

  const validation: ProposalSelectionValidation = validateProposalChanges(proposal.changes, selectedChangeIds);
  if (!validation.valid) {
    return rejected(config, state.revision, proposal.changes.map((change) => change.changeId), validation.issues);
  }
  if (validation.selectedChangeIds.length === 0) {
    return rejected(config, state.revision, proposal.changes.map((change) => change.changeId), validation.issues);
  }
  return { proposal, validation };
};

/**
 * Dependency-ordered staged analysis shared by the authoritative apply path and
 * the host/member review preview. Every selected change is evaluated against the
 * intermediate state produced by its dependencies, so "add combatant -> guidance
 * on the added combatant" is never reported as a conflict, and changes whose
 * target state already equals the proposal's postcondition are reported as
 * satisfied no-ops instead of conflicts.
 */
const analyzeStagedApplication = (
  config: ArenaRoomSharedConfig,
  proposal: ArenaProposal,
  validation: ProposalSelectionValidation,
): StagedAnalysis => {
  const selectedSet = new Set(validation.selectedChangeIds);
  const working = deepClone(config);
  const orderedSelected = topologicalOrder(validation.changes, validation.selectedChangeIds);
  const planById = new Map<string, ArenaProposalChangeAnalysis>();
  const conflicts: ArenaProposalConflict[] = [];
  const applicableChangeIds: string[] = [];
  const satisfiedChangeIds: string[] = [];
  // Evaluate each target immediately before its dependency-ordered application.
  // This lets a dependent change (e.g. add combatant -> guidance) compare its
  // expected base against the staged semantic value without exposing a partial
  // result if a later change conflicts.
  for (const change of orderedSelected) {
    const [analysis] = analyzeProposalChanges(working, [change]);
    if (!analysis) continue;
    planById.set(change.changeId, analysis);
    if (analysis.outcome === 'conflict' && analysis.conflict) {
      conflicts.push(analysis.conflict);
      continue;
    }
    if (analysis.outcome === 'satisfied') {
      satisfiedChangeIds.push(change.changeId);
      continue;
    }
    if (analysis.outcome !== 'applicable') continue;
    if (!changeTargetExists(working, change)) {
      throw new ArenaMultiplayerCoreError('unsupported-change', `proposal target is absent for ${change.changeId}`);
    }
    applicableChangeIds.push(change.changeId);
    applyChange(working, change);
  }
  // Unselected changes are reference-only for reviewers: analyze them against
  // the pristine config like the old non-staged review did.
  const plan = proposal.changes.flatMap((change) => {
    const staged = planById.get(change.changeId);
    if (staged) return [staged];
    if (selectedSet.has(change.changeId)) return [];
    const [reference] = analyzeProposalChanges(config, [change]);
    return reference ? [{ ...reference, outcome: 'unselected' as const }] : [];
  });
  return {
    working,
    plan,
    conflicts,
    applicableChangeIds,
    satisfiedChangeIds,
  };
};

/** Dry-run of applyArenaProposal for host/member review UIs. Same staged semantics. */
export function previewArenaProposalApplication(
  stateInput: ArenaProposalState,
  proposalInput: unknown,
  selectedChangeIds?: readonly string[],
): ArenaProposalApplicationPreview {
  const state = parseState(stateInput);
  const config = parseArenaRoomSharedConfig(state.config);
  const guarded = guardProposal(state, proposalInput, selectedChangeIds);
  if ('status' in guarded) {
    return {
      status: 'rejected',
      plan: [],
      acceptedChangeIds: [],
      satisfiedChangeIds: [],
      conflicts: guarded.conflicts,
      issues: guarded.issues,
    };
  }
  try {
    const staged = analyzeStagedApplication(config, guarded.proposal, guarded.validation);
    const accepted = [...guarded.validation.selectedChangeIds];
    return {
      status: staged.conflicts.length > 0 ? 'rejected' : (
        accepted.length === guarded.proposal.changes.length ? 'accepted' : 'partially_accepted'
      ),
      plan: staged.plan,
      acceptedChangeIds: accepted,
      satisfiedChangeIds: staged.satisfiedChangeIds,
      conflicts: staged.conflicts,
      issues: [],
    };
  } catch (error) {
    return {
      status: 'rejected',
      plan: [],
      acceptedChangeIds: [],
      satisfiedChangeIds: [],
      conflicts: [],
      issues: [{
        code: 'invalid-changes',
        message: error instanceof Error ? error.message : 'selected changes could not be applied',
      }],
    };
  }
}

export function applyArenaProposal(
  stateInput: ArenaProposalState,
  proposalInput: unknown,
  selectedChangeIds?: readonly string[],
): ArenaProposalApplyResult {
  const state = parseState(stateInput);
  const config = parseArenaRoomSharedConfig(state.config);
  const guarded = guardProposal(state, proposalInput, selectedChangeIds);
  if ('status' in guarded) return guarded;

  const selectedSet = new Set(guarded.validation.selectedChangeIds);
  try {
    const staged = analyzeStagedApplication(config, guarded.proposal, guarded.validation);
    if (staged.conflicts.length > 0) {
      return rejected(config, state.revision, guarded.proposal.changes.map((change) => change.changeId), guarded.validation.issues, staged.conflicts);
    }
    const finalConfig = ArenaRoomSharedConfigSchema.parse(staged.working);
    const accepted = [...guarded.validation.selectedChangeIds];
    const rejectedIds = guarded.proposal.changes
      .map((change) => change.changeId)
      .filter((changeId) => !selectedSet.has(changeId));
    return {
      status: accepted.length === guarded.proposal.changes.length ? 'accepted' : 'partially_accepted',
      config: deepClone(finalConfig),
      revision: state.revision + 1,
      acceptedChangeIds: accepted,
      satisfiedChangeIds: staged.satisfiedChangeIds,
      rejectedChangeIds: rejectedIds,
      conflicts: [],
      issues: [],
    };
  } catch (error) {
    const issue: ProposalSelectionIssue = {
      code: 'invalid-changes',
      message: error instanceof Error ? error.message : 'selected changes could not be applied',
    };
    return rejected(config, state.revision, guarded.proposal.changes.map((change) => change.changeId), [issue]);
  }
}
