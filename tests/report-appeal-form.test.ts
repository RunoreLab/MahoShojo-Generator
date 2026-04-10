import { describe, expect, test } from 'bun:test';

import { getReportAppealFormIdentity } from '@/components/report-appeals/ReportAppealForm';

describe('ReportAppealForm', () => {
  test('identity changes when reportCaseId changes on the same page instance', () => {
    expect(
      getReportAppealFormIdentity({
        reportCaseId: 'case-1',
        caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      }),
    ).not.toBe(
      getReportAppealFormIdentity({
        reportCaseId: 'case-2',
        caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      }),
    );
  });

  test('identity changes when caseUpdatedAtSnapshot changes for the same case', () => {
    expect(
      getReportAppealFormIdentity({
        reportCaseId: 'case-1',
        caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      }),
    ).not.toBe(
      getReportAppealFormIdentity({
        reportCaseId: 'case-1',
        caseUpdatedAtSnapshot: '2026-04-10T01:25:00.000Z',
      }),
    );
  });

  test('identity stays stable when case identity is unchanged', () => {
    expect(
      getReportAppealFormIdentity({
        reportCaseId: 'case-1',
        caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      }),
    ).toBe(
      getReportAppealFormIdentity({
        reportCaseId: 'case-1',
        caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      }),
    );
  });
});
