import { describe, expect, test } from 'bun:test';

import { extractStreamUpdateMeta, stripStreamUpdateMetaComment } from '@/lib/arena/stream-meta';

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
});
