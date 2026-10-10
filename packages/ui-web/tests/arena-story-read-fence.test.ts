import { describe, expect, it } from 'vitest';
import { createBattleStoryReadFence } from '../src/arena-story-session-read';

describe('shared story publication fence', () => {
  it('reserves synchronously and isolates list, selection, chapter and export lanes', () => {
    const fence = createBattleStoryReadFence<'list' | 'selection' | 'chapter' | 'export'>();
    const list = fence.begin('list')!; const selection = fence.begin('selection')!;
    const chapter = fence.begin('chapter')!; const exporting = fence.begin('export')!;
    expect(fence.capture('chapter').isCurrent()).toBe(true);
    const newer = fence.begin('chapter')!;
    expect(chapter.isCurrent()).toBe(false); expect(chapter.isInScope()).toBe(true);
    for (const token of [list, selection, exporting, newer]) expect(token.isCurrent()).toBe(true);
  });

  it('invalidate discards every publication in the scope but permits fresh work', () => {
    const fence = createBattleStoryReadFence<'list' | 'chapter'>();
    const list = fence.begin('list')!; const chapter = fence.capture('chapter');
    fence.invalidate();
    expect(list.isCurrent()).toBe(false); expect(list.isInScope()).toBe(false);
    expect(chapter.isCurrent()).toBe(false); expect(fence.begin('chapter')?.isCurrent()).toBe(true);
  });

  it('dispose remains terminal after invalidation and capture', () => {
    const fence = createBattleStoryReadFence<'chapter'>(); const chapter = fence.begin('chapter')!;
    fence.dispose(); fence.invalidate();
    expect(chapter.isCurrent()).toBe(false); expect(chapter.isInScope()).toBe(false);
    expect(fence.begin('chapter')).toBeNull(); expect(fence.capture('chapter').isCurrent()).toBe(false);
  });
});
