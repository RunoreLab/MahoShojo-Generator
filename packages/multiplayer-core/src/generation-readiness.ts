import {
  ARENA_CANONICAL_CAPABILITIES,
  evaluateArenaBasicGenerationReadiness,
  type ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import type { ArenaGateIssue } from './gate-types';

export const ARENA_GENERATION_READINESS_ISSUE_CODES = [
  'GENERATION_COMBATANTS_EMPTY',
  'GENERATION_COMBATANTS_INSUFFICIENT',
  'GENERATION_SCENARIO_REQUIRED',
  'GENERATION_COMBATANT_LIMIT',
] as const;
export type ArenaGenerationReadinessIssueCode = (
  typeof ARENA_GENERATION_READINESS_ISSUE_CODES
)[number];

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
  for (const issue of evaluateArenaBasicGenerationReadiness({
    battleMode: config.battleMode,
    combatantCount: current,
    hasScenario: config.scenario !== null,
  })) {
    if (issue.code === 'GENERATION_COMBATANTS_EMPTY') {
      issues.push(blockingIssue({
        code: issue.code,
        target: { kind: 'combatant' },
        params: { current: issue.current, required: issue.required },
        messageKey: 'arena.multiplayer.gate.generationCombatantsEmpty',
        userAction: '至少添加 1 位参战角色后再开始生成。',
      }));
    } else if (issue.code === 'GENERATION_COMBATANTS_INSUFFICIENT') {
      issues.push(blockingIssue({
        code: issue.code,
        target: { kind: 'combatant' },
        params: { current: issue.current, required: issue.required, mode: config.battleMode },
        messageKey: 'arena.multiplayer.gate.generationCombatantsInsufficient',
        userAction: `当前模式至少需要 ${issue.required} 位参战角色，请继续添加角色。`,
      }));
    } else {
      issues.push(blockingIssue({
        code: issue.code,
        target: { kind: 'scenario' },
        params: { mode: config.battleMode },
        messageKey: 'arena.multiplayer.gate.generationScenarioRequired',
        userAction: '情景模式需要主情景，请先选择或载入主情景。',
      }));
    }
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

  return { ready: issues.length === 0, issues };
};
