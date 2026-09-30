import { describe, expect, it } from 'vitest';

import { appRouteHandler as teaChoices } from '@/app/api/magic-tea-party/generate-choices/handler';
import { appRouteHandler as teaStream } from '@/app/api/magic-tea-party/generate-stream/handler';
import { appRouteHandler as teaSummarize } from '@/app/api/magic-tea-party/summarize/handler';
import { appRouteHandler as teaUpdates } from '@/app/api/magic-tea-party/generate-updates/handler';
import { MAGIC_TEA_PARTY_MAX_TOTAL_CHARS } from '@/lib/magic-tea-party/message-limits';

/**
 * 这些用例不触碰真实模型：用一个必然解析失败的 providerId，
 * 让 handler 在「长度闸门之后、真正调用上游之前」停下来。
 * 于是我们观察到的状态码就能精确回答：长度闸门有没有把请求拦下来。
 */
const UNKNOWN_PROVIDER_ID = '__test_unknown_provider__';

const customProvider = {
  providerId: UNKNOWN_PROVIDER_ID,
  modelId: 'test-model',
  apiKey: 'test-key',
};

const buildMessage = (length: number, index: number) => ({
  id: `m${index}`,
  role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
  content: '内'.repeat(length),
});

const post = (handler: (req: never) => Promise<Response>, body: unknown) =>
  handler(
    new Request('https://example.test/api/magic-tea-party', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never
  );

const streamBody = (messages: unknown[]) => ({
  sessionId: 's1',
  messages,
  settings: {},
  customProvider,
});

const summarizeBody = (messages: unknown[]) => ({
  sessionId: 's1',
  messages,
  customProvider,
});

const updatesBody = (messages: unknown[]) => ({
  sessionId: 's1',
  messages,
  settings: { writeCurrentState: true },
  customProvider,
});

const handlers = [
  ['generate-stream', teaStream, streamBody],
  ['generate-choices', teaChoices, streamBody],
  ['summarize', teaSummarize, summarizeBody],
  ['generate-updates', teaUpdates, updatesBody],
] as const;

describe('魔法茶会：单条超长消息不再硬失败', () => {
  it.each(handlers)('%s 放行 50000 字单条消息（走到 provider 校验而非长度闸门）', async (_id, handler, buildBody) => {
    const response = await post(handler, buildBody([buildMessage(50_000, 0)]));
    const payload = await response.json();

    // 旧实现在此返回 400「单条消息内容超过 8000 字，请先精简。」
    // 现在请求会越过长度闸门，停在 provider 解析。
    expect(payload.error).not.toContain('单条消息内容超过');
    expect(payload.error).not.toContain('请先精简');
    expect(payload).toEqual({ error: '未知的模型供应商 ID' });
  });

  it.each(handlers)('%s 对正常长度消息行为不变', async (_id, handler, buildBody) => {
    const response = await post(handler, buildBody([buildMessage(1_000, 0)]));
    expect(await response.json()).toEqual({ error: '未知的模型供应商 ID' });
  });

  it.each(handlers)('%s 历史总量超限返回 413 与结构化 meta', async (_id, handler, buildBody) => {
    // 200 条 × 5000 字 = 1,000,000 字 > 800,000
    const messages = Array.from({ length: 200 }, (_, index) => buildMessage(5_000, index));
    const response = await post(handler, buildBody(messages));
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload.error).toContain('超过单次请求');
    expect(payload.error).toContain(String(MAGIC_TEA_PARTY_MAX_TOTAL_CHARS));
    expect(payload.meta).toEqual({
      totalChars: 1_000_000,
      limit: MAGIC_TEA_PARTY_MAX_TOTAL_CHARS,
    });
  });

  it.each(handlers)('%s 总量恰好等于上限时放行（边界不含）', async (_id, handler, buildBody) => {
    // 200 条 × 4000 字 = 800,000 字 = 上限，且每条都未超单条预算
    const messages = Array.from({ length: 200 }, (_, index) => buildMessage(4_000, index));
    const response = await post(handler, buildBody(messages));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '未知的模型供应商 ID' });
  });
});
