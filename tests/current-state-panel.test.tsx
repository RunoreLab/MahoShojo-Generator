import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CurrentStatePanel } from '@/components/CurrentStatePanel';

describe('CurrentStatePanel 时间字段兼容', () => {
  it('应在仅存在 updated_at 时仍展示最近更新时间', () => {
    const html = renderToStaticMarkup(
      React.createElement(CurrentStatePanel, {
        state: {
          summary: '状态正常',
          fields: [],
          updated_at: '2026-03-01T10:00:00.000Z',
        },
      }),
    );

    expect(html).toContain('最近更新：');
  });
});
