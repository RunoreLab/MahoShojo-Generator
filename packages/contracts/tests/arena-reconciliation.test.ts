import { describe, expect, it } from 'vitest';
import {
  ARENA_RECONCILIATION_CAPABILITY,
  ARENA_RECONCILIATION_LIMITS,
  ARENA_RECONCILIATION_PROTOCOL_VERSION,
  ArenaReconciliationCapabilitySchema,
  ArenaReconciliationRequestSchema,
  ArenaReconciliationResponseSchema,
  parseArenaReconciliationResponse,
} from '../src/arena-reconciliation';
import { ARENA_CANONICAL_CAPABILITIES, ARENA_CANONICAL_RESOURCE_LIMITS } from '../src/arena-capabilities';

const generationId = `arena_${'a'.repeat(64)}`;
const success = () => ({
  version: ARENA_RECONCILIATION_PROTOCOL_VERSION,
  generationId,
  success: true,
  updatedCombatants: [{ combatantIndex: 0, data: { name: '角色', nested: [null, { x: true }] }, isNative: false }],
  warnings: [],
});
const issueFixtures = [
  { combatantIndex: 0, code: 'ARENA_RECONCILIATION_COMBATANT_UNMATCHED', message: '未匹配' },
  { rosterIndex: 31, characterName: null, code: 'ARENA_RECONCILIATION_ROSTER_COMBATANT_MISSING', message: '不在当前列表' },
  { characterName: '同名角色', code: 'ARENA_RECONCILIATION_IMPACT_AMBIGUOUS', message: '影响归属不唯一' },
];

describe('Arena reconciliation explicit opt-in wire contract', () => {
  it('capability is exact and does not claim shared deployment data consistency', () => {
    expect(ArenaReconciliationCapabilitySchema.parse(ARENA_RECONCILIATION_CAPABILITY)).toEqual({
      ok: true, contractVersion: 'arena-reconciliation-v1', expectedUserIdAssertion: 'v1',
      ownership: 'generation-actor', effects: 'frozen-manifest-v1',
    });
    expect(ArenaReconciliationCapabilitySchema.safeParse({ ...ARENA_RECONCILIATION_CAPABILITY, databaseConsistent: true }).success).toBe(false);
    expect(ARENA_RECONCILIATION_LIMITS.requestBodyBytes).toBe(ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes);
    expect(ARENA_RECONCILIATION_LIMITS.maxCombatants).toBe(ARENA_CANONICAL_CAPABILITIES.maxCombatants);
    expect(ARENA_RECONCILIATION_LIMITS.responseBodyBytes).toBe(16 * 1024 * 1024);
  });

  it('request keeps open nested JSON data but closes authority and transport fields', () => {
    const card = { type: 'general-character', data: { name: 'A', custom: { signature: 'untrusted', values: [1, null] } } };
    expect(ArenaReconciliationRequestSchema.parse({ generationId, combatants: [card] })).toEqual({ generationId, combatants: [card] });
    for (const extra of [{ isNative: true }, { signature: 'forged' }, { expectedUserId: 42 }, { url: 'https://example.test' }]) {
      expect(ArenaReconciliationRequestSchema.safeParse({ generationId, combatants: [{ ...card, ...extra }] }).success).toBe(false);
    }
    expect(ArenaReconciliationRequestSchema.safeParse({ generationId, combatants: Array.from({ length: 33 }, () => card) }).success).toBe(false);
    expect(ArenaReconciliationRequestSchema.safeParse({ generationId, combatants: [card], writeArenaHistory: true }).success).toBe(false);
  });

  it('accepts all existing warning/error shapes without inventing name or text limits', () => {
    const body = { ...success(), warnings: issueFixtures };
    expect(parseArenaReconciliationResponse(JSON.stringify(body), generationId, 1)).toEqual(body);
    const error = {
      version: ARENA_RECONCILIATION_PROTOCOL_VERSION, generationId,
      code: 'ARENA_RECONCILIATION_ROSTER_MISMATCH', error: '无法匹配', errors: issueFixtures,
    };
    expect(parseArenaReconciliationResponse(JSON.stringify(error), generationId, 1)).toEqual(error);
    expect(parseArenaReconciliationResponse(JSON.stringify({ ...error, generationId: undefined }), generationId, 1)).not.toHaveProperty('generationId');
    expect(ArenaReconciliationResponseSchema.safeParse({ ...error, errors: null }).success).toBe(false);
  });

  it('checks complete response identity, strict shapes and duplicate/invalid update indexes', () => {
    const valid = success();
    const invalid = [
      { ...valid, version: 'arena-reconciliation-v2' },
      { ...valid, generationId: 'another-generation' },
      { ...valid, unexpected: true },
      { ...valid, updatedCombatants: [valid.updatedCombatants[0], valid.updatedCombatants[0]] },
      ...[-1, 0.5, 1, 32].map((combatantIndex) => ({ ...valid, updatedCombatants: [{ ...valid.updatedCombatants[0], combatantIndex }] })),
      { ...valid, updatedCombatants: [{ combatantIndex: 0, data: [], isNative: true }] },
      { ...valid, updatedCombatants: [{ combatantIndex: 0, data: {}, isNative: 'true' }] },
      ...[undefined, null, '', '  ', 42].map((signature) => ({
        ...valid, updatedCombatants: [{ combatantIndex: 0, data: { signature }, isNative: true }],
      })),
      { ...valid, warnings: [{ ...issueFixtures[0], combatantIndex: 1 }] },
      { ...valid, warnings: [{ ...issueFixtures[1], extra: 'not allowed' }] },
    ];
    for (const body of invalid) {
      expect(() => parseArenaReconciliationResponse(JSON.stringify(body), generationId, 1)).toThrow();
    }
    for (const count of [0, 33, 1.5, Number.NaN]) {
      expect(() => parseArenaReconciliationResponse(JSON.stringify(valid), generationId, count)).toThrow('INVALID_CONTEXT');
    }
  });

  it('applies an inclusive raw UTF-8 response budget before parsing, never truncating', () => {
    const body = success();
    const wire = JSON.stringify(body);
    const room = ARENA_RECONCILIATION_LIMITS.responseBodyBytes - new TextEncoder().encode(wire).byteLength;
    expect(parseArenaReconciliationResponse(wire + ' '.repeat(room), generationId, 1)).toEqual(body);
    expect(() => parseArenaReconciliationResponse(wire + ' '.repeat(room) + '界', generationId, 1)).toThrow('RESPONSE_TOO_LARGE');
  });
});
