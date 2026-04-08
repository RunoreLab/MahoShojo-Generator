import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DataCardReportModal } from '@/components/data-card-reports/DataCardReportModal';

describe('DataCardReportModal', () => {
  test('renders reasons, details field and reference sections', () => {
    const html = renderToStaticMarkup(
      <DataCardReportModal
        isOpen={true}
        cardName="雪沫"
        reasons={[{ code: 'plagiarism', label: '疑似抄袭', description: '高度近似搬运' }]}
        initialReport={null}
        submitting={false}
        error={null}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(html).toContain('举报数据卡');
    expect(html).toContain('疑似抄袭');
    expect(html).toContain('补充说明');
    expect(html).toContain('引用公开数据卡');
    expect(html).toContain('引用百科条目');
  });
});
