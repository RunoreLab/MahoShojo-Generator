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

import { arrayReorder, unsupportedChange } from './errors';
import {
  arrayEqual,
  deepClone,
  deepEqual,
  isCanonicalDataCardKey,
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

const assertNestedOrder = (
  base: readonly string[],
  working: readonly string[],
  target: string,
): void => {
  const baseSet = new Set(base);
  const workingSet = new Set(working);
  const commonBase = base.filter((key) => workingSet.has(key));
  const commonWorking = working.filter((key) => baseSet.has(key));
  if (!arrayEqual(commonBase, commonWorking)) arrayReorder(target);
};

/**
 * Collection additions are applied by appending and removals by filtering the
 * existing sequence. Validate the exact sequence that those semantics produce,
 * including insertions mixed with retained entries.
 */
const assertAppendApplyOrder = (
  baseKeys: readonly string[],
  workingKeys: readonly string[],
  target: string,
): void => {
  const workingSet = new Set(workingKeys);
  const baseSet = new Set(baseKeys);
  const simulated = [
    ...baseKeys.filter((key) => workingSet.has(key)),
    ...workingKeys.filter((key) => !baseSet.has(key)),
  ];
  if (!arrayEqual(simulated, workingKeys)) arrayReorder(target);
};

const assertTeamApplyOrder = (
  base: ArenaRoomSharedConfig,
  working: ArenaRoomSharedConfig,
  removedCombatantKeys: ReadonlySet<string>,
  structural: readonly Extract<ArenaProposalChange, {
    type: 'addTeam' | 'removeTeam' | 'renameTeam';
  }>[],
  assignments: readonly Extract<ArenaProposalChange, { type: 'assignTeam' }>[],
): void => {
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
  for (const team of working.teams) {
    const result = simulated.get(team.key);
    if (!result || !arrayEqual(result, team.combatantKeys)) {
      arrayReorder(`team ${team.key} combatants`);
    }
  }
};

const changeIdFactory = (): (() => string) => {
  let sequence = 1;
  return () => `change-${sequence++}`;
};

function requireOnlineAddition(
  entry: unknown,
  target: string,
): asserts entry is { key: string; ref: { id: string; kind: string; versionToken: string } } {
  if (!onlineEntry(entry)) unsupportedChange(`${target} addition is host-local/preset or otherwise not an online data-card entry`);
  const online = entry as { key: string; ref: { id: string; kind: string; versionToken: string } };
  if (!isCanonicalDataCardKey(online.key, online.ref.id)) {
    unsupportedChange(`${target} addition must use canonical data-card key`);
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
  assertAppendApplyOrder(baseCombatantKeys, workingCombatantKeys, 'combatants');
  const baseCombatants = new Map(base.combatants.map((entry) => [entry.key, entry]));
  const workingCombatants = new Map(working.combatants.map((entry) => [entry.key, entry]));
  const addedCombatantIds = new Map<string, string>();

  for (const entry of working.combatants) {
    if (baseCombatants.has(entry.key)) continue;
    requireOnlineAddition(entry, 'combatant');
    const changeId = nextId();
    addedCombatantIds.set(entry.key, changeId);
    changes.push(makeChange({
      changeId,
      type: 'addCombatant',
      ref: deepClone(entry.ref),
      expectedBase: { kind: 'absent' },
    }));
  }
  for (const entry of base.combatants) {
    if (workingCombatants.has(entry.key)) continue;
    const changeId = nextId();
    changes.push(makeChange({
      changeId,
      type: 'removeCombatant',
      combatantKey: entry.key,
      expectedBase: { kind: 'present', ref: expectedCombatantRef(entry) },
    }));
  }
  for (const entry of working.combatants) {
    const previous = baseCombatants.get(entry.key);
    if (!previous) continue;
    compareStableEntry(previous, entry, `combatant ${entry.key}`, true);
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
  assertAppendApplyOrder(baseTeamKeys, workingTeamKeys, 'teams');
  const baseTeams = new Map(base.teams.map((team) => [team.key, team]));
  const workingTeams = new Map(working.teams.map((team) => [team.key, team]));
  const addedTeamIds = new Map<string, string>();
  for (const team of working.teams) {
    if (baseTeams.has(team.key)) continue;
    const changeId = nextId();
    addedTeamIds.set(team.key, changeId);
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
    changes.push(makeChange({
      changeId: nextId(),
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
    assertNestedOrder(baseTeam.combatantKeys, workingTeam.combatantKeys, `team ${baseTeam.key} combatants`);
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
    changes.push(makeChange({
      changeId: nextId(),
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
  assertTeamApplyOrder(
    base,
    working,
    new Set(base.combatants.filter((entry) => !workingCombatants.has(entry.key)).map((entry) => entry.key)),
    structuralTeamChanges,
    assignmentChanges,
  );

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
    if (workingScenario !== null && (!workingScenarioRef || !isCanonicalDataCardKey(workingScenario.key, workingScenarioRef.id))) {
      unsupportedChange('scenario host-local/preset addition is not representable by Arena Proposal v1');
    }
    changes.push(makeChange({
      changeId: nextId(),
      type: 'setScenario',
      ref: workingScenario === null ? null : deepClone(workingScenarioRef!),
      expectedBase: { kind: 'ref', ref: baseScenario === null ? null : expectedScenarioRef(baseScenario) },
    }));
  } else if (baseScenario !== null && workingScenario !== null) {
    if (hostEntry(baseScenario) || hostEntry(workingScenario)) {
      if (!deepEqual(baseScenario, workingScenario)) {
        unsupportedChange('scenario host-local field changes are not representable by Arena Proposal v1');
      }
    } else if (!deepEqual(baseScenario, workingScenario)) {
      const workingScenarioRef = ('ref' in workingScenario ? workingScenario.ref : undefined);
      if (!workingScenarioRef || !isCanonicalDataCardKey(workingScenario.key, workingScenarioRef.id)) {
        unsupportedChange('scenario reference changes must use canonical data-card key');
      }
      changes.push(makeChange({
        changeId: nextId(),
        type: 'setScenario',
        ref: deepClone(workingScenarioRef!),
        expectedBase: { kind: 'ref', ref: expectedScenarioRef(baseScenario) },
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
    assertAppendApplyOrder(baseKeys, workingKeys, `${target}s`);
    const baseMap = new Map(baseEntries.map((entry) => [entry.key, entry]));
    const workingMap = new Map(workingEntries.map((entry) => [entry.key, entry]));
    for (const entry of workingEntries) {
      if (baseMap.has(entry.key)) continue;
      requireOnlineAddition(entry, target);
      const entryRef = refOf(entry);
      if (target === 'auxScenario') {
        changes.push(makeChange({
          changeId: nextId(),
          type: 'addAuxScenario',
          ref: deepClone(entryRef) as ScenarioDataCardRef,
          expectedBase: { kind: 'absent' },
        }));
      } else {
        changes.push(makeChange({
          changeId: nextId(),
          type: 'addMaterial',
          ref: deepClone(entryRef) as MaterialDataCardRef,
          expectedBase: { kind: 'absent' },
        }));
      }
    }
    for (const entry of baseEntries) {
      if (workingMap.has(entry.key)) continue;
      if (target === 'auxScenario') {
        changes.push(makeChange({
          changeId: nextId(),
          type: 'removeAuxScenario',
          scenarioKey: entry.key,
          expectedBase: { kind: 'present', ref: expectedScenarioRef(entry as AuxiliaryScenarioEntry) },
        }));
      } else {
        changes.push(makeChange({
          changeId: nextId(),
          type: 'removeMaterial',
          materialKey: entry.key,
          expectedBase: { kind: 'present', ref: expectedMaterialRef(entry as MaterialEntry) },
        }));
      }
    }
    for (const entry of workingEntries) {
      const previous = baseMap.get(entry.key);
      if (previous) compareStableEntry(previous, entry, `${target} ${entry.key}`);
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
