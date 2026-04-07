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
});
