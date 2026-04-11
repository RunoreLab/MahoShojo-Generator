import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  buildReportReferencesFromModalFields,
  DataCardReportModal,
} from '@/components/data-card-reports/DataCardReportModal';

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

  test('uses a constrained modal layout with scrollable body and fixed actions', () => {
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

    expect(html).toContain('max-h-[calc(100dvh-2rem)]');
    expect(html).toContain('min-h-0 flex-1 overflow-y-auto');
    expect(html).toContain('shrink-0 border-t border-gray-200');
  });

  test('preserves existing reference notes for unchanged references when rebuilding draft references', () => {
    const references = buildReportReferencesFromModalFields({
      initialReferences: [
        {
          referenceType: 'public_data_card',
          referenceId: 'card-2',
          note: '对照卡备注',
          sortOrder: 0,
        },
        {
          referenceType: 'encyclopedia_entry',
          referenceId: 'community-rules',
          note: '规则依据',
          sortOrder: 1,
        },
      ],
      publicDataCardRefs: 'card-2\ncard-3',
      encyclopediaRefs: 'community-rules',
    });

    expect(references).toEqual([
      {
        referenceType: 'public_data_card',
        referenceId: 'card-2',
        note: '对照卡备注',
        sortOrder: 0,
      },
      {
        referenceType: 'public_data_card',
        referenceId: 'card-3',
        note: null,
        sortOrder: 1,
      },
      {
        referenceType: 'encyclopedia_entry',
        referenceId: 'community-rules',
        note: '规则依据',
        sortOrder: 2,
      },
    ]);
  });

  test('preserves existing public data card notes when the same card is pasted as a link', () => {
    const references = buildReportReferencesFromModalFields({
      initialReferences: [
        {
          referenceType: 'public_data_card',
          referenceId: '00000000-0000-4000-8000-000000000001',
          note: '对照卡备注',
          sortOrder: 0,
        },
      ],
      publicDataCardRefs: 'https://example.test/character-manager?dataCardId=00000000-0000-4000-8000-000000000001',
      encyclopediaRefs: '',
    });

    expect(references).toEqual([
      {
        referenceType: 'public_data_card',
        referenceId: '00000000-0000-4000-8000-000000000001',
        note: '对照卡备注',
        sortOrder: 0,
      },
    ]);
  });
});
