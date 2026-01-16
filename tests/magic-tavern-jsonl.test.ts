import { describe, expect, it } from 'bun:test';

import { createMagicTavernJsonlStreamState, flushMagicTavernJsonlStream, ingestMagicTavernJsonlChunk, parseMagicTavernJsonl } from '@/lib/magic-tavern/jsonl';

describe('magic tavern jsonl parser', () => {
  it('兼容 narration 的 text/content 字段', () => {
    const withText = parseMagicTavernJsonl('{"type":"narration","text":"酒馆的灯火在雨夜里摇曳……"}');
    expect(withText.segments).toHaveLength(1);
    expect(withText.segments[0]).toEqual({ type: 'narration', text: '酒馆的灯火在雨夜里摇曳……' });

    const withContent = parseMagicTavernJsonl('{"type":"narration","content":"我推开酒馆的大门……"}');
    expect(withContent.segments).toHaveLength(1);
    expect(withContent.segments[0]).toEqual({ type: 'narration', text: '我推开酒馆的大门……' });
  });

  it('会跳过 Markdown 围栏，并解析 dialogue/choices', () => {
    const input = [
      '```jsonl',
      '{"type":"narration","content":"场景开场……"}',
      '{"type":"dialogue","speakerId":"role-1","speakerName":"星见澪","content":"要来一杯热可可吗？"}',
      '{"type":"choices","items":["我点头并坐下","我礼貌拒绝，转向角落"]}',
      '```',
    ].join('\n');

    const parsed = parseMagicTavernJsonl(input);
    expect(parsed.segments.map((seg) => seg.type)).toEqual(['narration', 'dialogue', 'choices']);
    expect(parsed.segments[0]).toEqual({ type: 'narration', text: '场景开场……' });
    expect(parsed.segments[1]).toEqual({ type: 'dialogue', speakerId: 'role-1', speakerName: '星见澪', text: '要来一杯热可可吗？' });
    expect(parsed.choices?.map((c) => c.text)).toEqual(['我点头并坐下', '我礼貌拒绝，转向角落']);
  });

  it('当行 JSON 解析失败时保留原文', () => {
    const parsed = parseMagicTavernJsonl('这是一行普通文本');
    expect(parsed.segments).toHaveLength(1);
    expect(parsed.segments[0]).toEqual({ type: 'narration', text: '这是一行普通文本' });
  });

  it('支持按行增量解析 JSONL', () => {
    const state = createMagicTavernJsonlStreamState();
    ingestMagicTavernJsonlChunk(state, '{"type":"narration","text":"开场"}\n{"type":"dialogue","speakerId":"r1","text":"你');
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0]).toEqual({ type: 'narration', text: '开场' });

    ingestMagicTavernJsonlChunk(state, '好"}\n{"type":"choices","items":["回应一","回应二"]}\n');
    flushMagicTavernJsonlStream(state);
    expect(state.segments.map((seg) => seg.type)).toEqual(['narration', 'dialogue', 'choices']);
    expect(state.segments[1]).toEqual({ type: 'dialogue', speakerId: 'r1', text: '你好' });
    expect(state.choices?.map((item) => item.text)).toEqual(['回应一', '回应二']);
  });
});

