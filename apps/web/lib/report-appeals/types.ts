import type {
  ReportAppealReasonCode,
  ReportAppealResolutionCode,
  ReportAppealStatus,
  ReportCaseStatus,
  ReportReferenceType,
  ReportResolutionCode,
} from '@/lib/db/schema';

export type ReportAppealReasonOption = {
  code: ReportAppealReasonCode;
  label: string;
  description: string;
};

export const REPORT_APPEAL_REASON_OPTIONS: ReportAppealReasonOption[] = [
  { code: 'factual_error', label: '事实有误', description: '处理结果存在明显事实错误或误判。' },
  { code: 'missing_context', label: '缺少上下文', description: '处理时缺少关键上下文或引用材料。' },
  { code: 'already_fixed', label: '已自行修正', description: '相关问题已在处理前后修正。' },
  { code: 'misidentified_target', label: '对象识别错误', description: '被处理对象并非应当被处理的目标。' },
  { code: 'other', label: '其他', description: '其他需要管理员复核的情况。' },
];

export type ReportAppealReferenceDto = {
  referenceType: ReportReferenceType;
  referenceId: string;
  labelSnapshot: string;
  urlSnapshot: string | null;
  note: string | null;
  sortOrder: number;
};

export type ReportAppealReferenceDraft = {
  referenceType: ReportReferenceType;
  referenceId: string;
  note?: string | null;
};

export type ReportAppealSummaryDto = {
  appealId: string;
  reportCaseId: string;
  targetCardId: string;
  targetCardName: string;
  appealReasonCode: ReportAppealReasonCode;
  status: ReportAppealStatus;
  resolutionCode: ReportAppealResolutionCode | null;
  resolutionNote: string | null;
  caseUpdatedAtSnapshot: string;
  createdAt: string;
  updatedAt: string;
};

export type ReportAppealDetailDto = ReportAppealSummaryDto & {
  details: string;
  references: ReportAppealReferenceDto[];
  caseSnapshot: {
    status: ReportCaseStatus;
    resolutionCode: ReportResolutionCode | null;
    updatedAt: string;
  };
  currentCase: {
    status: ReportCaseStatus;
    resolutionCode: ReportResolutionCode | null;
    closedAt: string | null;
    updatedAt: string;
  };
};

export type ReportAppealEntryDto = {
  reportCaseId: string;
  eligible: boolean;
  caseUpdatedAtSnapshot: string | null;
  caseStatus: ReportCaseStatus | null;
  caseResolutionCode: ReportResolutionCode | null;
  targetCard: { id: string; name: string } | null;
  reasonOptions: ReportAppealReasonOption[];
  existingAppeal: ReportAppealSummaryDto | null;
};

export type ReportAppealListDto = {
  items: ReportAppealSummaryDto[];
  fetchedAt: string;
};

export type ReportAppealAdminListItemDto = ReportAppealSummaryDto & {
  appellantUserId: number;
  appellantUsername: string | null;
};

export type ReportAppealAdminListDto = {
  items: ReportAppealAdminListItemDto[];
  fetchedAt: string;
};

export type ReportAppealAdminDetailDto = ReportAppealDetailDto & {
  appellantUserId: number;
  targetUserId: number;
};

export type SubmitReportAppealResult = {
  appealId: string;
  status: ReportAppealStatus;
  entryUrl: string;
};

export type WithdrawReportAppealResult = {
  appealId: string;
  status: ReportAppealStatus;
};

export type ReviewReportAppealResult = {
  appealId: string;
  status: ReportAppealStatus;
  resolutionCode: ReportAppealResolutionCode;
  resolutionNote: string | null;
};

export type DataCardOwnerModerationSummaryDto = {
  latestCaseId: string;
  status: ReportCaseStatus;
  resolutionCode: ReportResolutionCode | null;
  canAppeal: boolean;
  activeAppealId: string | null;
  activeAppealStatus: ReportAppealStatus | null;
  appealEntryUrl: string | null;
  statusSummary: string;
};
