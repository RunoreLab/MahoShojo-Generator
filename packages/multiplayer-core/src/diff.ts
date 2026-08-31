import {
  ArenaProposalChangeSchema,
  parseArenaRoomSharedConfig,
  type ArenaProposalChange,
  type ArenaRoomSharedConfig,
  type CombatantEntry,
  type AuxiliaryScenarioEntry,
  type MaterialEntry,
  type CharacterDataCardRef,
  type HostLocalCombatantStub,
  type ScenarioDataCardRef,
  type HostLocalScenarioStub,
  type MaterialDataCardRef,
  type HostLocalMaterialStub,
  type DataCardRef,
} from '@mahoshojo/contracts/arena-room';

import { unsupportedChange } from './errors';
import {
  arrayEqual,
  deepClone,
  deepEqual,
  isCanonicalResourceKey,
  isOnlineRef,
} from './utils';

const entryKey = (entry: { key: string }): string => entry.key;

const onlineEntry = (entry: unknown): entry is { key: string; ref: { id: string; kind: string; versionToken: string } } => {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
  const record = entry as Record<string, unknown>;
  return typeof record.key === 'string' && isOnlineRef(record.ref);
};

const hostEntry = (entry: unknown): boolean => (
  typeof entry === 'object'
  && entry !== null
  && !Array.isArray(entry)
  && 'source' in entry
  && entry.source === 'host-local'
);

/**
 * Collection additions are applied by appending and removals by filtering the
 * existing sequence. Return the exact staged order before a typed reorder.
 */
const stagedAppendApplyOrder = (
  baseKeys: readonly string[],
  workingKeys: readonly string[],
): string[] => {
  const workingSet = new Set(workingKeys);
  const baseSet = new Set(baseKeys);
  return [
    ...baseKeys.filter((key) => workingSet.has(key)),
    ...workingKeys.filter((key) => !baseSet.has(key)),
  ];
};

const stagedTeamApplyOrder = (
  base: ArenaRoomSharedConfig,
  removedCombatantKeys: ReadonlySet<string>,
  structural: readonly Extract<ArenaProposalChange, {
    type: 'addTeam' | 'removeTeam' | 'renameTeam';
  }>[],
  assignments: readonly Extract<ArenaProposalChange, { type: 'assignTeam' }>[],
): Map<string, string[]> => {
  const simulated = new Map(base.teams.map((team) => [team.key, [...team.combatantKeys]]));
  for (const team of simulated.values()) {
    for (const key of removedCombatantKeys) {
      const index = team.indexOf(key);
      if (index >= 0) team.splice(index, 1);
    }
  }
  for (const change of structural) {
    if (change.type === 'addTeam') simulated.set(change.teamKey, []);
    if (change.type === 'removeTeam') simulated.delete(change.teamKey);
  }
  for (const change of assignments) {
    const target = change.teamKey === null ? undefined : simulated.get(change.teamKey);
    if (change.teamKey !== null && !target) {
      unsupportedChange(`team ${change.teamKey} is not present in the normalized working config`);
    }
    if (target?.includes(change.combatantKey)) continue;
    for (const team of simulated.values()) {
      const index = team.indexOf(change.combatantKey);
      if (index >= 0) team.splice(index, 1);
    }
    if (target) target.push(change.combatantKey);
  }
  return simulated;
};

const changeIdFactory = (): (() => string) => {
  let sequence = 1;
  return () => `change-${sequence++}`;
};

function requireOnlineAddition(
  entry: unknown,
  target: string,
): asserts entry is { key: string; ref: { id: string; kind: string; versionToken: string } } {
  if (!onlineEntry(entry)) unsupportedChange(`${target} addition is host-local or otherwise not a stable ref entry`);
  const online = entry as { key: string; ref: { id: string; kind: string; versionToken: string } };
  if (!isCanonicalResourceKey(online.key, online.ref.id)) {
    unsupportedChange(`${target} addition must use canonical data-card or preset key`);
  }
  if (target === 'material' && online.key.startsWith('preset:')) {
    unsupportedChange('material preset additions are not supported without a server registry');
  }
}

const expectedCombatantRef = (entry: CombatantEntry): CharacterDataCardRef | HostLocalCombatantStub => {
  if ('ref' in entry) return deepClone(entry.ref);
  return deepClone(entry);
};

const expectedScenarioRef = (entry: AuxiliaryScenarioEntry | (Exclude<ArenaRoomSharedConfig['scenario'], null>)): ScenarioDataCardRef | HostLocalScenarioStub => {
  if ('ref' in entry) return deepClone(entry.ref);
  return deepClone(entry);
};

const expectedMaterialRef = (entry: MaterialEntry): MaterialDataCardRef | HostLocalMaterialStub => {
  if ('ref' in entry) return deepClone(entry.ref);
  return deepClone(entry);
};

const compareStableEntry = (
  base: unknown,
  working: unknown,
  target: string,
  allowCharacterGuidance = false,
): void => {
  if (!base || !working || typeof base !== 'object' || typeof working !== 'object') return;
  const baseRecord = base as Record<string, unknown>;
  const workingRecord = working as Record<string, unknown>;
  const baseWithoutGuidance = { ...baseRecord };
  const workingWithoutGuidance = { ...workingRecord };
  if (allowCharacterGuidance) {
    delete baseWithoutGuidance.characterGuidance;
    delete workingWithoutGuidance.characterGuidance;
  }
  if (!deepEqual(baseWithoutGuidance, workingWithoutGuidance)) {
    unsupportedChange(`${target} has an unrepresentable identity or host-local field change`);
  }
};

const assignmentOf = (config: ArenaRoomSharedConfig, combatantKey: string): string | null => {
  for (const team of config.teams) {
    if (team.combatantKeys.includes(combatantKey)) return team.key;
  }
  return null;
};

const makeChange = (change: ArenaProposalChange): ArenaProposalChange => ArenaProposalChangeSchema.parse(change);

/**
 * Computes a deterministic typed proposal. Unsupported local-only or structural
 * edits throw an explicit local domain error instead of being silently omitted.
 */
export const diffArenaSharedConfig = (
  baseInput: unknown,
  workingInput: unknown,
): ArenaProposalChange[] => {
  const base = parseArenaRoomSharedConfig(baseInput);
  const working = parseArenaRoomSharedConfig(workingInput);
  const nextId = changeIdFactory();
  const changes: ArenaProposalChange[] = [];

  const baseCombatantKeys = base.combatants.map(entryKey);
  const workingCombatantKeys = working.combatants.map(entryKey);
  const baseCombatants = new Map(base.combatants.map((entry) => [entry.key, entry]));
  const workingCombatants = new Map(working.combatants.map((entry) => [entry.key, entry]));
  const addedCombatantIds = new Map<string, string>();
  const combatantOrderDependencies: string[] = [];
  const teamOrderDependencies = new Map<string, Set<string>>();
  const dependTeamOrderOn = (teamKey: string | null, changeId: string): void => {
    if (teamKey === null) return;
    const dependencies = teamOrderDependencies.get(teamKey) ?? new Set<string>();
    dependencies.add(changeId);
    teamOrderDependencies.set(teamKey, dependencies);
  };

  for (const entry of working.combatants) {
    if (baseCombatants.has(entry.key)) continue;
    requireOnlineAddition(entry, 'combatant');
    const changeId = nextId();
    addedCombatantIds.set(entry.key, changeId);
    combatantOrderDependencies.push(changeId);
    changes.push(makeChange({
      changeId,
      type: 'addCombatant',
      ref: deepClone(entry.ref),
      expectedBase: { kind: 'absent' },
      ...(entry.key.startsWith('data-card:') ? {} : { key: entry.key }),
    }));
  }
  for (const entry of base.combatants) {
    if (workingCombatants.has(entry.key)) continue;
    const changeId = nextId();
    combatantOrderDependencies.push(changeId);
    for (const team of base.teams) {
      if (team.combatantKeys.includes(entry.key)) dependTeamOrderOn(team.key, changeId);
    }
    changes.push(makeChange({
      changeId,
      type: 'removeCombatant',
      combatantKey: entry.key,
      expectedBase: {
        kind: 'present',
        ref: expectedCombatantRef(entry),
        ...(entry.key.startsWith('data-card:') ? {} : { key: entry.key }),
      },
    }));
  }
  for (const entry of working.combatants) {
    const previous = baseCombatants.get(entry.key);
    if (!previous) continue;
    compareStableEntry(previous, entry, `combatant ${entry.key}`, true);
  }

  const stagedCombatantKeys = stagedAppendApplyOrder(baseCombatantKeys, workingCombatantKeys);
  if (!arrayEqual(stagedCombatantKeys, workingCombatantKeys)) {
    changes.push(makeChange({
      changeId: nextId(),
      type: 'reorderCombatants',
      value: deepClone(workingCombatantKeys),
      expectedBase: { kind: 'value', value: stagedCombatantKeys },
      ...(combatantOrderDependencies.length > 0 ? { dependsOn: combatantOrderDependencies } : {}),
    }));
  }

  for (const entry of working.combatants) {
    const previous = baseCombatants.get(entry.key);
    const previousGuidance = previous?.characterGuidance ?? null;
    const nextGuidance = entry.characterGuidance ?? null;
    if (previous && deepEqual(previousGuidance, nextGuidance)) continue;
    if (!previous && nextGuidance === null) continue;
    const changeId = nextId();
    changes.push(makeChange({
      changeId,
      type: 'setCharacterGuidance',
      combatantKey: entry.key,
      value: nextGuidance,
      expectedBase: { kind: 'value', value: previousGuidance },
      ...(addedCombatantIds.has(entry.key) ? { dependsOn: [addedCombatantIds.get(entry.key)!] } : {}),
    }));
  }

  const baseTeamKeys = base.teams.map(entryKey);
  const workingTeamKeys = working.teams.map(entryKey);
  const baseTeams = new Map(base.teams.map((team) => [team.key, team]));
  const workingTeams = new Map(working.teams.map((team) => [team.key, team]));
  const addedTeamIds = new Map<string, string>();
  const topLevelTeamOrderDependencies: string[] = [];
  for (const team of working.teams) {
    if (baseTeams.has(team.key)) continue;
    const changeId = nextId();
    addedTeamIds.set(team.key, changeId);
    topLevelTeamOrderDependencies.push(changeId);
    dependTeamOrderOn(team.key, changeId);
    changes.push(makeChange({
      changeId,
      type: 'addTeam',
      teamKey: team.key,
      displayName: team.displayName,
      expectedBase: { kind: 'absent' },
    }));
  }
  for (const team of base.teams) {
    if (workingTeams.has(team.key)) continue;
    const changeId = nextId();
    topLevelTeamOrderDependencies.push(changeId);
    changes.push(makeChange({
      changeId,
      type: 'removeTeam',
      teamKey: team.key,
      expectedBase: { kind: 'present', ref: deepClone(team) },
    }));
  }
  for (const baseTeam of base.teams) {
    const workingTeam = workingTeams.get(baseTeam.key);
    if (!workingTeam) continue;
    if (baseTeam.displayName !== workingTeam.displayName) {
      changes.push(makeChange({
        changeId: nextId(),
        type: 'renameTeam',
        teamKey: baseTeam.key,
        value: workingTeam.displayName,
        expectedBase: { kind: 'value', value: baseTeam.displayName },
      }));
    }
  }
  const stagedTeamKeys = stagedAppendApplyOrder(baseTeamKeys, workingTeamKeys);
  if (!arrayEqual(stagedTeamKeys, workingTeamKeys)) {
    changes.push(makeChange({
      changeId: nextId(),
      type: 'reorderTeams',
      value: deepClone(workingTeamKeys),
      expectedBase: { kind: 'value', value: stagedTeamKeys },
      ...(topLevelTeamOrderDependencies.length > 0 ? { dependsOn: topLevelTeamOrderDependencies } : {}),
    }));
  }
  for (const entry of working.combatants) {
    const previousAssignment = baseCombatants.has(entry.key) ? assignmentOf(base, entry.key) : null;
    const nextAssignment = assignmentOf(working, entry.key);
    if (previousAssignment === nextAssignment) continue;
    if (nextAssignment === null && previousAssignment !== null && !workingTeams.has(previousAssignment)) {
      continue;
    }
    const dependencies = [
      ...(addedCombatantIds.has(entry.key) ? [addedCombatantIds.get(entry.key)!] : []),
      ...(nextAssignment !== null && addedTeamIds.has(nextAssignment) ? [addedTeamIds.get(nextAssignment)!] : []),
    ];
    const changeId = nextId();
    dependTeamOrderOn(previousAssignment, changeId);
    dependTeamOrderOn(nextAssignment, changeId);
    changes.push(makeChange({
      changeId,
      type: 'assignTeam',
      combatantKey: entry.key,
      teamKey: nextAssignment,
      expectedBase: { kind: 'value', value: previousAssignment },
      ...(dependencies.length > 0 ? { dependsOn: dependencies } : {}),
    }));
  }
  const structuralTeamChanges = changes.filter((change): change is Extract<ArenaProposalChange, {
    type: 'addTeam' | 'removeTeam' | 'renameTeam';
  }> => change.type === 'addTeam' || change.type === 'removeTeam' || change.type === 'renameTeam');
  const assignmentChanges = changes.filter((change): change is Extract<ArenaProposalChange, { type: 'assignTeam' }> => change.type === 'assignTeam');
  const stagedTeamCombatants = stagedTeamApplyOrder(
    base,
    new Set(base.combatants.filter((entry) => !workingCombatants.has(entry.key)).map((entry) => entry.key)),
    structuralTeamChanges,
    assignmentChanges,
  );
  for (const team of working.teams) {
    const stagedKeys = stagedTeamCombatants.get(team.key);
    if (!stagedKeys || arrayEqual(stagedKeys, team.combatantKeys)) continue;
    const dependencies = [...(teamOrderDependencies.get(team.key) ?? [])];
    changes.push(makeChange({
      changeId: nextId(),
      type: 'reorderTeamCombatants',
      teamKey: team.key,
      value: deepClone(team.combatantKeys),
      expectedBase: { kind: 'value', value: deepClone(stagedKeys) },
      ...(dependencies.length > 0 ? { dependsOn: dependencies } : {}),
    }));
  }

  if (base.battleMode !== working.battleMode) {
    changes.push(makeChange({
      changeId: nextId(),
      type: 'setBattleMode',
      value: working.battleMode,
      expectedBase: { kind: 'value', value: base.battleMode },
    }));
  }
  if (base.selectedLanguage !== working.selectedLanguage) {
    changes.push(makeChange({
      changeId: nextId(),
      type: 'setSelectedLanguage',
      value: working.selectedLanguage,
      expectedBase: { kind: 'value', value: base.selectedLanguage },
    }));
  }

  const baseScenario = base.scenario;
  const workingScenario = working.scenario;
  if (baseScenario === null ? workingScenario !== null : workingScenario === null) {
    const workingScenarioRef = workingScenario !== null && 'ref' in workingScenario ? workingScenario.ref : undefined;
    if (workingScenario !== null && (!workingScenarioRef || !isCanonicalResourceKey(workingScenario.key, workingScenarioRef.id))) {
      unsupportedChange('scenario host-local addition is not representable by Arena Proposal v1');
    }
    changes.push(makeChange({
      changeId: nextId(),
      type: 'setScenario',
      ref: workingScenario === null ? null : deepClone(workingScenarioRef!),
      expectedBase: {
        kind: 'ref',
        ref: baseScenario === null ? null : expectedScenarioRef(baseScenario),
        ...(baseScenario !== null && !baseScenario.key.startsWith('data-card:') ? { key: baseScenario.key } : {}),
      },
      ...(workingScenario !== null && !workingScenario.key.startsWith('data-card:') ? { key: workingScenario.key } : {}),
    }));
  } else if (baseScenario !== null && workingScenario !== null) {
    if (hostEntry(baseScenario) || hostEntry(workingScenario)) {
      if (!deepEqual(baseScenario, workingScenario)) {
        unsupportedChange('scenario host-local field changes are not representable by Arena Proposal v1');
      }
    } else if (!deepEqual(baseScenario, workingScenario)) {
      const workingScenarioRef = ('ref' in workingScenario ? workingScenario.ref : undefined);
      if (!workingScenarioRef || !isCanonicalResourceKey(workingScenario.key, workingScenarioRef.id)) {
        unsupportedChange('scenario reference changes must use canonical data-card or preset key');
      }
      changes.push(makeChange({
        changeId: nextId(),
        type: 'setScenario',
        ref: deepClone(workingScenarioRef!),
        expectedBase: {
          kind: 'ref',
          ref: expectedScenarioRef(baseScenario),
          ...(baseScenario.key.startsWith('data-card:') ? {} : { key: baseScenario.key }),
        },
        ...(workingScenario.key.startsWith('data-card:') ? {} : { key: workingScenario.key }),
      }));
    }
  }

  const refOf = (entry: AuxiliaryScenarioEntry | MaterialEntry): DataCardRef => {
    if ('ref' in entry) return entry.ref;
    return unsupportedChange('host-local collection entries do not have an online ref');
  };

  const diffCollection = (
    baseEntries: readonly (AuxiliaryScenarioEntry | MaterialEntry)[],
    workingEntries: readonly (AuxiliaryScenarioEntry | MaterialEntry)[],
    target: 'auxScenario' | 'material',
  ): void => {
    const baseKeys = baseEntries.map(entryKey);
    const workingKeys = workingEntries.map(entryKey);
    const baseMap = new Map(baseEntries.map((entry) => [entry.key, entry]));
    const workingMap = new Map(workingEntries.map((entry) => [entry.key, entry]));
    const orderDependencies: string[] = [];
    for (const entry of workingEntries) {
      if (baseMap.has(entry.key)) continue;
      requireOnlineAddition(entry, target);
      const entryRef = refOf(entry);
      if (target === 'auxScenario') {
        const changeId = nextId();
        orderDependencies.push(changeId);
        changes.push(makeChange({
          changeId,
          type: 'addAuxScenario',
          ref: deepClone(entryRef) as ScenarioDataCardRef,
          expectedBase: { kind: 'absent' },
          ...(entry.key.startsWith('data-card:') ? {} : { key: entry.key }),
        }));
      } else {
        const changeId = nextId();
        orderDependencies.push(changeId);
        changes.push(makeChange({
          changeId,
          type: 'addMaterial',
          ref: deepClone(entryRef) as MaterialDataCardRef,
          expectedBase: { kind: 'absent' },
          ...(entry.key.startsWith('data-card:') ? {} : { key: entry.key }),
        }));
      }
    }
    for (const entry of baseEntries) {
      if (workingMap.has(entry.key)) continue;
      if (target === 'auxScenario') {
        const changeId = nextId();
        orderDependencies.push(changeId);
        changes.push(makeChange({
          changeId,
          type: 'removeAuxScenario',
          scenarioKey: entry.key,
          expectedBase: {
            kind: 'present',
            ref: expectedScenarioRef(entry as AuxiliaryScenarioEntry),
            ...(entry.key.startsWith('data-card:') ? {} : { key: entry.key }),
          },
        }));
      } else {
        const changeId = nextId();
        orderDependencies.push(changeId);
        changes.push(makeChange({
          changeId,
          type: 'removeMaterial',
          materialKey: entry.key,
          expectedBase: {
            kind: 'present',
            ref: expectedMaterialRef(entry as MaterialEntry),
            ...(entry.key.startsWith('data-card:') ? {} : { key: entry.key }),
          },
        }));
      }
    }
    for (const entry of workingEntries) {
      const previous = baseMap.get(entry.key);
      if (previous) compareStableEntry(previous, entry, `${target} ${entry.key}`);
    }
    const stagedKeys = stagedAppendApplyOrder(baseKeys, workingKeys);
    if (!arrayEqual(stagedKeys, workingKeys)) {
      changes.push(makeChange({
        changeId: nextId(),
        type: target === 'auxScenario' ? 'reorderAuxScenarios' : 'reorderMaterials',
        value: deepClone(workingKeys),
        expectedBase: { kind: 'value', value: stagedKeys },
        ...(orderDependencies.length > 0 ? { dependsOn: orderDependencies } : {}),
      }));
    }
  };

  diffCollection(base.auxScenarios, working.auxScenarios, 'auxScenario');
  diffCollection(base.materials, working.materials, 'material');

  if (base.userGuidance !== working.userGuidance) {
    changes.push(makeChange({
      changeId: nextId(),
      type: 'setUserGuidance',
      value: working.userGuidance,
      expectedBase: { kind: 'value', value: base.userGuidance },
    }));
  }
  if (base.storyLength !== working.storyLength || base.customStoryLength !== working.customStoryLength) {
    changes.push(makeChange({
      changeId: nextId(),
      type: 'setStoryLength',
      value: working.storyLength,
      customStoryLength: working.customStoryLength,
      expectedBase: {
        kind: 'value',
        value: { storyLength: base.storyLength, customStoryLength: base.customStoryLength },
      },
    }));
  }
  if (!deepEqual(base.historySettings, working.historySettings)) {
    changes.push(makeChange({
      changeId: nextId(),
      type: 'setHistorySettings',
      value: deepClone(working.historySettings),
      expectedBase: { kind: 'value', value: deepClone(base.historySettings) },
    }));
  }

  return changes;
};
