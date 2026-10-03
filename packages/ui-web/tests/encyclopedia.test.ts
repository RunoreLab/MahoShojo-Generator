import { describe, expect, it } from 'vitest';

import {
  ENCYCLOPEDIA_CONTENT_PREFIX,
  type EncyclopediaCategoryId,
  encyclopediaCategories,
  encyclopediaContentUrl,
  encyclopediaEntries,
  getEncyclopediaCategory,
  getEncyclopediaEntry,
  groupEncyclopediaEntries,
  matchEncyclopediaEntry,
  normalizeEncyclopediaSearchText,
} from '../src/encyclopedia';

/**
 * 目录数据的不变量。
 *
 * 这些断言守的是**数据形状**而不是文案：目录是两个运行时的共同事实（`DESK-PROD-002`），任何一侧
 * 读到一份不同的目录，导航、搜索与错误提示就会开始互相矛盾。
 */
describe('encyclopedia catalog', () => {
  it('has unique slugs and unique content files', () => {
    const slugs = encyclopediaEntries.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    // 两个 slug 指向同一个正文文件不会立刻报错，但会让其中一个条目永远显示另一篇的内容。
    const files = encyclopediaEntries.map((entry) => entry.contentFile);
    expect(new Set(files).size).toBe(files.length);
  });

  it('references only declared categories', () => {
    const categoryIds = encyclopediaCategories.map((category) => category.id);
    expect(new Set(categoryIds).size).toBe(categoryIds.length);

    const valid = new Set(categoryIds);
    for (const entry of encyclopediaEntries) {
      expect(valid.has(entry.categoryId), `${entry.slug} 引用了未知分类 ${entry.categoryId}`).toBe(true);
    }
  });

  it('keeps every entry reachable through getEncyclopediaEntry', () => {
    for (const entry of encyclopediaEntries) {
      expect(getEncyclopediaEntry(entry.slug)?.slug).toBe(entry.slug);
    }
    expect(getEncyclopediaEntry('no-such-slug')).toBeNull();
    expect(getEncyclopediaEntry(undefined)).toBeNull();
  });

  it('resolves legacy slug aliases to a live entry', () => {
    // 这两个 slug 曾经是独立条目，正文与站内互链还在用旧地址；别名失效会让历史链接变成死链。
    expect(getEncyclopediaEntry('modelscope-auth-401')?.slug).toBe('tachie-auth-errors');
    expect(getEncyclopediaEntry('liblib-auth-401')?.slug).toBe('tachie-auth-errors');
  });

  it('groups every entry exactly once', () => {
    const grouped = groupEncyclopediaEntries(encyclopediaEntries);
    const all = [
      ...grouped.categoriesWithEntries.flatMap((item) => item.entries),
      ...grouped.uncategorized,
    ];
    expect(all.length).toBe(encyclopediaEntries.length);
    expect(new Set(all.map((entry) => entry.slug)).size).toBe(encyclopediaEntries.length);
  });

  it('matches on title, summary and keywords, not on the body', () => {
    const entry = encyclopediaEntries.find((item) => item.slug === 'rate-limit-429');
    expect(entry).toBeDefined();
    expect(matchEncyclopediaEntry(entry!, '429')).toBe(true);
    expect(matchEncyclopediaEntry(entry!, '限流')).toBe(true);
    expect(matchEncyclopediaEntry(entry!, '冷却')).toBe(true);

    // 空查询匹配全部；这是目录页初始状态的语义，不能因为 trim 实现变了就坏掉。
    expect(matchEncyclopediaEntry(entry!, '')).toBe(true);
    expect(matchEncyclopediaEntry(entry!, '   ')).toBe(true);
    expect(normalizeEncyclopediaSearchText('  Rate-Limit ')).toBe('rate-limit');
  });
});

/**
 * 正文寻址。
 *
 * base URL 由宿主注入（`D3.0-1`），因此这里必须钉住的是**前缀与 base 分离**这件事：如果哪天有人
 * 把 `/encyclopedia/` 合进 base，这两个断言会立刻失败，而不是等到某个部署在子路径下白屏。
 */
describe('encyclopedia content addressing', () => {
  it('appends the encyclopedia prefix to an injected base', () => {
    expect(encyclopediaContentUrl({ baseUrl: '/' }, 'site-guide.md')).toBe('/encyclopedia/site-guide.md');
    expect(encyclopediaContentUrl({ baseUrl: '/app/' }, 'site-guide.md')).toBe('/app/encyclopedia/site-guide.md');
    expect(encyclopediaContentUrl({ baseUrl: '/app' }, 'site-guide.md')).toBe('/app/encyclopedia/site-guide.md');
  });

  it('keeps the content prefix independent from the base', () => {
    expect(ENCYCLOPEDIA_CONTENT_PREFIX).toBe('/encyclopedia');
    for (const entry of encyclopediaEntries) {
      expect(encyclopediaContentUrl({ baseUrl: '/' }, entry.contentFile)).toBe(
        `${ENCYCLOPEDIA_CONTENT_PREFIX}/${entry.contentFile}`,
      );
    }
  });

  it('never emits a double slash for a non-root base', () => {
    for (const baseUrl of ['/', '/app/', 'https://example.invalid/sub/']) {
      for (const entry of encyclopediaEntries) {
        expect(encyclopediaContentUrl({ baseUrl }, entry.contentFile)).not.toContain('//encyclopedia');
      }
    }
  });
});

describe('encyclopedia categories', () => {
  it('resolves declared categories and rejects unknown ids', () => {
    const guide = encyclopediaCategories.find((category) => category.id === 'guide');
    expect(getEncyclopediaCategory(guide?.id)?.title).toBe(guide?.title);
    expect(getEncyclopediaCategory(undefined)).toBeNull();

    // 参数类型是已知 id 的联合，但实现刻意容忍未知值：宿主会先校验来自 URL 的 `?c=`，
    // 而这里再兜一层，避免任何一条漏网的路径渲染出「分类：undefined」。
    expect(getEncyclopediaCategory('not-a-category' as EncyclopediaCategoryId)).toBeNull();
  });
});