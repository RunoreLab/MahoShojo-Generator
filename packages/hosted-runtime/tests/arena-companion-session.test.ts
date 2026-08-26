import { describe, expect, it, vi } from 'vitest';
import type {
  ArenaGenerationService,
  GenerationStreamEvent,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { parseGenerationSseBlock } from '@mahoshojo/hosted-api/arena-generation/sse';
import type { SignatureService } from '../src/signature';
import {
  buildArenaSessionUpstreamRequestBody,
  createArenaSessionCompanionService,
} from '../src/arena-companion/session';

const response = (): Promise<Response> => Promise.resolve(new Response(null));
const streamOf = (...events: GenerationStreamEvent[]): ReadableStream<GenerationStreamEvent> => (
  new ReadableStream({
    start(controller) {
      events.forEach((event) => controller.enqueue(event));
      controller.close();
    },
  })
);

const requestBody = () => ({
  sessionId: 'session-1',
  generationRequestId: 'story-request-1234',
  action: 'start',
  chapterPlan: { totalChapters: 3 },
  chapterContext: {
    recentChapters: [],
    workingCombatants: [{ data: { codename: '角色甲' } }],
  },
  seed: {
    combatants: [{ data: { codename: '角色甲' } }],
    mode: 'classic',
    storyLength: 'standard',
    language: 'zh-CN',
    settings: {
      readArenaHistory: true,
      writeArenaHistory: true,
      readCurrentState: true,
      writeCurrentState: true,
      readNarrativeHistory: false,
      writeNarrativeHistory: false,
    },
  },
  userGuidance: '推进剧情',
});

const parseEvents = (text: string) => text.trim().split(/\n\n/gu).map((block) => {
  const parsed = parseGenerationSseBlock(block)!;
  return { ...parsed, json: JSON.parse(parsed.data) as Record<string, unknown> };
});

describe('Arena session companion service', () => {
  it('直接消费 typed subscription、签名内部引导并保留上游事件 id', async () => {
    const captured: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
    const release = vi.fn();
    const observeLifecycle = vi.fn();
    const generationService: ArenaGenerationService = {
      createSubscription: async (request) => {
        captured.push({
          headers: request.headers,
          body: await request.json() as Record<string, unknown>,
        });
        return {
          generationId: 'arena_story_generation',
          generationRequestId: 'story-request-1234',
          headers: {
            'X-Mahoshojo-Generation-Id': 'arena_story_generation',
            'X-Mahoshojo-Generation-Request-Id': 'story-request-1234',
            'X-Mahoshojo-Stream-Meta': 'encoded-meta',
          },
          events: streamOf(
            { id: '10-0', type: 'markdown', data: { chunk: '# 第一章\n\n开端。\n' } },
            {
              id: '11-0',
              type: 'meta',
              data: { meta: { report: { headline: '第一章', winner: '角色甲' } } },
            },
            { id: '12-0', type: 'done', data: { ok: true, status: 'completed' } },
          ),
        };
      },
      create: () => response(),
      cancelRequest: () => response(),
      lookup: () => response(),
      resume: () => response(),
      status: () => response(),
      cancel: () => response(),
    };
    const signatures: SignatureService = {
      generateSignature: vi.fn(async () => 'guidance-signature'),
      verifySignature: vi.fn(async () => true),
    };
    const service = createArenaSessionCompanionService({
      generationService,
      signatures,
      acquireRateLimit: () => ({ allowed: true, retryAfterSeconds: 0, release }),
      deriveChapterId: async () => 'chapter-stable-1',
      now: () => new Date('2026-08-26T01:02:03.000Z'),
      observeLifecycle,
    });

    const result = await service.generateNext(new Request(
      'https://example.test/api/arena/session/generate-next',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'session=1' },
        body: JSON.stringify(requestBody()),
      },
    ));
    const events = parseEvents(await result.text());

    expect(result.status).toBe(200);
    expect(result.headers.get('x-mahoshojo-generation-id')).toBe('arena_story_generation');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.headers.get('cookie')).toBe('session=1');
    expect(captured[0]!.headers.get('x-mahoshojo-arena-internal-guidance-signature'))
      .toBe('guidance-signature');
    expect(captured[0]!.body).toMatchObject({
      generationRequestId: 'story-request-1234',
      forceStreamMeta: true,
      internalGuidance: expect.stringContaining('连续战报会话'),
    });
    expect(events.map(({ event, id }) => [event, id])).toEqual([
      ['session_meta', null],
      ['markdown', '10-0'],
      ['meta', '11-0'],
      ['chapter_digest', null],
      ['done', '12-0'],
    ]);
    expect(events[0]!.json).toMatchObject({
      sessionId: 'session-1',
      chapterId: 'chapter-stable-1',
      chapterIndex: 1,
      generationId: 'arena_story_generation',
      acceptedAt: new Date('2026-08-26T01:02:03.000Z').getTime(),
    });
    expect(events[3]!.json).toMatchObject({
      chapterId: 'chapter-stable-1',
      chapterTitle: '第一章',
      winner: '角色甲',
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(observeLifecycle).toHaveBeenCalledWith({
      outcome: 'success',
      durationMs: expect.any(Number),
    });
  });

  it('内部引导无法签名时 fail closed，且不会创建 producer', async () => {
    const createSubscription = vi.fn();
    const service = createArenaSessionCompanionService({
      generationService: {
        createSubscription,
        create: () => response(),
        cancelRequest: () => response(),
        lookup: () => response(),
        resume: () => response(),
        status: () => response(),
        cancel: () => response(),
      },
      signatures: {
        generateSignature: async () => null,
        verifySignature: async () => false,
      },
      acquireRateLimit: () => ({ allowed: true, retryAfterSeconds: 0, release: vi.fn() }),
    });

    const result = await service.generateNext(new Request('https://example.test/api/arena/session/generate-next', {
      method: 'POST',
      body: JSON.stringify(requestBody()),
    }));

    expect(result.status).toBe(503);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('subscriber disconnect 只取消 typed subscription 并 exactly-once release lease', async () => {
    const upstreamCancel = vi.fn();
    const rateRelease = vi.fn();
    const observeLifecycle = vi.fn();
    const service = createArenaSessionCompanionService({
      generationService: {
        createSubscription: async () => ({
          generationId: 'arena_story_generation',
          generationRequestId: 'story-request-1234',
          headers: {},
          events: new ReadableStream<GenerationStreamEvent>({
            cancel: upstreamCancel,
          }),
        }),
        create: () => response(),
        cancelRequest: () => response(),
        lookup: () => response(),
        resume: () => response(),
        status: () => response(),
        cancel: () => response(),
      },
      signatures: {
        generateSignature: async () => 'guidance-signature',
        verifySignature: async () => true,
      },
      acquireRateLimit: () => ({
        allowed: true,
        retryAfterSeconds: 0,
        release: rateRelease,
      }),
      deriveChapterId: async () => 'chapter-stable-1',
      observeLifecycle,
    });
    const result = await service.generateNext(new Request(
      'https://example.test/api/arena/session/generate-next',
      { method: 'POST', body: JSON.stringify(requestBody()) },
    ));
    const reader = result.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel('client disconnected');

    await vi.waitFor(() => {
      expect(upstreamCancel).toHaveBeenCalledWith('client disconnected');
      expect(rateRelease).toHaveBeenCalledTimes(1);
      expect(observeLifecycle).toHaveBeenCalledWith({
        outcome: 'cancelled',
        durationMs: expect.any(Number),
      });
    });
  });

  it('typed terminal error 记录真实失败而不是 SSE 建链成功', async () => {
    const observeLifecycle = vi.fn();
    const service = createArenaSessionCompanionService({
      generationService: {
        createSubscription: async () => ({
          generationId: 'arena_story_generation',
          generationRequestId: 'story-request-1234',
          headers: {},
          events: streamOf(
            { id: '10-0', type: 'error', data: { code: 'PROVIDER_FAILED', status: 'failed' } },
          ),
        }),
        create: () => response(),
        cancelRequest: () => response(),
        lookup: () => response(),
        resume: () => response(),
        status: () => response(),
        cancel: () => response(),
      },
      signatures: {
        generateSignature: async () => 'guidance-signature',
        verifySignature: async () => true,
      },
      acquireRateLimit: () => ({ allowed: true, retryAfterSeconds: 0, release: vi.fn() }),
      observeLifecycle,
    });

    const result = await service.generateNext(new Request(
      'https://example.test/api/arena/session/generate-next',
      { method: 'POST', body: JSON.stringify(requestBody()) },
    ));
    expect(result.status).toBe(200);
    await result.text();

    expect(observeLifecycle).toHaveBeenCalledTimes(1);
    expect(observeLifecycle).toHaveBeenCalledWith({
      outcome: 'failure',
      durationMs: expect.any(Number),
    });
  });

  it('取得 lease 后 chapter identity 构造失败也 exactly-once release', async () => {
    const rateRelease = vi.fn();
    const createSubscription = vi.fn();
    const service = createArenaSessionCompanionService({
      generationService: {
        createSubscription,
        create: () => response(),
        cancelRequest: () => response(),
        lookup: () => response(),
        resume: () => response(),
        status: () => response(),
        cancel: () => response(),
      },
      signatures: {
        generateSignature: async () => 'guidance-signature',
        verifySignature: async () => true,
      },
      acquireRateLimit: () => ({
        allowed: true,
        retryAfterSeconds: 0,
        release: rateRelease,
      }),
      deriveChapterId: async () => {
        throw new Error('chapter id unavailable');
      },
    });

    const result = await service.generateNext(new Request(
      'https://example.test/api/arena/session/generate-next',
      { method: 'POST', body: JSON.stringify(requestBody()) },
    ));

    expect(result.status).toBe(500);
    expect(rateRelease).toHaveBeenCalledTimes(1);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('subscription stream 已锁定时 fail closed 并释放 lease', async () => {
    const rateRelease = vi.fn();
    const events = streamOf();
    events.getReader();
    const service = createArenaSessionCompanionService({
      generationService: {
        createSubscription: async () => ({
          generationId: 'arena_story_generation',
          generationRequestId: 'story-request-1234',
          headers: {},
          events,
        }),
        create: () => response(),
        cancelRequest: () => response(),
        lookup: () => response(),
        resume: () => response(),
        status: () => response(),
        cancel: () => response(),
      },
      signatures: {
        generateSignature: async () => 'guidance-signature',
        verifySignature: async () => true,
      },
      acquireRateLimit: () => ({ allowed: true, retryAfterSeconds: 0, release: rateRelease }),
    });

    const result = await service.generateNext(new Request(
      'https://example.test/api/arena/session/generate-next',
      { method: 'POST', body: JSON.stringify(requestBody()) },
    ));

    expect(result.status).toBe(500);
    expect(rateRelease).toHaveBeenCalledTimes(1);
  });

  it('复用请求体投影并保留自定义 provider 与读取上限语义', () => {
    const body = requestBody();
    (body.seed.settings as Record<string, unknown>).readArenaHistoryLimit = 5;
    const projected = buildArenaSessionUpstreamRequestBody(
      body as any,
      '可信内部引导',
      { providerId: 'kourichat', modelId: 'gemini-2.5-flash', apiKey: 'sk-test' },
    );
    expect(projected).toMatchObject({
      arenaHistoryReadLimit: 5,
      internalGuidance: '可信内部引导',
      customProvider: {
        providerId: 'kourichat',
        modelId: 'gemini-2.5-flash',
        apiKey: 'sk-test',
      },
    });
  });
});
