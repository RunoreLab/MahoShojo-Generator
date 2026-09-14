import type { ReportAppealResolutionCode, ReportCaseStatus, ReportResolutionCode } from '../../db/schema/business';

export const ADVERSE_REPORT_RESOLUTIONS = ['confirmed_violation', 'content_removed', 'self_remediated'] as const;
export const isAdverseFinalReportResolutionCode = (code: ReportResolutionCode | null): code is typeof ADVERSE_REPORT_RESOLUTIONS[number] =>
  code !== null && (ADVERSE_REPORT_RESOLUTIONS as readonly string[]).includes(code);

export type ReportCaseDecision = { status: ReportCaseStatus; resolutionCode: ReportResolutionCode | null; closedAt: string | null };
export function reportCaseDecision(status: 'resolved' | 'dismissed' | 'under_review', code: ReportResolutionCode | null, now: string): ReportCaseDecision {
  if (status === 'under_review' ? code !== null : status === 'resolved'
    ? !isAdverseFinalReportResolutionCode(code) : code !== 'no_violation' && code !== 'malicious_report') {
    throw new Error('ADMIN_REPORT_DECISION_INVALID');
  }
  return { status, resolutionCode: code, closedAt: status === 'under_review' ? null : now };
}
export function crowdReviewCaseDecision(result: 'violation' | 'no_violation' | 'tie' | 'escalated' | 'reopen_under_review', now: string): ReportCaseDecision {
  return result === 'violation' ? reportCaseDecision('resolved', 'confirmed_violation', now)
    : result === 'no_violation' ? reportCaseDecision('dismissed', 'no_violation', now) : reportCaseDecision('under_review', null, now);
}
export function appealCaseDecision(result: ReportAppealResolutionCode, now: string): ReportCaseDecision | null {
  return result === 'upheld' ? null : result === 'overturned_no_violation'
    ? reportCaseDecision('dismissed', 'no_violation', now) : reportCaseDecision('under_review', null, now);
}
export function reportResolutionLabel(code: ReportResolutionCode | ReportAppealResolutionCode | null): string {
  const labels = { confirmed_violation: '确认违规', content_removed: '内容已移除', self_remediated: '已自行整改',
    no_violation: '不违规', malicious_report: '恶意举报', upheld: '维持原判',
    overturned_no_violation: '改判为不违规', reopened_under_review: '已转人工继续复核' };
  return code === null ? '处理中' : labels[code];
}
