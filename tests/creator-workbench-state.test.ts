import { describe, expect, test } from 'bun:test';

import { hasCreatorWorkbenchResult, subscribeToMediaQueryChange } from '@/lib/creator/workbench';

describe('creator workbench state', () => {
  test('流式空缓冲区不应被视为已生成结果', () => {
    expect(
      hasCreatorWorkbenchResult({
        generationMode: 'stream',
        magicalGirlDetails: null,
        streamingMarkdown: '',
        streamedGeneralCard: null,
      })
    ).toBe(false);
  });

  test('流式收到正文后应切入结果阶段', () => {
    expect(
      hasCreatorWorkbenchResult({
        generationMode: 'stream',
        magicalGirlDetails: null,
        streamingMarkdown: '# 测试角色',
        streamedGeneralCard: null,
      })
    ).toBe(true);
  });

  test('流式卡片已完成时即使 Markdown 已清空也应保留结果阶段', () => {
    expect(
      hasCreatorWorkbenchResult({
        generationMode: 'stream',
        magicalGirlDetails: null,
        streamingMarkdown: null,
        streamedGeneralCard: { templateId: '通用角色' },
      })
    ).toBe(true);
  });

  test('matchMedia 优先使用 addEventListener/removeEventListener', () => {
    const calls: string[] = [];
    const listener = () => {};
    const mediaQuery = {
      addEventListener(eventName: string, handler: (event: MediaQueryListEvent) => void) {
        calls.push(`addEventListener:${eventName}:${String(handler === listener)}`);
      },
      removeEventListener(eventName: string, handler: (event: MediaQueryListEvent) => void) {
        calls.push(`removeEventListener:${eventName}:${String(handler === listener)}`);
      },
    } as Pick<MediaQueryList, 'addEventListener' | 'removeEventListener'>;

    const unsubscribe = subscribeToMediaQueryChange(mediaQuery, listener);
    unsubscribe();

    expect(calls).toEqual([
      'addEventListener:change:true',
      'removeEventListener:change:true',
    ]);
  });

  test('旧版 matchMedia 会回退到 addListener/removeListener', () => {
    const calls: string[] = [];
    const listener = () => {};
    const mediaQuery = {
      addListener(handler: (event: MediaQueryListEvent) => void) {
        calls.push(`addListener:${String(handler === listener)}`);
      },
      removeListener(handler: (event: MediaQueryListEvent) => void) {
        calls.push(`removeListener:${String(handler === listener)}`);
      },
    } as Pick<MediaQueryList, 'addListener' | 'removeListener'>;

    const unsubscribe = subscribeToMediaQueryChange(mediaQuery, listener);
    unsubscribe();

    expect(calls).toEqual([
      'addListener:true',
      'removeListener:true',
    ]);
  });
});
