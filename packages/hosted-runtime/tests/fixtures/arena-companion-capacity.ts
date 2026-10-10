import { strict as assert } from 'node:assert';
import { createArenaCompanionService } from '../../src/arena-companion/service';
import { createArenaPostBattleProjector } from '../../src/arena-companion/post-battle';
import { createArenaGenerationRuntime, ARENA_GENERATION_MATERIALIZATION_VERSION } from '../../src/arena-generation/runtime';
import { buildArenaGenerationPrompt } from '../../src/arena-generation/prompt';
import { buildArenaStructuredReportSchema } from '@mahoshojo/ai-core/arena-generation';
import { parseAIProvidersFromEnv } from '../../src/node-runtime/providers';
import { buildReasoningSummary } from '../../src/node-runtime/reasoning-normalizer';
import { ARENA_RESOURCE_BUDGET } from '@mahoshojo/hosted-api/arena-generation/resource-budget';

import { ARENA_COMPANION_PROTOCOL_HEADER, ARENA_COMPANION_PROTOCOL_VERSION } from '@mahoshojo/contracts/arena-companion';
const MiB = 1024 * 1024;
const LIMIT = ARENA_RESOURCE_BUDGET.maxOutputBytes;
const CTRL = '\u0001';
const generationId = `arena_${'a'.repeat(64)}`;
const generationRequestId = 'request-capacity-fixture';
const actorKey = 'user:capacity-fixture';
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const jsonBytes = (value: unknown) => bytes(JSON.stringify(value));
const reportBase = () => ({ headline: 'H', article: { body: 'B', analysis: 'A' }, officialReport: { winner: 'C00', conclusion: 'C' } });
const payloadBase = (count = 2, flags = false, web = false) => ({
  generationRequestId,
  customProvider: { providerId: 'fixture-preset', apiKey: 'synthetic-unused-key', modelId: 'synthetic-local-model' },
  mode: 'classic', language: 'zh-CN', reportFormat: web ? 'web' : 'markdown',
  combatants: Array.from({ length: count }, (_, i) => ({ type: 'magical-girl', data: { name: `C${String(i).padStart(2, '0')}`, templateId: 'magical-girl' }, isNative: false })),
  writeArenaHistory: flags, writeCurrentState: flags,
  readArenaHistory: false, readCurrentState: false, readNarrativeHistory: false,
});
const trailer = (meta: unknown = { report: { headline: 'H', winner: 'C00' } }) => `<!-- MAHOSHOJO_ARENA_META ${JSON.stringify(meta)} -->`;
const html = (inner: string) => `<!doctype html><html><body><pre>${inner}</pre></body></html>`;
const webSource = (total: number, meta?: unknown) => {
  const tail = trailer(meta);
  const shell = html('');
  return html(CTRL.repeat(total - bytes(shell) - bytes(tail))) + tail;
};
function structuredBodySource(total: number) {
  const report = reportBase(); report.article.body = '';
  const budget = total - jsonBytes(report);
  report.article.body = CTRL.repeat(Math.floor(budget / 6)) + 'x'.repeat(budget % 6);
  assert.equal(jsonBytes(report), total);
  return JSON.stringify(report);
}
const metadataPayload = (fieldSize: number, fundingMode: 'hosted-system' | 'hosted-byok' = 'hosted-system') => {
  const payload: any = payloadBase(32);
  payload.userGuidance = CTRL.repeat(201);
  for (const c of payload.combatants) c.characterGuidance = CTRL.repeat(101);
  payload.adjudicationEvents = Array.from({ length: 100 }, () => ({ type: 'custom', description: CTRL.repeat(fieldSize), outcomes: [{ name: CTRL.repeat(fieldSize), probability: 100 }] }));
  payload.adjudicationResults = [{ description: 'FORGED_CLIENT_RESULT_MUST_NOT_SURVIVE' }];
  return { payload, fundingMode };
};
export type ArenaCompanionCapacityFixture = { name: string; payload: any; source: string; reasoning?: string; fundingMode?: string; bypassProviderSchema?: boolean; expectStatus?: number; expectCode?: string; telemetryOnlyReasoning?: boolean; modelFromSyntheticConfig?: boolean; notes: string[] };
export function arenaCompanionCapacityFixture(name: string): ArenaCompanionCapacityFixture {
  if (name === 'structured_telemetry_reasoning_combined_4m' || name === 'structured_telemetry_reasoning_outside_meter') {
    const total = name.endsWith('_combined_4m') ? LIMIT - 12000 : LIMIT;
    return { name, payload: payloadBase(), source: structuredBodySource(total), reasoning: CTRL.repeat(12000), telemetryOnlyReasoning: true, notes: ['Synthetic telemetry-only envelope mirrors default structured bridge shape (12,000 text chars, real buildReasoningSummary). No Provider or private buildNonStreamReasoningEnvelope function is invoked.', 'Default structured-ai writes reasoning to telemetry and never invokes onReasoningEvent; real runtime therefore counts body, not this envelope. The companion still includes it.'] };
  }
  if (name === 'system_config_model_1m') return { name, payload: payloadBase(), source: JSON.stringify(reportBase()), modelFromSyntheticConfig: true, notes: ['Real parseAIProvidersFromEnv accepts a synthetic 1 MiB model identifier with allowAnonymous=true and an invalid example URL; no secrets, keys, Provider or network used.', 'Synthetic generate returns this accepted model as telemetry.model, matching the actual raw/structured bridge assignment. This proves configuration-derived length is separate from input/output budgets, not that a real Provider accepts this identifier.'] };
  if (name === 'freeweb_4m_near12m_input') {
    const target = 12 * MiB;
    const zero = metadataPayload(0, 'hosted-byok');
    zero.payload.scenarioTitle = 'Capacity scenario'; zero.payload.customStoryLength = 'Capacity length';
    const fieldSize = Math.floor((target - jsonBytes(zero.payload)) / (100 * 2 * 6));
    const { payload, fundingMode } = metadataPayload(fieldSize, 'hosted-byok'); payload.reportFormat = 'web';
    payload.scenarioTitle = 'Capacity scenario'; payload.customStoryLength = 'Capacity length';
    const remaining = target - jsonBytes(payload);
    payload.adjudicationEvents[0].description += CTRL.repeat(Math.floor(remaining / 6)) + 'x'.repeat(remaining % 6);
    assert.equal(jsonBytes(payload), target);
    return { name, payload, fundingMode, source: webSource(LIMIT), notes: ['Request body is exactly 12 MiB, with 32 guidance records and 100 input-derived adjudications. Control-character descriptions/outcomes consume JSON input bytes but keep the real BYOK approximate prompt estimate below 1M tokens.', 'Model body plus hidden trailer is exactly 4 MiB and passes the real runtime output gate. No production Provider or HTTP server is contacted.'] };
  }
  if (name === 'structured_body_controls_4m') return { name, payload: payloadBase(), source: structuredBodySource(LIMIT), notes: ['Structured body controls are already JSON-escaped inside the runtime source.'] };
  if (name === 'structured_empty_body_fallback_4m') {
    const report = reportBase(); report.article.body = ''; report.headline = '';
    report.headline = 'H'.repeat(LIMIT - jsonBytes(report));
    return { name, payload: payloadBase(), source: JSON.stringify(report), notes: ['Schema-valid empty article.body triggers the existing markdown fallback to the whole structured source, duplicating large headline bytes into article.body. This is current measured behavior, not a proposed contract change.'] };
  }
  if (name === 'structured_reasoning_controls_4m') {
    const source = JSON.stringify(reportBase());
    return { name, payload: payloadBase(), source, reasoning: CTRL.repeat(LIMIT - bytes(source)), notes: ['Near-maximal structured JSON expansion uses raw reasoning controls, not 4 MiB decoded structured body.'] };
  }
  if (name === 'structured_body_reasoning_half_4m') return { name, payload: payloadBase(), source: structuredBodySource(2 * MiB), reasoning: CTRL.repeat(2 * MiB), notes: ['Half of runtime source budget is serialized structured body, half is raw reasoning.'] };
  if (name === 'freeweb_body_controls_4m') return { name, payload: payloadBase(2, false, true), source: webSource(LIMIT), notes: ['Real runtime accepts this freeWeb content and valid control trailer; HTML conformance or browser renderability is not asserted.'] };
  if (name === 'freeweb_body_reasoning_half_4m') return { name, payload: payloadBase(2, false, true), source: webSource(2 * MiB), reasoning: CTRL.repeat(2 * MiB), notes: ['Body and reasoning combined exactly hit the real runtime budget, including hidden trailer.'] };
  if (name === 'freeweb_reasoning_controls_4m') {
    const source = html('B') + trailer();
    return { name, payload: payloadBase(2, false, true), source, reasoning: CTRL.repeat(LIMIT - bytes(source)), notes: ['Reasoning appears once in final JSON, while body is repeated twice.'] };
  }
  if (name === 'structured_extra_impacts_schema_strip') {
    const report: any = reportBase();
    report.impacts = [{ characterName: 'C00', impact: CTRL.repeat(128 * 1024), currentStateSummary: 'malicious', arbitraryExtra: 'remove' }];
    report.unrecognized = 'remove';
    return { name, payload: payloadBase(), source: JSON.stringify(report), bypassProviderSchema: true, notes: ['Adversarial injection deliberately bypasses only the provider-side schema to exercise real companion schema stripping. Runtime output budget remains real.'] };
  }
  if (name === 'freeweb_extra_impacts_normalization') {
    const meta = { report: { headline: 'H', winner: 'C00' }, impacts: [{ characterName: 'C00', impact: CTRL.repeat(128 * 1024), currentStateSummary: 'malicious', arbitraryExtra: 'remove' }], arbitraryExtra: 'remove' };
    return { name, payload: payloadBase(2, false, true), source: html('B') + trailer(meta), notes: ['Valid freeWeb trailer with unrequested impacts; production projector parses object and companion normalizer preserves the three recognized impact fields despite false flags.'] };
  }
  if (name === 'structured_metadata_guidance_adjudication') {
    const { payload, fundingMode } = metadataPayload(1024);
    return { name, payload, fundingMode, source: JSON.stringify(reportBase()), notes: ['201/101 UTF-16-unit guidance inputs are reduced to 200/100 by production prompt code. 100 adjudications are generated from request events, not forged result input.'] };
  }
  if (name === 'freeweb_4m_plus_metadata') {
    const { payload, fundingMode } = metadataPayload(1024); payload.reportFormat = 'web';
    return { name, payload, fundingMode, source: webSource(LIMIT), notes: ['Combines output-bound body with bounded guidance and input-derived adjudications; metadata lies outside model output budget.'] };
  }
  if (name === 'large_percent_header_independent') {
    const { payload, fundingMode } = metadataPayload(8192, 'hosted-byok');
    return { name, payload, fundingMode, source: JSON.stringify(reportBase()), notes: ['Large metadata/header case is isolated from model-output amplification. Trusted funding context is synthesized as hosted-byok, no real credentials. Node Headers is not proof an HTTP server/proxy accepts this header.'] };
  }
  if (name === 'headline_1m_32_flags_true' || name === 'headline_1m_32_flags_false') {
    const on = name.endsWith('_true');
    const report: any = reportBase(); report.headline = 'H'.repeat(MiB);
    if (on) report.impacts = Array.from({ length: 32 }, (_, i) => ({ characterName: `C${String(i).padStart(2, '0')}`, impact: 'I', currentStateSummary: 'S' }));
    return { name, payload: payloadBase(32, on), source: JSON.stringify(report), notes: ['Exactly 1 MiB ASCII headline and 32 participants. Real domain post-battle projection; signature verification false and signature generator unused.'] };
  }
  if (name === 'freeweb_budget_plus_one_rejected') return { name, payload: payloadBase(2, false, true), source: webSource(LIMIT + 1), expectStatus: 502, expectCode: 'ARENA_OUTPUT_BUDGET_EXCEEDED', notes: ['Negative control proves actual runtime 4 MiB budget rejects 4 MiB plus one; no model request exists.'] };
  if (name === 'reasoning_budget_plus_one_rejected') return { name, payload: payloadBase(), source: JSON.stringify(reportBase()), reasoning: CTRL.repeat(LIMIT + 1), expectStatus: 502, expectCode: 'ARENA_OUTPUT_BUDGET_EXCEEDED', notes: ['Reasoning callback alone exceeds limit before body is opened.'] };
  throw new Error(`Unknown fixture ${name}`);
}
export async function runArenaCompanionCapacityFixture(f: ArenaCompanionCapacityFixture, optIn = true) {
  const signatureCalls = { verify: 0, generate: 0 };
  let generationCalls = 0, promptInfo: any, finalizationInfo: any, actualRuntimeSource = '', runtimeTerminal: any;
  let bodyCancelled = false, eventsCount = 0, bodyStreamCreated = false, runtimeSourceDeliveredBytes = 0, reasoningSubmittedBytes = 0;
  let headerMeta: any, responseHeaders: Record<string, string> = {};
  const reasoning = f.reasoning ?? '';
  const runtime = createArenaGenerationRuntime({
    preparePayload: async ({ payload }) => ({ ...payload, __arenaServerContextV1: { deliveryMode: 'non-stream', endpoint: 'api/arena/generate', fundingMode: f.fundingMode ?? 'hosted-system' } }),
    checkSafety: async () => null,
    buildPrompt: async input => {
      const prepared = await buildArenaGenerationPrompt(input);
      promptInfo = { bytes: bytes(prepared.prompt), outputContract: prepared.metadata.outputContract };
      return prepared;
    },
    generate: async ({ payload, onReasoning }) => {
      generationCalls++;
      if (f.payload.reportFormat !== 'web' && !f.bypassProviderSchema) {
        const schema = buildArenaStructuredReportSchema({ enableImpacts: payload.writeArenaHistory === true || payload.writeCurrentState === true, enableImpactText: payload.writeArenaHistory === true, enableCurrentState: payload.writeCurrentState === true });
        actualRuntimeSource = JSON.stringify(schema.parse(JSON.parse(f.source)));
        assert.equal(actualRuntimeSource, f.source, 'normal fixture is provider-schema canonical');
      } else actualRuntimeSource = f.source;
      if (reasoning && !f.telemetryOnlyReasoning) {
        await onReasoning({ type: 'reasoning-start' });
        for (let offset = 0; offset < reasoning.length; offset += 64 * 1024) {
          const piece = reasoning.slice(offset, offset + 64 * 1024); reasoningSubmittedBytes += bytes(piece);
          await onReasoning({ type: 'reasoning-delta', text: piece });
        }
        await onReasoning({ type: 'reasoning-end' });
      }
      let model = 'synthetic-local-model';
      if (f.modelFromSyntheticConfig) {
        const providers = parseAIProvidersFromEnv({ AI_PROVIDERS_CONFIG: JSON.stringify([{ name: 'capacity-fixture', model: 'M'.repeat(MiB), type: 'openai', baseUrl: 'https://fixture.invalid/v1', allowAnonymous: true }]) });
        assert.equal(providers.length, 1); assert.equal(typeof providers[0].model, 'string'); model = providers[0].model as string;
      }
      let offset = 0;
      bodyStreamCreated = true;
      return { body: new ReadableStream({ pull(controller) {
        if (offset >= actualRuntimeSource.length) { controller.close(); return; }
        const piece = actualRuntimeSource.slice(offset, offset + 64 * 1024); offset += piece.length;
        runtimeSourceDeliveredBytes += bytes(piece); controller.enqueue(new TextEncoder().encode(piece));
      }, cancel() { bodyCancelled = true; } }), telemetry: { model, usage: { promptTokens: 7, completionTokens: 11, totalTokens: 18 }, ...(reasoning ? { reasoning: f.telemetryOnlyReasoning ? { status: 'done', source: 'sdk', summary: buildReasoningSummary(reasoning), text: reasoning, reasoningTokens: null } : { text: reasoning, status: 'complete' } } : {}), finishReason: 'stop' } };
    },
    finalize: async input => {
      finalizationInfo = { status: input.status, errorCode: input.errorCode, markdownBytes: bytes(input.markdown), outputContract: input.metadata.outputContract, estimatedPromptTokens: input.metadata.estimatedPromptTokens };
      return { resultRef: null, ranking: null };
    },
  });
  const forbidden = async () => { throw new Error('Only parsed subscription is authorized in this fixture'); };
  const generationService: any = { createSubscription: forbidden, create: forbidden, cancelRequest: forbidden, lookup: forbidden, resume: forbidden, status: forbidden, cancel: forbidden,
    createParsedSubscription: async (request: Request, command: any) => {
      assert.equal(request.body, null);
      assert.equal(command.bodyBytes, jsonBytes(f.payload));
      const input = { request, actorKey, generationRequestId: command.generationRequestId, payload: command.payload };
      const preflight: any = await runtime.preflight!(input);
      if (preflight instanceof Response) return preflight;
      const prepared: any = await runtime.materialize!({ ...input, payload: preflight.materializationPayload, preparationSeed: '11'.repeat(32), preparationVersion: ARENA_GENERATION_MATERIALIZATION_VERSION });
      if (prepared instanceof Response) return prepared;
      responseHeaders = { ...prepared.responseHeaders, 'X-Mahoshojo-Generation-Id': generationId, 'X-Mahoshojo-Generation-Request-Id': generationRequestId };
      headerMeta = JSON.parse(decodeURIComponent(responseHeaders['X-Mahoshojo-Stream-Meta']));
      return { generationId, generationRequestId, headers: responseHeaders, events: new ReadableStream({ async start(controller) {
        try {
          runtimeTerminal = await runtime.execute({ generationId, generationRequestId, actorKey, producerToken: 'synthetic-producer-token', payloadHash: 'synthetic-payload-hash', payload: prepared.executionPayload, signal: request.signal,
            emit: async event => { controller.enqueue({ ...event, id: `1791612000000-${eventsCount++}` }); }, claimFinalization: async () => ({ kind: 'claimed' as const }) });
          if (runtimeTerminal.status === 'completed') controller.enqueue({ id: `1791612000000-${eventsCount++}`, type: 'done', data: { ...runtimeTerminal, ok: true } });
          else controller.enqueue({ id: `1791612000000-${eventsCount++}`, type: 'error', data: { ...runtimeTerminal, code: runtimeTerminal.code } });
          controller.close();
        } catch (error) { controller.error(error); }
      } }) };
    },
  };
  const companion = createArenaCompanionService({ generationService, projectUpdatedCombatants: createArenaPostBattleProjector({ signatures: { verifySignature: async () => { signatureCalls.verify++; return false; }, generateSignature: async () => { signatureCalls.generate++; return null; } } }) });
  const response = await companion.generate(new Request('https://fixture.invalid/api/arena/generate', { method: 'POST', headers: optIn ? { [ARENA_COMPANION_PROTOCOL_HEADER]: ARENA_COMPANION_PROTOCOL_VERSION } : {}, body: JSON.stringify(f.payload) }));
  return { response, headerMeta, signatureCalls, generationCalls, promptInfo, finalizationInfo, actualRuntimeSource, runtimeTerminal, bodyCancelled, eventsCount, bodyStreamCreated, runtimeSourceDeliveredBytes, reasoningSubmittedBytes };
}
export const ARENA_COMPANION_CAPACITY_RECIPES = [
  'structured_body_controls_4m', 'structured_telemetry_reasoning_combined_4m', 'structured_telemetry_reasoning_outside_meter', 'system_config_model_1m', 'structured_empty_body_fallback_4m', 'structured_reasoning_controls_4m', 'structured_body_reasoning_half_4m',
  'freeweb_body_controls_4m', 'freeweb_body_reasoning_half_4m', 'freeweb_reasoning_controls_4m',
  'structured_extra_impacts_schema_strip', 'freeweb_extra_impacts_normalization',
  'structured_metadata_guidance_adjudication', 'freeweb_4m_plus_metadata', 'freeweb_4m_near12m_input', 'large_percent_header_independent',
  'headline_1m_32_flags_false', 'headline_1m_32_flags_true', 'freeweb_budget_plus_one_rejected', 'reasoning_budget_plus_one_rejected',
];
