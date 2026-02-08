import { describe, expect, test } from 'bun:test';

import { readJsonWithAiMeta } from '@/lib/client/read-json-with-ai-meta';

describe('client/read-json-with-ai-meta', () => {
  test('支持解析 data + aiMeta 包装体', async () => {
    const response = new Response(
      JSON.stringify({
        data: { codename: '白百合' },
        aiMeta: {
          aiModel: 'gemini-3-flash-preview',
          aiUsage: { promptTokens: 120, completionTokens: 360, reasoningTokens: 48 },
          aiReasoning: {
            status: 'done',
            source: 'sdk',
            summary: '先梳理角色核心关键词。',
            text: '先梳理角色核心关键词，再扩展设定细节。',
          },
        },
      }),
      {
        headers: { 'content-type': 'application/json' },
      }
    );

    const parsed = await readJsonWithAiMeta<{ codename: string }>(response);

    expect(parsed.data.codename).toBe('白百合');
    expect(parsed.aiMeta?.aiModel).toBe('gemini-3-flash-preview');
    expect(parsed.aiMeta?.aiReasoning?.status).toBe('done');
    expect(parsed.aiMeta?.aiReasoning?.text).toContain('扩展设定细节');
  });

  test('兼容旧版纯 JSON 响应', async () => {
    const response = new Response(JSON.stringify({ title: '情景 A' }), {
      headers: { 'content-type': 'application/json' },
    });

    const parsed = await readJsonWithAiMeta<{ title: string }>(response);

    expect(parsed.data.title).toBe('情景 A');
    expect(parsed.aiMeta).toBeNull();
  });
});
