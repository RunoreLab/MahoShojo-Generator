import { describe, expect, test } from 'vitest';

import { useNarrativeHistoryStore } from '@/components/arena/stores/useNarrativeHistoryStore';

describe('narrative history store', () => {
  test('appendEntry: 空正文返回 null', () => {
    useNarrativeHistoryStore.getState().clear();

    const created = useNarrativeHistoryStore.getState().appendEntry({ title: 't', content: '   \n  ' });
    expect(created).toBeNull();
    expect(useNarrativeHistoryStore.getState().entries.length).toBe(0);
  });

  test('appendEntry: 标题为空时从正文首行推断', () => {
    useNarrativeHistoryStore.getState().clear();

    const created = useNarrativeHistoryStore.getState().appendEntry({
      title: '',
      content: '# 标题行\n\n正文段落',
    });

    expect(created).not.toBeNull();
    expect(created!.title).toBe('标题行');
    expect(created!.content).toContain('正文段落');
    expect(Number.isFinite(Date.parse(created!.createdAt))).toBe(true);
    expect(Number.isFinite(Date.parse(created!.updatedAt))).toBe(true);
    expect(useNarrativeHistoryStore.getState().entries[0]!.id).toBe(created!.id);
  });

  test('appendEntry: 同一 generation 终态重放只写入一次', () => {
    useNarrativeHistoryStore.getState().clear();

    const first = useNarrativeHistoryStore.getState().appendEntry({
      title: '首次',
      content: '完整战报',
      generationId: 'generation-1234',
    });
    const replay = useNarrativeHistoryStore.getState().appendEntry({
      title: '重放',
      content: '完整战报',
      generationId: 'generation-1234',
    });

    expect(replay).toBe(first);
    expect(first?.id).toBe('arena-generation:generation-1234');
    expect(useNarrativeHistoryStore.getState().entries).toHaveLength(1);
  });
});
