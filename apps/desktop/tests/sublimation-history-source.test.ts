import { describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { readSublimationHistorySource, composeDesktopSublimationHistory } from '../src/features/sublimation/history-source';
const entry = { id: 'same', title: '史', content: '正文', createdAt: '2026-01-01', updatedAt: '2026-01-01', extra: { a: 1 } };
const record = (id: string) => ({ id, updatedAt: '2026-01-01', data: { templateId: 'narrative-history', version: 1, updatedAt: '2026-01-01', entries: [entry], extension: true } });
const repo = (list: unknown) => ({ list } as Pick<CardRepository, 'list'>);
describe('Desktop Sublimation history source', () => {
  it('pages only history cards and preserves repeated legacy IDs via source identity without writes', async () => {
    const a = record('a'), b = record('b'), before = JSON.stringify([a,b]);
    const list = vi.fn().mockResolvedValueOnce({ items: [a], nextCursor: 'next' }).mockResolvedValueOnce({ items: [b] });
    const result = await readSublimationHistorySource(repo(list));
    expect(result.status).toBe('ready'); expect(result.entries).toHaveLength(2);
    expect(new Set(result.entries.map(e => e.id)).size).toBe(2);
    expect(result.entries[0]).toHaveProperty('extra', { a: 1 });
    expect(JSON.stringify([a,b])).toBe(before);
    expect(list).toHaveBeenNthCalledWith(2, { cardTypes: ['history'], limit: 100, cursor: 'next' });
    expect(composeDesktopSublimationHistory(result.entries, [result.entries[1].id], '手写')).toContain('已选 1 条');
  });
  it('unsupported cards are retained and reported instead of repaired', async () => {
    const bad = { ...record('bad'), data: { templateId: 'unknown', entries: [entry] } };
    const result = await readSublimationHistorySource(repo(vi.fn().mockResolvedValue({ items: [bad], unreadable: ['broken-record'] })));
    expect(result.status).toBe('ready'); expect(result.unsupportedCount).toBe(2); expect(result.message).toContain('原始数据保留');
    expect(bad.data.templateId).toBe('unknown');
  });
  it('read failure discards partial projection and differs from valid empty library', async () => {
    const error = await readSublimationHistorySource(repo(vi.fn().mockResolvedValueOnce({items:[record('a')],nextCursor:'x'}).mockRejectedValueOnce(new Error('private details'))));
    expect(error.status).toBe('error'); expect(error.entries).toEqual([]); expect(error.message).not.toContain('private');
    expect((await readSublimationHistorySource(repo(vi.fn().mockResolvedValue({items:[]})))).status).toBe('ready');
  });
  it('abort and repeated cursors cannot produce successful partial history', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(readSublimationHistorySource(repo(vi.fn()), abort.signal)).rejects.toThrow();
    expect((await readSublimationHistorySource(repo(vi.fn().mockResolvedValue({items:[],nextCursor:'same'})))).status).toBe('error');
  });
});
