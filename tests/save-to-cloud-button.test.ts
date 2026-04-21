import { describe, expect, mock, test } from 'bun:test';

describe('SaveToCloudButton replace modal opening', () => {
  test('替换已有应先打开弹窗，再后台刷新数据卡', async () => {
    const module = await import('@/components/SaveToCloudButton');
    const openReplaceModalAndRefresh = (
      module as typeof module & {
        openReplaceModalAndRefresh?: (input: {
          openModal: () => void;
          refreshCards: () => Promise<unknown>;
        }) => void;
      }
    ).openReplaceModalAndRefresh;

    expect(typeof openReplaceModalAndRefresh).toBe('function');
    if (typeof openReplaceModalAndRefresh !== 'function') return;

    let opened = false;
    let refreshStarted = false;
    let resolveRefresh: (() => void) | null = null;

    const refreshCards = mock(() => {
      refreshStarted = true;
      return new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      });
    });

    openReplaceModalAndRefresh({
      openModal: () => {
        opened = true;
      },
      refreshCards,
    });

    expect(opened).toBe(true);
    expect(refreshStarted).toBe(true);
    expect(refreshCards).toHaveBeenCalledTimes(1);

    resolveRefresh?.();
  });
});
