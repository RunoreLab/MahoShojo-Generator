import { describe, expect, it, vi } from 'vitest';
import { ARENA_STORY_PROTOCOL_HEADER, ARENA_STORY_PROTOCOL_VERSION, ArenaStoryCreateRequestSchema, type ArenaStoryCreateRequest } from '@mahoshojo/contracts/arena-story';
import { buildBattleStoryArenaRequest } from '@mahoshojo/domain/arena-battle-story-request';
import { countBattleStoryCommitJsonBytes } from '@mahoshojo/domain/arena-story-commit';
import type { ArenaGenerationCreateCommand, ArenaGenerationService, GenerationStreamEvent } from '@mahoshojo/hosted-api/arena-generation/service';
import { ARENA_RESOURCE_BUDGET } from '@mahoshojo/hosted-api/arena-generation/resource-budget';
import { parseGenerationSseBlock } from '@mahoshojo/hosted-api/arena-generation/sse';
import { buildArenaSessionUpstreamRequestBody, createArenaSessionCompanionService } from '../src/arena-companion/session';

const fixture = (): ArenaStoryCreateRequest => ({
  version: 1, sessionId: 'story-1', generationRequestId: 'story-request-1234', action: 'continue', chapterIndex: 2, sourceChapterId: 'chapter-1',
  chapterContext: { workingCombatants: [{ data: { name: 'A' } }], recentWindow: [{ chapterId: 'chapter-1', chapterIndex: 1, title: '第一章', mode: 'digest', text: '完整的摘要', truncated: false }] },
  seed: { combatants: [{ data: { name: 'A' } }], mode: 'daily', storyLength: 'standard', language: 'zh-CN', settings: {
    readArenaHistory: false, writeArenaHistory: false, readCurrentState: false, writeCurrentState: false,
    readNarrativeHistory: false, writeNarrativeHistory: false,
  } },
});
const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const expanded = (body: ArenaStoryCreateRequest) => buildArenaSessionUpstreamRequestBody(body, buildBattleStoryArenaRequest(body).internalGuidance, null);
const stream = (events: GenerationStreamEvent[]) => new ReadableStream<GenerationStreamEvent>({ start(controller) { for (const event of events) controller.enqueue(event); controller.close(); } });
const setup = (events?: GenerationStreamEvent[]) => {
  const commands: ArenaGenerationCreateCommand[] = [];
  const createParsedSubscription = vi.fn(async (_request: Request, command: ArenaGenerationCreateCommand) => {
    commands.push(command);
    return events ? { generationId: 'generation_1', generationRequestId: command.generationRequestId, headers: {}, events: stream(events) }
      : new Response(null, { status: 418 });
  });
  const noop = async () => new Response(null, { status: 503 });
  const generationService: ArenaGenerationService = { storyProtocolVersion: ARENA_STORY_PROTOCOL_VERSION, createParsedSubscription,
    createSubscription: vi.fn(noop), create: noop, lookup: noop, resume: noop, status: noop, cancel: noop, cancelRequest: noop };
  const generateSignature = vi.fn(async () => 'synthetic-signature');
  const release = vi.fn();
  const acquireRateLimit = vi.fn(() => ({ allowed: true as const, retryAfterSeconds: 0 as const, release }));
  const options = { generationService, signatures: { generateSignature, verifySignature: async () => true }, acquireRateLimit, storyProtocolEnabled: true };
  const service = createArenaSessionCompanionService(options);
  const request = (body: unknown, headers: Record<string, string> = { [ARENA_STORY_PROTOCOL_HEADER]: ARENA_STORY_PROTOCOL_VERSION }) => new Request('https://synthetic.test/api/arena/session/generate-next', { method: 'POST', headers, body: JSON.stringify(body) });
  return { ...options, options, commands, service, request, createParsedSubscription, generateSignature, release };
};

describe('opt-in story protocol producer and independent byte budgets', () => {
  it('uses the exact shared window projection and a separate trusted identity, without wrapper/digest or private telemetry', async () => {
    const test = setup([
      { id: '1-0', type: 'markdown', data: { chunk: '原文' } },
      { id: '2-0', type: 'telemetry', data: { model: 'synthetic-model', usage: { totalTokens: 4 }, providerName: 'private' } },
      { id: '3-0', type: 'done', data: { ok: true, status: 'completed' } },
    ]);
    const body = fixture();
    const response = await test.service.generateNext(test.request(body));
    const events = (await response.text()).trim().split('\n\n').map((block) => parseGenerationSseBlock(block)!);
    expect(response.headers.get(ARENA_STORY_PROTOCOL_HEADER)).toBe(ARENA_STORY_PROTOCOL_VERSION);
    expect(events.map(({ id, event }) => [id, event])).toEqual([['1-0', 'markdown'], ['2-0', 'telemetry'], ['3-0', 'done']]);
    expect(JSON.parse(events[1]!.data)).toEqual({ version: 1, aiModel: 'synthetic-model', usage: { totalTokens: 4 } });
    expect(test.commands[0]!.payload).toEqual(buildBattleStoryArenaRequest(body));
    expect(test.commands[0]!.trustedStoryIdentity).toEqual({ version: 1, sessionId: body.sessionId, action: 'continue', chapterIndex: 2, sourceChapterId: 'chapter-1' });
    expect(test.commands[0]!.bodyBytes).toBe(jsonBytes(expanded(body)));
    expect(test.commands[0]!.bodyBytes).not.toBe(jsonBytes(body));
    expect(test.commands[0]!.payload.internalGuidance).toContain('（摘要）\n完整的摘要');
    expect(test.release).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1])('checks the actual incoming wrapper at 12 MiB + %i even without content-length', async (over) => {
    const test = setup(); const body = fixture();
    const data = (body.seed.combatants[0] as { data: Record<string, unknown> }).data;
    data.padding = '';
    data.padding = 'x'.repeat(ARENA_RESOURCE_BUDGET.hardBodyBytes - jsonBytes(body) + over);
    expect(jsonBytes(body)).toBe(ARENA_RESOURCE_BUDGET.hardBodyBytes + over);
    expect(jsonBytes(expanded(body))).toBeLessThan(4096);
    const response = await test.service.generateNext(test.request(body));
    expect(response.status).toBe(over ? 413 : 418);
    expect(test.createParsedSubscription).toHaveBeenCalledTimes(over ? 0 : 1);
    expect(test.generateSignature).toHaveBeenCalledTimes(over ? 0 : 1);
    expect(test.acquireRateLimit).toHaveBeenCalledTimes(over ? 0 : 1);
  });

  it('counts the actual producer faithfully across the 8192 UTF-16 fragment boundary', async () => {
    const test = setup(); const body = fixture();
    const item = body.chapterContext.recentWindow[0]!;
    item.text = 'MARKER';
    const start = String(expanded(body).internalGuidance).indexOf('MARKER');
    expect(start).toBeGreaterThan(0);
    item.text = 'x'.repeat(8191 - start % 8192) + '😀\ud800x\udfff\u0000汉é';
    const upstream = expanded(body);
    expect(String(upstream.internalGuidance).indexOf('😀') % 8192).toBe(8191);
    expect(countBattleStoryCommitJsonBytes(upstream)).toBe(jsonBytes(upstream));
    expect((await test.service.generateNext(test.request(body))).status).toBe(418);
    expect(test.commands[0]!.bodyBytes).toBe(jsonBytes(upstream));
    expect(test.commands[0]!.payload.internalGuidance).toBe(upstream.internalGuidance);
  });

  it.each([0, 1])('preflights the real expanded JSON producer at 12 MiB + %i with escaped controls, Unicode and lone surrogates', async (over) => {
    const test = setup(); const body = fixture();
    const item = body.chapterContext.recentWindow[0]!;
    item.text = '\u0000\u0001\n\t"\\汉é😀\ud800x\udfff';
    const overhead = jsonBytes(expanded(body));
    item.text += 'x'.repeat(ARENA_RESOURCE_BUDGET.hardBodyBytes - overhead + over);
    const upstream = expanded(body);
    expect(jsonBytes(body)).toBeLessThan(ARENA_RESOURCE_BUDGET.hardBodyBytes);
    expect(jsonBytes(upstream)).toBe(ARENA_RESOURCE_BUDGET.hardBodyBytes + over);
    expect(countBattleStoryCommitJsonBytes(upstream)).toBe(jsonBytes(upstream));
    const response = await test.service.generateNext(test.request(body));
    expect(response.status).toBe(over ? 413 : 418);
    expect(test.createParsedSubscription).toHaveBeenCalledTimes(over ? 0 : 1);
    expect(test.generateSignature).toHaveBeenCalledTimes(over ? 0 : 1);
    expect(test.acquireRateLimit).toHaveBeenCalledTimes(over ? 0 : 1);
    if (!over) {
      expect(test.commands[0]!.bodyBytes).toBe(ARENA_RESOURCE_BUDGET.hardBodyBytes);
      expect(test.commands[0]!.payload.internalGuidance).toContain(item.text);
    }
  });

  it('fails closed on an unsupported version/runtime instead of switching to the legacy DTO', async () => {
    const test = setup();
    for (const version of ['', 'arena-story-v2', 'arena-story-v1,arena-story-v1']) {
      expect((await test.service.generateNext(test.request(fixture(), { [ARENA_STORY_PROTOCOL_HEADER]: version }))).status).toBe(400);
    }
    for (const options of [
      { ...test.options, storyProtocolEnabled: false },
      { ...test.options, generationService: { ...test.generationService, storyProtocolVersion: undefined } },
      { ...test.options, generationService: { ...test.generationService, createParsedSubscription: undefined } },
    ]) {
      const service = createArenaSessionCompanionService(options);
      expect(service.storyProtocolVersion).toBeUndefined();
      expect((await service.generateNext(test.request(fixture()))).status).toBe(503);
    }
    expect(test.createParsedSubscription).not.toHaveBeenCalled();
    expect(test.generationService.createSubscription).not.toHaveBeenCalled();
  });

  it.each(['internalGuidance', 'adjudicationResults', 'trustedStoryIdentity', '__arenaServerStoryIdentityV1', 'url', 'headers', 'reportFormat'])('rejects untrusted top-level %s', async (field) => {
    const test = setup();
    expect((await test.service.generateNext(test.request({ ...fixture(), [field]: 'forged' }))).status).toBe(400);
    expect(test.generateSignature).not.toHaveBeenCalled(); expect(test.createParsedSubscription).not.toHaveBeenCalled();
  });

  it('retains the 32-role and 12-window limits and rejects ambiguous or invalid linear identity', () => {
    const body = fixture();
    body.seed.combatants = body.chapterContext.workingCombatants = Array.from({ length: 32 }, () => ({ data: { name: 'A' } }));
    expect(ArenaStoryCreateRequestSchema.safeParse(body).success).toBe(true);
    body.chapterContext.workingCombatants.push({ data: { name: 'B' } });
    expect(ArenaStoryCreateRequestSchema.safeParse(body).success).toBe(false);
    const invalid = [
      { ...fixture(), chapterIndex: undefined }, { ...fixture(), sourceChapterId: undefined },
      { ...fixture(), action: 'branch' }, { ...fixture(), action: 'rewrite' },
      { ...fixture(), chapterIndex: 3 }, { ...fixture(), sourceChapterId: 'other' },
      { ...fixture(), chapterPlan: { totalChapters: 1 } },
      { ...fixture(), chapterContext: { ...fixture().chapterContext, recentChapters: [] } },
      { ...fixture(), chapterContext: { ...fixture().chapterContext, recentWindow: Array(13).fill(fixture().chapterContext.recentWindow[0]) } },
    ];
    for (const value of invalid) expect(ArenaStoryCreateRequestSchema.safeParse(value).success).toBe(false);
  });
});
