import {
  ARENA_CANONICAL_CAPABILITIES,
  type ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import type { ArenaGateIssue } from './gate-types';

export type ArenaGenerationReadinessIssueCode =
  | 'GENERATION_COMBATANTS_EMPTY'
  | 'GENERATION_COMBATANTS_INSUFFICIENT'
  | 'GENERATION_SCENARIO_REQUIRED'
  | 'GENERATION_COMBATANT_LIMIT';

export type ArenaGenerationReadinessIssue = ArenaGateIssue & Readonly<{
  code: ArenaGenerationReadinessIssueCode;
  gate: 'generation-readiness';
  severity: 'blocking';
}>;

export interface ArenaGenerationReadinessEvaluation {
  readonly ready: boolean;
  readonly issues: readonly ArenaGenerationReadinessIssue[];
}

type GenerationReadinessConfig = Readonly<Pick<
  ArenaRoomSharedConfig,
  'battleMode' | 'combatants' | 'scenario'
>>;

const blockingIssue = (
  issue: Omit<ArenaGenerationReadinessIssue, 'gate' | 'severity'>,
): ArenaGenerationReadinessIssue => ({
  ...issue,
  gate: 'generation-readiness',
  severity: 'blocking',
});

/**
 * Evaluates generation-only completeness without changing Room shareability.
 * Ref/version/payload checks remain in the authority materializer because they
 * require server or request-scoped data that is absent from Shared Config.
 */
export const evaluateArenaGenerationReadiness = (
  config: GenerationReadinessConfig,
): ArenaGenerationReadinessEvaluation => {
  const issues: ArenaGenerationReadinessIssue[] = [];
  const current = config.combatants.length;
  const required = ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode[config.battleMode];

  if (current === 0) {
    issues.push(blockingIssue({
      code: 'GENERATION_COMBATANTS_EMPTY',
      target: { kind: 'combatant' },
      params: { current, required: 1 },
      messageKey: 'arena.multiplayer.gate.generationCombatantsEmpty',
      userAction: '至少添加 1 位参战角色后再开始生成。',
    }));
  } else if (current < required) {
    issues.push(blockingIssue({
      code: 'GENERATION_COMBATANTS_INSUFFICIENT',
      target: { kind: 'combatant' },
      params: { current, required, mode: config.battleMode },
      messageKey: 'arena.multiplayer.gate.generationCombatantsInsufficient',
      userAction: `当前模式至少需要 ${required} 位参战角色，请继续添加角色。`,
    }));
  }

  if (current > ARENA_CANONICAL_CAPABILITIES.maxCombatants) {
    issues.push(blockingIssue({
      code: 'GENERATION_COMBATANT_LIMIT',
      target: { kind: 'combatant' },
      params: { current, maximum: ARENA_CANONICAL_CAPABILITIES.maxCombatants },
      messageKey: 'arena.multiplayer.gate.generationCombatantLimit',
      userAction: `最多支持 ${ARENA_CANONICAL_CAPABILITIES.maxCombatants} 位参战角色，请移除多余角色。`,
    }));
  }

  if (config.battleMode === 'scenario' && config.scenario === null) {
    issues.push(blockingIssue({
      code: 'GENERATION_SCENARIO_REQUIRED',
      target: { kind: 'scenario' },
      params: { mode: config.battleMode },
      messageKey: 'arena.multiplayer.gate.generationScenarioRequired',
      userAction: '情景模式需要主情景，请先选择或载入主情景。',
    }));
  }

  return { ready: issues.length === 0, issues };
};
