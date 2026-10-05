/**
 * Dependency-neutral Arena product/runtime capabilities.
 *
 * Consumers may impose additional byte, authority or concurrency gates, but
 * must not silently introduce a lower count limit for these same semantics.
 */
export const ARENA_CANONICAL_CAPABILITIES = Object.freeze({
  maxCombatants: 32,
  maxReferenceItemsSanity: 256,
  minCombatantsByMode: Object.freeze({
    classic: 2,
    kizuna: 2,
    daily: 1,
    scenario: 1,
  }),
});

export const ARENA_RUNTIME_RESOURCE_BUDGET_KEYS = [
  'hardBodyBytes',
  'cancelBodyBytes',
  'maxCombatants',
  'maxAdjudicationEvents',
  'maxReferenceItemsSanity',
  'maxOutputBytes',
  'maxEstimatedPromptTokens',
] as const;
export type ArenaRuntimeResourceBudgetKey = typeof ARENA_RUNTIME_RESOURCE_BUDGET_KEYS[number];

export const ARENA_BASIC_GENERATION_READINESS_ISSUE_CODES = [
  'GENERATION_COMBATANTS_EMPTY',
  'GENERATION_COMBATANTS_INSUFFICIENT',
  'GENERATION_SCENARIO_REQUIRED',
] as const;
export type ArenaBasicGenerationReadinessIssueCode = (
  typeof ARENA_BASIC_GENERATION_READINESS_ISSUE_CODES
)[number];

export type ArenaBasicGenerationReadinessIssue =
  | Readonly<{ code: 'GENERATION_COMBATANTS_EMPTY'; current: 0; required: 1 }>
  | Readonly<{
    code: 'GENERATION_COMBATANTS_INSUFFICIENT';
    current: number;
    required: number;
  }>
  | Readonly<{ code: 'GENERATION_SCENARIO_REQUIRED' }>;

export type ArenaBasicGenerationReadinessInput = Readonly<{
  battleMode: keyof typeof ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode;
  combatantCount: number;
  hasScenario: boolean;
}>;

/** Shared single/multiplayer mode-minimum evaluator with no schema/runtime dependency. */
export const evaluateArenaBasicGenerationReadiness = (
  input: ArenaBasicGenerationReadinessInput,
): readonly ArenaBasicGenerationReadinessIssue[] => {
  const issues: ArenaBasicGenerationReadinessIssue[] = [];
  const required = ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode[input.battleMode];
  if (input.combatantCount === 0) {
    issues.push({ code: 'GENERATION_COMBATANTS_EMPTY', current: 0, required: 1 });
  } else if (input.combatantCount < required) {
    issues.push({
      code: 'GENERATION_COMBATANTS_INSUFFICIENT',
      current: input.combatantCount,
      required,
    });
  }
  if (input.battleMode === 'scenario' && !input.hasScenario) {
    issues.push({ code: 'GENERATION_SCENARIO_REQUIRED' });
  }
  return Object.freeze(issues);
};
