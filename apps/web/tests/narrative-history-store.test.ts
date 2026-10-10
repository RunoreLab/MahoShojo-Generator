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

describe('共源更新的真实 Web 持久化消费者', () => {
  test('编辑保留扩展、原 ID/顺序，并沿旧正文生成空标题 fallback', async () => {
    await useNarrativeHistoryStore.persist.rehydrate();
    const original = {
      id: 'persisted', title: '旧标题', content: '# 旧正文', createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-02T00:00:00.000Z', extension: { preserved: true },
    };
    useNarrativeHistoryStore.getState().replaceAll([original]);
    useNarrativeHistoryStore.getState().updateEntry('persisted', { title: ' ', content: ' \n新正文 \n' });
    const state = useNarrativeHistoryStore.getState();
    expect(state.entries[0]).toMatchObject({
      id: 'persisted', title: '旧正文', content: ' \n新正文 \n', createdAt: original.createdAt,
      extension: { preserved: true },
    });
    expect(original.content).toBe('# 旧正文');
    const persisted = JSON.parse(localStorage.getItem('arena-narrative-history-v1') ?? '{}');
    expect(persisted.version).toBe(2);
    expect(persisted.state.entries).toEqual(state.entries);
    expect(persisted.state.lastUpdatedAt).toBe(state.lastUpdatedAt);
  });

  test('原 key/version/skipHydration 与旧数据迁移的提示词顺序保持', async () => {
    const opts = useNarrativeHistoryStore.persist.getOptions();
    expect(opts).toMatchObject({ name: 'arena-narrative-history-v1', version: 2, skipHydration: true });
    const entry = { title: '历史', content: '正文', updatedAt: '2020-01-05', extension: 42 };
    localStorage.setItem('arena-narrative-history-v1', JSON.stringify({ version: 1, state: {
      entries: [{ ...entry, id: 'new', createdAt: '2020-01-02' }, { ...entry, id: 'old', createdAt: '2020-01-01' }],
      lastUpdatedAt: 'retained', sort: 'invalid',
    } }));
    await useNarrativeHistoryStore.persist.rehydrate();
    expect(useNarrativeHistoryStore.getState().entries.map((item) => item.id)).toEqual(['old', 'new']);
    expect(useNarrativeHistoryStore.getState().sort).toBe('updated_desc');
    expect(useNarrativeHistoryStore.getState().lastUpdatedAt).toBe('retained');
    expect(useNarrativeHistoryStore.getState().entries[0]).toHaveProperty('extension', 42);
    useNarrativeHistoryStore.getState().setSort('created_desc');
    expect(useNarrativeHistoryStore.getState().entries.map((item) => item.id)).toEqual(['old', 'new']);
  });
});
