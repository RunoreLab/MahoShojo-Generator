import { describe, expect, test } from 'bun:test';

import {
  getCrowdReviewFinalDecision,
  getCrowdReviewVoteAuditResult,
  summarizeCrowdReviewVotes,
} from '@/lib/admin/crowd-review-audit';
import type { AdminCrowdReviewAssignmentDetailItem } from '@/lib/admin/governance';

const makeAssignment = (
  overrides: Partial<AdminCrowdReviewAssignmentDetailItem> = {},
): AdminCrowdReviewAssignmentDetailItem => ({
  assignmentId: 'assign-1',
  inspectorUserId: 7,
  inspectorUsername: 'inspector',
  inspectorEmail: 'inspector@example.com',
  status: 'voted',
  assignedAt: '2026-04-20T08:00:00.000Z',
  expiresAt: '2026-04-20T10:00:00.000Z',
  completedAt: '2026-04-20T08:30:00.000Z',
  decision: 'violation',
  decisionNote: null,
  postVoteSummary: {},
  postVoteSummarySeenAt: null,
  createdAt: '2026-04-20T08:00:00.000Z',
  updatedAt: '2026-04-20T08:30:00.000Z',
  ...overrides,
});

describe('admin crowd review audit helpers', () => {
  test('getCrowdReviewFinalDecision derives direction from admin override resolution', () => {
    expect(
      getCrowdReviewFinalDecision({
        resultCode: 'admin_override',
        reportCaseResolutionCode: 'confirmed_violation',
      }),
    ).toBe('violation');

    expect(
      getCrowdReviewFinalDecision({
        resultCode: 'admin_override',
        reportCaseResolutionCode: 'no_violation',
      }),
    ).toBe('no_violation');

    expect(
      getCrowdReviewFinalDecision({
        resultCode: 'escalated',
        reportCaseResolutionCode: 'confirmed_violation',
      }),
    ).toBeNull();
  });

  test('summarizeCrowdReviewVotes counts each vote bucket', () => {
    const summary = summarizeCrowdReviewVotes([
      makeAssignment({ assignmentId: 'assign-1', decision: 'violation', status: 'voted' }),
      makeAssignment({ assignmentId: 'assign-2', decision: 'no_violation', status: 'voted' }),
      makeAssignment({ assignmentId: 'assign-3', decision: 'abstain', status: 'abstained' }),
      makeAssignment({ assignmentId: 'assign-4', decision: null, status: 'assigned', completedAt: null }),
      makeAssignment({ assignmentId: 'assign-5', decision: null, status: 'expired' }),
      makeAssignment({ assignmentId: 'assign-6', decision: null, status: 'revoked' }),
    ]);

    expect(summary).toEqual({
      totalCount: 6,
      votedCount: 2,
      violationVoteCount: 1,
      noViolationVoteCount: 1,
      abstainCount: 1,
      pendingCount: 1,
      expiredCount: 1,
      revokedCount: 1,
    });
  });

  test('getCrowdReviewVoteAuditResult compares assignment vote with final direction', () => {
    const matched = getCrowdReviewVoteAuditResult({
      assignment: makeAssignment({ decision: 'violation' }),
      roundStatus: 'concluded',
      resultCode: 'violation',
      reportCaseResolutionCode: 'confirmed_violation',
    });
    expect(matched.label).toBe('与最终结论一致');

    const mismatched = getCrowdReviewVoteAuditResult({
      assignment: makeAssignment({ decision: 'no_violation' }),
      roundStatus: 'concluded',
      resultCode: 'violation',
      reportCaseResolutionCode: 'confirmed_violation',
    });
    expect(mismatched.label).toBe('与最终结论不一致');

    const pending = getCrowdReviewVoteAuditResult({
      assignment: makeAssignment({ status: 'assigned', decision: null, completedAt: null }),
      roundStatus: 'active',
      resultCode: null,
      reportCaseResolutionCode: null,
    });
    expect(pending.label).toBe('尚未投票');
  });
});
