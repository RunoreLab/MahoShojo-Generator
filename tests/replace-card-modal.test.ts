import { describe, expect, test } from 'bun:test';

describe('ReplaceCardModal empty state diagnostics', () => {
  test('在没有同类型候选时输出当前账号、总卡数与目标类型', async () => {
    const module = await import('@/components/ReplaceCardModal');
    const buildEmptyState = (
      module as typeof module & {
        buildReplaceCardEmptyState?: (input: {
          targetType: 'character' | 'scenario' | 'history' | 'questionnaire';
          totalCards: number;
          candidateCount: number;
          viewer?: { id?: number | null; username?: string | null } | null;
          loadError?: string | null;
        }) => { title: string; details: string[]; errorMessage: string | null };
      }
    ).buildReplaceCardEmptyState;

    expect(typeof buildEmptyState).toBe('function');
    if (typeof buildEmptyState !== 'function') return;

    const state = buildEmptyState({
      targetType: 'character',
      totalCards: 3,
      candidateCount: 0,
      viewer: { id: 308, username: '没灵感的造物主' },
      loadError: null,
    });

    expect(state.title).toBe('暂无同类型的数据卡可替换。');
    expect(state.errorMessage).toBeNull();
    expect(state.details).toContain('当前登录：没灵感的造物主 (#308)');
    expect(state.details).toContain('已加载数据卡：3 张');
    expect(state.details).toContain('目标类型：角色');
    expect(state.details).toContain('同类型候选：0 张');
  });

  test('在卡片列表加载失败时保留失败原因供弹窗展示', async () => {
    const module = await import('@/components/ReplaceCardModal');
    const buildEmptyState = (
      module as typeof module & {
        buildReplaceCardEmptyState?: (input: {
          targetType: 'character' | 'scenario' | 'history' | 'questionnaire';
          totalCards: number;
          candidateCount: number;
          viewer?: { id?: number | null; username?: string | null } | null;
          loadError?: string | null;
        }) => { title: string; details: string[]; errorMessage: string | null };
      }
    ).buildReplaceCardEmptyState;

    expect(typeof buildEmptyState).toBe('function');
    if (typeof buildEmptyState !== 'function') return;

    const state = buildEmptyState({
      targetType: 'character',
      totalCards: 0,
      candidateCount: 0,
      viewer: { id: 308, username: '没灵感的造物主' },
      loadError: '未授权',
    });

    expect(state.errorMessage).toBe('未授权');
    expect(state.details).toContain('加载状态：失败');
    expect(state.details).toContain('当前登录：没灵感的造物主 (#308)');
  });
});
