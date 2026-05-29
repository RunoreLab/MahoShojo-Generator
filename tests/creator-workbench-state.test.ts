import { describe, expect, test } from 'vitest';

import * as creatorWorkbench from '@/lib/creator/workbench';

const {
  hasCreatorWorkbenchResult,
  resolveCreatorStreamingDisplayMarkdown,
  subscribeToMediaQueryChange,
} = creatorWorkbench;

describe('creator workbench state', () => {
  test('流式生成一启动即应切入结果阶段', () => {
    expect(
      hasCreatorWorkbenchResult({
        generationMode: 'stream',
        magicalGirlDetails: null,
        streamingMarkdown: '',
        streamedGeneralCard: null,
      })
    ).toBe(true);
  });

  test('流式展示 Markdown 在启动阶段应保留空字符串', () => {
    expect(
      resolveCreatorStreamingDisplayMarkdown({
        streamingMarkdown: '',
        streamedGeneralCard: null,
      })
    ).toBe('');
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

  test('流式结果阶段未完成时不应显示创作完成文案', () => {
    const result = (creatorWorkbench as any).buildCreatorResultOverview?.({
      isSubmitting: true,
      snapshot: {
        generationMode: 'stream',
        template: 'general',
        templateLabel: '通用角色卡（Markdown）',
        primaryRuleLabel: '魔法少女竞技场 TRPG 简化角色卡',
        questionCount: 12,
        nativeAllowed: true,
        overLimitCount: 0,
        streamFallbackLabel: '测试角色',
      },
      result: null,
    });

    expect(result).toEqual({
      stageLabel: '创作进行中',
      progressLabel: '共 12 题，结果仍在生成中',
      nativeHint: '当前提交满足原生条件，完成签名后将具备原生性',
    });
  });

  test('签名失败后的结果阶段提示应明确降级为非原生', () => {
    const result = (creatorWorkbench as any).buildCreatorResultOverview?.({
      isSubmitting: false,
      snapshot: {
        generationMode: 'stream',
        template: 'general',
        templateLabel: '通用角色卡（Markdown）',
        primaryRuleLabel: '魔法少女竞技场 TRPG 简化角色卡',
        questionCount: 12,
        nativeAllowed: true,
        overLimitCount: 0,
        streamFallbackLabel: '测试角色',
      },
      result: {
        templateId: '通用角色',
        content: '# 测试角色',
      },
    });

    expect(result).toEqual({
      stageLabel: '创作完成',
      progressLabel: '共 12 题，已进入结果阶段',
      nativeHint: '原生性签名失败，当前展示结果已降级为非原生',
    });
  });

  test('已有结果时应继续使用提交时的模板与规则快照', () => {
    const result = (creatorWorkbench as any).resolveCreatorWorkbenchDisplayState?.({
      currentGenerationMode: 'stream',
      currentTemplate: 'general-scenario',
      currentTemplateLabel: '通用情景卡（Markdown）',
      currentPrimaryRuleLabel: '另一条规则',
      currentQuestionCount: 18,
      currentStreamFallbackLabel: '新的标题提示',
      snapshot: {
        generationMode: 'stream',
        template: 'general',
        templateLabel: '通用角色卡（Markdown）',
        primaryRuleLabel: '魔法少女竞技场 TRPG 简化角色卡',
        questionCount: 12,
        nativeAllowed: true,
        overLimitCount: 0,
        streamFallbackLabel: '初始角色名',
      },
    });

    expect(result).toEqual({
      generationMode: 'stream',
      template: 'general',
      templateLabel: '通用角色卡（Markdown）',
      primaryRuleLabel: '魔法少女竞技场 TRPG 简化角色卡',
      questionCount: 12,
      nativeAllowed: true,
      overLimitCount: 0,
      streamFallbackLabel: '初始角色名',
    });
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
