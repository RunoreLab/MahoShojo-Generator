import { describe, expect, test } from 'bun:test';

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
});

