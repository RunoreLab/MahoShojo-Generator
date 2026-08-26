import { describe, expect, it, vi } from 'vitest';
import type {
  ArenaGenerationService,
  ArenaGenerationSubscription,
  GenerationStreamEvent,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { createArenaCompanionService } from '../src/arena-companion/service';

const response = (): Promise<Response> => Promise.resolve(new Response(null));

const generationService = (
  createSubscription: ArenaGenerationService['createSubscription'],
): ArenaGenerationService => ({
  createSubscription,
  create: () => response(),
  cancelRequest: () => response(),
  lookup: () => response(),
  resume: () => response(),
  status: () => response(),
  cancel: () => response(),
});

const streamOf = (...events: GenerationStreamEvent[]): ReadableStream<GenerationStreamEvent> => (
  new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(event);
      controller.close();
    },
  })
);

const subscription = (events: GenerationStreamEvent[]): ArenaGenerationSubscription => ({
  generationId: 'arena_generation_1',
  generationRequestId: 'request-12345678',
  headers: {
    'X-Mahoshojo-Generation-Id': 'arena_generation_1',
    'X-Mahoshojo-Generation-Request-Id': 'request-12345678',
    'X-Mahoshojo-Stream-Meta': encodeURIComponent(JSON.stringify({
      reporterInfo: { name: '记者甲', publication: '魔法记录报' },
      userGuidance: '延续上一章',
      narrativeHistoryReadCount: 2,
      adjudicationResults: [{ type: 'binary', outcome: 'success' }],
    })),
  },
  events: streamOf(...events),
});

describe('Arena companion service', () => {
  it('通过 typed subscription 复用唯一 producer 并投影兼容 JSON', async () => {
    const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
    const projectUpdatedCombatants = vi.fn(async () => [{ codename: '角色甲' }]);
    const service = createArenaCompanionService({
      generationService: generationService(async (request) => {
        captured.push({
          url: request.url,
          body: await request.json() as Record<string, unknown>,
        });
        return subscription([
          { id: '1-0', type: 'markdown', data: { chunk: '# 星海决战\n\n正文段落\n' } },
          { id: '2-0', type: 'markdown', data: { chunk: '\n## 胜利者\n角色甲\n\n## 最终结果\n世界恢复平静。' } },
          {
            id: '3-0',
            type: 'meta',
            data: {
              parseOk: true,
              meta: {
                version: 1,
                report: { headline: '星海决战', winner: '角色甲' },
                impacts: [{ characterName: '角色甲', impact: '获得成长' }],
              },
            },
          },
          { id: '4-0', type: 'telemetry', data: { model: 'model-a', usage: { totalTokens: 42 } } },
          { id: '5-0', type: 'done', data: { ok: true, status: 'completed' } },
        ]);
      }),
      createGenerationRequestId: () => 'request-12345678',
      projectUpdatedCombatants,
    });

    const result = await service.generate(new Request('https://example.test/api/arena/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'session=1' },
      body: JSON.stringify({
        combatants: [{ data: { codename: '角色甲' } }],
        mode: 'classic',
        writeArenaHistory: true,
        writeCurrentState: false,
      }),
    }));
    const json = await result.json() as Record<string, any>;

    expect(result.status).toBe(200);
    expect(result.headers.get('x-mahoshojo-generation-id')).toBe('arena_generation_1');
    expect(captured).toEqual([{
      url: 'https://example.test/api/arena/generate',
      body: expect.objectContaining({
        forceStreamMeta: true,
        generationRequestId: 'request-12345678',
      }),
    }]);
    expect(json).toMatchObject({
      generationId: 'arena_generation_1',
      report: {
        headline: '星海决战',
        reporterInfo: { name: '记者甲', publication: '魔法记录报' },
        article: { body: '正文段落' },
        officialReport: { winner: '角色甲', conclusion: '世界恢复平静。' },
        aiModel: 'model-a',
        aiUsage: { totalTokens: 42 },
        narrativeHistoryReadCount: 2,
      },
      updatedCombatants: [{ codename: '角色甲' }],
      adjudicationResults: [{ type: 'binary', outcome: 'success' }],
      impacts: [{ characterName: '角色甲', impact: '获得成长' }],
    });
    expect(projectUpdatedCombatants).toHaveBeenCalledTimes(1);
    expect(projectUpdatedCombatants).toHaveBeenCalledWith(expect.objectContaining({
      generationId: 'arena_generation_1',
      occurredAt: '1970-01-01T00:00:00.001Z',
      writeArenaHistory: true,
      writeCurrentState: false,
    }));
  });

  it('沿用调用方 generationRequestId 并透传 preflight 失败响应', async () => {
    const captured = vi.fn();
    const service = createArenaCompanionService({
      generationService: generationService(async (request) => {
        captured(await request.json());
        return new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
      createGenerationRequestId: () => 'must-not-be-used',
      projectUpdatedCombatants: async () => [],
    });

    const result = await service.generate(new Request('https://example.test/api/generate-battle-story', {
      method: 'POST',
      body: JSON.stringify({ generationRequestId: 'caller-request-1234' }),
    }));

    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ code: 'UNAUTHORIZED' });
    expect(captured).toHaveBeenCalledWith(expect.objectContaining({
      generationRequestId: 'caller-request-1234',
    }));
  });

  it('typed terminal error 不返回半成品成功响应', async () => {
    const service = createArenaCompanionService({
      generationService: generationService(async () => subscription([
        { id: '1-0', type: 'markdown', data: { chunk: '# 半成品' } },
        { id: '2-0', type: 'error', data: { code: 'PROVIDER_FAILED', status: 'failed' } },
      ])),
      createGenerationRequestId: () => 'request-12345678',
      projectUpdatedCombatants: async () => [],
    });

    const result = await service.generate(new Request('https://example.test/api/arena/generate', {
      method: 'POST',
      body: '{}',
    }));

    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({
      code: 'PROVIDER_FAILED',
      error: 'Arena generation failed',
      generationId: 'arena_generation_1',
    });
  });

  it('typed stream 读取失败仍返回已分配的稳定 generationId', async () => {
    const service = createArenaCompanionService({
      generationService: generationService(async () => ({
        ...subscription([]),
        events: new ReadableStream<GenerationStreamEvent>({
          start(controller) {
            controller.error(new Error('replay transport failed'));
          },
        }),
      })),
      createGenerationRequestId: () => 'request-12345678',
      projectUpdatedCombatants: async () => [],
    });

    const result = await service.generate(new Request('https://example.test/api/arena/generate', {
      method: 'POST',
      body: '{}',
    }));

    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({
      code: 'GENERATION_STREAM_FAILED',
      error: 'Arena generation stream failed',
      generationId: 'arena_generation_1',
    });
  });

  it('本地投影失败不会伪装成功且保留稳定 generationId', async () => {
    const service = createArenaCompanionService({
      generationService: generationService(async () => subscription([
        { id: '1-0', type: 'markdown', data: { chunk: '# 完整战报' } },
        { id: '2-0', type: 'done', data: { ok: true, status: 'completed' } },
      ])),
      createGenerationRequestId: () => 'request-12345678',
      projectUpdatedCombatants: async () => {
        throw new Error('projection failed');
      },
    });

    const result = await service.generate(new Request('https://example.test/api/arena/generate', {
      method: 'POST',
      body: '{}',
    }));

    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({
      code: 'ARENA_COMPANION_PROJECTION_FAILED',
      error: 'Arena companion projection failed',
      generationId: 'arena_generation_1',
    });
  });

  it('显式无效 generationRequestId 不会被静默替换', async () => {
    const createSubscription = vi.fn();
    const service = createArenaCompanionService({
      generationService: generationService(createSubscription),
      createGenerationRequestId: () => 'request-12345678',
      projectUpdatedCombatants: async () => [],
    });
    const result = await service.generate(new Request('https://example.test/api/arena/generate', {
      method: 'POST',
      body: JSON.stringify({ generationRequestId: 'bad id' }),
    }));

    expect(result.status).toBe(400);
    expect(createSubscription).not.toHaveBeenCalled();
  });
});
