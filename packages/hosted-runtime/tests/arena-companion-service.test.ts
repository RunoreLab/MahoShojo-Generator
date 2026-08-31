import { describe, expect, it, vi } from 'vitest';
import type {
  ArenaGenerationService,
  ArenaGenerationSubscription,
  GenerationStreamEvent,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { createArenaCompanionRouteService } from '../src/arena-companion';
import { createArenaCompanionService } from '../src/arena-companion/service';
import { createArenaGenerationActorResolvers } from '../src/arena-generation/actor';
import {
  ARENA_PVP_GENERATION_SIGNATURE_HEADER,
  ARENA_PVP_GENERATION_SIGNATURE_PURPOSE,
  createArenaPvpGenerationAuthority,
} from '../src/arena-generation/internal-authority';
import { createEnvSignatureService } from '../src/node-runtime/env-signature';

const response = (): Promise<Response> => Promise.resolve(new Response(null));

const generationService = (
  createSubscription: ArenaGenerationService['createSubscription'],
  createParsedSubscription?: NonNullable<ArenaGenerationService['createParsedSubscription']>,
): ArenaGenerationService => ({
  createSubscription,
  ...(createParsedSubscription ? { createParsedSubscription } : {}),
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
  it('preserves the strict PVP payload signature through non-stream request rebuild', async () => {
    const env = { SIGNATURE_SECRET_KEY: 'test-only-companion-pvp-purpose-secret' };
    const signatures = createEnvSignatureService({ env });
    const pvpSignatures = createEnvSignatureService({
      env,
      purpose: ARENA_PVP_GENERATION_SIGNATURE_PURPOSE,
    });
    const pvpAuthority = createArenaPvpGenerationAuthority(pvpSignatures);
    const generationRequestId = 'pvp_request_companion';
    const payload = {
      combatants: [{ name: 'A' }, { name: 'B' }],
      mode: 'classic',
      forceStreamMeta: true,
      internalGuidance: 'server-owned PVP rule',
      pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
    };
    const signature = await pvpAuthority.sign({ generationRequestId, payload });
    const { resolveActor, resolveCreateActor } = createArenaGenerationActorResolvers({
      env: { ...env, HONO_AUTH_MODE: 'bearer' },
      signatures,
      pvpSignatures,
      getD1Client: () => ({
        prepare: vi.fn(() => ({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn(async () => ({ success: true, results: [{ id: 42 }], meta: {} })),
          run: vi.fn(async () => ({ success: true, results: [], meta: {} })),
        })),
      }),
    });
    const createSubscription = vi.fn();
    const createParsedSubscription = vi.fn(async (
      request: Request,
      command: Parameters<NonNullable<ArenaGenerationService['createParsedSubscription']>>[1],
    ) => {
      const actor = await resolveActor(request);
      expect(actor).toEqual({ actorKey: 'user:42' });
      await expect(resolveCreateActor({
        request,
        actor: actor!,
        generationRequestId: command.generationRequestId,
        payload: command.payload,
      })).resolves.toEqual({ actorKey: 'pvp-room:room-1' });
      expect(command).toMatchObject({
        generationRequestId,
        payload: { ...payload, forceStreamMeta: true },
      });
      expect(command.bodyBytes).toBeGreaterThan(0);
      expect(request.body).toBeNull();
      return Response.json({ code: 'TEST_STOP' }, { status: 409 });
    });
    const service = createArenaCompanionService({
      generationService: generationService(createSubscription, createParsedSubscription),
      createGenerationRequestId: () => generationRequestId,
      projectUpdatedCombatants: vi.fn(async () => []),
    });

    const result = await service.generate(new Request(
      'https://example.test/api/generate-battle-story',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer caller-token',
          'Content-Type': 'application/json',
          [ARENA_PVP_GENERATION_SIGNATURE_HEADER]: signature!,
        },
        body: JSON.stringify({ generationRequestId, ...payload }),
      },
    ));

    expect(result.status).toBe(409);
    expect(createParsedSubscription).toHaveBeenCalledTimes(1);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('preserves the durable terminal marker when projecting a failed fallback', async () => {
    const failedFallback: ArenaGenerationSubscription = {
      generationId: 'arena_generation_failed',
      generationRequestId: 'request-failed-fallback',
      headers: {
        'X-Mahoshojo-Generation-Id': 'arena_generation_failed',
        'X-Mahoshojo-Generation-Request-Id': 'request-failed-fallback',
        'X-Mahoshojo-Generation-Fallback': 'terminal',
        'x-mahoshojo-generation-terminal-status': 'failed',
      },
      events: streamOf({
        id: '1-0',
        type: 'error',
        data: { ok: false, status: 'failed', code: 'PROVIDER_FAILED' },
      }),
    };
    const service = createArenaCompanionService({
      generationService: generationService(async () => failedFallback),
      projectUpdatedCombatants: vi.fn(async () => []),
    });

    const response = await service.generate(new Request(
      'https://example.test/api/generate-battle-story',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationRequestId: 'request-failed-fallback',
          combatants: [{ name: 'A' }, { name: 'B' }],
        }),
      },
    ));

    expect(response.status).toBe(502);
    expect(response.headers.get('x-mahoshojo-generation-id'))
      .toBe('arena_generation_failed');
    expect(response.headers.get('x-mahoshojo-generation-terminal-status')).toBe('failed');
  });

  it('emits trusted route/placement telemetry for rejected companion calls', async () => {
    const observeArenaGeneration = vi.fn();
    const service = createArenaCompanionRouteService({
      generationService: generationService(vi.fn()),
      signatures: {
        generateSignature: async () => 'signature',
        verifySignature: async () => false,
      },
      placement: 'next-dr',
      observer: { observeArenaGeneration },
    });

    const result = await service.generate(
      new Request('https://example.test/api/generate-battle-story'),
      'generate-battle-story',
    );

    expect(result.status).toBe(405);
    expect(observeArenaGeneration).toHaveBeenCalledWith({
      event: 'companion',
      operation: 'generate-battle-story',
      placement: 'next-dr',
      outcome: 'rejected',
      durationMs: expect.any(Number),
    });
  });

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
          { id: '2-0', type: 'markdown', data: { chunk: '\n## 记者点' } },
          { id: '2-1', type: 'markdown', data: { chunk: '评\n> 这一胜利暴露了旧秩序的裂缝。\n\n## 胜利者\n角色甲\n\n## 最终结果\n世界恢复平静。' } },
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
        article: {
          body: '正文段落',
          analysis: '这一胜利暴露了旧秩序的裂缝。',
        },
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

  it('从 snapshot replay 投影记者点评且不把点评混入正文', async () => {
    const service = createArenaCompanionService({
      generationService: generationService(async () => subscription([
        {
          id: '20-0',
          type: 'snapshot',
          data: {
            markdown: [
              '# 重放战报',
              '',
              '重放正文。',
              '',
              '## 记者点评',
              '重放仍应保持同一份点评。',
              '',
              '## 胜利者',
              '角色甲',
              '',
              '## 最终结果',
              '重放完成。',
            ].join('\n'),
          },
        },
        { id: '21-0', type: 'done', data: { ok: true, status: 'completed' } },
      ])),
      createGenerationRequestId: () => 'request-12345678',
      projectUpdatedCombatants: async () => [],
    });

    const result = await service.generate(new Request('https://example.test/api/generate-battle-story', {
      method: 'POST',
      body: '{}',
    }));
    const json = await result.json() as Record<string, any>;

    expect(result.status).toBe(200);
    expect(json.report.article).toEqual({
      body: '重放正文。',
      analysis: '重放仍应保持同一份点评。',
    });
  });

  it('从 structured JSON snapshot 原样投影 non-stream 战报与 impacts', async () => {
    const structured = {
      headline: '结构化重放战报',
      article: {
        body: '正文中可以自由出现\n## 胜利者\n而不应被 Markdown parser 截断。',
        analysis: '独立的记者点评。',
      },
      officialReport: { winner: '角色乙', conclusion: '结构化结论。' },
      impacts: [{ characterName: '角色乙', impact: '获得成长' }],
    };
    const projectUpdatedCombatants = vi.fn(async () => []);
    const service = createArenaCompanionService({
      generationService: generationService(async () => subscription([
        {
          id: '30-0',
          type: 'snapshot',
          data: { markdown: JSON.stringify(structured) },
        },
        {
          id: '30-1',
          type: 'telemetry',
          data: {
            model: 'reasoning-model',
            reasoning: {
              status: 'done',
              source: 'sdk',
              summary: '推理摘要',
              text: '结构化模型推理',
              reasoningTokens: 8,
            },
          },
        },
        { id: '31-0', type: 'done', data: { ok: true, status: 'completed' } },
      ])),
      createGenerationRequestId: () => 'request-12345678',
      projectUpdatedCombatants,
    });

    const result = await service.generate(new Request('https://example.test/api/arena/generate', {
      method: 'POST',
      body: JSON.stringify({ writeArenaHistory: true, writeCurrentState: false }),
    }));
    const json = await result.json() as Record<string, any>;

    expect(result.status).toBe(200);
    expect(json.report).toMatchObject(structured);
    expect(json.report.aiReasoning).toEqual({
      status: 'done',
      source: 'sdk',
      summary: '推理摘要',
      text: '结构化模型推理',
      reasoningTokens: 8,
    });
    expect(json.impacts).toEqual(structured.impacts);
    expect(projectUpdatedCombatants).toHaveBeenCalledWith(expect.objectContaining({
      report: expect.objectContaining(structured),
      impacts: structured.impacts,
    }));
  });

  it('当前 structured contract 的 malformed snapshot 必须 fail closed', async () => {
    const malformed: ArenaGenerationSubscription = {
      ...subscription([]),
      headers: {
        ...subscription([]).headers,
        'X-Mahoshojo-Stream-Meta': encodeURIComponent(JSON.stringify({
          outputContract: 'structured-report',
        })),
      },
      events: streamOf(
        { id: '40-0', type: 'snapshot', data: { markdown: 'not-json' } },
        { id: '41-0', type: 'done', data: { ok: true, status: 'completed' } },
      ),
    };
    const service = createArenaCompanionService({
      generationService: generationService(async () => malformed),
      createGenerationRequestId: () => 'request-12345678',
      projectUpdatedCombatants: async () => [],
    });

    const result = await service.generate(new Request('https://example.test/api/arena/generate', {
      method: 'POST',
      body: '{}',
    }));

    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({
      code: 'ARENA_STRUCTURED_REPORT_INVALID',
      error: 'Arena structured report validation failed',
      generationId: 'arena_generation_1',
    });
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

  it('typed terminal error 保留显式安全的 Provider 诊断', async () => {
    const service = createArenaCompanionService({
      generationService: generationService(async () => subscription([
        {
          id: '2-0',
          type: 'error',
          data: {
            code: 'AI_UPSTREAM_REQUEST_FAILED',
            status: 'failed',
            error: 'AI_APICallError: 余额不足（HTTP 402）',
            upstreamStatus: 402,
          },
        },
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
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      error: 'AI_APICallError: 余额不足（HTTP 402）',
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
