import { describe, expect, it } from 'vitest';

import { normalizeArenaWebOutput } from '@/lib/arena/web-output';

describe('normalizeArenaWebOutput', () => {
  it('extracts the canonical HTML document and keeps surrounding text as notes', () => {
    const result = normalizeArenaWebOutput([
      '下面是本场特别战报。',
      '',
      '<!doctype html>',
      '<html><body><h1>战报</h1></body></html>',
      '',
      '希望你喜欢这场战斗。',
      '<!-- MAHOSHOJO_ARENA_META {"version":1} -->',
    ].join('\n'));

    expect(result.document).toBe('<!doctype html>\n<html><body><h1>战报</h1></body></html>');
    expect(result.prelude).toBe('下面是本场特别战报。');
    expect(result.epilogue).toBe('希望你喜欢这场战斗。');
    expect(result.document).not.toContain('MAHOSHOJO_ARENA_META');
    expect(result.epilogue).not.toContain('MAHOSHOJO_ARENA_META');
  });

  it('supports html documents without doctype and removes a single markdown fence', () => {
    const result = normalizeArenaWebOutput([
      '```html',
      '<html><body>内容</body></html>',
      '```',
    ].join('\n'));

    expect(result.document).toBe('<html><body>内容</body></html>');
    expect(result.prelude).toBe('');
    expect(result.epilogue).toBe('');
  });

  it('uses the first real html closing tag and keeps later mentions in the epilogue', () => {
    const result = normalizeArenaWebOutput([
      '<!doctype html>',
      '<html><head><title>示例 </html> 标记</title></head><body><script>const example = "</html>";</script><textarea>输入 </html> 标记</textarea></body></html>',
      '',
      '页面已在 </html> 标签结束。',
    ].join('\n'));

    expect(result.document).toBe('<!doctype html>\n<html><head><title>示例 </html> 标记</title></head><body><script>const example = "</html>";</script><textarea>输入 </html> 标记</textarea></body></html>');
    expect(result.epilogue).toBe('页面已在 </html> 标签结束。');
  });

  it('only removes an opening fence immediately before the html document', () => {
    const result = normalizeArenaWebOutput([
      '先展示一个代码示例：',
      '',
      '```',
      'foo',
      '```',
      '',
      '<!doctype html>',
      '<html><body>内容</body></html>',
    ].join('\n'));

    expect(result.prelude).toBe('先展示一个代码示例：\n\n```\nfoo\n```');
    expect(result.document).toBe('<!doctype html>\n<html><body>内容</body></html>');
  });

  it('does not expose incomplete output to an executable iframe', () => {
    const result = normalizeArenaWebOutput('先说两句。\n<!doctype html><html><body>还没结束');

    expect(result.document).toBeNull();
    expect(result.prelude).toContain('<!doctype html>');
    expect(result.epilogue).toBe('');
  });

  it('returns no executable document when the model never emits html', () => {
    expect(normalizeArenaWebOutput('这是一段普通说明。')).toEqual({
      document: null,
      prelude: '这是一段普通说明。',
      epilogue: '',
    });
  });
});
