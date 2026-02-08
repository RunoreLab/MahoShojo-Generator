import { describe, expect, test } from 'bun:test';

import { AI_META_REQUEST_HEADER, buildJsonResponseWithOptionalAiMeta } from '@/lib/ai/meta-response';

describe('ai/meta-response', () => {
  test('未声明 aiMeta 请求头时保持旧版 JSON', async () => {
    const response = buildJsonResponseWithOptionalAiMeta({
      requestHeaders: new Headers(),
      data: { name: '测试角色' },
      telemetry: {
        model: 'gemini-3-flash-preview',
        usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 3 },
        reasoning: {
          status: 'done',
          source: 'sdk',
          summary: '先构建角色主轴。',
          text: '先构建角色主轴，再补齐细节。',
        },
      },
      status: 200,
    });

    const payload = await response.json();
    expect(payload).toEqual({ name: '测试角色' });
  });

  test('声明 aiMeta 请求头时返回 data + aiMeta 包装体', async () => {
    const response = buildJsonResponseWithOptionalAiMeta({
      requestHeaders: new Headers({ [AI_META_REQUEST_HEADER]: '1' }),
      data: { name: '测试角色' },
      telemetry: {
        model: 'gemini-3-flash-preview',
        usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 3 },
        reasoning: {
          status: 'done',
          source: 'sdk',
          summary: '先构建角色主轴。',
          text: '先构建角色主轴，再补齐细节。',
        },
      },
      status: 200,
    });

    const payload = (await response.json()) as any;
    expect(payload?.data?.name).toBe('测试角色');
    expect(payload?.aiMeta?.aiModel).toBe('gemini-3-flash-preview');
    expect(payload?.aiMeta?.aiUsage?.reasoningTokens).toBe(3);
    expect(payload?.aiMeta?.aiReasoning?.status).toBe('done');
  });
});
