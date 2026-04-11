import { describe, expect, test } from 'bun:test';

import { renderMessageTemplate } from '@/lib/messages/templates';

describe('message templates', () => {
  test('renders site issue update from payload', () => {
    const result = renderMessageTemplate({
      templateKey: 'site.issue.update',
      payload: { issueTitle: 'PVP 结算异常', statusText: '已修复' },
      titleText: null,
      bodyText: null,
    });

    expect(result.title).toContain('问题处理');
    expect(result.body).toContain('PVP 结算异常');
    expect(result.body).toContain('已修复');
  });

  test('falls back to titleText and bodyText for unknown template', () => {
    const result = renderMessageTemplate({
      templateKey: 'unknown.template',
      payload: {},
      titleText: '手写标题',
      bodyText: '手写正文',
    });

    expect(result).toEqual({ title: '手写标题', body: '手写正文' });
  });

  test('renders anonymous data card report notification without reporter identity', () => {
    const rendered = renderMessageTemplate({
      templateKey: 'user.moderation.data_card_reported',
      payload: {
        dataCardName: '雪沫',
        reasonLabels: ['疑似抄袭'],
        referenceSummary: ['引用公开数据卡：白百合'],
        detailsPreview: '能力结构高度近似。',
        reportCount: 2,
      },
      titleText: null,
      bodyText: null,
    });

    expect(rendered.title).toContain('雪沫');
    expect(rendered.body).toContain('疑似抄袭');
    expect(rendered.body).toContain('引用公开数据卡');
    expect(rendered.body).not.toContain('举报人');
  });

  test('renders report case resolved appeal-entry notification', () => {
    const rendered = renderMessageTemplate({
      templateKey: 'user.moderation.report_case_resolved',
      payload: {
        dataCardName: '雪沫',
        resolutionLabel: '确认违规',
      },
      titleText: null,
      bodyText: null,
    });

    expect(rendered.title).toContain('雪沫');
    expect(rendered.body).toContain('确认违规');
    expect(rendered.body).toContain('申诉');
  });

  test('renders report case resolved notification with admin follow-up reason', () => {
    const rendered = renderMessageTemplate({
      templateKey: 'user.moderation.report_case_resolved',
      payload: {
        dataCardName: '雪沫',
        resolutionLabel: '确认违规',
        reason: '请按说明整改后再提交。',
      },
      titleText: null,
      bodyText: null,
    });

    expect(rendered.body).toContain('确认违规');
    expect(rendered.body).toContain('请按说明整改后再提交');
  });

  test('renders report appeal resolved notification', () => {
    const rendered = renderMessageTemplate({
      templateKey: 'user.moderation.report_appeal_resolved',
      payload: {
        dataCardName: '雪沫',
        resolutionLabel: '维持原判',
      },
      titleText: null,
      bodyText: null,
    });

    expect(rendered.title).toContain('申诉');
    expect(rendered.body).toContain('维持原判');
  });
});
