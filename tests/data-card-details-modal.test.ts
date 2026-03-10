import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DataCardDetailsModal from '@/components/DataCardDetailsModal';

describe('DataCardDetailsModal', () => {
  it('renders markdown strings with preserved line breaks', () => {
    const data = {
      templateId: 'narrative-history',
      version: 1,
      title: '测试历史卡',
      updatedAt: '2025-12-28T00:00:00.000Z',
      entries: [
        {
          id: 'e1',
          title: '第一章',
          content: '第一行\n第二行\n\n**加粗**',
          createdAt: '2025-12-28T00:00:00.000Z',
          updatedAt: '2025-12-28T00:00:00.000Z',
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(DataCardDetailsModal, {
        isOpen: true,
        onClose: () => {},
        card: {
          id: 'c1',
          name: '测试卡片',
          description: '用于验证 Markdown 渲染',
          type: 'history',
          data: JSON.stringify(data),
          isPublic: false,
          author: 'tester',
        },
      }),
    );

    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('whitespace-pre-wrap');
  });
});

