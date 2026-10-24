import { describe, expect, it } from 'vitest';
import { resolveMagicTeaPartyBranchSummary } from '../src/magic-tea-party/branch-summary';
import type { MagicTeaPartyMessage, MagicTeaPartySession } from '../src/magic-tea-party/types';

const messages: MagicTeaPartyMessage[] = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, sessionId: 'session', role: 'user', content: id, createdAt: 1 }));
const session = (): MagicTeaPartySession => ({ id: 'session', title: '茶会', roles: [], createdAt: 1, updatedAt: 1, settings: { providerId: 'p', modelId: 'm' },
  summary: '已有摘要', summarySections: { recap: '摘要段落' }, summaryMeta: { updatedAt: 1, fromMessageId: 'a', toMessageId: 'c',
    coverage: { version: 1, sourceMessageCount: 3, selectedMessageIds: ['b', 'c'], clippedMessageIds: ['c'], omittedMessageCount: 1 } } });
const idMap = new Map([['a', 'new-a'], ['b', 'new-b'], ['c', 'new-c']]);
const clear = { summary: undefined, summarySections: undefined, summaryMeta: undefined };

describe('shared summary coverage on fork and merge', () => {
  it('remaps full-history watermarks and sparse coverage independently on fork', () => {
    const source = session();
    const before = JSON.stringify(source);
    const next = resolveMagicTeaPartyBranchSummary({ session: source, messages, replaceFromIndex: 3, clonedMessageIds: idMap });
    expect(next).toEqual({ summary: source.summary, summarySections: source.summarySections, summaryMeta: { updatedAt: 1,
      fromMessageId: 'new-a', toMessageId: 'new-c', coverage: { ...source.summaryMeta!.coverage, selectedMessageIds: ['new-b', 'new-c'], clippedMessageIds: ['new-c'] } } });
    expect(next.summaryMeta!.fromMessageId).not.toBe(next.summaryMeta!.coverage!.selectedMessageIds[0]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each(['d', 'missing'])('invalidates all fork summary fields when coverage crosses the cloned prefix or is unprovable (%s)', id => {
    const source = session();
    source.summaryMeta!.coverage!.selectedMessageIds = ['b', id];
    source.summaryMeta!.coverage!.clippedMessageIds = [];
    const next = resolveMagicTeaPartyBranchSummary({ session: source, messages, replaceFromIndex: 3, clonedMessageIds: idMap });
    expect(next).toEqual(clear);
    expect(source.summary).toBe('已有摘要');
    expect(source.summaryMeta!.toMessageId).toBe('c');
    expect(source.summaryMeta!.coverage!.selectedMessageIds).toEqual(['b', id]);
  });

  it('still clears all summary fields when a fork replaces its full-history watermark', () => {
    expect(resolveMagicTeaPartyBranchSummary({ session: session(), messages, replaceFromIndex: 2, clonedMessageIds: idMap })).toEqual(clear);
  });

  it('keeps unknown legacy watermarks and summaries without coverage under their existing semantics', () => {
    const source = session();
    source.summaryMeta = { updatedAt: 1, fromMessageId: 'missing-from', toMessageId: 'missing-to' };
    expect(resolveMagicTeaPartyBranchSummary({ session: source, messages, replaceFromIndex: 3, clonedMessageIds: idMap })).toEqual({ summary: source.summary, summarySections: source.summarySections, summaryMeta: source.summaryMeta });
  });

  it('keeps a parent summary whose coverage remains entirely before the merged tail', () => {
    const source = session();
    expect(resolveMagicTeaPartyBranchSummary({ session: source, messages, replaceFromIndex: 3 })).toEqual({ summary: source.summary, summarySections: source.summarySections, summaryMeta: source.summaryMeta });
  });

  it.each(['d', 'missing'])('invalidates all parent summary fields when merge coverage points outside the retained prefix (%s)', id => {
    const source = session();
    source.summaryMeta!.coverage!.selectedMessageIds = ['b', id];
    source.summaryMeta!.coverage!.clippedMessageIds = [];
    expect(resolveMagicTeaPartyBranchSummary({ session: source, messages, replaceFromIndex: 3 })).toEqual(clear);
    expect(source.summary).toBe('已有摘要');
  });

  it('retains the pre-existing merge watermark invalidation even without coverage', () => {
    const source = session();
    delete source.summaryMeta!.coverage;
    expect(resolveMagicTeaPartyBranchSummary({ session: source, messages, replaceFromIndex: 2 })).toEqual(clear);
  });
});

import fixture from '@mahoshojo/contracts/fixtures/desktop-tea-branch-summary.json';
describe('shared Native/Web branch summary golden cases', () => {
  it.each(fixture.cases)('$name', ({ session: summary, replaceFromIndex, expected }) => {
    const result = resolveMagicTeaPartyBranchSummary({ session: Object.assign(session(), { summary: undefined, summarySections: undefined, summaryMeta: undefined }, summary) as MagicTeaPartySession,
      messages: fixture.messageIds.map(id => ({ id, sessionId: 'session', role: 'user', content: id, createdAt: 1 })),
      replaceFromIndex, clonedMessageIds: new Map(Object.entries(fixture.clonedMessageIds)) });
    // JSON absence is the persisted Native representation of cleared optional fields.
    expect(JSON.parse(JSON.stringify(result))).toEqual(expected);
  });
});


describe('shared Native/Web merge summary golden cases', () => {
  it.each(fixture.cases)('$name', ({ session: summary, replaceFromIndex, expectedMerge }) => {
    const result = resolveMagicTeaPartyBranchSummary({ session: Object.assign(session(), { summary: undefined, summarySections: undefined, summaryMeta: undefined }, summary) as MagicTeaPartySession,
      messages: fixture.messageIds.map(id => ({ id, sessionId: 'session', role: 'user', content: id, createdAt: 1 })), replaceFromIndex });
    expect(JSON.parse(JSON.stringify(result))).toEqual(expectedMerge);
  });
});
