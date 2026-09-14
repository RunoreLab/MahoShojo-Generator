import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildContentDiff, DIFF_LIMITS, jsonContentDiff } from '../src/client/content-diff-model';
import { ContentUpdateDiff } from '../src/client/content-diff';

describe('待审更新内容对照', () => {
  it('读取序列化原稿，null 继承而空字符串明确覆盖', () => {
    const result = buildContentDiff({ currentCard: JSON.stringify({ name: '原名', description: '原描述', data: '{"x":1}' }), name: null, description: '', data: null });
    expect(result.hasCurrent).toBe(true);
    expect(result.fields[0]).toMatchObject({ after: '原名', inherited: true, changes: [] });
    expect(result.fields[1]).toMatchObject({ after: '', inherited: false, changes: [{ kind: 'modified', before: '原描述', after: '' }] });
    expect(result.fields[2].changes).toEqual([]);
  });
  it('识别嵌套新增、删除、修改及数组变化，区分不存在和 null', () => {
    const result = jsonContentDiff('{"nested":{"old":null,"x":1},"list":[1,2]}', '{"nested":{"new":null,"x":2},"list":[1]}');
    expect(result.notices).toEqual([]);
    expect(result.changes.map(({ path, kind }) => ({ path, kind }))).toEqual([
      { path: '/nested/old', kind: 'removed' }, { path: '/nested/x', kind: 'modified' }, { path: '/nested/new', kind: 'added' }, { path: '/list/1', kind: 'removed' },
    ]);
  });
  it('JSON 格式和键顺序变化不计为内容变化；路径转义且不读取继承属性', () => {
    expect(jsonContentDiff('{"a":1,"b":2}', '{ "b": 2, "a": 1 }').changes).toEqual([]);
    expect(jsonContentDiff('{"a/b~c":1,"__proto__":1}', '{"a/b~c":2}').changes.map(item => item.path)).toEqual(['/a~1b~0c', '/__proto__']);
  });
  it('无效 JSON 降级为文本，而合法 JSON 字符串仍按 JSON 比较', () => {
    expect(jsonContentDiff('{bad', '{}')).toMatchObject({ changes: [{ path: '内容', before: '{bad', after: '{}' }], notices: [expect.stringContaining('无效 JSON')] });
    expect(jsonContentDiff('"old"', '"new"')).toMatchObject({ changes: [{ before: '"old"', after: '"new"' }], notices: [] });
    expect(jsonContentDiff('{"x":"1"}', '{"x":1}').changes).toMatchObject([{ before: '"1"', after: '1' }]);
  });
  it('大文本、深层及大量变更有界，并保留完整原文', () => {
    const huge = 'x'.repeat(DIFF_LIMITS.inputChars + 1);
    const result = buildContentDiff({ currentCard: { data: '{}' }, data: huge });
    expect(result.fields[2].after).toBe(huge);
    expect(result.fields[2].changes[0].after.length).toBeLessThan(DIFF_LIMITS.previewChars + 100);
    expect(result.fields[2].notices.join()).toContain('大小上限');
    const deep = '['.repeat(30) + '1' + ']'.repeat(30);
    expect(jsonContentDiff(deep, deep.replace('1', '2')).notices.join()).toContain('结果不完整');
    expect(jsonContentDiff(Array(500).fill(1), Array(500).fill(2)).changes).toHaveLength(DIFF_LIMITS.changes);
    expect(jsonContentDiff(Array(5_000).fill(1), Array(5_000).fill(1)).notices.join()).toContain('结果不完整');
  });
  it('恶意 HTML 始终转义为文本，完整原文默认折叠且延迟渲染', () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const html = renderToStaticMarkup(createElement(ContentUpdateDiff, { selected: { currentCard: { name: 'old', data: '{}' }, name: hostile, data: '{}' } }));
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
    expect(html).toContain('完整原文'); expect(html).not.toContain('<details open');
  });
  it('缺失当前卡片明确阻止声称完成对照', () => {
    const selected = { currentCard: null, name: 'new' };
    expect(buildContentDiff(selected).hasCurrent).toBe(false);
    expect(renderToStaticMarkup(createElement(ContentUpdateDiff, { selected }))).toContain('当前卡片不可用');
  });
});
