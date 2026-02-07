import { describe, expect, test } from 'bun:test';

import { createReasoningSseBridge, shouldUseClientSse } from '@/lib/stream/reasoning-sse';

describe('stream/reasoning-sse', () => {
  test('shouldUseClientSse 支持 query 与 Accept 双判定', () => {
    const byQuery = new Request('https://example.com/api/test?format=sse', { method: 'POST' });
    const byAccept = new Request('https://example.com/api/test', {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
    });
    const normal = new Request('https://example.com/api/test', { method: 'POST' });

    expect(shouldUseClientSse(byQuery)).toBe(true);
    expect(shouldUseClientSse(byAccept)).toBe(true);
    expect(shouldUseClientSse(normal)).toBe(false);
  });

  test('会把文本流与 reasoning 事件桥接为 SSE', async () => {
    const bridge = createReasoningSseBridge('桥接测试');
    bridge.onReasoningEvent({ type: 'reasoning-start' });
    bridge.onReasoningEvent({ type: 'reasoning-delta', text: '先识别核心需求。' });
    bridge.onReasoningEvent({ type: 'reasoning-end' });

    const textResponse = new Response('## 正文\n测试内容', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });

    const sseResponse = bridge.toResponse(textResponse, {
      usagePromise: Promise.resolve({
        promptTokens: 11,
        completionTokens: 25,
        reasoningTokens: 4,
      }),
      aiModel: 'gemini-test',
    });

    const sseRaw = await sseResponse.text();
    expect(sseResponse.headers.get('content-type')).toContain('text/event-stream');
    expect(sseRaw).toContain('event: reasoning');
    expect(sseRaw).toContain('event: markdown');
    expect(sseRaw).toContain('event: reasoning_done');
    expect(sseRaw).toContain('event: telemetry');
    expect(sseRaw).toContain('"aiModel":"gemini-test"');
    expect(sseRaw).toContain('event: done');
  });

  test('正文延迟时，reasoning 事件可先于 markdown 输出', async () => {
    const bridge = createReasoningSseBridge('延迟正文测试');
    bridge.onReasoningEvent({ type: 'reasoning-start' });
    bridge.onReasoningEvent({ type: 'reasoning-delta', text: '先做任务分解。' });

    const encoder = new TextEncoder();
    const delayedTextBody = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(encoder.encode('正文稍后到达'));
          controller.close();
        }, 40);
      },
    });
    const textResponse = new Response(delayedTextBody, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });

    const sseResponse = bridge.toResponse(textResponse);
    const reader = sseResponse.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();

    const first = await reader!.read();
    const firstChunk = decoder.decode(first.value ?? new Uint8Array(), { stream: true });
    expect(firstChunk).toContain('event: reasoning');
    expect(firstChunk).not.toContain('event: markdown');

    let merged = firstChunk;
    for (let i = 0; i < 6; i++) {
      const next = await reader!.read();
      if (next.done) break;
      merged += decoder.decode(next.value ?? new Uint8Array(), { stream: true });
      if (merged.includes('event: markdown')) break;
    }
    expect(merged).toContain('event: markdown');
  });

  test('无 reasoning 时会发出 unavailable', async () => {
    const bridge = createReasoningSseBridge('无推理测试');
    const textResponse = new Response('纯正文');
    const sseResponse = bridge.toResponse(textResponse);
    const sseRaw = await sseResponse.text();
    expect(sseRaw).toContain('"status":"unavailable"');
    expect(sseRaw).toContain('event: done');
  });
});
