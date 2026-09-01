import {
  ARENA_CANONICAL_CAPABILITIES,
  ARENA_ROOM_ERROR_TAXONOMY,
  ARENA_ROOM_HTTP_ERROR_CODES,
  ARENA_RUNTIME_RESOURCE_BUDGET_KEYS,
  ArenaRoomSharedConfigSchema,
  evaluateArenaBasicGenerationReadiness,
} from '@mahoshojo/contracts/arena-room';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ARENA_GATE_CAPABILITY_REGISTRY,
  ARENA_GATE_DOMAIN_HTTP_CODE_MAP,
  ARENA_GATE_SOURCE_CATEGORIES,
  ARENA_GATE_SOURCE_INVENTORY,
  ARENA_GATE_TEST_EVIDENCE,
  ARENA_GATE_WORKFLOW_CAPABILITY_REGISTRY,
  ARENA_GENERATION_READINESS_ISSUE_CODES,
  ARENA_GENERATION_REQUEST_SEMANTIC_KEYS,
  ARENA_PRODUCT_PARITY_SEMANTIC_KEYS,
  ARENA_PRODUCT_PARITY_COVERAGE,
  ARENA_ROOM_TRANSITION_FAILURE_REASONS,
  ARENA_STATE_MACHINE_FAILURE_REASON_REGISTRY,
  evaluateArenaGenerationReadiness,
} from '../src/index';
import { baseConfig } from './state-machine-fixtures';

describe('GMR-10Q generation readiness', () => {
  it('[GMR10Q-READINESS] 共享 schema 接受空 roster，但 readiness 返回稳定且可行动的结构化 issue', () => {
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
    expect(evaluateArenaBasicGenerationReadiness({
      battleMode: 'classic', combatantCount: 1, hasScenario: false,
    })).toEqual([{ code: 'GENERATION_COMBATANTS_INSUFFICIENT', current: 1, required: 2 }]);
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
      if (entry.reasonCategory === 'explicit-product-non-goal') {
        expect(entry.nextCondition?.trim().length).toBeGreaterThan(0);
      }
      expect(entry.currentUserMessage ?? '').not.toMatch(
        /无法安全共享|Proposal|typed diff|\bBASE\b|\bCURRENT\b|\bPROPOSED\b/u,
      );
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
      'ROOM_CONFIG_APPLY_VALIDATION',
      'PROPOSAL_PENDING_LIMIT',
      'PROPOSAL_HISTORY_BOUND',
      'PROPOSAL_ACTION_AUTHORITY',
      'PROPOSAL_STATE_FENCE',
      'COLLABORATION_PRODUCT_TERMINOLOGY',
      'GENERATION_COMBATANTS_EMPTY',
      'GENERATION_COMBATANTS_INSUFFICIENT',
      'GENERATION_SCENARIO_REQUIRED',
      'GENERATION_COMBATANT_LIMIT',
      'RUNTIME_REFERENCE_LIMIT',
      'RUNTIME_PROMPT_BUDGET',
      'RUNTIME_OUTPUT_LIMIT',
      'RESULT_HOST_WRITE_AUTHORITY',
      'RESULT_PRIVATE_WRITE_ACTIONS_DEFERRED',
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
    for (const entry of ARENA_GATE_CAPABILITY_REGISTRY) {
      if (entry.reasonCategory === 'explicit-product-non-goal') {
        expect(entry.reason.trim().length).toBeGreaterThan(0);
        expect(entry.nextCondition?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('[GMR10Q-CANONICAL-INVENTORY] 对真实 source inventory 做精确集合比对', () => {
    expect([...ARENA_GATE_SOURCE_INVENTORY.stateMachineFailureReasons].sort())
      .toEqual([...ARENA_ROOM_TRANSITION_FAILURE_REASONS].sort());
    expect(ARENA_STATE_MACHINE_FAILURE_REASON_REGISTRY.map((entry) => entry.reason).sort())
      .toEqual([...ARENA_ROOM_TRANSITION_FAILURE_REASONS].sort());
    expect(new Set(ARENA_STATE_MACHINE_FAILURE_REASON_REGISTRY.map((entry) => entry.reason)).size)
      .toBe(ARENA_ROOM_TRANSITION_FAILURE_REASONS.length);
    expect([...ARENA_GATE_SOURCE_INVENTORY.roomHttpErrorCodes].sort())
      .toEqual([...ARENA_ROOM_HTTP_ERROR_CODES].sort());
    expect([...ARENA_GATE_SOURCE_INVENTORY.generationReadinessIssueCodes].sort())
      .toEqual([...ARENA_GENERATION_READINESS_ISSUE_CODES].sort());
    expect([...ARENA_GATE_SOURCE_INVENTORY.runtimeResourceBudgetKeys].sort())
      .toEqual([...ARENA_RUNTIME_RESOURCE_BUDGET_KEYS].sort());
    expect([...ARENA_GATE_SOURCE_INVENTORY.productParitySemanticKeys].sort())
      .toEqual(Object.entries(ARENA_PRODUCT_PARITY_SEMANTIC_KEYS)
        .flatMap(([group, keys]) => keys.map((key) => `${group}:${key}`))
        .sort());
    expect(Object.keys(ARENA_PRODUCT_PARITY_COVERAGE.generationRequest).sort())
      .toEqual([...ARENA_GENERATION_REQUEST_SEMANTIC_KEYS].sort());
    for (const group of ['roomSharedConfig', 'proposalChanges', 'arenaUi'] as const) {
      expect(Object.keys(ARENA_PRODUCT_PARITY_COVERAGE[group]).sort())
        .toEqual([...ARENA_PRODUCT_PARITY_SEMANTIC_KEYS[group]].sort());
    }
    expect(ARENA_GATE_SOURCE_CATEGORIES.map((entry) => entry.category).sort()).toEqual([
      'generation-readiness-code',
      'product-parity-semantic-key',
      'room-http-error-code',
      'runtime-resource-budget-key',
      'state-machine-failure-reason',
    ]);
    for (const source of ARENA_GATE_SOURCE_CATEGORIES) {
      expect(source.currentSource.length).toBeGreaterThan(0);
      expect(source.classifiedItems.length).toBeGreaterThan(0);
    }
  });

  it('[GMR10Q-PRODUCER-BINDING] inventory 每一项都绑定实际 producer source，而非仅在登记表中自证', () => {
    const repositoryRoot = resolve(process.cwd(), '../..');
    for (const category of ARENA_GATE_SOURCE_CATEGORIES) {
      const source = readFileSync(resolve(repositoryRoot, category.currentSource), 'utf8');
      for (const item of category.classifiedItems) {
        const sourceToken = category.category === 'product-parity-semantic-key'
          ? item.slice(item.indexOf(':') + 1)
          : item;
        expect(source, `${category.currentSource} -> ${item}`).toContain(sourceToken);
      }
    }
  });

  it('domain error 显式映射公开 HTTP code，且 mapping 与 canonical taxonomy 一致', () => {
    expect(ARENA_GATE_DOMAIN_HTTP_CODE_MAP).toEqual(Object.fromEntries(
      ARENA_ROOM_ERROR_TAXONOMY.map(({ domainCode, httpCode, hostedCodes }) => [
        domainCode,
        { httpCode, hostedCodes },
      ]),
    ));
  });

  it('create 到 result/Web/contract 的关键 workflow capability 均被 registry 分类', () => {
    expect(ARENA_GATE_WORKFLOW_CAPABILITY_REGISTRY.map((entry) => entry.capability).sort())
      .toEqual([
        'contracts-limits',
        'contracts-schemas',
        'generation-host-local',
        'generation-readiness',
        'generation-reconciliation',
        'generation-reference',
        'proposal-atomic-apply',
        'proposal-byte-limit',
        'proposal-change-limit',
        'proposal-depends-on',
        'proposal-history-limit',
        'proposal-pending-limit',
        'proposal-precondition',
        'proposal-resolve',
        'proposal-submit',
        'proposal-withdraw',
        'result-narrative-history-write',
        'result-presentation',
        'result-private-write-actions-deferred',
        'result-save-image',
        'room-close',
        'room-create',
        'room-join',
        'room-kick',
        'room-leave',
        'room-presence',
        'room-recovery',
        'runtime-body',
        'runtime-funding',
        'runtime-output',
        'runtime-provider',
        'runtime-single-producer',
        'runtime-token',
        'shared-config-apply',
        'shared-config-build',
        'shared-config-publish',
        'web-local-validation',
      ]);
    const gateCodes = new Set(ARENA_GATE_CAPABILITY_REGISTRY.map((entry) => entry.code));
    for (const entry of ARENA_GATE_WORKFLOW_CAPABILITY_REGISTRY) {
      expect(gateCodes.has(entry.gateCode), `${entry.capability} -> ${entry.gateCode}`).toBe(true);
      expect(ARENA_GATE_TEST_EVIDENCE).toContain(entry.testId);
    }
    const workflowByCapability = new Map(
      ARENA_GATE_WORKFLOW_CAPABILITY_REGISTRY.map((entry) => [entry.capability, entry]),
    );
    expect(workflowByCapability.get('proposal-history-limit')).toMatchObject({
      gateCode: 'PROPOSAL_HISTORY_BOUND',
      testId: expect.stringContaining('removes terminal Proposals'),
    });
    expect(workflowByCapability.get('shared-config-publish')).toMatchObject({
      gateCode: 'ROOM_CONFIG_PUBLISH_FENCE',
      testId: expect.stringContaining('publishes only semantic config changes'),
    });
    expect(workflowByCapability.get('shared-config-apply')).toMatchObject({
      gateCode: 'ROOM_CONFIG_APPLY_VALIDATION',
      testId: expect.stringContaining('materialize 到 host BattleStore'),
    });
    expect(workflowByCapability.get('result-save-image')).toMatchObject({
      gateCode: 'RESULT_PRESENTATION_PARITY',
      testId: expect.stringContaining('保存图片动作'),
    });
    expect(workflowByCapability.get('runtime-provider')).toMatchObject({
      gateCode: 'RUNTIME_PROVIDER_CONFIG',
      testId: expect.stringContaining('definitive downstream rejection'),
    });
    expect(workflowByCapability.get('runtime-funding')).toMatchObject({
      gateCode: 'RUNTIME_PROMPT_BUDGET',
      testId: expect.stringContaining('system prompt budget'),
    });
    expect(workflowByCapability.get('runtime-token')).toMatchObject({
      gateCode: 'RUNTIME_PROMPT_BUDGET',
      testId: expect.stringContaining('system prompt budget'),
    });
    expect(workflowByCapability.get('runtime-output')).toMatchObject({
      gateCode: 'RUNTIME_OUTPUT_LIMIT',
      testId: expect.stringContaining('combined reasoning and markdown'),
    });
    for (const entry of ARENA_STATE_MACHINE_FAILURE_REASON_REGISTRY) {
      expect(gateCodes.has(entry.gateCode), `${entry.reason} -> ${entry.gateCode}`).toBe(true);
      expect(ARENA_GATE_TEST_EVIDENCE).toContain(entry.testId);
    }
    const failureGateByReason = new Map(
      ARENA_STATE_MACHINE_FAILURE_REASON_REGISTRY.map((entry) => [entry.reason, entry.gateCode]),
    );
    expect(failureGateByReason.get('proposal-pending-limit-reached')).toBe('PROPOSAL_PENDING_LIMIT');
    expect(failureGateByReason.get('proposal-not-found')).toBe('PROPOSAL_STATE_FENCE');
    expect(failureGateByReason.get('proposal-author-required')).toBe('PROPOSAL_ACTION_AUTHORITY');
    expect(failureGateByReason.get('proposal-selection-invalid')).toBe('PROPOSAL_REVISION_CONFLICT');
  });

  it('所有 testId 都绑定仓库中真实执行的 it/test case，而不是注释 marker', () => {
    const repositoryRoot = resolve(process.cwd(), '../..');
    const evidence = new Set([
      ...ARENA_GATE_TEST_EVIDENCE,
      ...ARENA_GATE_CAPABILITY_REGISTRY.map((entry) => entry.testId),
      ...ARENA_GATE_WORKFLOW_CAPABILITY_REGISTRY.map((entry) => entry.testId),
      ...ARENA_STATE_MACHINE_FAILURE_REASON_REGISTRY.map((entry) => entry.testId),
    ]);
    for (const testId of evidence) {
      const [relativeFile, marker] = testId.split('::');
      expect(relativeFile, testId).toMatch(/\.test\.tsx?$/u);
      expect(marker?.length, testId).toBeGreaterThan(0);
      const source = readFileSync(resolve(repositoryRoot, relativeFile!), 'utf8');
      expect([
        `it('${marker}'`,
        `it("${marker}"`,
        `test('${marker}'`,
        `test("${marker}"`,
        `)('${marker}'`,
        `)("${marker}"`,
      ].some((definition) => source.includes(definition)), testId).toBe(true);
    }
  });
});
