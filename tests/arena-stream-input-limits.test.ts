import { describe, expect, test } from 'vitest';

import {
  ARENA_STREAM_INPUT_LIMITS,
  ArenaStreamInputLimitError,
  parseArenaStreamRequestBody,
  serializeAndValidateArenaStreamInput,
} from '@/lib/arena/generate-stream-input';

describe('arena generate-stream input limits', () => {
  test('拒绝超过总请求字节上限的 JSON', async () => {
    const request = new Request('https://example.com/api/arena/generate-stream', {
      method: 'POST',
      body: JSON.stringify({ padding: '界'.repeat(ARENA_STREAM_INPUT_LIMITS.requestBytes) }),
    });

    await expect(parseArenaStreamRequestBody(request)).rejects.toMatchObject({
      code: 'request_bytes_exceeded',
      status: 400,
    });
  });

  test('无 Content-Length 时累计到字节上限即取消请求流', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(ARENA_STREAM_INPUT_LIMITS.requestBytes));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('https://example.com/api/arena/generate-stream', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit);

    await expect(parseArenaStreamRequestBody(request)).rejects.toMatchObject({
      code: 'request_bytes_exceeded',
    });
    expect(cancelled).toBe(true);
  });

  test('拒绝超长用户引导而不是静默截断', () => {
    expect(() => serializeAndValidateArenaStreamInput({
      userGuidance: 'a'.repeat(ARENA_STREAM_INPUT_LIMITS.userGuidanceChars + 1),
    })).toThrow(ArenaStreamInputLimitError);
  });

  test('拒绝超长角色引导', () => {
    expect(() => serializeAndValidateArenaStreamInput({
      combatants: [{ data: { name: 'A' }, characterGuidance: 'a'.repeat(101) }],
    })).toThrow('角色行动引导最多 100 个字符');
  });

  test('拒绝过大的叙事历史内容', () => {
    expect(() => serializeAndValidateArenaStreamInput({
      narrativeHistory: [{ title: '历史', content: 'a'.repeat(50_001) }],
    })).toThrow('单条叙事历史正文最多 50000 个字符');
  });

  test('在边界内只生成一份可复用序列化结果', () => {
    const result = serializeAndValidateArenaStreamInput({
      combatants: [{ data: { name: 'A' }, characterGuidance: '行动' }],
      userGuidance: '保持悬念',
      scenario: { title: '雨夜' },
      materials: [{ content: { note: '线索' } }],
      teams: { A: 1 },
    });

    expect(result.serialized.combatants).toEqual(['{"name":"A"}']);
    expect(result.serialized.scenario).toBe('{"title":"雨夜"}');
    expect(result.serialized.materials).toEqual(['{"note":"线索"}']);
    expect(result.inputChars).toBe(result.inputJson.length);
    expect(result.inputBytes).toBe(new TextEncoder().encode(result.inputJson).byteLength);
  });

  test('辅助情景序列化索引与 handler 过滤后的对象保持一致', () => {
    const result = serializeAndValidateArenaStreamInput({
      auxScenarios: [null, { title: '有效情景' }, 'invalid'],
    });

    expect(result.serialized.auxScenarios).toEqual(['{"title":"有效情景"}']);
  });
});
