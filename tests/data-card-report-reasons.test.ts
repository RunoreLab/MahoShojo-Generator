import { describe, expect, test } from 'bun:test';

import {
  DATA_CARD_REPORT_REASONS,
  getDataCardReportReasonLabel,
  isDataCardReportReasonCode,
} from '@/lib/data-card-reports/reasons';

describe('data card report reasons', () => {
  test('exposes stable report reason codes and labels', () => {
    expect(DATA_CARD_REPORT_REASONS.map((reason) => reason.code)).toContain('plagiarism');
    expect(isDataCardReportReasonCode('plagiarism')).toBe(true);
    expect(isDataCardReportReasonCode('unknown')).toBe(false);
    expect(getDataCardReportReasonLabel('plagiarism')).toContain('抄袭');
  });
});
