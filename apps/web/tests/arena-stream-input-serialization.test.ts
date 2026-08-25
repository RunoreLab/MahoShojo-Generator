import { describe, expect, test } from 'vitest';

import {
  ArenaStreamInputError,
  parseArenaStreamRequestBody,
  prepareArenaStreamInput,
} from '@/lib/arena/generate-stream-input';

describe('arena generate-stream input serialization', () => {
  test('接受超过旧 512 KiB 应用层上限的 JSON', async () => {
    const padding = '界'.repeat(200_000);
    const request = new Request('https://example.com/api/arena/generate-stream', {
      method: 'POST',
      body: JSON.stringify({ padding }),
    });

    await expect(parseArenaStreamRequestBody(request)).resolves.toMatchObject({ padding });
  });

  test('无效 JSON 仍返回明确的 400 输入错误', async () => {
    const request = new Request('https://example.com/api/arena/generate-stream', {
      method: 'POST',
      body: '{',
    });

    await expect(parseArenaStreamRequestBody(request)).rejects.toMatchObject({
      code: 'invalid_json',
      status: 400,
    });
  });

  test('不截断或拒绝长引导与叙事历史', () => {
    const userGuidance = '引'.repeat(250_000);
    const characterGuidance = '行'.repeat(150_000);
    const narrativeContent = '史'.repeat(300_000);

    const result = prepareArenaStreamInput({
      userGuidance,
      combatants: [{ data: { name: 'A' }, characterGuidance }],
      narrativeHistory: [{ title: '历史', content: narrativeContent }],
    });

    expect(result.inputJson).toContain(userGuidance);
    expect(result.inputJson).toContain(characterGuidance);
    expect(() => result.serialize({ title: '历史', content: narrativeContent }, '叙事历史')).not.toThrow();
  });

  test('按实际对象缓存序列化结果，不依赖数组索引对应关系', () => {
    let serializeCalls = 0;
    const material = {
      toJSON() {
        serializeCalls += 1;
        return { note: '规范化后的线索' };
      },
    };
    const result = prepareArenaStreamInput({});

    expect(result.serialize(material, '素材')).toBe('{"note":"规范化后的线索"}');
    expect(result.serialize(material, '素材')).toBe('{"note":"规范化后的线索"}');
    expect(serializeCalls).toBe(1);
  });

  test('统计复用 inputJson，字符数和 UTF-8 字节数准确', () => {
    const result = prepareArenaStreamInput({
      combatants: [{ data: { name: 'A' } }],
      userGuidance: '保持悬念',
      scenario: { title: '雨夜' },
      materials: [{ content: { note: '线索' } }],
      teams: { A: 1 },
    });

    expect(result.inputChars).toBe(result.inputJson.length);
    expect(result.inputBytes).toBe(new TextEncoder().encode(result.inputJson).byteLength);
  });

  test('不可序列化值仍返回明确输入错误', () => {
    const result = prepareArenaStreamInput({});
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => result.serialize(cyclic, '素材')).toThrow(ArenaStreamInputError);
  });
});
