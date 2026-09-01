import {
  ARENA_CANONICAL_CAPABILITIES,
  ArenaRoomSharedConfigSchema,
} from '@mahoshojo/contracts/arena-room';
import { describe, expect, it } from 'vitest';

import {
  ARENA_GATE_CAPABILITY_REGISTRY,
  ARENA_PRODUCT_PARITY_COVERAGE,
  evaluateArenaGenerationReadiness,
} from '../src/index';
import { baseConfig } from './state-machine-fixtures';

describe('GMR-10Q generation readiness', () => {
  it('共享 schema 接受空 roster，但 readiness 返回稳定且可行动的结构化 issue', () => {
    const draft = { ...baseConfig(), battleMode: 'daily' as const, combatants: [] };

    expect(ArenaRoomSharedConfigSchema.safeParse(draft).success).toBe(true);
    expect(evaluateArenaGenerationReadiness(draft)).toEqual({
      ready: false,
      issues: [{
        code: 'GENERATION_COMBATANTS_EMPTY',
        gate: 'generation-readiness',
        severity: 'blocking',
        target: { kind: 'combatant' },
        params: { current: 0, required: 1 },
        messageKey: 'arena.multiplayer.gate.generationCombatantsEmpty',
        userAction: '至少添加 1 位参战角色后再开始生成。',
      }],
    });
  });

  it('继承单人 Arena 的 mode-specific 最低人数和情景完整性', () => {
    const oneCombatant = baseConfig();
    expect(evaluateArenaGenerationReadiness({
      ...oneCombatant,
      battleMode: 'daily',
    })).toEqual({ ready: true, issues: [] });
    expect(evaluateArenaGenerationReadiness({
      ...oneCombatant,
      battleMode: 'classic',
    }).issues).toEqual([expect.objectContaining({
      code: 'GENERATION_COMBATANTS_INSUFFICIENT',
      params: { current: 1, required: 2, mode: 'classic' },
    })]);
    expect(evaluateArenaGenerationReadiness({
      ...oneCombatant,
      battleMode: 'scenario',
      scenario: null,
    }).issues).toEqual([expect.objectContaining({
      code: 'GENERATION_SCENARIO_REQUIRED',
      target: { kind: 'scenario' },
    })]);
    expect(evaluateArenaGenerationReadiness({
      ...oneCombatant,
      battleMode: 'scenario',
      scenario: {
        key: 'data-card:scenario-1',
        ref: { id: 'scenario-1', kind: 'scenario', versionToken: 'v1' },
      },
    })).toEqual({ ready: true, issues: [] });
  });

  it('32 位通过 readiness，33 位返回 canonical capacity issue', () => {
    const combatants = Array.from({ length: 32 }, (_, index) => ({
      key: `data-card:character-${index}`,
      ref: { id: `character-${index}`, kind: 'character' as const, versionToken: 'v1' },
    }));
    expect(evaluateArenaGenerationReadiness({
      ...baseConfig(), battleMode: 'daily', combatants,
    })).toEqual({ ready: true, issues: [] });
    expect(evaluateArenaGenerationReadiness({
      ...baseConfig(), battleMode: 'daily', combatants: [...combatants, {
        key: 'data-card:character-32',
        ref: { id: 'character-32', kind: 'character', versionToken: 'v1' },
      }],
    }).issues).toEqual([expect.objectContaining({
      code: 'GENERATION_COMBATANT_LIMIT',
      params: { current: 33, maximum: 32 },
    })]);
  });
});

describe('GMR-10Q machine-readable gate/capability registry', () => {
  it('覆盖六层关键门禁，且不存在未分类、无理由或无测试绑定的例外', () => {
    const layers = new Set([
      'room-lifecycle',
      'room-shareability',
      'collaboration',
      'generation-readiness',
      'runtime-resource',
      'result-action',
    ]);
    const reasonCategories = new Set([
      'product-parity',
      'security/privacy',
      'authorization/authority',
      'distributed-consistency',
      'resource/concurrency',
      'explicit-product-non-goal',
    ]);

    expect(new Set(ARENA_GATE_CAPABILITY_REGISTRY.map((entry) => entry.code)).size)
      .toBe(ARENA_GATE_CAPABILITY_REGISTRY.length);
    expect(new Set(ARENA_GATE_CAPABILITY_REGISTRY.map((entry) => entry.layer))).toEqual(layers);
    for (const entry of ARENA_GATE_CAPABILITY_REGISTRY) {
      expect(entry.condition.trim().length).toBeGreaterThan(0);
      expect(entry.currentSource.trim().length).toBeGreaterThan(0);
      expect(entry.singleEquivalent.trim().length).toBeGreaterThan(0);
      expect(entry.canonicalSource.trim().length).toBeGreaterThan(0);
      expect(reasonCategories).toContain(entry.reasonCategory);
      expect(entry.userAction.trim().length).toBeGreaterThan(0);
      expect(entry.messageKey.trim().length).toBeGreaterThan(0);
      expect(entry.testId.trim().length).toBeGreaterThan(0);
      if (entry.reasonCategory !== 'product-parity') {
        expect(entry.reason.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('绑定 lifecycle/shareability/collaboration/readiness/runtime/result 关键项与独立错误', () => {
    const byCode = new Map(ARENA_GATE_CAPABILITY_REGISTRY.map((entry) => [entry.code, entry]));
    for (const code of [
      'ROOM_MEMBER_LIMIT',
      'ROOM_LEAVE_MEMBERSHIP_REQUIRED',
      'ROOM_CONFIG_COMBATANT_LIMIT',
      'ROOM_CONFIG_REFERENCE_LIMIT',
      'ROOM_CONFIG_FRAME_LIMIT',
      'ROOM_CONFIG_PUBLISH_FENCE',
      'PROPOSAL_PENDING_LIMIT',
      'PROPOSAL_ACTION_AUTHORITY',
      'COLLABORATION_PRODUCT_TERMINOLOGY',
      'GENERATION_COMBATANTS_EMPTY',
      'GENERATION_COMBATANTS_INSUFFICIENT',
      'GENERATION_SCENARIO_REQUIRED',
      'GENERATION_COMBATANT_LIMIT',
      'RUNTIME_REFERENCE_LIMIT',
      'RUNTIME_PROMPT_BUDGET',
      'RUNTIME_OUTPUT_LIMIT',
      'RESULT_HOST_WRITE_AUTHORITY',
    ]) expect(byCode.has(code), code).toBe(true);
    expect(byCode.get('ROOM_MEMBER_LIMIT')?.layer).toBe('room-lifecycle');
    expect(byCode.get('PROPOSAL_PENDING_LIMIT')?.layer).toBe('collaboration');
    expect(byCode.get('ROOM_MEMBER_LIMIT')?.messageKey)
      .not.toBe(byCode.get('PROPOSAL_PENDING_LIMIT')?.messageKey);
  });

  it('canonical limits、默认继承与叙事历史本地正文/共享设置语义可被回归约束', () => {
    const byCode = new Map(ARENA_GATE_CAPABILITY_REGISTRY.map((entry) => [entry.code, entry]));
    expect(byCode.get('ROOM_CONFIG_COMBATANT_LIMIT')?.canonicalValue)
      .toBe(ARENA_CANONICAL_CAPABILITIES.maxCombatants);
    expect(byCode.get('RUNTIME_COMBATANT_LIMIT')?.canonicalValue)
      .toBe(ARENA_CANONICAL_CAPABILITIES.maxCombatants);
    expect(byCode.get('ROOM_CONFIG_REFERENCE_LIMIT')?.canonicalValue)
      .toBe(ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity);
    expect(byCode.get('RUNTIME_REFERENCE_LIMIT')?.canonicalValue)
      .toBe(ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity);
    expect(byCode.get('ARENA_DEFAULTS_INHERIT_SINGLE')?.singleEquivalent).toMatch(/默认值.*输入范围/u);
    expect(byCode.get('NARRATIVE_HISTORY_SETTINGS_PARITY')?.singleEquivalent)
      .toMatch(/read\/write.*limit\/unlimited/u);
    expect(byCode.get('NARRATIVE_HISTORY_BODY_LOCAL')?.reasonCategory).toBe('security/privacy');
    expect(byCode.get('NARRATIVE_HISTORY_BODY_LOCAL')?.reason).toMatch(/正文.*本地|本地.*正文/u);
    expect(ARENA_PRODUCT_PARITY_COVERAGE.generationRequest.narrativeHistory).toMatchObject({
      classification: 'local-only',
      roomHost: 'host-only',
      roomProposal: 'forbidden',
    });
    expect(ARENA_PRODUCT_PARITY_COVERAGE.arenaUi.narrativeHistoryResultWrite).toMatchObject({
      single: 'local-only',
      roomHost: 'host-only',
      roomProposal: 'forbidden',
    });
  });

  it('每个 deferred-with-reason 都声明可验证的 nextCondition', () => {
    const groups = [
      ARENA_PRODUCT_PARITY_COVERAGE.generationRequest,
      ARENA_PRODUCT_PARITY_COVERAGE.roomSharedConfig,
      ARENA_PRODUCT_PARITY_COVERAGE.proposalChanges,
      ARENA_PRODUCT_PARITY_COVERAGE.arenaUi,
    ];
    for (const entry of groups.flatMap((group) => Object.values(group))) {
      if (entry.classification === 'deferred-with-reason') {
        expect(entry.reason?.trim().length).toBeGreaterThan(0);
        expect(entry.nextCondition?.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
