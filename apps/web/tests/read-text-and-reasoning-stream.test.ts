import { describe, expect, test, vi } from 'vitest';

import { readTextAndReasoningStreamFromResponse } from '@/lib/stream/read-text-and-reasoning-stream';

const encodeSse = (event: string, payload: unknown) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

describe('stream/read-text-and-reasoning-stream', () => {
  test('支持解析 SSE 的 markdown + reasoning + telemetry', async () => {
    const rawSse = [
      encodeSse('markdown', { chunk: '# 标题\n' }),
      encodeSse('reasoning', { source: 'sdk', status: 'thinking', chunk: '先分析约束。' }),
      encodeSse('reasoning', { source: 'sdk', status: 'thinking', chunk: '再组织结构。' }),
      encodeSse('reasoning_done', { source: 'sdk', status: 'done' }),
      encodeSse('telemetry', { usage: { promptTokens: 12, reasoningTokens: 5, completionTokens: 30 } }),
      encodeSse('done', { ok: true }),
    ].join('');

    const response = new Response(rawSse, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });

    const textSnapshots: string[] = [];
    const result = await readTextAndReasoningStreamFromResponse(response, {
      label: '测试 SSE 读取',
      onText: (text) => textSnapshots.push(text),
    });

    expect(result.isSse).toBe(true);
    expect(result.text).toContain('# 标题');
    expect(textSnapshots.length).toBeGreaterThan(0);
    expect(result.reasoning?.status).toBe('done');
    expect(result.reasoning?.text).toContain('先分析约束。再组织结构。');
    expect((result.telemetry?.usage as any)?.reasoningTokens).toBe(5);
  });

  test('普通文本流会回退并执行启发式思考提取', async () => {
    const markdown = [
      '# 战斗战报',
      '',
      'thought',
      '先梳理双方技能，再判断胜负逻辑，最后生成新闻结构与结语，并明确引用每一条约束来避免角色行为越界。',
      '需要确保格式稳定、标题完整且结论可追溯，同时保证叙事节奏与事件顺序保持一致，避免出现跳步叙事。',
      '',
      '## 正文',
      '战报正文内容。',
    ].join('\n');

    const response = new Response(markdown, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });

    const result = await readTextAndReasoningStreamFromResponse(response, {
      label: '测试 plain 读取',
    });

    expect(result.isSse).toBe(false);
    expect(result.text).toContain('战报正文内容');
    expect(result.reasoning?.source).toBe('heuristic');
    expect(result.reasoning?.status).toBe('done');
  });

  test('SSE error 事件会抛出异常', async () => {
    const rawSse = [
      encodeSse('markdown', { chunk: '部分正文' }),
      encodeSse('error', { error: '上游错误：quota exceeded' }),
    ].join('');
    const response = new Response(rawSse, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });

    await expect(
      readTextAndReasoningStreamFromResponse(response, {
        label: '测试 SSE error',
      })
    ).rejects.toThrow('quota exceeded');
  });

  test('SSE error 事件会取消未结束 reader', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          encodeSse('error', { error: 'upstream failed' }),
        ));
      },
      cancel,
    }), { headers: { 'content-type': 'text/event-stream' } });

    await expect(readTextAndReasoningStreamFromResponse(response))
      .rejects.toThrow('upstream failed');
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('SSE EOF-before-done 不得作为成功结果返回', async () => {
    const response = new Response(
      encodeSse('markdown', { chunk: 'partial' }),
      { headers: { 'content-type': 'text/event-stream' } },
    );

    await expect(readTextAndReasoningStreamFromResponse(response))
      .rejects.toThrow(/done/u);
  });

  test('SSE 无 reasoning 事件时会收敛为 unavailable', async () => {
    const rawSse = [
      encodeSse('markdown', { chunk: '仅正文输出' }),
      encodeSse('telemetry', { usage: { promptTokens: 21, completionTokens: 9, reasoningTokens: 0 } }),
      encodeSse('done', { ok: true }),
    ].join('');
    const response = new Response(rawSse, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });

    const result = await readTextAndReasoningStreamFromResponse(response, {
      label: '测试 SSE 无 reasoning',
    });

    expect(result.reasoning?.status).toBe('unavailable');
    expect(result.reasoning?.source).toBe('sdk');
    expect(result.reasoning?.reasoningTokens).toBe(0);
  });
});

// Scenario Markdown must be decoded once at the SSE boundary, never globally unescaped.
test.each([
  '# 简报\n\n## 任务\n- 观察',
  '# 简报\r\n\r\n## 任务\r\n- 观察',
  '# 简报\\n\\n---\\n\\n## 任务\\n观察',
  '# 示例\n\n`C:\\notes\\new`\n\n```json\n{"line":"a\\nb"}\n```',
])('preserves scenario Markdown and literal backslashes across fragmented SSE transport', async (markdown) => {
  const split = Math.floor(markdown.length / 2);
  const wire = encodeSse('markdown', { chunk: markdown.slice(0, split) })
    + encodeSse('markdown', { chunk: markdown.slice(split) })
    + encodeSse('done', { ok: true });
  const bytes = new TextEncoder().encode(wire);
  const response = new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
  const onText = vi.fn();
  const result = await readTextAndReasoningStreamFromResponse(response, { onText });
  expect(result.text).toBe(markdown);
  expect(onText).toHaveBeenLastCalledWith(markdown);
});
