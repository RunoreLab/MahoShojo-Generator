import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARENA_COMPANION_PROTOCOL_HEADER } from '@mahoshojo/contracts/arena-companion';
import {
  ARENA_STORY_PROTOCOL_HEADER,
  ARENA_STORY_PROTOCOL_VERSION,
  type ArenaStoryCreateRequest,
} from '@mahoshojo/contracts/arena-story';
import { ARENA_EXPECTED_USER_ID_HEADER, DesktopArenaHostedReadinessSchema, parseDesktopArenaHostedSseBlock } from '@mahoshojo/contracts/desktop-arena-hosted';
import { buildBattleStoryArenaRequest } from '@mahoshojo/domain/arena-battle-story-request';
import { createMemoryGenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/memory-replay-store';
import { parseGenerationSseBlock } from '@mahoshojo/hosted-api/arena-generation/sse';
import {
  __resetArenaSessionSoftRateLimitForTest,
  buildArenaSessionUpstreamRequestBody,
  configureArenaCompanionRouteService,
  createArenaCompanionRouteService,
  createArenaSessionCompanionService,
  type ArenaSessionRequest,
} from '@mahoshojo/hosted-runtime/arena-companion';
import {
  ARENA_ANONYMOUS_TOKEN_HEADER,
  ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER,
  canonicalizeNodeArenaGenerationSemanticPayload,
  configureArenaGenerationService,
  createArenaInternalGuidanceAuthority,
  createNodeArenaGenerationExecutor,
  createNodeArenaGenerationService,
  hashArenaGenerationPayload,
  type ArenaGenerationFinalizationInput,
  type NodeArenaGenerationExecutorOptions,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { createSignatureService } from '@mahoshojo/hosted-runtime/signature';
import { POST as generateNext } from '#/adapters/arena/session/generate-next';
import { POST as generateStream } from '#/adapters/arena/generate-stream';
import { GET as lookup } from '#/adapters/arena/generation-requests/[generationRequestId]';
import { GET as status } from '#/adapters/arena/generations/[generationId]';
import { GET as resume } from '#/adapters/arena/generations/[generationId]/stream';
import { POST as cancel } from '#/adapters/arena/generations/[generationId]/cancel';
import { createHonoDrReadinessHandler } from '#/adapters/hosted/dr-readiness';
import { configureHonoArenaGenerationRuntime } from '#/arena-generation/runtime';

const path = '/api/arena/session/generate-next';
const accountHeaders = {
  Cookie: 'better-auth.session_token=synthetic-story-session',
  [ARENA_EXPECTED_USER_ID_HEADER]: 'v1:42',
};
const protocolHeaders = { [ARENA_STORY_PROTOCOL_HEADER]: ARENA_STORY_PROTOCOL_VERSION };
const markdown = '# 合成章节\n\n两位角色在清晨重逢。';
const output = `${markdown}\n<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"winner":"A"}} -->`;
const combatants = [{ type: 'magical-girl', data: { name: 'A' } }];
const story = (action: 'start' | 'continue' = 'start'): ArenaStoryCreateRequest => ({
  version: 1,
  sessionId: 'story_session_1',
  generationRequestId: `story_${action}_request_1234`,
  action,
  chapterIndex: action === 'start' ? 1 : 2,
  ...(action === 'continue' ? { sourceChapterId: 'chapter_1' } : {}),
  chapterPlan: { totalChapters: 3 },
  chapterContext: {
    workingCombatants: structuredClone(combatants),
    sessionSummary: '这是服务端测试用的故事梗概。',
    recentWindow: action === 'start' ? [] : [{
      chapterId: 'chapter_1', chapterIndex: 1, title: '前章',
      mode: 'digest', text: '前章摘要：两人约定黎明再会。', truncated: false,
    }],
  },
  seed: {
    combatants: structuredClone(combatants), mode: 'daily', storyLength: 'standard', language: 'zh-CN',
    settings: {
      readArenaHistory: false, writeArenaHistory: false,
      readCurrentState: false, writeCurrentState: false,
      readNarrativeHistory: false, writeNarrativeHistory: false,
    },
  },
  userGuidance: '保持温暖的语气。',
});
const makeD1 = () => ({ prepare: vi.fn(() => ({
  bind: vi.fn().mockReturnThis(),
  all: vi.fn(async () => ({ success: true, results: [{ id: 42, isBanned: null, ok: 1 }], meta: {} })),
  run: vi.fn(async () => ({ success: true, results: [], meta: {} })),
})) });
const readinessProvider = {
  id: 'hono-d1-primary' as const,
  openSession: () => ({ consistency: 'replica-ok' as const, initialBookmark: null, getBookmark: () => null, client: makeD1() }),
};

const setup = async (options: { holdModel?: boolean } = {}) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('synthetic-story-protocol-test-signing'), {
    name: 'HMAC', hash: 'SHA-256',
  }, false, ['sign', 'verify']);
  const signatures = createSignatureService({ getSigningKey: async () => key });
  const fetcher = vi.fn(async () => Response.json({ user: { id: 42 } }));
  const safety = vi.fn<NonNullable<NodeArenaGenerationExecutorOptions['enforceSafety']>>(async () => null);
  const finalizer = vi.fn(async (_input: ArenaGenerationFinalizationInput) => ({ resultRef: 'synthetic://story/result', ranking: null }));
  const model = vi.fn<NonNullable<NodeArenaGenerationExecutorOptions['generateWithStreamAI']>>(async (_config, modelOptions) => {
    Object.assign(modelOptions?.telemetry ?? {}, {
      model: 'synthetic-story-model', providerName: 'private-provider', providerIndex: 7, reasoning: 'private-reasoning',
    });
    const response = options.holdModel ? new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(markdown));
        modelOptions?.abortSignal?.addEventListener('abort', () => controller.error(new Error('synthetic abort')), { once: true });
      },
    })) : new Response(output);
    return {
      response, usagePromise: Promise.resolve({ totalTokens: 9 }), finishReasonPromise: Promise.resolve('stop'),
    };
  });
  const structuredModel = vi.fn<NonNullable<NodeArenaGenerationExecutorOptions['generateWithStructuredAI']>>();
  const nodeExecutor = createNodeArenaGenerationExecutor({
    env: {}, signatureService: signatures, enforceSafety: safety, finalizer,
    generateWithStreamAI: model, generateWithStructuredAI: structuredModel,
  });
  // Observe the real executor without substituting any preparation or execution behavior.
  const execute = vi.fn(nodeExecutor.execute);
  const memory = createMemoryGenerationReplayStore();
  const reserve = vi.fn(memory.reserve.bind(memory));
  const generation = createNodeArenaGenerationService({
    store: { ...memory, reserve }, signatures,
    env: { HONO_AUTH_MODE: 'hybrid', BETTER_AUTH_URL: 'https://synthetic-auth.test' },
    fetch: fetcher, getD1Client: makeD1,
    executor: { ...nodeExecutor, execute }, replayPollMs: 1,
  });
  const companion = createArenaCompanionRouteService({ generationService: generation, signatures, placement: 'hono-primary' });
  configureArenaGenerationService(generation, { expectedUserIdAssertionInstalled: true });
  configureArenaCompanionRouteService(companion);
  const app = new Hono();
  app.post(path, (c) => generateNext(c.req.raw));
  app.post('/api/arena/generate-stream', (c) => generateStream(c.req.raw));
  app.get('/api/arena/generation-requests/:generationRequestId', (c) => lookup(c.req.raw, { params: Promise.resolve(c.req.param()) }));
  app.get('/api/arena/generations/:generationId', (c) => status(c.req.raw, { params: Promise.resolve(c.req.param()) }));
  app.get('/api/arena/generations/:generationId/stream', (c) => resume(c.req.raw, { params: Promise.resolve(c.req.param()) }));
  app.post('/api/arena/generations/:generationId/cancel', (c) => cancel(c.req.raw, { params: Promise.resolve(c.req.param()) }));
  const readiness = createHonoDrReadinessHandler(readinessProvider);
  app.on(['GET', 'HEAD'], '/api/hosted/dr-readiness', (c) => readiness(c.req.raw));
  const create = (payload: unknown = story(), headers: Record<string, string> = accountHeaders) => {
    // The soft-rate-limit algorithm has its own tests; isolate protocol retries from its cooldown.
    __resetArenaSessionSoftRateLimitForTest();
    return app.request(path, { method: 'POST', headers: { ...protocolHeaders, ...headers }, body: JSON.stringify(payload) });
  };
  return { app, create, generation, companion, signatures, model, structuredModel, execute, safety, finalizer, reserve, memory, fetcher };
};

const readEvents = async (response: Response) => {
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return text.split(/\r?\n\r?\n/u).flatMap((block) => {
    const event = parseGenerationSseBlock(block);
    return event ? [{ id: event.id, event: event.event, data: JSON.parse(event.data) as Record<string, unknown> }] : [];
  });
};
const actorHeaders = (response: Response) => ({ [ARENA_ANONYMOUS_TOKEN_HEADER]: response.headers.get(ARENA_ANONYMOUS_TOKEN_HEADER)! });

afterEach(() => {
  configureArenaCompanionRouteService(null);
  configureArenaGenerationService(null);
  __resetArenaSessionSoftRateLimitForTest();
});

describe('Hono Hosted story v1: real session, generation executor and memory replay', () => {
  it.each(['start', 'continue'] as const)('%s produces only replayable generation events with real signed story guidance', async (action) => {
    const test = await setup();
    const payload = story(action);
    const response = await test.create(payload, {
      ...accountHeaders,
      [ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER]: 'renderer-forged-signature',
      'X-Mahoshojo-Trusted-Story-Identity': '{"sessionId":"forged-session"}',
    });
    expect(response.headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBe(ARENA_STORY_PROTOCOL_VERSION);
    const strictEvents = (await response.clone().text()).trimEnd().split('\n\n')
      .map((block) => parseDesktopArenaHostedSseBlock(`${block}\n\n`));
    const events = await readEvents(response);
    expect(strictEvents).toEqual(events);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining(['markdown', 'telemetry', 'done']));
    expect(events.every((event) => /^\d+-\d+$/u.test(event.id ?? ''))).toBe(true);
    expect(events.map((event) => event.event)).not.toEqual(expect.arrayContaining(['session_meta']));
    expect(events.map((event) => event.event)).not.toEqual(expect.arrayContaining(['chapter_digest']));
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { ok: true, status: 'completed' } });
    expect(events.filter((event) => event.event === 'markdown').map((event) => event.data.chunk).join('')).toContain(markdown);
    expect(events.find((event) => event.event === 'telemetry')?.data).toMatchObject({ version: 1, aiModel: 'synthetic-story-model' });
    expect(JSON.stringify(events)).not.toMatch(/private-provider|private-reasoning|providerIndex/u);
    const safetyInput = test.safety.mock.calls[0]![0];
    const expectedGuidance = buildBattleStoryArenaRequest(payload).internalGuidance;
    expect(safetyInput.payload.internalGuidance).toBe(expectedGuidance);
    expect(await createArenaInternalGuidanceAuthority(test.signatures).resolve(safetyInput)).toBe(expectedGuidance);
    expect(test.model.mock.calls[0]![0].prompt).toContain(expectedGuidance);
    expect(test.model.mock.calls[0]![0].prompt).not.toContain('forged-session');
    expect(test.finalizer.mock.calls[0]![0].payload).not.toHaveProperty('__arenaServerStoryIdentityV1');
    expect(test.structuredModel).not.toHaveBeenCalled();
    expect(test.execute).toHaveBeenCalledOnce();
    expect(test.finalizer).toHaveBeenCalledOnce();
    expect(test.fetcher).toHaveBeenCalledOnce();
  });

  it.each([false, true])('same actor/request retries replay identically; changing only session conflicts (account=%s)', async (account) => {
    const test = await setup();
    const payload = story();
    const response = await test.create(payload, account ? accountHeaders : {});
    const headers = account ? accountHeaders : actorHeaders(response);
    const id = response.headers.get('X-Mahoshojo-Generation-Id');
    const first = await readEvents(response);
    const retry = await test.create(payload, headers);
    expect(retry.headers.get('X-Mahoshojo-Generation-Id')).toBe(id);
    expect(await readEvents(retry)).toEqual(first);
    const resumed = await test.app.request(`/api/arena/generations/${id}/stream`, {
      headers: { ...headers, 'Last-Event-ID': first[0]!.id! },
    });
    expect(await readEvents(resumed)).toEqual(first.slice(1));
    const conflict = await test.create({ ...payload, sessionId: 'another_session' }, headers);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'GENERATION_REQUEST_CONFLICT' });
    expect(test.execute).toHaveBeenCalledOnce();
    expect(test.model).toHaveBeenCalledOnce();
    expect(test.finalizer).toHaveBeenCalledOnce();
  });

  it('binds the continue source identity even when its prompt context and session are unchanged', async () => {
    const test = await setup();
    const original = story('continue');
    const changedSource = {
      ...original, sourceChapterId: 'chapter_other',
      chapterContext: {
        ...original.chapterContext,
        recentWindow: original.chapterContext.recentWindow.map((chapter) => ({ ...chapter, chapterId: 'chapter_other' })),
      },
    };
    // The shared producer deliberately excludes chapter IDs from continuation prose.
    expect(buildBattleStoryArenaRequest(changedSource)).toEqual(buildBattleStoryArenaRequest(original));
    await readEvents(await test.create(original));
    const conflict = await test.create(changedSource);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'GENERATION_REQUEST_CONFLICT' });
    expect(test.model).toHaveBeenCalledOnce();
    expect(test.execute).toHaveBeenCalledOnce();
    expect(test.finalizer).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing account session', { [ARENA_EXPECTED_USER_ID_HEADER]: 'v1:42' }],
    ['account mismatch', { ...accountHeaders, [ARENA_EXPECTED_USER_ID_HEADER]: 'v1:43' }],
    ['malformed account assertion', { ...accountHeaders, [ARENA_EXPECTED_USER_ID_HEADER]: '42' }],
    ['forged anonymous token', { [ARENA_ANONYMOUS_TOKEN_HEADER]: 'renderer-invented-token' }],
  ])('rejects %s on story creation before reservation or provider dispatch', async (_name, headers) => {
    const test = await setup();
    const response = await test.create(story(), headers);
    expect(response.status).toBe(401);
    expect(test.reserve).not.toHaveBeenCalled();
    expect(test.safety).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.model).not.toHaveBeenCalled();
  });

  it.each([
    ['missing version', { version: undefined }], ['future version', { version: 2 }],
    ['branch', { action: 'branch' }], ['rewrite', { action: 'rewrite' }],
    ['missing chapter index', { chapterIndex: undefined }],
    ['renderer guidance', { internalGuidance: 'forged-authority' }],
    ['renderer adjudication', { adjudicationResults: [{ result: 'forged-authority' }] }],
    ['renderer identity', { trustedStoryIdentity: { sessionId: 'forged-session' } }],
    ['renderer reserved identity', { __arenaServerStoryIdentityV1: { sessionId: 'forged-session' } }],
  ])('rejects %s before reservation or execution', async (_name, patch) => {
    const test = await setup();
    const response = await test.create({ ...story(), ...patch });
    expect(response.status).toBe(400);
    expect(test.reserve).not.toHaveBeenCalled();
    expect(test.model).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('requires the source chapter for continue and rejects authority nested in the seed', async () => {
    const test = await setup();
    const payload = story('continue');
    for (const invalid of [
      { ...payload, sourceChapterId: undefined },
      { ...payload, sourceChapterId: 'not_the_latest' },
      { ...payload, seed: { ...payload.seed, adjudicationResults: [{ result: 'forged' }] } },
      { ...payload, seed: { ...payload.seed, internalGuidance: 'forged' } },
    ]) expect((await test.create(invalid)).status).toBe(400);
    expect(test.reserve).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('an ordinary generation route cannot manufacture story identity, guidance or adjudication authority', async () => {
    const test = await setup();
    const body = {
      generationRequestId: 'plain_story_forgery_1234', mode: 'daily', combatants,
      writeArenaHistory: false, writeCurrentState: false,
    };
    const send = (payload: Record<string, unknown>) => test.app.request('/api/arena/generate-stream', {
      method: 'POST', headers: { ...accountHeaders, [ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER]: 'forged',
        'X-Mahoshojo-Trusted-Story-Identity': '{"sessionId":"forged"}' }, body: JSON.stringify(payload),
    });
    const first = await readEvents(await send({
      ...body, internalGuidance: 'forged-guidance', adjudicationResults: [{ result: 'forged-roll' }],
      __arenaServerStoryIdentityV1: { version: 1, sessionId: 'forged', action: 'start', chapterIndex: 1, sourceChapterId: null },
    }));
    expect(await readEvents(await send(body))).toEqual(first);
    expect(test.safety.mock.calls[0]![0].payload.internalGuidance).toBeUndefined();
    expect(test.finalizer.mock.calls[0]![0].payload.adjudicationResults).toBeUndefined();
    expect(test.model.mock.calls[0]![0].prompt).not.toMatch(/forged-guidance|forged-roll/u);
    expect(test.model).toHaveBeenCalledOnce();
  });

  it.each([false, true])('system and preset BYOK keep funding independent of actor (account=%s)', async (account) => {
    const test = await setup();
    for (const funding of ['system', 'preset'] as const) {
      const response = await test.create({
        ...story(), generationRequestId: `funding_${funding}_${account}_1234`,
        customProvider: funding === 'system'
          ? { providerId: 'system', modelId: 'default', apiKey: '' }
          : { providerId: 'chatbox', modelId: 'gpt-5.4', apiKey: 'synthetic-byok-key' },
      }, account ? accountHeaders : {});
      if (!account) expect(response.headers.get(ARENA_ANONYMOUS_TOKEN_HEADER)).toBeTruthy();
      await readEvents(response);
    }
    expect(test.execute.mock.calls.map(([input]) => input.actorKey)).toEqual(account
      ? ['user:42', 'user:42']
      : [expect.stringMatching(/^anonymous:/u), expect.stringMatching(/^anonymous:/u)]);
    expect(test.finalizer.mock.calls.map(([input]) => (input.payload.__arenaServerContextV1 as { fundingMode: string }).fundingMode))
      .toEqual(['hosted-system', 'hosted-byok']);
    expect(test.model.mock.calls[0]![1]?.providerOverride).toBeUndefined();
    expect(test.model.mock.calls[1]![1]?.providerOverride?.apiKey).toBe('synthetic-byok-key');
    expect(test.model.mock.calls[1]![0].modelOverride).toBe('gpt-5.4');
  });

  it('rejects unrecognized providers and caller-defined provider endpoints before dispatch', async () => {
    const test = await setup();
    for (const customProvider of [
      { providerId: 'not-a-preset', modelId: 'custom', apiKey: 'synthetic' },
      { providerId: 'chatbox', modelId: 'gpt-5.4', apiKey: 'synthetic', baseUrl: 'https://renderer.test' },
    ]) expect((await test.create({ ...story(), customProvider })).status).toBe(400);
    expect(test.reserve).not.toHaveBeenCalled();
    expect(test.model).not.toHaveBeenCalled();
  });

  it.each([['system', 128_000], ['preset', 1_000_000]] as const)('keeps the final %s prompt token budget independently of the 12 MiB carriers', async (funding, limit) => {
    const test = await setup(); const payload = story('continue');
    payload.chapterContext.recentWindow[0]!.text = '汉'.repeat(limit + 1);
    if (funding === 'preset') payload.customProvider = { providerId: 'chatbox', modelId: 'gpt-5.4', apiKey: 'synthetic-byok-key' };
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeLessThan(12 * 1024 * 1024);
    const response = await test.create(payload);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'ARENA_PROMPT_BUDGET_EXCEEDED', maxEstimatedPromptTokens: limit });
    expect(test.model).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.finalizer).not.toHaveBeenCalled();
  });

  it.each([false, true])('capability withdrawal preserves original-actor lookup/resume/stop (account=%s)', async (account) => {
    const test = await setup({ holdModel: true });
    const payload = story();
    const response = await test.create(payload, account ? accountHeaders : {});
    expect(response.status).toBe(200);
    const id = response.headers.get('X-Mahoshojo-Generation-Id')!;
    const headers = account ? accountHeaders : actorHeaders(response);
    await vi.waitFor(() => expect(test.model).toHaveBeenCalledOnce());
    configureArenaCompanionRouteService(createArenaCompanionRouteService({
      generationService: test.generation, signatures: test.signatures, placement: 'next-dr',
    }));
    expect((await test.app.request('/api/hosted/dr-readiness')).headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBeNull();
    expect((await test.create(payload, headers)).status).toBe(503);
    const found = await test.app.request(`/api/arena/generation-requests/${payload.generationRequestId}`, { headers });
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ generationId: id });
    expect((await test.app.request(`/api/arena/generations/${id}`, { headers })).status).toBe(200);
    expect((await test.app.request(`/api/arena/generation-requests/${payload.generationRequestId}`, {
      headers: { [ARENA_ANONYMOUS_TOKEN_HEADER]: 'bootstrap.123e4567-e89b-42d3-a456-426614174000' },
    })).status).toBe(404);
    for (const [method, suffix] of [['GET', ''], ['GET', '/stream'], ['POST', '/cancel']] as const) {
      expect((await test.app.request(`/api/arena/generations/${id}${suffix}`, {
        method, headers: { [ARENA_ANONYMOUS_TOKEN_HEADER]: 'bootstrap.123e4567-e89b-42d3-a456-426614174000' },
      })).status).toBe(404);
    }
    const resumed = await test.app.request(`/api/arena/generations/${id}/stream`, { headers });
    const stopped = await test.app.request(`/api/arena/generations/${id}/cancel`, { method: 'POST', headers });
    expect(stopped.status).toBe(202);
    const events = await readEvents(response);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { status: 'cancelled' } });
    expect(await readEvents(resumed)).toEqual(events);
    const stoppedAgain = await test.app.request(`/api/arena/generations/${id}/cancel`, { method: 'POST', headers });
    expect(stoppedAgain.status).toBe(200);
    expect(test.model.mock.calls[0]![1]?.abortSignal?.aborted).toBe(true);
    expect(test.execute).toHaveBeenCalledOnce();
  });

  it('legacy no-header story clients retain wrapper metadata and digest events', async () => {
    const test = await setup();
    const payload = story();
    const legacy: ArenaSessionRequest = {
      sessionId: payload.sessionId, generationRequestId: payload.generationRequestId,
      action: payload.action, chapterIndex: payload.chapterIndex, chapterPlan: payload.chapterPlan,
      seed: payload.seed, userGuidance: payload.userGuidance,
      chapterContext: { workingCombatants: combatants, recentChapters: [] },
    };
    const response = await test.app.request(path, { method: 'POST', headers: accountHeaders, body: JSON.stringify(legacy) });
    expect(response.headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBeNull();
    const events = await readEvents(response);
    expect(events[0]).toMatchObject({ id: null, event: 'session_meta', data: { sessionId: payload.sessionId, chapterIndex: 1 } });
    expect(events.find((event) => event.event === 'chapter_digest')).toMatchObject({ id: null, data: { sessionId: payload.sessionId } });
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { ok: true } });
    expect(test.model).toHaveBeenCalledOnce();
    // Reconstruct the original pre-story-v1 seeded hash, without the new identity carrier.
    const guidance = buildBattleStoryArenaRequest(legacy).internalGuidance;
    const upstream = buildArenaSessionUpstreamRequestBody(legacy, guidance, null);
    delete upstream.generationRequestId;
    const semanticPayload = await canonicalizeNodeArenaGenerationSemanticPayload({
      payload: upstream, signatures: test.signatures,
      trustedInternalGuidance: guidance, trustedPvpContext: null,
    });
    const legacyHash = await hashArenaGenerationPayload({
      reservationHashVersion: 'arena-seeded-reservation-v1', semanticPayload,
    });
    expect(test.reserve.mock.calls[0]![0].payloadHash).toBe(legacyHash);
    expect(legacyHash).toBe('8ce3019f78e6cb8b4f811406ab1623b963f4ce3ad30c03c074664b98a38058ae');
  });
});

describe('Hono story capability evidence', () => {
  it('advertises only after actual Hono composition and withdraws independently of the old capability', async () => {
    const handler = createHonoDrReadinessHandler(readinessProvider);
    const request = new Request('https://hono.test/api/hosted/dr-readiness');
    expect((await handler(request)).headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBeNull();
    configureHonoArenaGenerationRuntime({ getGenerationReplayStore: () => createMemoryGenerationReplayStore() }, {
      settleRatings: async () => undefined, readRanking: async () => null,
    });
    const ready = await handler(request);
    expect(ready.headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBe(ARENA_STORY_PROTOCOL_VERSION);
    expect(ready.headers.get('Cache-Control')).toContain('no-store');
    expect(DesktopArenaHostedReadinessSchema.safeParse(await ready.json()).success).toBe(true);
    configureArenaCompanionRouteService(null);
    const withdrawn = await handler(request);
    expect(withdrawn.headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBeNull();
    expect(DesktopArenaHostedReadinessSchema.safeParse(await withdrawn.json()).success).toBe(true);
  });

  it('requires the generation version marker plus parsed method, and never enables Next by inference', async () => {
    const test = await setup();
    for (const generationService of [
      { ...test.generation, storyProtocolVersion: undefined },
      { ...test.generation, createParsedSubscription: undefined },
    ]) {
      const companion = createArenaCompanionRouteService({ generationService, signatures: test.signatures, placement: 'hono-primary' });
      expect(companion.storyProtocolVersion).toBeUndefined();
      configureArenaCompanionRouteService(companion);
      expect((await test.app.request('/api/hosted/dr-readiness')).headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBeNull();
      expect((await test.create()).status).toBe(503);
    }
    const next = createArenaCompanionRouteService({ generationService: test.generation, signatures: test.signatures, placement: 'next-dr' });
    configureArenaCompanionRouteService(next);
    expect(next.storyProtocolVersion).toBeUndefined();
    expect((await test.create()).status).toBe(503);
    const withoutOptIn = createArenaSessionCompanionService({
      generationService: test.generation, signatures: test.signatures,
      acquireRateLimit: () => ({ allowed: true, retryAfterSeconds: 0, release: () => undefined }),
    });
    expect(withoutOptIn.storyProtocolVersion).toBeUndefined();
    expect((await withoutOptIn.generateNext(new Request(`https://hono.test${path}`, {
      method: 'POST', headers: protocolHeaders, body: JSON.stringify(story()),
    }))).status).toBe(503);
    expect(test.reserve).not.toHaveBeenCalled();
  });

  it('keeps story evidence independent of companion JSON and requires ready identity-aware GET', async () => {
    await setup();
    const ready = createHonoDrReadinessHandler(readinessProvider, () => true, () => false, () => false, () => true);
    const response = await ready(new Request('https://hono.test/api/hosted/dr-readiness'));
    expect(response.headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBe(ARENA_STORY_PROTOCOL_VERSION);
    expect(response.headers.get(ARENA_COMPANION_PROTOCOL_HEADER)).toBeNull();
    const failed = createHonoDrReadinessHandler({ ...readinessProvider, openSession: () => null });
    const unavailable = await failed(new Request('https://hono.test/api/hosted/dr-readiness'));
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBeNull();
    const noIdentity = createHonoDrReadinessHandler(readinessProvider, () => false);
    expect((await noIdentity(new Request('https://hono.test/api/hosted/dr-readiness'))).headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBeNull();
    expect((await ready(new Request('https://hono.test/api/hosted/dr-readiness', { method: 'HEAD' }))).headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBeNull();
  });

  it('rejects unknown protocol versions without silently selecting the legacy wrapper', async () => {
    const test = await setup();
    const response = await test.create(story(), { ...accountHeaders, [ARENA_STORY_PROTOCOL_HEADER]: 'arena-story-v2' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'ARENA_STORY_PROTOCOL_UNSUPPORTED' });
    expect(test.reserve).not.toHaveBeenCalled();
  });
});
