import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/arena-companion.json';
import { readFileSync } from 'node:fs';
// Read the wire directly: bundler JSON import parsers may themselves reject lone UTF-16 surrogates.
const utf16 = JSON.parse(readFileSync(new URL('../fixtures/arena-companion-utf16.json', import.meta.url), 'utf8'));
import { ARENA_COMPANION_JSON_LIMITS, ArenaCompanionEnvelopeSchema, ArenaCompanionMetadataSchema, ArenaCompanionModelIdSchema, ArenaCompanionReasoningSchema, ArenaCompanionUsageSchema, parseArenaCompanionEnvelope } from '../src/arena-companion';

describe('complete report-only Arena companion contract', () => {
  it('fixes the source-derived bound and preserves every public JSON value', () => {
    expect(ARENA_COMPANION_JSON_LIMITS).toEqual(fixture.limits);
    for (const value of [...fixture.successEnvelopes, ...fixture.errorEnvelopes]) expect(parseArenaCompanionEnvelope(JSON.stringify(value))).toEqual(value);
    expect(Object.keys(fixture.successEnvelopes[2]!.metadata)).toHaveLength(12);
  });
  it('rejects unsupported extensions instead of silently stripping', () => {
    const value = fixture.successEnvelopes[0]!;
    for (const candidate of [
      { ...value, extra: true }, { ...value, body: { ...value.body, extra: true } },
      { ...value, metadata: { ...value.metadata, extra: true } },
      { ...value, body: { ...value.body, report: { ...value.body.report, extra: true } } },
      { ...value, body: { ...value.body, updatedCombatants: [{ name: 'unrequested card' }] } },
      { ...value, metadata: null }, { ...value, metadata: { ...value.metadata, outputContract: 'stream-markdown' } },
    ]) expect(ArenaCompanionEnvelopeSchema.safeParse(candidate).success).toBe(false);
  });
  it('retains both reasoning shapes and the actual finite floored SDK token domain', () => {
    for (const value of [
      { status: 'complete', text: '\u0001\ud800 reasoning' },
      { status: 'unavailable', source: 'sdk', text: null, summary: null, reasoningTokens: -Number.MAX_VALUE },
      { status: 'done', source: 'sdk', text: 'x'.repeat(12000), summary: 'x'.repeat(80), reasoningTokens: 1e100, anomalyFlags: ['truncated'] },
    ]) expect(ArenaCompanionReasoningSchema.parse(value)).toEqual(value);
    for (const extra of [{ parts: [] }, { anomalyFlags: ['other'] }, { errorMessage: 'unknown' }]) expect(ArenaCompanionReasoningSchema.safeParse({ ...fixture.successEnvelopes[0]!.body.report.aiReasoning, ...extra }).success).toBe(false);
    expect(ArenaCompanionReasoningSchema.safeParse({ status: 'complete', text: '', source: 'sdk' }).success).toBe(false);
    expect(ArenaCompanionReasoningSchema.safeParse({ status: 'done', source: 'sdk', text: 'x'.repeat(12001), summary: '', reasoningTokens: Infinity }).success).toBe(false);
  });
  it('accepts the native token sum but never trims or truncates model metadata', () => {
    expect(ArenaCompanionUsageSchema.parse({ completionTokens: 2 * Number.MAX_SAFE_INTEGER })).toEqual({ completionTokens: 2 * Number.MAX_SAFE_INTEGER });
    expect(ArenaCompanionUsageSchema.safeParse({ completionTokens: 2 * Number.MAX_SAFE_INTEGER + 2 }).success).toBe(false);
    expect(ArenaCompanionUsageSchema.safeParse({ totalTokens: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(ArenaCompanionModelIdSchema.parse('m'.repeat(200))).toBe('m'.repeat(200));
    for (const value of ['m'.repeat(201), ' model', 'model ', 'model\u0001', '']) expect(ArenaCompanionModelIdSchema.safeParse(value).success).toBe(false);
  });
  it('accepts 2100 nodes independently of C1 small metadata', () => {
    const metadata = fixture.successEnvelopes[0]!.metadata;
    expect(ArenaCompanionMetadataSchema.safeParse({ ...metadata, adjudicationResults: Array(2100).fill(metadata.adjudicationResults[0]) }).success).toBe(true);
    expect(ArenaCompanionMetadataSchema.safeParse({ ...metadata, adjudicationResults: Array(2101).fill(metadata.adjudicationResults[0]) }).success).toBe(false);
    expect(ArenaCompanionMetadataSchema.safeParse({ ...metadata, storyLength: 'x'.repeat(65537) }).success).toBe(true);
  });
  it('retains the actual producer UTF-16 slice without surrogate replacement', () => {
    const value = parseArenaCompanionEnvelope(JSON.stringify(utf16));
    expect(value).toEqual(utf16);
    expect(value.metadata!.userGuidance!.charCodeAt(199)).toBe(0xd83d);
    expect(value.metadata!.characterGuidances![0]!.guidance.charCodeAt(99)).toBe(0xd83d);
    expect(JSON.stringify(value)).toContain('\\ud83d');
  });
  it('retains lone surrogates in the existing bounded public error fields', () => {
    const wire = readFileSync(new URL('../fixtures/arena-companion-error-utf16.json', import.meta.url), 'utf8');
    const value = parseArenaCompanionEnvelope(wire);
    expect(value.body).toMatchObject({ error: '失败\ud800', message: '提示\ud800', resultRef: 'r2:\ud800' });
    expect(value.metadata).toBeNull();
    expect(value).toEqual(JSON.parse(wire));
    expect(JSON.stringify(value)).toContain('\\ud800');
  });
  it('rejects truncated wire and mismatched package refs', () => {
    expect(() => parseArenaCompanionEnvelope('{"version":')).toThrow();
    const value = fixture.successEnvelopes[2]!;
    expect(ArenaCompanionEnvelopeSchema.safeParse({ ...value, metadata: { ...value.metadata, webPackageRef: { ...value.metadata.webPackageRef, digest: `sha256:${'d'.repeat(64)}` } } }).success).toBe(false);
  });
});
