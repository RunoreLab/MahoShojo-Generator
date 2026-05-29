import { describe, expect, test } from 'vitest';

import {
  appendReasoningDelta,
  buildLiveReasoningSummary,
  buildReasoningSummary,
  extractHeuristicReasoningFromMarkdown,
  updateReasoningStatus,
} from '@/lib/ai/reasoning-normalizer';

describe('ai/reasoning-normalizer', () => {
  test('buildReasoningSummary 会生成截断摘要', () => {
    const summary = buildReasoningSummary(
      'thought 先梳理角色设定，再比对场景约束，最后产出战报结构与胜者判断。',
      20
    );

    expect(summary).toBeTruthy();
    expect(summary).toContain('先梳理角色设定');
    expect(summary?.endsWith('…')).toBe(true);
  });

  test('appendReasoningDelta 会累积文本并更新摘要', () => {
    const first = appendReasoningDelta(null, '第一段推理。');
    const second = appendReasoningDelta(first, '第二段推理。');

    expect(second.status).toBe('thinking');
    expect(second.source).toBe('sdk');
    expect(second.text).toContain('第一段推理。第二段推理。');
    expect(typeof second.summary).toBe('string');
  });

  test('appendReasoningDelta 的摘要会跟随最新思考段落', () => {
    const first = appendReasoningDelta(null, '**Defining Battle Parameters** 我先定义战斗边界。');
    const second = appendReasoningDelta(
      first,
      '\n\n**Revising Power Disparity** 我重新评估双方等级差并修正叙事重点。'
    );

    expect(second.summary).toContain('Revising Power Disparity');
    expect(second.summary).not.toContain('Defining Battle Parameters');
  });

  test('buildLiveReasoningSummary 优先取末段摘要', () => {
    const text = [
      '**阶段一** 先整理输入约束。',
      '',
      '**阶段二** 再修正胜负判定逻辑并对齐输出格式。',
    ].join('\n');
    const summary = buildLiveReasoningSummary(text, 40);

    expect(summary).toContain('阶段二');
    expect(summary).not.toContain('阶段一');
  });

  test('updateReasoningStatus: 空状态 + unavailable 会返回可展示状态', () => {
    const next = updateReasoningStatus(null, { status: 'unavailable' });
    expect(next).not.toBeNull();
    expect(next?.status).toBe('unavailable');
    expect(next?.source).toBe('sdk');
  });

  test('extractHeuristicReasoningFromMarkdown 可识别 thought 泄漏前缀', () => {
    const markdown = [
      '# 战斗战报',
      '**来源：A.R.E.N.A.论坛-综合板块 | 记者：冲师逆徒**',
      '',
      'thought',
      'Playwright and storyteller.',
      'Magical Girl world.',
      'News report style.',
      '严格遵循角色设定与情景约束，先拟定指令，再构造执行过程，最后确定胜者与回执结构。',
      '确认输出语言、标题格式、结尾标记与胜者字段都满足约束。',
      '',
      '# 正式战报标题',
      '正文开始。',
    ].join('\n');

    const result = extractHeuristicReasoningFromMarkdown(markdown);
    expect(result?.source).toBe('heuristic');
    expect(result?.status).toBe('done');
    expect(result?.text).toContain('Playwright and storyteller.');
    expect(result?.anomalyFlags).toContain('text_injected');
  });
});
