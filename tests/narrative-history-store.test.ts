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
});

