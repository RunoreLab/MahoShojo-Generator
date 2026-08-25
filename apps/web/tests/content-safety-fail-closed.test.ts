import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = {
  events: [] as string[],
  localUnsafe: false,
  aiError: null as Error | null,
};

vi.mock('@/lib/config', () => ({
  config: {
    ENABLE_SENSITIVE_WORD_FILTER: true,
    ENABLE_AI_SAFETY_CHECK: true,
  },
}));

vi.mock('@/lib/sensitive-word-filter', () => {
  const quickCheckForServer = async (text: string) => {
    state.events.push(`local:${text}`);
    return {
      hasSensitiveWords: state.localUnsafe,
      detectedWords: state.localUnsafe ? [text] : [],
    };
  };
  return { quickCheck: quickCheckForServer, quickCheckForServer };
});

vi.mock('@/lib/ai', () => ({
  generateWithAI: async (text: string) => {
    state.events.push(`ai:${text}`);
    if (state.aiError) throw state.aiError;
    return { isUnsafe: false };
  },
}));

describe('content safety authority', () => {
  beforeEach(() => {
    state.events = [];
    state.localUnsafe = false;
    state.aiError = null;
  });

  test('敏感词先于 AI 判定，命中后不把输入正文写入日志', async () => {
    state.localUnsafe = true;
    const warn = vi.fn();
    const { enforceTextSafety } = await import('@/lib/content-safety/server');
    const response = await enforceTextSafety({
      text: '用户秘密正文',
      log: { warn, error: vi.fn() },
      logMeta: {
        requestId: 'request-1',
        answers: { answer: '用户秘密正文' },
        verificationCode: 123456,
        answersCount: 1,
      },
    });

    expect(response?.status).toBe(400);
    expect(state.events).toEqual(['local:用户秘密正文']);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/用户秘密正文|123456/);
    expect(warn).toHaveBeenCalledWith('检测到敏感词，请求被拒绝', { answersCount: 1 });
  });

  test('AI 检查失败返回 503，且不把异常中的 secret/body 写入日志', async () => {
    state.aiError = new Error('upstream secret=abc body=用户秘密正文');
    const error = vi.fn();
    const { enforceTextSafety } = await import('@/lib/content-safety/server');
    const response = await enforceTextSafety({
      text: '用户秘密正文',
      log: { warn: vi.fn(), error },
      logMeta: {
        requestId: 'request-2',
        answers: { answer: '用户秘密正文' },
        answersCount: 1,
      },
    });

    expect(response?.status).toBe(503);
    expect(state.events).toEqual(['local:用户秘密正文', 'ai:用户秘密正文']);
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/secret=abc|用户秘密正文/);
    expect(error).toHaveBeenCalledWith('安全检查 AI 调用失败', { answersCount: 1 });
  });
});
