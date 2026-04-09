import type {
  CrowdReviewAssignmentStatus,
  CrowdReviewDecision,
  CrowdReviewInspectorStatus,
  CrowdReviewResultCode,
} from '@/lib/db/schema';

export type CrowdReviewSummaryDto = {
  eligible: boolean;
  inspectorStatus: 'anonymous' | 'ineligible' | CrowdReviewInspectorStatus;
  statusReason: string | null;
  hasCurrentAssignment: boolean;
  hasCrowdReviewPending: boolean;
  entryUrl: '/investigation';
};

export type CrowdReviewPostVoteSummaryDto = {
  roundStatus: string;
  resultCode: CrowdReviewResultCode | null;
  summaryText: string;
};

export type CrowdReviewCurrentCaseDto = {
  assignmentId: string;
  assignmentStatus: CrowdReviewAssignmentStatus;
  assignedAt: string;
  expiresAt: string;
  caseId: string;
  reportCaseId: string;
  targetEntityType: 'data_card';
  targetEntityId: string;
  targetSnapshot: {
    name: string;
    description: string | null;
  } | null;
  reportSummary: {
    reasonLabels: string[];
    details: string[];
    references: string[];
  };
  ruleHints: string[];
  availableDecisions: CrowdReviewDecision[];
  postVoteSummary: CrowdReviewPostVoteSummaryDto | null;
};

export type CrowdReviewHistoryItemDto = {
  assignmentId: string;
  reportCaseId: string;
  assignmentStatus: CrowdReviewAssignmentStatus;
  decision: CrowdReviewDecision | null;
  completedAt: string | null;
  resultCode: CrowdReviewResultCode | null;
};

export type CrowdReviewHistoryDto = {
  items: CrowdReviewHistoryItemDto[];
  fetchedAt: string;
};

export type SubmitCrowdReviewDecisionResult = {
  assignmentId: string;
  assignmentStatus: CrowdReviewAssignmentStatus;
  decision: CrowdReviewDecision;
  postVoteSummary: CrowdReviewPostVoteSummaryDto;
  idempotentReplay: boolean;
};

export type AssignCurrentCaseResult = {
  createdNewAssignment: boolean;
  currentCase: CrowdReviewCurrentCaseDto;
};
