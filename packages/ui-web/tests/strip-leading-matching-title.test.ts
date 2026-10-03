import { describe, expect, it } from 'vitest';

import { stripLeadingMatchingTitle } from '../src/markdown/strip-leading-matching-title';

/**
 * 条目页的外层标题与正文 H1 之间的关系。
 *
 * 这不是格式洁癖：53 篇正文都带自己的 H1（它们要能独立阅读），而条目页在正文之前已经渲染了标题。
 * 规则本身是「**相同才剥**」——当前有 7 篇的正文 H1 与目录标题有意不同，对它们剥离会丢掉正文真正的
 * 标题，因此必须保留。这些用例把这条规则连同它的例外一起固定下来。
 */
describe('stripLeadingMatchingTitle', () => {
  it('removes a leading H1 that duplicates the page title', () => {
    const result = stripLeadingMatchingTitle({
      content: '# 角色生成\n\n三种角色生成入口的差异。\n',
      title: '角色生成',
    });
    expect(result).toBe('三种角色生成入口的差异。\n');
  });

  it('keeps a leading H1 that intentionally differs from the page title', () => {
    const result = stripLeadingMatchingTitle({
      content: '# Web 战报数据卡创作进阶：从“写故事”到“生成互动体验”\n\n正文。',
      title: 'Web 战报数据卡创作进阶',
    });
    expect(result).toContain('# Web 战报数据卡创作进阶');
    expect(result).toContain('正文。');
  });

  it('only considers the very first line', () => {
    const result = stripLeadingMatchingTitle({
      content: '引言。\n\n# 角色生成\n\n正文。',
      title: '角色生成',
    });
    expect(result).toBe('引言。\n\n# 角色生成\n\n正文。');
  });

  it('normalizes CRLF so Windows-authored content behaves the same', () => {
    const result = stripLeadingMatchingTitle({
      content: '# 角色生成\r\n\r\n正文。',
      title: '角色生成',
    });
    expect(result).toBe('正文。');
    expect(result).not.toContain('\r');
  });

  it('tolerates whitespace differences around the title', () => {
    const result = stripLeadingMatchingTitle({
      content: '# 角色生成  \n\n正文。',
      title: '  角色生成  ',
    });
    expect(result).toBe('正文。');
  });

  it('leaves content untouched when there is no H1', () => {
    const content = '## 只有二级标题\n\n正文。';
    expect(stripLeadingMatchingTitle({ content, title: '只有二级标题' })).toBe(content);
  });

  it('leaves content untouched when the page title is empty', () => {
    // 空标题意味着调用方没提供页面标题；此时任何"匹配"都是意外，不能当成剥除许可。
    const content = '# 角色生成\n\n正文。';
    expect(stripLeadingMatchingTitle({ content, title: '' })).toBe(content);
    expect(stripLeadingMatchingTitle({ content, title: '   ' })).toBe(content);
  });

  it('does not swallow the whole document when the H1 is the only content', () => {
    expect(stripLeadingMatchingTitle({ content: '# 角色生成', title: '角色生成' })).toBe('');
    expect(stripLeadingMatchingTitle({ content: '# 角色生成\n', title: '角色生成' })).toBe('');
  });
});