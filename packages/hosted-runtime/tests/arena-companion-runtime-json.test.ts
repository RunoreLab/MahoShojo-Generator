import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAdjudicationEvents } from '@mahoshojo/domain/arena-adjudication';
import { normalizeUsage } from '@mahoshojo/ai-core/token-usage';
import { BUILTIN_ARENA_NEWS_PACKAGE_REF, createWebPackageOverlay } from '@mahoshojo/web-package';
import { ArenaCompanionAdjudicationResultSchema, ArenaCompanionEnvelopeSchema, ArenaCompanionUsageSchema, parseArenaCompanionEnvelope } from '@mahoshojo/contracts/arena-companion';
import { runArenaCompanionCapacityFixture, type ArenaCompanionCapacityFixture } from './fixtures/arena-companion-capacity';

const body = '<!doctype html><html><head><title>测试新闻</title></head><body><article>完整正文</article></body></html>\n';
const trailer = '<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"测试","winner":"A"}} -->';
const report = { headline: '测试', article: { body: '正文', analysis: '点评' }, officialReport: { winner: 'A', conclusion: '结论' } };
const payload = {
  generationRequestId: 'request-capacity-fixture', reportFormat: 'markdown', mode: 'classic',
  combatants: [{ data: { name: 'A' }, characterGuidance: 'x'.repeat(99) + '😀' }, { data: { name: 'B' } }],
  writeArenaHistory: false, writeCurrentState: false, userGuidance: 'x'.repeat(199) + '😀',
  scenarioTitle: '场景', language: 'zh-CN', customStoryLength: '短篇',
  adjudicationEvents: [{ type: 'binary', probability: 100, description: '原输入事件' }],
  adjudicationResults: [{ description: 'FORGED_CLIENT_RESULT' }], readNarrativeHistory: true, narrativeHistory: [],
};
const recipe = (kind: string): ArenaCompanionCapacityFixture => ({
  name: `small-${kind}`, payload: { ...payload, reportFormat: kind === 'structured' ? 'markdown' : 'web', ...(kind === 'package' ? { webPackageRef: BUILTIN_ARENA_NEWS_PACKAGE_REF } : {}) },
  source: kind === 'structured' ? JSON.stringify(report) : body + trailer,
  reasoning: '真实runtime收到的合成reasoning', notes: ['Actual runtime/preflight/materialization/projector; synthetic provider/store/signatures only'],
});
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network in the fixture'); })); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('C2 actual runtime and legacy companion parity', () => {
  it.each(['structured', 'web', 'package'])('preserves all producer-derived fields and UTF-16 guidance (%s)', async (kind) => {
    const f = recipe(kind);
    const legacy = await runArenaCompanionCapacityFixture(f, false);
    const legacyBody = await legacy.response.json();
    const modern = await runArenaCompanionCapacityFixture(f);
    const wire = await modern.response.text();
    expect(modern.response.status, wire.slice(0, 500)).toBe(200);
    const value = parseArenaCompanionEnvelope(wire);
    expect(value.body).toEqual(legacyBody);
    expect(value.metadata).toEqual(legacy.headerMeta);
    expect(value.metadata).toEqual(modern.headerMeta);
    expect(Object.keys(value.metadata!)).toHaveLength(kind === 'package' ? 12 : 11);
    expect(modern.response.headers.get('x-mahoshojo-stream-meta')).toBeNull();
    expect(value.metadata!.userGuidance!.length).toBe(200);
    expect(value.metadata!.userGuidance!.charCodeAt(199)).toBe(0xd83d);
    expect(value.metadata!.characterGuidances![0]!.guidance.charCodeAt(99)).toBe(0xd83d);
    expect(wire).toContain('\\ud83d');
    expect(JSON.stringify(value)).not.toContain('FORGED_CLIENT_RESULT');
    expect(modern.runtimeTerminal.status).toBe('completed'); expect(modern.generationCalls).toBe(1);
    expect(modern.signatureCalls.generate).toBe(0);
    if (kind === 'package') {
      const { generatedContent, ...artifact } = await createWebPackageOverlay(BUILTIN_ARENA_NEWS_PACKAGE_REF, body);
      expect(generatedContent).toBe(body);
      expect(value.body).toMatchObject({ report: { webPackage: artifact, article: { body } } });
    }
  });
  it('preserves 2100 actual resolved nodes including worst finite probability/roll skeleton', () => {
    const chain = (depth: number): unknown => ({ type: 'binary', description: '', probability: Number.MAX_VALUE, onSuccess: depth ? { event: chain(depth - 1) } : {} });
    const nodes = resolveAdjudicationEvents(Array.from({ length: 100 }, () => chain(21)), () => 1);
    expect(nodes).toHaveLength(2100);
    for (const node of nodes) { expect(ArenaCompanionAdjudicationResultSchema.parse(node)).toEqual(node); expect(Buffer.byteLength(JSON.stringify(node))).toBeLessThan(256); }
    const extremes = resolveAdjudicationEvents([Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE].map(probability => ({ type: 'binary', probability })), () => 1);
    for (const node of extremes) expect(Buffer.byteLength(JSON.stringify(node))).toBeLessThan(256);
  });
  it('validates the real normalizeUsage sum and same-schema unknown metadata rejection', () => {
    const usage = normalizeUsage({ candidatesTokenCount: Number.MAX_SAFE_INTEGER, thoughtsTokenCount: Number.MAX_SAFE_INTEGER });
    expect(usage!.completionTokens).toBe(2 * Number.MAX_SAFE_INTEGER);
    expect(ArenaCompanionUsageSchema.parse(usage)).toEqual(usage);
    expect(ArenaCompanionEnvelopeSchema.safeParse({ version: 'arena-companion-v1', body: { code: 'GENERATION_FAILED', private: 'hidden' }, metadata: null }).success).toBe(false);
  });
});
