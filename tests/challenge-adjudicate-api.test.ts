import { describe, expect, test } from 'bun:test';

describe('api/challenge/adjudicate-stream', () => {
  test('adjudicate-stream returns SSE markdown and done event', async () => {
    const { createChallengeAdjudicateStreamHandler } = await import('@/pages/api/challenge/adjudicate-stream');

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
    });

    const response = await handler(
      new Request('https://example.com/api/challenge/adjudicate-stream?format=sse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          runState: { runId: 'run-1' },
          encounter: { nodeId: 'L1-N1' },
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
    const { createChallengeAdjudicateStreamHandler } = await import('@/pages/api/challenge/adjudicate-stream');

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
    const { createChallengeAdjudicateStreamHandler } = await import('@/pages/api/challenge/adjudicate-stream');

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
});
