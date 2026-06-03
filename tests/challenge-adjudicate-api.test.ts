import { describe, expect, test } from 'vitest';

describe('api/challenge/adjudicate-stream', () => {
  test('SSE 请求会直接返回流响应，而不是等待完整裁定结束后再回放', async () => {
    const { createChallengeAdjudicateStreamHandler } = await import('@/app/api/challenge/adjudicate-stream/handler');

    let releaseAdjudication!: () => void;
    const slowAdjudication = new Promise<any>((resolve) => {
      releaseAdjudication = () =>
        resolve({
          finalSource: 'ai',
          storyMarkdown: '延后完成的正文',
          storyMarkdownWithMeta: [
            '延后完成的正文',
            '<!-- MAHOSHOJO_ARENA_META {"version":1,"adjudication":{"outcome":"victory","trackDeltas":{"hp":-6},"addStatuses":[],"removeStatuses":[],"rewardOptionId":null,"summary":"延后完成"}} -->',
          ].join('\n'),
          generation: null,
        });
    });

    const handler = createChallengeAdjudicateStreamHandler({
      adjudicateChallengeRequest: async () => slowAdjudication,
      streamChallengeRequest: async () =>
        new Response(
          [
            'event: reasoning',
            'data: {"source":"sdk","status":"thinking","chunk":"先读取输入。"}',
            '',
            'event: markdown',
            'data: {"chunk":"这是实时返回的首段。"}',
            '',
            'event: done',
            'data: {"ok":true,"finalSource":"ai"}',
            '',
          ].join('\n'),
          {
            status: 200,
            headers: {
              'content-type': 'text/event-stream; charset=utf-8',
            },
          }
        ),
    } as any);

    const request = new Request('https://example.com/api/challenge/adjudicate-stream?format=sse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        runState: {
          version: 1,
          runId: 'run-early-stream',
          worldPresetId: 'arena',
          runSeed: 'run-seed-early-stream',
          status: 'in_progress',
          playerSnapshot: null,
          worldState: {
            version: 1,
            schemaId: 'arena-v1',
            tracks: {
              hp: { current: 80, max: 100 },
              radiance: { current: 50, max: 100 },
              currency: { current: 12, max: null },
            },
            temporaryStatuses: [],
            runFlags: [],
            persistentItemIds: [],
            consumableIds: [],
          },
          mapState: {
            version: 1,
            rootNodeId: 'ROOT',
            totalLayers: 1,
            bossNodeId: 'L1-N1',
            nodes: [
              {
                version: 1,
                nodeId: 'L1-N1',
                layer: 1,
                nodeType: 'battle',
                visibility: 'focused',
                riskHint: 'mid',
                rewardHint: 'mid',
                encounterRef: 'arena:battle:L1-N1',
              },
            ],
            edges: [],
          },
          pendingRewardChoice: null,
          currentNodeId: 'L1-N1',
          visitedNodeCount: 0,
          checkpointSeq: 1,
          usedBootstrapReroll: false,
          startedAt: 1,
          updatedAt: 1,
        },
        encounter: {
          version: 1,
          nodeId: 'L1-N1',
          templateId: 'arena-battle-L1-N1',
          kind: 'battle',
          inputMode: 'recommended-action-plus-free-intent',
          enemySnapshot: {
            version: 1,
            sourceType: 'preset',
            sourceId: 'preset:snowy',
            displayName: '雪绒',
            strengthTier: 'common',
            combatProfile: {},
            tags: ['游击'],
            promptSummary: '善于高速游走与试探。',
          },
          rewardOptions: [],
          eventOptions: [],
          shopOffers: [],
        },
        playerInput: { note: '先观察，再出手。' },
      }),
    });

    const responsePromise = handler(request);
    const raceResult = await Promise.race([
      responsePromise.then(() => 'resolved' as const),
      new Promise<'pending'>((resolve) => {
        setTimeout(() => resolve('pending'), 20);
      }),
    ]);

    releaseAdjudication();
    const response = await responsePromise;

    expect(raceResult).toBe('resolved');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
  });

  test('adjudicate-stream returns SSE markdown and done event', async () => {
    const { createChallengeAdjudicateStreamHandler } = await import('@/app/api/challenge/adjudicate-stream/handler');

    const validRunState = {
      version: 1,
      runId: 'run-1',
      worldPresetId: 'arena',
      runSeed: 'run-seed-1',
      status: 'in_progress',
      playerSnapshot: null,
      worldState: {
        version: 1,
        schemaId: 'arena-v1',
        tracks: {
          hp: { current: 80, max: 100 },
          radiance: { current: 50, max: 100 },
          currency: { current: 12, max: null },
        },
        temporaryStatuses: [],
        runFlags: [],
        persistentItemIds: [],
        consumableIds: [],
      },
      mapState: {
        version: 1,
        rootNodeId: 'ROOT',
        totalLayers: 1,
        bossNodeId: 'L1-N1',
        nodes: [
          {
            version: 1,
            nodeId: 'L1-N1',
            layer: 1,
            nodeType: 'battle',
            visibility: 'focused',
            riskHint: 'mid',
            rewardHint: 'mid',
            encounterRef: 'arena:battle:L1-N1',
          },
        ],
        edges: [],
      },
      pendingRewardChoice: null,
      currentNodeId: 'L1-N1',
      visitedNodeCount: 0,
      checkpointSeq: 1,
      usedBootstrapReroll: false,
      startedAt: 1,
      updatedAt: 1,
    };

    const validEncounter = {
      version: 1,
      nodeId: 'L1-N1',
      templateId: 'arena-battle-L1-N1',
      kind: 'battle',
      inputMode: 'recommended-action-plus-free-intent',
      enemySnapshot: {
        version: 1,
        sourceType: 'preset',
        sourceId: 'preset:snowy',
        displayName: '雪绒',
        strengthTier: 'common',
        combatProfile: {},
        tags: ['游击'],
        promptSummary: '善于高速游走与试探。',
      },
      rewardOptions: [],
      eventOptions: [],
      shopOffers: [],
    };

    const handler = createChallengeAdjudicateStreamHandler({
      adjudicateChallengeRequest: async () =>
        ({
          finalSource: 'ai',
          storyMarkdown: '战斗正文第一段',
          storyMarkdownWithMeta: [
            '战斗正文第一段',
            '<!-- MAHOSHOJO_ARENA_META {"version":1,"adjudication":{"outcome":"victory","trackDeltas":{"hp":-12},"addStatuses":[],"removeStatuses":[],"rewardOptionId":null,"summary":"险胜"}} -->',
          ].join('\n'),
          generation: null,
        }) as any,
      streamChallengeRequest: async () =>
        new Response(
          [
            'event: markdown',
            'data: {"chunk":"战斗正文第一段\\n<!-- MAHOSHOJO_ARENA_META {\\"version\\":1,\\"adjudication\\":{\\"outcome\\":\\"victory\\",\\"trackDeltas\\":{\\"hp\\":-12},\\"addStatuses\\":[],\\"removeStatuses\\":[],\\"rewardOptionId\\":null,\\"summary\\":\\"险胜\\"}} -->"}',
            '',
            'event: done',
            'data: {"ok":true,"finalSource":"ai"}',
            '',
          ].join('\n'),
          {
            status: 200,
            headers: {
              'content-type': 'text/event-stream; charset=utf-8',
            },
          }
        ),
    });

    const response = await handler(
      new Request('https://example.com/api/challenge/adjudicate-stream?format=sse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          runState: validRunState,
          encounter: validEncounter,
          playerInput: { note: '先观察，再出手。' },
        }),
      })
    );

    const text = await response.text();
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain('event: markdown');
    expect(text).toContain('MAHOSHOJO_ARENA_META');
    expect(text).toContain('event: done');
  });

  test('非 POST 请求会返回 405', async () => {
    const { createChallengeAdjudicateStreamHandler } = await import('@/app/api/challenge/adjudicate-stream/handler');

    const handler = createChallengeAdjudicateStreamHandler({
      adjudicateChallengeRequest: async () => {
        throw new Error('should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.com/api/challenge/adjudicate-stream', {
        method: 'GET',
      })
    );

    expect(response.status).toBe(405);
  });

  test('缺少 runState 或 encounter 时返回 400', async () => {
    const { createChallengeAdjudicateStreamHandler } = await import('@/app/api/challenge/adjudicate-stream/handler');

    const handler = createChallengeAdjudicateStreamHandler({
      adjudicateChallengeRequest: async () => {
        throw new Error('should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.com/api/challenge/adjudicate-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerInput: { note: '没有必要字段。' },
        }),
      })
    );

    expect(response.status).toBe(400);
  });

  test('runState 或 encounter 结构不完整时返回 400，而不是落入内部 500', async () => {
    const { createChallengeAdjudicateStreamHandler } = await import('@/app/api/challenge/adjudicate-stream/handler');

    const handler = createChallengeAdjudicateStreamHandler({
      adjudicateChallengeRequest: async () => {
        throw new Error('should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.com/api/challenge/adjudicate-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          runState: { runId: 'run-1' },
          encounter: { nodeId: 'L1-N1' },
          playerInput: { note: '参数并不完整。' },
        }),
      })
    );

    expect(response.status).toBe(400);
  });
});
