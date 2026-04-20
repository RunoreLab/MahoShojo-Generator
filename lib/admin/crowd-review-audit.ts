import type { AdminCrowdReviewAssignmentDetailItem } from '@/lib/admin/governance';

type CrowdReviewFinalDecision = 'violation' | 'no_violation' | null;

export type CrowdReviewVoteAuditTone = 'positive' | 'negative' | 'warning' | 'neutral' | 'pending';

export type CrowdReviewVoteAuditResult = {
  tone: CrowdReviewVoteAuditTone;
  label: string;
  detail: string;
};

export type CrowdReviewVoteSummary = {
  totalCount: number;
  votedCount: number;
  violationVoteCount: number;
  noViolationVoteCount: number;
  abstainCount: number;
  pendingCount: number;
  expiredCount: number;
  revokedCount: number;
};

const ADVERSE_REPORT_RESOLUTION_CODES = new Set(['confirmed_violation', 'content_removed', 'self_remediated']);
const CLEAR_REPORT_RESOLUTION_CODES = new Set(['no_violation', 'malicious_report']);

export function getCrowdReviewFinalDecision(input: {
  resultCode: string | null;
  reportCaseResolutionCode: string | null;
}): CrowdReviewFinalDecision {
  if (input.resultCode === 'violation') return 'violation';
  if (input.resultCode === 'no_violation') return 'no_violation';
  if (input.resultCode !== 'admin_override') return null;

  if (input.reportCaseResolutionCode && ADVERSE_REPORT_RESOLUTION_CODES.has(input.reportCaseResolutionCode)) {
    return 'violation';
  }
  if (input.reportCaseResolutionCode && CLEAR_REPORT_RESOLUTION_CODES.has(input.reportCaseResolutionCode)) {
    return 'no_violation';
  }
  return null;
}

export function summarizeCrowdReviewVotes(
  assignments: AdminCrowdReviewAssignmentDetailItem[],
): CrowdReviewVoteSummary {
  return assignments.reduce<CrowdReviewVoteSummary>(
    (summary, assignment) => {
      summary.totalCount += 1;

      if (assignment.status === 'assigned') {
        summary.pendingCount += 1;
        return summary;
      }
      if (assignment.status === 'expired') {
        summary.expiredCount += 1;
        return summary;
      }
      if (assignment.status === 'revoked') {
        summary.revokedCount += 1;
        return summary;
      }
      if (assignment.status === 'abstained' || assignment.decision === 'abstain') {
        summary.abstainCount += 1;
        return summary;
      }

      if (assignment.status === 'voted') {
        summary.votedCount += 1;
        if (assignment.decision === 'violation') {
          summary.violationVoteCount += 1;
        } else if (assignment.decision === 'no_violation') {
          summary.noViolationVoteCount += 1;
        }
      }

      return summary;
    },
    {
      totalCount: 0,
      votedCount: 0,
      violationVoteCount: 0,
      noViolationVoteCount: 0,
      abstainCount: 0,
      pendingCount: 0,
      expiredCount: 0,
      revokedCount: 0,
    },
  );
}

export function getCrowdReviewVoteAuditResult(input: {
  assignment: AdminCrowdReviewAssignmentDetailItem;
  roundStatus: string;
  resultCode: string | null;
  reportCaseResolutionCode: string | null;
}): CrowdReviewVoteAuditResult {
  const { assignment } = input;

  if (assignment.status === 'assigned') {
    return {
      tone: 'pending',
      label: '尚未投票',
      detail: '该派单仍在处理中，尚未形成可审计投票。',
    };
  }

  if (assignment.status === 'expired') {
    return {
      tone: 'neutral',
      label: '未计入有效票',
      detail: '派单已过期，未形成有效投票。',
    };
  }

  if (assignment.status === 'revoked') {
    return {
      tone: 'neutral',
      label: '已撤销派单',
      detail: '该派单已被系统或管理员撤销，不计入本轮有效票。',
    };
  }

  if (assignment.status === 'abstained' || assignment.decision === 'abstain') {
    return {
      tone: 'neutral',
      label: '已弃权',
      detail: '巡查使主动弃权，不参与本轮有效票比较。',
    };
  }

  const finalDecision = getCrowdReviewFinalDecision({
    resultCode: input.resultCode,
    reportCaseResolutionCode: input.reportCaseResolutionCode,
  });

  if (!finalDecision) {
    const detail =
      input.roundStatus === 'escalated'
        ? '当前轮次已升级管理员处理，需结合管理员结论单独判断。'
        : '当前轮次尚未形成可直接对照的最终方向。';
    return {
      tone: 'warning',
      label: '暂不可比对',
      detail,
    };
  }

  if (assignment.decision === finalDecision) {
    return {
      tone: 'positive',
      label: '与最终结论一致',
      detail: '该票与轮次最终方向一致，可作为正向审计样本。',
    };
  }

  return {
    tone: 'negative',
    label: '与最终结论不一致',
    detail: '该票与轮次最终方向相反，适合进入重点复盘。',
  };
}
