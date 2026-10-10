import { describe, expect, it, vi } from 'vitest';
import type { NarrativeHistoryEntry } from '../src/arena-types';
import {
  buildNarrativeHistoryCardPayload,
  extractNarrativeHistoryImportEntries,
  mergeNarrativeHistoryEntries,
  normalizeImportedNarrativeHistoryEntries,
  sortNarrativeHistoryEntries,
  updateNarrativeHistoryEntry,
} from '../src/narrative-history-operations';
import * as legacy from './fixtures/narrative-history-editor-legacy';

const clock = () => '2026-10-10T01:02:03.000Z';
const idFactory = () => { let next = 0; return () => `host-${++next}`; };
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'same', title: '  原标题  ', content: ' \n# 原正文\n内容  ',
  createdAt: '2020-01-01T01:00:00+01:00', updatedAt: '2020-01-02', extension: { keepRaw: true },
  ...overrides,
});
describe('活动历史纯规则与提取前 Web 双跑', () => {
  it.each([
    { input: null }, { input: {} }, { input: [] }, { input: [null, '', 1, {}, row({ content: ' ' })] },
    { input: [row(), row({ id: null, title: '', createdAt: 'bad', created_at: '2001-01-01', updatedAt: null }),
      row({ id: '', title: '长'.repeat(140), updatedAt: 'bad', updated_at: '2002-01-01' }),
      row({ createdAt: 0, created_at: 'bad', updatedAt: undefined })] },
    { input: { entries: [row()] } }, { input: { templateId: 'narrative-history', data: { entries: [row()] } } },
    { input: { templateId: 'other', data: { entries: [row()] } } },
  ])('旧卡、缺 ID/日期、坏条目与空正文的既有规范投影不变 %#', ({ input }) => {
    const before = structuredClone(input);
    const expected = legacy.normalizeImportedEntries(input, idFactory());
    const actual = normalizeImportedNarrativeHistoryEntries(input, { createId: idFactory() });
    expect(actual).toStrictEqual(expected);
    expect(input).toStrictEqual(before);
    for (const entry of actual) expect(entry).not.toHaveProperty('extension');
  });

  it('多卡提取、追加/覆盖重复 ID、显示排序及卡封套不创造另一顺序权威', () => {
    const original = [{ entries: [row()] }, { templateId: 'narrative-history', data: { entries: [row({ title: '第二条' })] } }];
    const extracted = extractNarrativeHistoryImportEntries(original);
    expect(extracted.groupCount).toBe(2);
    const imported = normalizeImportedNarrativeHistoryEntries(extracted.entries, { createId: idFactory() });
    const existing = [{ ...imported[0], extension: { preserved: true } }];
    const appended = mergeNarrativeHistoryEntries(existing, imported, 'append');
    expect(appended.map((entry) => entry.id)).toEqual(['same', 'same::2', 'same::3']);
    expect(mergeNarrativeHistoryEntries(existing, imported, 'replace').map((entry) => entry.id)).toEqual(['same', 'same::2']);
    expect(appended[0]).toBe(existing[0]);
    sortNarrativeHistoryEntries(appended, 'updated_desc');
    const now = vi.fn(clock);
    const card = buildNarrativeHistoryCardPayload(appended, 'preserved-time', { now });
    expect(card).toStrictEqual(legacy.buildNarrativeHistoryCardPayload(appended, 'preserved-time', clock));
    expect(card.entries).not.toBe(appended);
    expect(card.entries[0]).toBe(existing[0]);
    expect(now).not.toHaveBeenCalled();
    expect(buildNarrativeHistoryCardPayload(appended, null, { now })).toStrictEqual(
      legacy.buildNarrativeHistoryCardPayload(appended, null, clock),
    );
    expect(now).toHaveBeenCalledTimes(1);
    expect(original[0].entries?.[0]).toHaveProperty('extension');
  });

  it.each([{}, { title: '' }, { title: ' x '.repeat(80) }, { content: ' \n新正文 \n' }, { title: ' ', content: '# 新正文' }])(
    '更新沿旧正文 fallback 并保留未知 entry 扩展 %#', (patch) => {
      const rows = [row(), row({ id: 'other' })] as NarrativeHistoryEntry[];
      const before = structuredClone(rows);
      const actual = updateNarrativeHistoryEntry(rows, 'same', patch, { now: clock });
      expect(actual).toStrictEqual(legacy.updateEntry(rows, 'same', patch, clock));
      expect(actual[1]).toBe(rows[1]);
      expect(actual[0]).toHaveProperty('extension', { keepRaw: true });
      expect(rows).toStrictEqual(before);
      expect(updateNarrativeHistoryEntry(rows, '', patch, { now: clock })).toBe(rows);
    },
  );

});
