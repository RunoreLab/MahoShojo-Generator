import {
  ArenaRoomSharedConfigSchema,
  evaluateArenaBasicGenerationReadiness,
} from '@mahoshojo/contracts/arena-room';
import { describe, expect, it } from 'vitest';

import { evaluateArenaGenerationReadiness } from '../src/index';
import { baseConfig } from './state-machine-fixtures';

describe('Arena generation readiness', () => {
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
