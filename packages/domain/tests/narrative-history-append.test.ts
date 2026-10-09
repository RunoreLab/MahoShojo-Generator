import { describe, expect, it } from 'vitest';
import { appendNarrativeHistoryEntry, materializeArenaNarrativeHistoryForRequest } from '../src/narrative-history-operations';
const context = { fallbackId: 'local-1', createdAt: '2026-01-01T00:00:00Z' };
describe('pure Arena narrative history entry operations', () => {
  it('keeps legacy title/content normalization, prompt ordering and duplicate identity', () => {
    const first = appendNarrativeHistoryEntry([], { title: '', content: '\n# 标题\n\n正文  ', generationId: ' gen-1 ' }, context);
    expect(first.entry).toEqual({ id: 'arena-generation:gen-1', title: '标题', content: '# 标题\n\n正文', createdAt: context.createdAt, updatedAt: context.createdAt });
    const replay = appendNarrativeHistoryEntry(first.entries, { title: '重放', content: '新内容', generationId: 'gen-1' }, { fallbackId: 'unused', createdAt: 'later' });
    expect(replay.entry).toBe(first.entry);
    expect(replay.entries).toBe(first.entries);
    expect(replay.appended).toBe(false);
    const next = appendNarrativeHistoryEntry(first.entries, { title: '新'.repeat(130), content: '新正文' }, context);
    expect(next.entries[0]).toBe(first.entry);
    expect(next.entry?.title).toHaveLength(120);
    expect(next.entry?.id).toBe('local-1');
    expect(first.entries).toHaveLength(1);
    expect(appendNarrativeHistoryEntry(first.entries, { title: '', content: ' ' }, context).entries).toBe(first.entries);
  });
  it('disabled reading emits no history and limits select the tail in prompt order', () => {
    const settings = { readNarrativeHistory: false, readNarrativeHistoryLimit: 1, isNarrativeHistoryUnlimited: false };
    const entries = ['一', '二', '三'].map((content) => appendNarrativeHistoryEntry([], { title: '', content }, { ...context, fallbackId: content }).entry!);
    expect(materializeArenaNarrativeHistoryForRequest(settings, entries)).toEqual({ readLimit: undefined, entries: undefined });
    const enabled = materializeArenaNarrativeHistoryForRequest({ ...settings, readNarrativeHistory: true }, entries);
    expect(enabled.entries?.map((entry) => entry.title)).toEqual(['三']);
    expect(materializeArenaNarrativeHistoryForRequest({ ...settings, readNarrativeHistory: true, isNarrativeHistoryUnlimited: true }, entries).entries).toHaveLength(3);
  });
});
