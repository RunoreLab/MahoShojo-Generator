import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { ARENA_COMPANION_JSON_LIMITS, ArenaCompanionEnvelopeSchema, parseArenaCompanionEnvelope } from '@mahoshojo/contracts/arena-companion';
import { ARENA_COMPANION_CAPACITY_RECIPES, arenaCompanionCapacityFixture, runArenaCompanionCapacityFixture } from './fixtures/arena-companion-capacity';
const fixture = JSON.parse(readFileSync(new URL('../../contracts/fixtures/arena-companion.json', import.meta.url), 'utf8'));

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
describe('Arena companion source-bound fixed allowance', () => {
  it('retains the twenty independently measured compact recipes without binary artifacts', () => {
    expect(ARENA_COMPANION_CAPACITY_RECIPES).toHaveLength(20);
    expect(new Set(ARENA_COMPANION_CAPACITY_RECIPES).size).toBe(20);
    expect(ARENA_COMPANION_JSON_LIMITS.wireBytes).toBe(12 * 4194304 + 2 * 12582912 + 2 * 2100 * 256 + 6 * (12000 + 80 + 200) + 65536);
  });
  it('proves the final success/error/diagnostic skeletons fit the unchanged 64KiB allowance', () => {
    const source = readFileSync(new URL('../src/arena-generation/prompt.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('prompt.ts', source, ts.ScriptTarget.Latest, true);
    const literals = new Map<string, any[]>();
    const literal = (node: ts.Expression): any => {
      if (ts.isAsExpression(node)) return literal(node.expression);
      if (ts.isArrayLiteralExpression(node)) return node.elements.map(value => literal(value));
      if (ts.isStringLiteral(node)) return node.text;
      throw new Error('Reporter catalog must remain a static string array');
    };
    for (const statement of ast.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && ['JOURNALISTS', 'PUBLICATIONS'].includes(declaration.name.text)) literals.set(declaration.name.text, literal(declaration.initializer!));
    }
    const variants = literals.get('JOURNALISTS')!.flatMap(([name, publication]: string[]) => publication ? [{ name, publication }] : literals.get('PUBLICATIONS')!.map(publication => ({ name, publication })));
    variants.push({ name: '佚名', publication: '魔法国度时报' });
    expect(variants).toHaveLength(157);
    const reporterInfo = variants.reduce((a, b) => bytes(a) > bytes(b) ? a : b);
    expect(bytes(reporterInfo)).toBe(124);
    const packageRef = { id: 'x'.repeat(128), version: 'v'.repeat(128), digest: `sha256:${'0'.repeat(64)}` };
    const webPackage = { packageRef, targetPath: '\ud800'.repeat(512), targetMediaType: 'application/javascript', generatedDigest: `sha256:${'f'.repeat(64)}` };
    const characterGuidances = Array.from({ length: 32 }, () => ({ characterName: '', guidance: '' }));
    const aiUsage = { promptTokens: Number.MAX_SAFE_INTEGER, completionTokens: 2 * Number.MAX_SAFE_INTEGER, totalTokens: Number.MAX_SAFE_INTEGER, cachedTokens: Number.MAX_SAFE_INTEGER, reasoningTokens: Number.MAX_SAFE_INTEGER, textTokens: Number.MAX_SAFE_INTEGER, completionTokensIncludesReasoning: false };
    const generationId = `arena_${'0'.repeat(64)}`;
    const success = { version: 'arena-companion-v1', body: { report: { reportFormat: 'web', webPackage, headline: '', reporterInfo, article: { body: '', analysis: '' }, officialReport: { winner: '', conclusion: '' }, mode: 'scenario', userGuidance: '', characterGuidances, aiUsage, aiModel: 'm', narrativeHistoryReadCount: 256, aiReasoning: { status: 'unavailable', source: 'sdk', summary: null, text: null, reasoningTokens: -Number.MAX_VALUE, anomalyFlags: ['truncated'] } }, updatedCombatants: [], generationId, adjudicationResults: [], impacts: [] }, metadata: { reportFormat: 'web', webPackageRef: packageRef, mode: 'scenario', scenarioDisplayName: '', language: '', storyLength: '', outputContract: 'web-package-target', reporterInfo, userGuidance: '', characterGuidances, adjudicationResults: [], narrativeHistoryReadCount: 256 } };
    const error = { version: 'arena-companion-v1', body: { code: 'E'.repeat(128), error: '\u0001'.repeat(2048), message: '\u0001'.repeat(2048), generationId, generationRequestId: 'r'.repeat(128), status: 'finalizing', cancelled: false, resumable: false, lastEventId: '9'.repeat(126) + '-0', updatedAt: '2026-10-10T00:00:00.000Z', resultRef: '\u0001'.repeat(2048), finalAuthoritative: false, resultAvailable: false, replayUnavailable: false, persistenceWarning: 'PERSISTENCE_UNAVAILABLE', contentRetention: 'expired' }, metadata: null };
    expect(ArenaCompanionEnvelopeSchema.safeParse(success).success).toBe(true);
    expect(ArenaCompanionEnvelopeSchema.safeParse(error).success).toBe(true);
    const diagnostic = { version: 'arena-companion-v1', body: { code: 'ARENA_COMPANION_PROTOCOL_UNSUPPORTED', error: 'Arena companion delivery is unavailable; recover the original generation.', status: 'completed', generationId, generationRequestId: 'r'.repeat(128) }, metadata: null };
    expect(ArenaCompanionEnvelopeSchema.safeParse(diagnostic).success).toBe(true);
    expect(bytes(diagnostic)).toBeLessThan(bytes(error));
    expect(bytes(success) + bytes(error) + 2 * 33 * 6).toBeLessThan(65536);
  });
});

// Run only in the explicitly scheduled serial capacity window. Ordinary CI uses all small shape/source proofs above.
// MAHO_ARENA_COMPANION_CAPACITY=1 vitest run .../arena-companion-capacity.test.ts --maxWorkers=1
// A single recipe can be selected with Vitest -t; no files, providers, databases or network are used.
describe.skipIf(process.env.MAHO_ARENA_COMPANION_CAPACITY !== '1')('Arena companion full source/wire capacity', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network in capacity fixtures'); })); });
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  it.each(ARENA_COMPANION_CAPACITY_RECIPES)('%s', async (name) => {
    const recipe = arenaCompanionCapacityFixture(name);
    const legacyControl = name === 'headline_1m_32_flags_true';
    const result = await runArenaCompanionCapacityFixture(recipe, !legacyControl);
    const wire = await result.response.text();
    const envelope = legacyControl ? null : parseArenaCompanionEnvelope(wire);
    const body = legacyControl ? JSON.parse(wire) : envelope!.body;
    if (name === 'system_config_model_1m') {
      expect(result.response.status).toBe(502);
      expect(body).toMatchObject({ code: 'ARENA_COMPANION_PROTOCOL_UNSUPPORTED', status: 'completed' });
    } else {
      expect(result.response.status, wire.slice(0, 500)).toBe(recipe.expectStatus ?? 200);
      if (recipe.expectCode) expect(body).toMatchObject({ code: recipe.expectCode });
      else {
        expect(result.runtimeTerminal.status).toBe('completed');
        expect(body.updatedCombatants).toHaveLength(legacyControl ? 32 : 0);
        if (!legacyControl) {
          expect(envelope!.metadata).toEqual(result.headerMeta);
          expect(result.response.headers.get('x-mahoshojo-stream-meta')).toBeNull();
          expect(Buffer.byteLength(wire)).toBeLessThanOrEqual(ARENA_COMPANION_JSON_LIMITS.wireBytes);
        }
      }
    }
    if (name === 'freeweb_4m_near12m_input') {
      expect(bytes(recipe.payload)).toBe(12582912);
      expect(Buffer.byteLength(recipe.source)).toBe(4194304);
      expect(Buffer.byteLength(wire)).toBeGreaterThan(75_000_000);
    }
    if (name === 'structured_extra_impacts_schema_strip') { expect(body).not.toHaveProperty('impacts'); expect(body.report).not.toHaveProperty('impacts'); }
    if (name === 'freeweb_extra_impacts_normalization') { expect(body.impacts).toHaveLength(1); expect(body.impacts[0]).not.toHaveProperty('arbitraryExtra'); }
    expect(result.signatureCalls.generate).toBe(0);
  }, 60_000);
  it('accepts the exact wire ceiling and rejects +1 before JSON decoding', () => {
    const base = JSON.stringify(fixture.successEnvelopes[0]);
    const wire = base + ' '.repeat(ARENA_COMPANION_JSON_LIMITS.wireBytes - Buffer.byteLength(base));
    expect(parseArenaCompanionEnvelope(wire)).toEqual(fixture.successEnvelopes[0]);
    expect(() => parseArenaCompanionEnvelope(wire + ' ')).toThrow('ARENA_COMPANION_RESPONSE_TOO_LARGE');
  }, 60_000);
});
