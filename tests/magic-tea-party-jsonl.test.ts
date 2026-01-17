import { describe, expect, it } from 'bun:test';

import { createMagicTeaPartyJsonlStreamState, flushMagicTeaPartyJsonlStream, ingestMagicTeaPartyJsonlChunk, parseMagicTeaPartyJsonl } from '@/lib/magic-tea-party/jsonl';

describe('magic tea party jsonl parser', () => {
  it('兼容 narration 的 text/content 字段', () => {
    const withText = parseMagicTeaPartyJsonl('{"type":"narration","text":"奶茶店的灯光在雨夜里摇曳……"}');
    expect(withText.segments).toHaveLength(1);
    expect(withText.segments[0]).toEqual({ type: 'narration', text: '奶茶店的灯光在雨夜里摇曳……' });
    expect(withText.notices).toHaveLength(0);

    const withContent = parseMagicTeaPartyJsonl('{"type":"narration","content":"我推开咖啡店的门……"}');
    expect(withContent.segments).toHaveLength(1);
    expect(withContent.segments[0]).toEqual({ type: 'narration', text: '我推开咖啡店的门……' });
    expect(withContent.notices).toHaveLength(0);
  });

  it('会跳过 Markdown 围栏，并解析 dialogue/choices', () => {
    const input = [
      '```jsonl',
      '{"type":"narration","content":"场景开场……"}',
      '{"type":"dialogue","speakerId":"role-1","speakerName":"星见澪","content":"要来一杯桂花奶茶吗？"}',
      '{"type":"choices","items":["我点头并接过菜单","我礼貌拒绝，转向窗边"]}',
      '```',
    ].join('\n');

    const parsed = parseMagicTeaPartyJsonl(input);
    expect(parsed.segments.map((seg) => seg.type)).toEqual(['narration', 'dialogue', 'choices']);
    expect(parsed.segments[0]).toEqual({ type: 'narration', text: '场景开场……' });
    expect(parsed.segments[1]).toEqual({ type: 'dialogue', speakerId: 'role-1', speakerName: '星见澪', text: '要来一杯桂花奶茶吗？' });
    expect(parsed.choices?.map((c) => c.text)).toEqual(['我点头并接过菜单', '我礼貌拒绝，转向窗边']);
    expect(parsed.notices).toHaveLength(0);
  });

  it('当行 JSON 解析失败时保留原文', () => {
    const parsed = parseMagicTeaPartyJsonl('这是一行普通文本');
    expect(parsed.segments).toHaveLength(1);
    expect(parsed.segments[0]).toEqual({ type: 'narration', text: '这是一行普通文本' });
    expect(parsed.notices).toHaveLength(0);
  });

  it('疑似侧信道行解析失败时会忽略并提示', () => {
    const input = ['{"type":"summary","text":"夜雨"}', '{"type":"summary","text":"夜雨"', '{"type":"narration","text":"灯光摇曳"}'].join('\n');
    const parsed = parseMagicTeaPartyJsonl(input);
    expect(parsed.segments.map((seg) => seg.type)).toEqual(['narration']);
    expect(parsed.notices.some((notice) => notice.code === 'jsonl_side_channel_parse_error')).toBe(true);
  });

  it('支持按行增量解析 JSONL', () => {
    const state = createMagicTeaPartyJsonlStreamState();
    ingestMagicTeaPartyJsonlChunk(state, '{"type":"narration","text":"开场"}\n{"type":"dialogue","speakerId":"r1","text":"你');
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0]).toEqual({ type: 'narration', text: '开场' });

    ingestMagicTeaPartyJsonlChunk(state, '好"}\n{"type":"choices","items":["回应一","回应二"]}\n');
    flushMagicTeaPartyJsonlStream(state);
    expect(state.segments.map((seg) => seg.type)).toEqual(['narration', 'dialogue', 'choices']);
    expect(state.segments[1]).toEqual({ type: 'dialogue', speakerId: 'r1', text: '你好' });
    expect(state.choices?.map((item) => item.text)).toEqual(['回应一', '回应二']);
    expect(state.notices).toHaveLength(0);
  });

  it('会识别 notice 行并忽略为正文', () => {
    const input = [
      '{"type":"notice","level":"error","code":"missing","message":"缺少必要卡片"}',
      '{"type":"narration","text":"风铃轻响。"}',
    ].join('\n');
    const parsed = parseMagicTeaPartyJsonl(input);
    expect(parsed.segments.map((seg) => seg.type)).toEqual(['narration']);
    expect(parsed.notices).toHaveLength(1);
    expect(parsed.notices[0]).toMatchObject({ level: 'error', code: 'missing', message: '缺少必要卡片' });
  });

  it('会识别 summary/updates 作为侧信道输出', () => {
    const input = [
      '{"type":"narration","text":"雨夜的奶茶店。"}',
      '{"type":"summary","text":"世界状态：雨未停。","sections":{"世界状态":"雨未停"}}',
      '{"type":"updates","drafts":[{"characterName":"星见澪","impact":"并肩作战"}],"meta":{"messageRange":{"fromMessageId":"m1","toMessageId":"m2","count":2}}}',
    ].join('\n');
    const parsed = parseMagicTeaPartyJsonl(input);
    expect(parsed.segments.map((seg) => seg.type)).toEqual(['narration']);
    expect(parsed.summary?.text).toBe('世界状态：雨未停。');
    expect(parsed.updates?.[0]?.characterName).toBe('星见澪');
    expect(parsed.updatesMeta?.messageRange).toMatchObject({ fromMessageId: 'm1', toMessageId: 'm2', count: 2 });
  });
});
