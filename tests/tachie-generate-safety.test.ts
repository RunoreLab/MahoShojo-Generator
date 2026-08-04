import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enforceTextSafety: vi.fn(async (): Promise<Response | null> => null),
}));

vi.mock('@/lib/content-safety/server', () => ({
  enforceTextSafety: mocks.enforceTextSafety,
}));

import { appRouteHandler } from '@/app/api/tachie/generate/handler';

beforeEach(() => {
  vi.clearAllMocks();
});

test('立绘提示词会经过服务端内容安全检查', async () => {
  mocks.enforceTextSafety.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: '输入内容不合规' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  const response = await appRouteHandler(
    new Request('https://example.test/api/tachie/generate', {
      method: 'POST',
      body: JSON.stringify({
        source: 'modelscope',
        prompt: '测试敏感词',
        modelscopeToken: 'token',
      }),
    }),
  );

  expect(response.status).toBe(400);
  expect(mocks.enforceTextSafety).toHaveBeenCalledWith(expect.objectContaining({
    text: '测试敏感词',
    sensitiveWordReason: '立绘生成提示词含敏感词',
  }));
});
