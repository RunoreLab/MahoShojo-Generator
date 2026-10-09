import fixture from '../fixtures/arena-direct-execution.json';
import { AiExecutionRequestSchema, AiExecutionResultSchema, ArenaAiExecutionResultSchema, aiOutputContentBytes,
  ARENA_AI_MAX_WIRE_BYTES, ARENA_AI_WIRE_METADATA_BYTES, MAX_AI_EXECUTION_RESULT_BYTES, validateArenaAiInputJson } from '../src/ai-execution';
import { ARENA_CANONICAL_CAPABILITIES, ARENA_CANONICAL_RESOURCE_LIMITS } from '../src/arena-capabilities';

const terminal = fixture.events.at(-1)!.result!;
const source = (mode = 'daily', count = 1, rest = {}) => JSON.stringify({ mode, combatants: Array.from({ length: count }, () => ({})), ...rest });

describe('Arena Direct fixed resource contract', () => {
  it('round trips the request and terminal without adding budgets or credentials', () => {
    expect(AiExecutionRequestSchema.parse(fixture.request)).toEqual(fixture.request);
    expect(ArenaAiExecutionResultSchema.parse(terminal)).toEqual(terminal);
    expect(ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes).toBe(fixture.measurements.inputSourceUtf8Bytes);
    expect(ARENA_CANONICAL_RESOURCE_LIMITS.outputContentBytes).toBe(fixture.measurements.outputTextAndReasoningUtf8Bytes);
    expect(ARENA_AI_MAX_WIRE_BYTES).toBe(fixture.measurements.wireMaxBytes);
    expect(ARENA_AI_WIRE_METADATA_BYTES).toBe(fixture.measurements.wireMetadataBytes);
    expect(MAX_AI_EXECUTION_RESULT_BYTES).toBe(fixture.measurements.legacyResultJsonUtf8Bytes);
  });
  it.each(fixture.contentBoundaries)('$name measures content rather than escaped result JSON', ({character, repeat, suffix, accepted}) => {
    const text = character.repeat(repeat) + suffix;
    const result = { ...terminal, output: { text } };
    expect(ArenaAiExecutionResultSchema.safeParse(result).success).toBe(accepted);
    expect(AiExecutionResultSchema.safeParse(result).success).toBe(false);
  });
  it('counts reasoning together with text and forbids structured output bypass', () => {
    const text = 'x'.repeat(ARENA_CANONICAL_RESOURCE_LIMITS.outputContentBytes - 3);
    expect(aiOutputContentBytes({ text, reasoning: '中' })).toBe(4194304);
    expect(ArenaAiExecutionResultSchema.safeParse({ ...terminal, output: { text, reasoning: '中' } }).success).toBe(true);
    expect(ArenaAiExecutionResultSchema.safeParse({ ...terminal, output: { text, reasoning: '中文' } }).success).toBe(false);
    expect(ArenaAiExecutionResultSchema.safeParse({ ...terminal, output: { text: 'x', structured: {} } }).success).toBe(false);
  });
  it('checks exactly the original UTF8 source budget, not formatted messages', () => {
    const base = source('daily', 1, { padding: '' });
    const at = base.replace('"padding":""', `"padding":"${'x'.repeat(12582912 - base.length)}"`);
    expect(validateArenaAiInputJson(at)).toBe(true);
    expect(validateArenaAiInputJson(at + ' ')).toBe(false);
    // Evidence is explicitly not a claim of prompt equivalence or authority.
    expect(AiExecutionRequestSchema.safeParse({ ...fixture.request, messages: [{ role: 'user', content: 'x'.repeat(12582913) }] }).success).toBe(true);
  });
  it.each(Object.entries(ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode))('retains %s mode minimum and canonical maximum', (mode, min) => {
    const extra = mode === 'scenario' ? { scenario: {} } : {};
    expect(validateArenaAiInputJson(source(mode, min, extra))).toBe(true);
    expect(validateArenaAiInputJson(source(mode, min - 1, extra))).toBe(false);
    expect(validateArenaAiInputJson(source(mode, 32, extra))).toBe(true);
    expect(validateArenaAiInputJson(source(mode, 33, extra))).toBe(false);
  });
  it('rejects forged kinds/budgets and missing or malformed evidence', () => {
    for (const change of [{ requestKind: 'anything' }, { requestKind: undefined }, { arenaInputJson: undefined },
      { arenaInputJson: '{}' }, { maxOutputBytes: 99999999 }, { mode: 'hosted' }, { endpoint: 'http://evil.test' }]) {
      expect(AiExecutionRequestSchema.safeParse({ ...fixture.request, ...change }).success).toBe(false);
    }
    for (const input of fixture.invalidInputSources) expect(validateArenaAiInputJson(JSON.stringify(input))).toBe(false);
    expect(validateArenaAiInputJson(source('daily', 1, { materials: Array(256).fill({}) }))).toBe(true);
    expect(validateArenaAiInputJson(source('daily', 1, { materials: Array(256).fill({}), questionnaires: [{}] }))).toBe(false);
    expect(validateArenaAiInputJson(source('daily', 1, { adjudicationEvents: Array(100).fill({}) }))).toBe(true);
    expect(validateArenaAiInputJson(source('daily', 1, { adjudicationEvents: Array(101).fill({}) }))).toBe(false);
  });
});
