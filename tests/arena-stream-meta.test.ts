import { describe, expect, test } from 'bun:test';

import { extractStreamTelemetryMeta, extractStreamUpdateMeta, stripStreamUpdateMetaComment } from '@/lib/arena/stream-meta';

describe('arena stream meta', () => {
  test('extracts valid meta comment and strips it from markdown', async () => {
    const md = [
      '# 标题',
      '',
      '正文',
      '',
      '## 胜利者',
      'A',
      '',
      '<!-- MAHOSHOJO_ARENA_META {"version":1,"impacts":[{"characterName":"A","impact":"成长","currentStateSummary":"疲惫但满足"}]} -->',
    ].join('\n');

    const extracted = await extractStreamUpdateMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.meta.impacts?.[0]?.characterName).toBe('A');
    expect(extracted!.meta.impacts?.[0]?.currentStateSummary).toBe('疲惫但满足');
    expect(extracted!.strippedMarkdown.includes('MAHOSHOJO_ARENA_META')).toBe(false);
  });

  test('repairs malformed json (unquoted keys, trailing commas, single quotes, snake_case)', async () => {
    const md = [
      '# 标题',
      '',
      '正文',
      '',
      '## 胜利者',
      'A',
      '',
      "<!-- MAHOSHOJO_ARENA_META {version:1, impacts:[{name:'A', impact:'成长', current_state_summary:'平静',},],} -->",
    ].join('\n');

    const extracted = await extractStreamUpdateMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.meta.impacts?.[0]?.characterName).toBe('A');
    expect(extracted!.meta.impacts?.[0]?.currentStateSummary).toBe('平静');
  });

  test('repairs ellipsis placeholders (……/...) inside impacts array', async () => {
    const md = [
      '# 标题',
      '',
      '正文',
      '',
      '<!-- MAHOSHOJO_ARENA_META {"version":1,"report":{"headline":"H","winner":"A"},"impacts":[{"characterName":"A","impact":"OK","currentStateSummary":"S"},……,{"characterName":"B","currentStateSummary":"T"},...]} -->',
    ].join('\n');

    const extracted = await extractStreamUpdateMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.meta.report?.headline).toBe('H');
    expect(extracted!.meta.report?.winner).toBe('A');
    expect(extracted!.meta.impacts?.map((i) => i.characterName)).toEqual(['A', 'B']);
    expect(extracted!.strippedMarkdown.includes('MAHOSHOJO_ARENA_META')).toBe(false);
  });

  test('merges duplicate impacts and keeps the latest non-empty fields', async () => {
    const md = [
      '# 标题',
      '',
      '<!-- MAHOSHOJO_ARENA_META {"version":1,"impacts":[{"characterName":"A","impact":"OLD"},{"characterName":"A","currentStateSummary":"NEW"}]} -->',
    ].join('\n');

    const extracted = await extractStreamUpdateMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.meta.impacts).toHaveLength(1);
    expect(extracted!.meta.impacts?.[0]?.characterName).toBe('A');
    expect(extracted!.meta.impacts?.[0]?.impact).toBe('OLD');
    expect(extracted!.meta.impacts?.[0]?.currentStateSummary).toBe('NEW');
  });

  test('accepts array root and wraps as impacts', async () => {
    const md = [
      '# 标题',
      '',
      '正文',
      '',
      '## 胜利者',
      'A',
      '',
      '<!-- MAHOSHOJO_ARENA_META [{"character":"A","currentStateSummary":"OK"}] -->',
    ].join('\n');

    const extracted = await extractStreamUpdateMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.meta.impacts?.[0]?.characterName).toBe('A');
    expect(extracted!.meta.impacts?.[0]?.currentStateSummary).toBe('OK');
  });

  test('uses the last matching comment when multiple exist', async () => {
    const md = [
      '# 标题',
      '',
      '正文',
      '',
      '<!-- MAHOSHOJO_ARENA_META {"version":1,"impacts":[{"characterName":"A","currentStateSummary":"OLD"}]} -->',
      '',
      '<!-- MAHOSHOJO_ARENA_META {"version":1,"impacts":[{"characterName":"A","currentStateSummary":"NEW"}]} -->',
    ].join('\n');

    const extracted = await extractStreamUpdateMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.meta.impacts?.[0]?.currentStateSummary).toBe('NEW');
  });

  test('normalizes chinese quotes', async () => {
    const md = [
      '# 标题',
      '',
      '正文',
      '',
      '## 胜利者',
      'A',
      '',
      '!---',
      '',
      '<!-- MAHOSHOJO_ARENA_META {“version”:1,“impacts”:[{“characterName”:“A”,“currentStateSummary”:“好”}]} -->',
    ].join('\n');

    const extracted = await extractStreamUpdateMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.meta.impacts?.[0]?.characterName).toBe('A');
    expect(extracted!.meta.impacts?.[0]?.currentStateSummary).toBe('好');
  });

  test('returns null when marker is missing', async () => {
    const md = ['# 标题', '', '正文', '', '<!-- {"version":1} -->'].join('\n');
    const extracted = await extractStreamUpdateMeta(md);
    expect(extracted).toBeNull();
  });

  test('strips marker comment without parsing json', () => {
    const md = [
      '# 标题',
      '',
      '正文',
      '',
      "<!-- MAHOSHOJO_ARENA_META {version:1, impacts:[{name:'A'}],} -->",
    ].join('\n');

    const stripped = stripStreamUpdateMetaComment(md);
    expect(stripped).not.toBeNull();
    expect(stripped!.strippedMarkdown.includes('MAHOSHOJO_ARENA_META')).toBe(false);
    expect(stripped!.strippedMarkdown.includes('正文')).toBe(true);
  });

  test('extracts telemetry meta (usage + narrativeHistoryReadCount) and strips it', async () => {
    const md = [
      '# 标题',
      '',
      '正文',
      '',
      '<!-- MAHOSHOJO_TELEMETRY_META {"version":1,"usage":{"promptTokens":12,"reasoningTokens":3,"completionTokens":9},"narrativeHistoryReadCount":2} -->',
    ].join('\n');

    const extracted = await extractStreamTelemetryMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.meta.usage?.promptTokens).toBe(12);
    expect(extracted!.meta.usage?.reasoningTokens).toBe(3);
    expect(extracted!.meta.usage?.completionTokens).toBe(9);
    expect(extracted!.meta.narrativeHistoryReadCount).toBe(2);
    expect(extracted!.strippedMarkdown.includes('MAHOSHOJO_TELEMETRY_META')).toBe(false);
  });

  test('extractStreamUpdateMeta ignores telemetry comment after update meta', async () => {
    const md = [
      '# 标题',
      '',
      '正文',
      '',
      '<!-- MAHOSHOJO_ARENA_META {"version":1,"impacts":[{"characterName":"A","impact":"OK"}]} -->',
      '',
      '<!-- MAHOSHOJO_TELEMETRY_META {"version":1,"usage":{"promptTokens":1}} -->',
    ].join('\n');

    const extracted = await extractStreamUpdateMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.meta.impacts?.[0]?.characterName).toBe('A');
  });

  test('extracts loose marker block (---MAHOSHOJO_ARENA_META ...) and strips only the block', async () => {
    const md = [
      '# 标题',
      '',
      '---MAHOSHOJO_ARENA_META {version:1, impacts:[{name:"A", currentStateSummary:"OK"}]}',
      '',
      '正文继续',
    ].join('\n');

    const extracted = await extractStreamUpdateMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.meta.impacts?.[0]?.characterName).toBe('A');
    expect(extracted!.meta.impacts?.[0]?.currentStateSummary).toBe('OK');
    expect(extracted!.strippedMarkdown.includes('MAHOSHOJO_ARENA_META')).toBe(false);
    expect(extracted!.strippedMarkdown.includes('正文继续')).toBe(true);
  });

  test('accepts <!---MAHOSHOJO_ARENA_META ... --> and python-ish tokens', async () => {
    const md = [
      '# 标题',
      '',
      "<!---MAHOSHOJO_ARENA_META {'version':1,'report':{'headline':'H'},'impacts':[{'characterName':'A','currentStateSummary':'好','flag':True,'none':None}]} -->",
    ].join('\n');

    const extracted = await extractStreamUpdateMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.meta.report?.headline).toBe('H');
    expect(extracted!.meta.impacts?.[0]?.characterName).toBe('A');
    expect(extracted!.meta.impacts?.[0]?.currentStateSummary).toBe('好');
  });

  test('ignores marker-like line without json', async () => {
    const md = ['# 标题', '', 'MAHOSHOJO_ARENA_META 只是提到', '', '正文'].join('\n');
    expect(await extractStreamUpdateMeta(md)).toBeNull();
    expect(stripStreamUpdateMetaComment(md)).toBeNull();
  });

  test('telemetry meta strips even when json is malformed', async () => {
    const md = [
      '# 标题',
      '',
      '正文',
      '',
      '<!-- MAHOSHOJO_TELEMETRY_META {"version":1,"usage":[ -->',
    ].join('\n');

    const extracted = await extractStreamTelemetryMeta(md);
    expect(extracted).not.toBeNull();
    expect(extracted!.strippedMarkdown.includes('MAHOSHOJO_TELEMETRY_META')).toBe(false);
    expect(extracted!.strippedMarkdown.includes('正文')).toBe(true);
  });
});
