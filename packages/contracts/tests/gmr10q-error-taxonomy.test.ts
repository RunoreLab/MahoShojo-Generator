import { describe, expect, it } from 'vitest';

import {
  ARENA_ROOM_ERROR_TAXONOMY,
  ARENA_ROOM_ERROR_TAXONOMY_HEADER,
  ARENA_ROOM_ERROR_TAXONOMY_VERSION,
  ARENA_ROOM_HOSTED_ERROR_CODES,
  ARENA_ROOM_HTTP_ERROR_CODES,
  evaluateArenaBasicGenerationReadiness,
} from '../src/arena-room';

describe('GMR-10Q canonical Arena error taxonomy', () => {
  it('[GMR10Q-CONTRACT-TAXONOMY] 协商版本与 HTTP code 是可枚举的稳定 contract', () => {
    expect(ARENA_ROOM_ERROR_TAXONOMY_HEADER).toBe('x-mahoshojo-arena-error-taxonomy');
    expect(ARENA_ROOM_ERROR_TAXONOMY_VERSION).toBe('2');
    expect(ARENA_ROOM_HTTP_ERROR_CODES).toEqual([
      'ROOM_AUTHENTICATION_REQUIRED',
      'ROOM_AUTHENTICATION_DENIED',
      'ROOM_FORBIDDEN',
      'ROOM_NOT_FOUND',
      'ROOM_PAYLOAD_TOO_LARGE',
      'ROOM_REQUEST_INVALID',
      'ROOM_CONFLICT',
      'ROOM_RATE_LIMITED',
      'ROOM_UNAVAILABLE',
      'ROOM_GENERATION_COMBATANTS_EMPTY',
      'ROOM_GENERATION_COMBATANTS_INSUFFICIENT',
      'ROOM_GENERATION_SCENARIO_REQUIRED',
      'ROOM_GENERATION_COMBATANT_LIMIT',
      'ROOM_GENERATION_RANDOM_COMBATANT_UNRESOLVED',
      'ROOM_GENERATION_RECONCILIATION_REQUIRED',
      'ROOM_MEMBER_LIMIT_REACHED',
      'ROOM_PROPOSAL_PENDING_LIMIT_REACHED',
      'ROOM_PROPOSAL_CHANGE_LIMIT',
      'ROOM_PROPOSAL_BYTE_LIMIT',
      'ROOM_CONFIG_FRAME_TOO_LARGE',
      'ROOM_CONFIG_SHAREABILITY_INVALID',
      'ROOM_CONFIG_COMBATANT_LIMIT',
      'ROOM_CONFIG_REFERENCE_LIMIT',
      'ROOM_HOST_LOCAL_PAYLOAD_MISSING',
      'ROOM_HOST_LOCAL_PAYLOAD_INVALID',
      'ROOM_HOST_LOCAL_KIND_MISMATCH',
      'ROOM_HOST_LOCAL_DIGEST_MISMATCH',
      'ROOM_HOST_LOCAL_TYPE_MISMATCH',
      'ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING',
      'ROOM_HOST_LOCAL_CONTENT_VERSION_MISMATCH',
      'ROOM_REFERENCE_VERSION_MISSING',
      'ROOM_REFERENCE_STALE',
      'ROOM_REFERENCE_DENIED',
      'ROOM_RUNTIME_BODY_LIMIT',
      'ROOM_RUNTIME_REFERENCE_LIMIT',
      'ROOM_RUNTIME_ADJUDICATION_LIMIT',
      'ROOM_RUNTIME_PROMPT_BUDGET_EXCEEDED',
      'ROOM_PROVIDER_CONFIG_INVALID',
    ]);
    expect(ARENA_ROOM_HTTP_ERROR_CODES).not.toContain(
      'ROOM_HOST_LOCAL_PAYLOAD_MISSING_OR_MISMATCH',
    );
  });

  it('显式映射 domain code、公开 HTTP code 与 Hosted runtime code', () => {
    const mapping = Object.fromEntries(ARENA_ROOM_ERROR_TAXONOMY.map((entry) => [
      entry.domainCode,
      { httpCode: entry.httpCode, hostedCodes: entry.hostedCodes },
    ]));

    expect(mapping).toMatchObject({
      GENERATION_COMBATANT_LIMIT: {
        httpCode: 'ROOM_GENERATION_COMBATANT_LIMIT',
        hostedCodes: ['ARENA_PARTICIPANTS_LIMIT'],
      },
      CONFIG_COMBATANT_LIMIT: {
        httpCode: 'ROOM_CONFIG_COMBATANT_LIMIT',
        hostedCodes: [],
      },
      CONFIG_REFERENCE_LIMIT: {
        httpCode: 'ROOM_CONFIG_REFERENCE_LIMIT',
        hostedCodes: [],
      },
      HOST_LOCAL_PAYLOAD_MISSING: {
        httpCode: 'ROOM_HOST_LOCAL_PAYLOAD_MISSING',
        hostedCodes: [],
      },
      HOST_LOCAL_PAYLOAD_INVALID: {
        httpCode: 'ROOM_HOST_LOCAL_PAYLOAD_INVALID',
        hostedCodes: [],
      },
      HOST_LOCAL_KIND_MISMATCH: {
        httpCode: 'ROOM_HOST_LOCAL_KIND_MISMATCH',
        hostedCodes: [],
      },
      HOST_LOCAL_DIGEST_MISMATCH: {
        httpCode: 'ROOM_HOST_LOCAL_DIGEST_MISMATCH',
        hostedCodes: [],
      },
      HOST_LOCAL_TYPE_MISMATCH: {
        httpCode: 'ROOM_HOST_LOCAL_TYPE_MISMATCH',
        hostedCodes: [],
      },
      REFERENCE_VERSION_MISSING: {
        httpCode: 'ROOM_REFERENCE_VERSION_MISSING',
        hostedCodes: [],
      },
      RUNTIME_BODY_LIMIT: {
        httpCode: 'ROOM_RUNTIME_BODY_LIMIT',
        hostedCodes: ['ARENA_REQUEST_TOO_LARGE'],
      },
      RUNTIME_REFERENCE_LIMIT: {
        httpCode: 'ROOM_RUNTIME_REFERENCE_LIMIT',
        hostedCodes: ['ARENA_REFERENCE_ITEMS_LIMIT'],
      },
      RUNTIME_ADJUDICATION_LIMIT: {
        httpCode: 'ROOM_RUNTIME_ADJUDICATION_LIMIT',
        hostedCodes: ['ARENA_ADJUDICATION_EVENTS_LIMIT'],
      },
      RUNTIME_PROMPT_BUDGET_EXCEEDED: {
        httpCode: 'ROOM_RUNTIME_PROMPT_BUDGET_EXCEEDED',
        hostedCodes: [
          'ARENA_PROMPT_BUDGET_EXCEEDED',
          'ARENA_SAFETY_PROMPT_BUDGET_EXCEEDED',
        ],
      },
      PROVIDER_CONFIG_INVALID: {
        httpCode: 'ROOM_PROVIDER_CONFIG_INVALID',
        hostedCodes: [
          'ARENA_CUSTOM_PROVIDER_INVALID',
          'ARENA_PROVIDER_UNKNOWN',
          'ARENA_PROVIDER_KEY_EMPTY',
        ],
      },
    });
    expect(new Set(ARENA_ROOM_ERROR_TAXONOMY.map((entry) => entry.domainCode)).size)
      .toBe(ARENA_ROOM_ERROR_TAXONOMY.length);
    expect([...new Set(ARENA_ROOM_ERROR_TAXONOMY.map((entry) => entry.httpCode))].sort())
      .toEqual([...ARENA_ROOM_HTTP_ERROR_CODES].sort());
    expect([...ARENA_ROOM_HOSTED_ERROR_CODES].sort()).toEqual([
      'ARENA_ADJUDICATION_EVENTS_LIMIT',
      'ARENA_CUSTOM_PROVIDER_INVALID',
      'ARENA_PARTICIPANTS_LIMIT',
      'ARENA_PROMPT_BUDGET_EXCEEDED',
      'ARENA_PROVIDER_KEY_EMPTY',
      'ARENA_PROVIDER_UNKNOWN',
      'ARENA_REFERENCE_ITEMS_LIMIT',
      'ARENA_REQUEST_TOO_LARGE',
      'ARENA_SAFETY_PROMPT_BUDGET_EXCEEDED',
    ]);
  });

  it('[GMR10Q-CONTRACT-MODE-MINIMUM] dependency-neutral evaluator 统一单人/多人最低生成条件', () => {
    expect(evaluateArenaBasicGenerationReadiness({
      battleMode: 'classic', combatantCount: 1, hasScenario: false,
    })).toEqual([{ code: 'GENERATION_COMBATANTS_INSUFFICIENT', current: 1, required: 2 }]);
    expect(evaluateArenaBasicGenerationReadiness({
      battleMode: 'daily', combatantCount: 1, hasScenario: false,
    })).toEqual([]);
    expect(evaluateArenaBasicGenerationReadiness({
      battleMode: 'scenario', combatantCount: 1, hasScenario: false,
    })).toEqual([{ code: 'GENERATION_SCENARIO_REQUIRED' }]);
  });
});
