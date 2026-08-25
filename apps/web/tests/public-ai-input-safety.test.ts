import { beforeEach, describe, expect, vi, test } from 'vitest';

const state = vi.hoisted(() => ({
  rateLimitCalls: [] as Array<Record<string, unknown>>,
  safetyCalls: [] as Array<Record<string, unknown>>,
  safetyResponse: null as Response | null,
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/public-rate-limit', () => ({
  OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS: 60_000,
  createPublicAiRateLimiter: vi.fn(() => ({
    acquirePublicAiRateLimit: vi.fn(async (input: Record<string, unknown>) => {
      state.rateLimitCalls.push(input);
      return {
        allowed: true,
        retryAfterSeconds: 0,
        identityScope: 'ip',
      };
    }),
  })),
  buildPublicAiRateLimitResponse: (result: Record<string, unknown>) =>
    new Response(JSON.stringify(result), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/content-safety', () => ({
  createContentSafetyService: vi.fn(() => ({
    enforceTextSafety: vi.fn(async (input: Record<string, unknown>) => {
      state.safetyCalls.push(input);
      return state.safetyResponse;
    }),
  })),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/data-ports', () => ({
  createNodeDataPorts: vi.fn(() => ({
    getDataCardById: vi.fn(async () => null),
    recordAiChannelOutcome: vi.fn(),
    recordUserActivityFromRequest: vi.fn(),
    touchUserLastActivity: vi.fn(),
  })),
}));

// generate-magical-girl-details 仍是 Next-owned exited route；在退出完成前保留旧 port mock。
vi.mock('@/lib/ai/public-rate-limit', () => ({
  acquirePublicAiRateLimit: async (input: Record<string, unknown>) => {
    state.rateLimitCalls.push(input);
    return {
      allowed: true,
      retryAfterSeconds: 0,
      identityScope: 'ip',
    };
  },
  buildPublicAiRateLimitResponse: (result: Record<string, unknown>) =>
    new Response(JSON.stringify(result), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }),
  inferPublicAiProviderMode: () => 'system',
}));

vi.mock('@/lib/content-safety/server', () => ({
  enforceTextSafety: async (input: Record<string, unknown>) => {
    state.safetyCalls.push(input);
    return state.safetyResponse;
  },
}));

vi.mock('@/lib/user-activity/record', () => ({
  recordUserActivityFromRequest: () => {},
}));

describe('public ai input safety', () => {
  beforeEach(() => {
    state.rateLimitCalls = [];
    state.safetyCalls = [];
    state.safetyResponse = null;
  });

  test('名字生成 direct API 会走服务端 canonical 安全检查并阻断敏感输入', async () => {
    state.safetyResponse = new Response(
      JSON.stringify({
        error: '输入内容不合规',
        shouldRedirect: true,
        reason: '使用危险符文',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const { default: handler } = await import('@/app/api/generate-magical-girl/handler');
    const response = await handler(
      new Request('https://example.com/api/generate-magical-girl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '  危险名字  ',
          language: ' zh-CN ',
        }),
      }),
    );

    const payload = (await response.json()) as { shouldRedirect?: boolean; reason?: string };
    expect(response.status).toBe(400);
    expect(payload.shouldRedirect).toBe(true);
    expect(payload.reason).toBe('使用危险符文');
    expect(state.rateLimitCalls).toHaveLength(1);
    expect(state.safetyCalls).toHaveLength(1);
    expect(state.safetyCalls[0]?.text).toBe('危险名字');
    expect(state.safetyCalls[0]?.sensitiveWordReason).toBe('使用危险符文');
  });

  test('名字超过上限时会在服务端直接拒绝且不进入安全检查', async () => {
    const { default: handler } = await import('@/app/api/generate-magical-girl/handler');
    const response = await handler(
      new Request('https://example.com/api/generate-magical-girl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'a'.repeat(301),
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('名字太长啦，你怎么回事！');
    expect(state.rateLimitCalls).toHaveLength(0);
    expect(state.safetyCalls).toHaveLength(0);
  });

  test('非流式问卷生成 direct API 也会做服务端 canonical 安全检查', async () => {
    state.safetyResponse = new Response(
      JSON.stringify({
        error: '输入内容不合规',
        shouldRedirect: true,
        reason: '在问卷中使用了危险符文',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const { default: handler } = await import('@/app/api/generate-magical-girl-details/handler');
    const response = await handler(
      new Request('https://example.com/api/generate-magical-girl-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: [
            {
              question: '问题 1',
              answer: '  危险问卷输入  ',
              questionId: 'q1',
              questionnaireId: 'questionnaire-1',
            },
          ],
          questionnaires: [
            {
              id: 'questionnaire-1',
              title: '测试问卷',
              kind: 'magical-girl',
              questions: [
                {
                  id: 'q1',
                  question: '问题 1',
                  required: false,
                  maxLength: null,
                },
              ],
            },
          ],
        }),
      }),
    );

    const payload = (await response.json()) as { shouldRedirect?: boolean; reason?: string };
    expect(response.status).toBe(400);
    expect(payload.shouldRedirect).toBe(true);
    expect(payload.reason).toBe('在问卷中使用了危险符文');
    expect(state.rateLimitCalls).toHaveLength(1);
    expect(state.safetyCalls).toHaveLength(1);
    expect(state.safetyCalls[0]?.text).toBe('危险问卷输入');
    expect(state.safetyCalls[0]?.logMeta).toEqual({
      questionId: 'q1',
      questionnaireId: 'questionnaire-1',
    });
  });
});
