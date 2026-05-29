import { describe, expect, test } from 'vitest';

import {
  InvalidDataCardReportReferenceError,
  MAX_DATA_CARD_REPORT_DETAILS_LENGTH,
  MAX_DATA_CARD_REPORT_REFERENCE_NOTE_LENGTH,
  buildNormalizedReportPayloadHash,
  normalizeDataCardReportDetails,
  normalizeDataCardReportReferences,
} from '@/lib/data-card-reports/normalization';

describe('data card report normalization', () => {
  test('deduplicates references by type and id while keeping first note and order', () => {
    const refs = normalizeDataCardReportReferences([
      { referenceType: 'encyclopedia_entry', referenceId: 'community-rules', note: '第一次' },
      { referenceType: 'encyclopedia_entry', referenceId: 'community-rules', note: '第二次' },
      { referenceType: 'public_data_card', referenceId: 'card-a', note: '对照卡' },
    ]);

    expect(refs).toEqual([
      { referenceType: 'encyclopedia_entry', referenceId: 'community-rules', note: '第一次', sortOrder: 0 },
      { referenceType: 'public_data_card', referenceId: 'card-a', note: '对照卡', sortOrder: 1 },
    ]);
  });

  test('canonicalizes encyclopedia alias slugs before deduplication', () => {
    const refs = normalizeDataCardReportReferences([
      { referenceType: 'encyclopedia_entry', referenceId: 'modelscope-auth-401', note: '第一次' },
      { referenceType: 'encyclopedia_entry', referenceId: 'tachie-auth-errors', note: '第二次' },
    ]);

    expect(refs).toEqual([
      { referenceType: 'encyclopedia_entry', referenceId: 'tachie-auth-errors', note: '第一次', sortOrder: 0 },
    ]);
  });

  test('uses normalized references and details for stable payload hash', async () => {
    const a = await buildNormalizedReportPayloadHash({
      targetEntityId: 'card-1',
      reasonCode: 'plagiarism',
      details: '  说明\n',
      references: [{ referenceType: 'encyclopedia_entry', referenceId: 'community-rules', note: '' }],
    });
    const b = await buildNormalizedReportPayloadHash({
      targetEntityId: 'card-1',
      reasonCode: 'plagiarism',
      details: '说明',
      references: [{ referenceType: 'encyclopedia_entry', referenceId: 'community-rules', note: null }],
    });

    expect(a).toBe(b);
  });

  test('treats reordered references as the same normalized payload hash', async () => {
    const a = await buildNormalizedReportPayloadHash({
      targetEntityId: 'card-1',
      reasonCode: 'plagiarism',
      details: '说明',
      references: [
        { referenceType: 'encyclopedia_entry', referenceId: 'community-rules', note: '规则依据', sortOrder: 0 },
        { referenceType: 'public_data_card', referenceId: 'card-a', note: '对照卡', sortOrder: 1 },
      ],
    });
    const b = await buildNormalizedReportPayloadHash({
      targetEntityId: 'card-1',
      reasonCode: 'plagiarism',
      details: '说明',
      references: [
        { referenceType: 'public_data_card', referenceId: 'card-a', note: '对照卡', sortOrder: 0 },
        { referenceType: 'encyclopedia_entry', referenceId: 'community-rules', note: '规则依据', sortOrder: 1 },
      ],
    });

    expect(a).toBe(b);
  });

  test('treats encyclopedia alias and canonical slug as the same normalized payload hash', async () => {
    const aliasHash = await buildNormalizedReportPayloadHash({
      targetEntityId: 'card-1',
      reasonCode: 'plagiarism',
      details: '说明',
      references: [{ referenceType: 'encyclopedia_entry', referenceId: 'modelscope-auth-401', note: '规则依据' }],
    });
    const canonicalHash = await buildNormalizedReportPayloadHash({
      targetEntityId: 'card-1',
      reasonCode: 'plagiarism',
      details: '说明',
      references: [{ referenceType: 'encyclopedia_entry', referenceId: 'tachie-auth-errors', note: '规则依据' }],
    });

    expect(aliasHash).toBe(canonicalHash);
  });

  test('extracts public data card id from pasted links', () => {
    const refs = normalizeDataCardReportReferences([
      {
        referenceType: 'public_data_card',
        referenceId: 'https://example.test/character-manager?dataCardId=00000000-0000-4000-8000-000000000001',
      },
    ]);

    expect(refs[0]?.referenceId).toBe('00000000-0000-4000-8000-000000000001');
  });

  test('rejects oversized details', () => {
    expect(() => normalizeDataCardReportDetails('a'.repeat(MAX_DATA_CARD_REPORT_DETAILS_LENGTH + 1))).toThrow(
      `补充说明不能超过 ${MAX_DATA_CARD_REPORT_DETAILS_LENGTH} 个字符`,
    );
  });

  test('rejects oversized reference notes', () => {
    expect(() =>
      normalizeDataCardReportReferences([
        {
          referenceType: 'encyclopedia_entry',
          referenceId: 'community-rules',
          note: 'a'.repeat(MAX_DATA_CARD_REPORT_REFERENCE_NOTE_LENGTH + 1),
        },
      ]),
    ).toThrow(InvalidDataCardReportReferenceError);
  });

  test('rejects more than five unique references instead of truncating silently', () => {
    expect(() =>
      normalizeDataCardReportReferences([
        { referenceType: 'encyclopedia_entry', referenceId: 'a' },
        { referenceType: 'encyclopedia_entry', referenceId: 'b' },
        { referenceType: 'encyclopedia_entry', referenceId: 'c' },
        { referenceType: 'encyclopedia_entry', referenceId: 'd' },
        { referenceType: 'encyclopedia_entry', referenceId: 'e' },
        { referenceType: 'encyclopedia_entry', referenceId: 'f' },
      ]),
    ).toThrow(InvalidDataCardReportReferenceError);
  });
});
