import type {
  CrowdReviewAssignmentStatus,
  CrowdReviewDecision,
  CrowdReviewInspectorStatus,
  CrowdReviewResultCode,
  CrowdReviewRoundStatus,
  ReportCaseStatus,
  ReportResolutionCode,
} from '@/lib/db/schema/business';

const REPORT_CASE_STATUS_LABELS: Record<ReportCaseStatus, string> = {
  open: '待处理',
  under_review: '人工复核中',
  resolved: '已确认处理',
  dismissed: '已驳回',
};

const REPORT_RESOLUTION_CODE_LABELS: Record<ReportResolutionCode, string> = {
  self_remediated: '作者已自整改',
  content_removed: '内容已移除',
  confirmed_violation: '确认违规',
  no_violation: '不构成违规',
  malicious_report: '恶意举报',
};

const CROWD_REVIEW_ROUND_STATUS_LABELS: Record<CrowdReviewRoundStatus, string> = {
  pending_dispatch: '待派单',
  active: '进行中',
  waiting_more_votes: '待补充投票',
  concluded: '已出结论',
  escalated: '升级管理员处理',
  cancelled: '已撤销',
};

const CROWD_REVIEW_RESULT_CODE_LABELS: Record<CrowdReviewResultCode, string> = {
  violation: '支持违规',
  no_violation: '支持不违规',
  tie: '平票',
  escalated: '升级管理员处理',
  admin_override: '管理员改判',
};

const CROWD_REVIEW_DECISION_LABELS: Record<CrowdReviewDecision, string> = {
  violation: '投票：违规',
  no_violation: '投票：不违规',
  abstain: '投票：弃权',
};

const CROWD_REVIEW_ASSIGNMENT_STATUS_LABELS: Record<CrowdReviewAssignmentStatus, string> = {
  assigned: '待处理',
  voted: '已投票',
  abstained: '已弃权',
  expired: '已过期',
  revoked: '已撤销',
};

const CROWD_REVIEW_INSPECTOR_STATUS_LABELS: Record<CrowdReviewInspectorStatus, string> = {
  active: '正常',
  suspended: '已暂停',
  revoked: '已撤销资格',
};

const toUnknownLabel = (value: string | null | undefined): string => {
  if (!value) {
    return '未知';
  }
  return `未知（${value}）`;
};

const lookupLabel = (labels: Record<string, string>, value: string | null | undefined): string => {
  if (!value) return '未知';
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value]! : toUnknownLabel(value);
};

export function getReportCaseStatusLabel(value: string | null | undefined): string {
  return lookupLabel(REPORT_CASE_STATUS_LABELS, value);
}

export function getReportResolutionCodeLabel(value: string | null | undefined): string {
  return lookupLabel(REPORT_RESOLUTION_CODE_LABELS, value);
}

export function getCrowdReviewRoundStatusLabel(value: string | null | undefined): string {
  return lookupLabel(CROWD_REVIEW_ROUND_STATUS_LABELS, value);
}

export function getCrowdReviewResultCodeLabel(value: string | null | undefined): string {
  return lookupLabel(CROWD_REVIEW_RESULT_CODE_LABELS, value);
}

export function getCrowdReviewDecisionLabel(value: string | null | undefined): string {
  return lookupLabel(CROWD_REVIEW_DECISION_LABELS, value);
}

export function getCrowdReviewAssignmentStatusLabel(value: string | null | undefined): string {
  return lookupLabel(CROWD_REVIEW_ASSIGNMENT_STATUS_LABELS, value);
}

export function getCrowdReviewInspectorStatusLabel(value: string | null | undefined): string {
  return lookupLabel(CROWD_REVIEW_INSPECTOR_STATUS_LABELS, value);
}
