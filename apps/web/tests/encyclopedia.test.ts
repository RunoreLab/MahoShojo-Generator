import { describe, expect, test } from 'vitest';

import {
  encyclopediaCategories,
  encyclopediaEntries,
  getEncyclopediaEntry,
  groupEncyclopediaEntries,
  matchEncyclopediaEntry,
} from '@/lib/encyclopedia';

describe('encyclopedia', () => {
  test('slugs are unique', () => {
    const slugs = encyclopediaEntries.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('category ids are unique and referenced', () => {
    const categoryIds = encyclopediaCategories.map((category) => category.id);
    expect(new Set(categoryIds).size).toBe(categoryIds.length);

    const validCategoryIds = new Set(categoryIds);
    for (const entry of encyclopediaEntries) {
      expect(validCategoryIds.has(entry.categoryId)).toBe(true);
    }
  });

  test('getEncyclopediaEntry finds existing entries', () => {
    for (const entry of encyclopediaEntries) {
      expect(getEncyclopediaEntry(entry.slug)?.slug).toBe(entry.slug);
    }
  });

  test('group helper covers all entries', () => {
    const grouped = groupEncyclopediaEntries(encyclopediaEntries);
    const groupedEntries = [
      ...grouped.categoriesWithEntries.flatMap((item) => item.entries),
      ...grouped.uncategorized,
    ];
    expect(groupedEntries.length).toBe(encyclopediaEntries.length);
    expect(new Set(groupedEntries.map((entry) => entry.slug)).size).toBe(encyclopediaEntries.length);
  });

  test('match helper searches title/summary/keywords', () => {
    const entry = encyclopediaEntries.find((item) => item.slug === 'rate-limit-429');
    expect(entry).not.toBeUndefined();
    expect(matchEncyclopediaEntry(entry!, '429')).toBe(true);
    expect(matchEncyclopediaEntry(entry!, '限流')).toBe(true);
    expect(matchEncyclopediaEntry(entry!, '冷却')).toBe(true);
  });

  // 注册了但没有对应 markdown 的条目会在运行时变成 404，而且很难被察觉。
  test('every registered entry has its markdown file', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
    const missing: string[] = [];
    for (const entry of encyclopediaEntries) {
      try {
        await readFile(join(publicDir, entry.markdownPath), 'utf8');
      } catch {
        missing.push(`${entry.slug} -> ${entry.markdownPath}`);
      }
    }
    expect(missing).toEqual([]);
  });

  // 站内条目之间靠 /encyclopedia/<slug> 互链，拼错只会得到一个死链。
  test('cross-links between encyclopedia pages all resolve', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
    const known = new Set(encyclopediaEntries.map((entry) => `/encyclopedia/${entry.slug}`));
    const broken: string[] = [];
    for (const entry of encyclopediaEntries) {
      const body = await readFile(join(publicDir, entry.markdownPath), 'utf8');
      for (const match of body.matchAll(/\/encyclopedia\/[a-z0-9-]+/g)) {
        if (!known.has(match[0])) broken.push(`${entry.slug} -> ${match[0]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

