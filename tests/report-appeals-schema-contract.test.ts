import { describe, expect, test } from 'vitest';

import { reportAppealReferences, reportAppeals, reportCases } from '@/lib/db/schema';

describe('report appeals schema contract', () => {
  test('exports appeal tables and report-case notification fields with snake_case columns', () => {
    expect(reportCases.resolutionNotifiedAt.name).toBe('resolution_notified_at');
    expect(reportCases.resolutionNotifiedCaseUpdatedAt.name).toBe('resolution_notified_case_updated_at');

    expect(reportAppeals.reportCaseId.name).toBe('report_case_id');
    expect(reportAppeals.appealReasonCode.name).toBe('appeal_reason_code');
    expect(reportAppeals.caseUpdatedAtSnapshot.name).toBe('case_updated_at_snapshot');
    expect(reportAppeals.reviewedByUserId.name).toBe('reviewed_by_user_id');

    expect(reportAppealReferences.appealId.name).toBe('appeal_id');
    expect(reportAppealReferences.referenceType.name).toBe('reference_type');
  });
});
