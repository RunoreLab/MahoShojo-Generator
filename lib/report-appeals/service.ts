import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { getDataCardByIdWithAuthorAndTags } from '@/lib/db/repositories/data-cards-core';
import * as repo from '@/lib/db/repositories/report-appeals';
import { getEncyclopediaEntry } from '@/lib/encyclopedia';
import { createUserMessageEntry } from '@/lib/messages/service';
import {
  REPORT_APPEAL_REASON_OPTIONS,
  type DataCardOwnerModerationSummaryDto,
  type ReportAppealAdminDetailDto,
  type ReportAppealAdminListDto,
  type ReportAppealEntryDto,
  type ReportAppealDetailDto,
  type ReportAppealListDto,
  type ReportAppealReferenceDraft,
  type ReportAppealSummaryDto,
  type ReviewReportAppealResult,
  type SubmitReportAppealResult,
  type WithdrawReportAppealResult,
} from '@/lib/report-appeals/types';
import type {
  ReportAppealReasonCode,
  ReportAppealResolutionCode,
  ReportAppealStatus,
  ReportReferenceType,
  ReportResolutionCode,
} from '@/lib/db/schema';

type ReportAppealsServiceDb = AppDrizzleDb | null;

type ResolvedAppealReferenceSnapshot = {
  referenceType: ReportReferenceType;
  referenceId: string;
  labelSnapshot: string;
  urlSnapshot: string | null;
  note: string | null;
  sortOrder: number;
};

type ReportAppealsRepository = {
  getAppealableCaseForUser: typeof repo.getAppealableCaseForUser;
  getLatestNonWithdrawnAppealByCaseSnapshot: typeof repo.getLatestNonWithdrawnAppealByCaseSnapshot;
  getActiveAppealByCase: typeof repo.getActiveAppealByCase;
  createReportAppeal: typeof repo.createReportAppeal;
  replaceReportAppealReferences: typeof repo.replaceReportAppealReferences;
  getReportAppealByIdForAppellant: typeof repo.getReportAppealByIdForAppellant;
  getReportAppealByIdForAdmin: typeof repo.getReportAppealByIdForAdmin;
  listReportAppealReferences: typeof repo.listReportAppealReferences;
  listReportAppealsByAppellant: typeof repo.listReportAppealsByAppellant;
  listReportAppealsForAdmin: typeof repo.listReportAppealsForAdmin;
  restoreReportAppealAfterReviewFailure: typeof repo.restoreReportAppealAfterReviewFailure;
  updateReportAppealStatus: typeof repo.updateReportAppealStatus;
  updateReportAppealResolution: typeof repo.updateReportAppealResolution;
  updateReportCaseAfterAppealReview: typeof repo.updateReportCaseAfterAppealReview;
  getReportCaseForResolutionNotification: typeof repo.getReportCaseForResolutionNotification;
  markReportCaseResolutionNotified: typeof repo.markReportCaseResolutionNotified;
  clearReportCaseResolutionNotified: typeof repo.clearReportCaseResolutionNotified;
};

export type ReportAppealsServiceDeps = {
  now: () => string;
  idFactory: () => string;
  repo: ReportAppealsRepository;
  resolveReferenceSnapshots: (input: {
    db: AppDrizzleDb;
    targetEntityId: string;
    references: ReportAppealReferenceDraft[];
  }) => Promise<ResolvedAppealReferenceSnapshot[]>;
  createUserMessageEntry: typeof createUserMessageEntry;
};

export class ReportAppealServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportAppealServiceUnavailableError';
  }
}

export class ReportAppealValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportAppealValidationError';
  }
}

export class ReportAppealForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportAppealForbiddenError';
  }
}

export class ReportAppealNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportAppealNotFoundError';
  }
}

export class ReportAppealConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportAppealConflictError';
  }
}

export class ReportAppealUnprocessableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportAppealUnprocessableError';
  }
}

const APPEALABLE_FINAL_RESOLUTION_CODES: ReportResolutionCode[] = [
  'confirmed_violation',
  'content_removed',
  'self_remediated',
];

const reportAppealReasonCodeSet = new Set<ReportAppealReasonCode>(
  REPORT_APPEAL_REASON_OPTIONS.map((option) => option.code),
);
const reportAppealResolutionCodeSet = new Set<ReportAppealResolutionCode>([
  'upheld',
  'overturned_no_violation',
  'reopened_under_review',
]);

const requireDb = (db: ReportAppealsServiceDb): AppDrizzleDb => {
  if (!db) {
    throw new ReportAppealServiceUnavailableError('申诉服务当前不可用');
  }
  return db;
};

const isAppealableFinalResolutionCode = (value: ReportResolutionCode | null): boolean =>
  value != null && APPEALABLE_FINAL_RESOLUTION_CODES.includes(value);

const canRepairExistingAppealReferences = (status: ReportAppealStatus): boolean =>
  status === 'submitted' || status === 'under_review';

const normalizeAppealDetails = (details: string): string => {
  const normalized = details.trim();
  if (!normalized) {
    throw new ReportAppealValidationError('申诉说明不能为空');
  }
  return normalized;
};

const buildResolutionLabel = (resolutionCode: ReportResolutionCode | ReportAppealResolutionCode | null): string => {
  switch (resolutionCode) {
    case 'confirmed_violation':
      return '确认违规';
    case 'content_removed':
      return '内容已移除';
    case 'self_remediated':
      return '已自行整改';
    case 'no_violation':
      return '不违规';
    case 'upheld':
      return '维持原判';
    case 'overturned_no_violation':
      return '改判为不违规';
    case 'reopened_under_review':
      return '已转人工继续复核';
    default:
      return '处理中';
  }
};

const mapAppealSummary = (
  row: {
    id: string;
    reportCaseId: string;
    targetEntityId: string;
    appealReasonCode: ReportAppealReasonCode;
    status: ReportAppealStatus;
    resolutionCode: ReportAppealResolutionCode | null;
    resolutionNote: string | null;
    caseUpdatedAtSnapshot: string;
    createdAt: string;
    updatedAt: string;
  },
  targetCardName: string,
): ReportAppealSummaryDto => ({
  appealId: row.id,
  reportCaseId: row.reportCaseId,
  targetCardId: row.targetEntityId,
  targetCardName,
  appealReasonCode: row.appealReasonCode,
  status: row.status,
  resolutionCode: row.resolutionCode,
  resolutionNote: row.resolutionNote,
  caseUpdatedAtSnapshot: row.caseUpdatedAtSnapshot,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapAppealReferences = (
  rows: Awaited<ReturnType<typeof repo.listReportAppealReferences>>,
) =>
  rows.map((reference) => ({
    referenceType: reference.referenceType,
    referenceId: reference.referenceId,
    labelSnapshot: reference.labelSnapshot,
    urlSnapshot: reference.urlSnapshot,
    note: reference.note,
    sortOrder: reference.sortOrder,
  }));

const normalizeAppealReferenceNote = (note: string | null | undefined): string | null => note?.trim() || null;

const canonicalizeAppealReferenceIdentity = (
  references: Array<{ referenceType: string; referenceId: string; note: string | null; sortOrder: number }>,
): string[] =>
  references
    .map((reference) =>
      JSON.stringify([reference.referenceType, reference.referenceId, reference.note ?? null, reference.sortOrder]),
    )
    .sort();

const hasMatchingAppealReferences = (
  currentReferences: Array<{
    referenceType: string;
    referenceId: string;
    note: string | null;
    sortOrder: number;
  }>,
  submittedReferences: ReportAppealReferenceDraft[],
): boolean => {
  if (currentReferences.length !== submittedReferences.length) return false;

  const currentCanonical = canonicalizeAppealReferenceIdentity(currentReferences);
  const submittedCanonical = canonicalizeAppealReferenceIdentity(
    submittedReferences.map((reference, index) => ({
      referenceType: reference.referenceType,
      referenceId: reference.referenceId,
      note: normalizeAppealReferenceNote(reference.note),
      sortOrder: index,
    })),
  );

  return submittedCanonical.every((referenceKey, index) => currentCanonical[index] === referenceKey);
};

const buildAppealStatusSummary = (input: {
  resolutionCode: ReportResolutionCode | null;
  existingAppealStatus: ReportAppealStatus | null;
  existingAppealId: string | null;
}): string => {
  if (input.existingAppealId && input.existingAppealStatus === 'resolved') {
    return '该处理结果的申诉已完成，可查看复核结论。';
  }
  if (input.existingAppealId) {
    return '该处理结果的申诉正在处理中，可查看当前状态。';
  }
  if (isAppealableFinalResolutionCode(input.resolutionCode)) {
    return '该卡因举报处理结果被判定为违规，可提交申诉。';
  }
  return '当前处理结果暂不可申诉。';
};

const resolveAppealCaseOrThrow = async (
  deps: ReportAppealsServiceDeps,
  db: AppDrizzleDb,
  input: { reportCaseId: string; userId: number },
) => {
  const reportCase = await deps.repo.getAppealableCaseForUser(db, input);
  if (!reportCase) {
    const rawCase = await deps.repo.getReportCaseForResolutionNotification(db, input.reportCaseId);
    if (!rawCase) {
      throw new ReportAppealNotFoundError('举报案件不存在');
    }
    if (rawCase.targetUserId !== input.userId) {
      throw new ReportAppealForbiddenError('仅案件目标创作者可发起申诉');
    }
    throw new ReportAppealUnprocessableError('当前案件结果不可申诉');
  }
  if (reportCase.status !== 'resolved' || !isAppealableFinalResolutionCode(reportCase.resolutionCode)) {
    throw new ReportAppealUnprocessableError('当前案件结果不可申诉');
  }
  return reportCase;
};

const resolveReferenceSnapshots = async (input: {
  db: AppDrizzleDb;
  targetEntityId: string;
  references: ReportAppealReferenceDraft[];
}): Promise<ResolvedAppealReferenceSnapshot[]> => {
  const resolved: ResolvedAppealReferenceSnapshot[] = [];

  for (const [index, reference] of input.references.entries()) {
    if (reference.referenceType === 'public_data_card') {
      if (reference.referenceId === input.targetEntityId) {
        throw new ReportAppealValidationError('引用公开数据卡时不能引用被申诉目标自身');
      }
      const card = await getDataCardByIdWithAuthorAndTags(input.db, {
        cardId: reference.referenceId,
        publicOnly: true,
      });
      if (!card) {
        throw new ReportAppealValidationError('引用的公开数据卡不存在或不可访问');
      }
      resolved.push({
        referenceType: reference.referenceType,
        referenceId: reference.referenceId,
        labelSnapshot: card.name,
        urlSnapshot: `/character-manager?dataCardId=${encodeURIComponent(card.id)}`,
        note: reference.note?.trim() || null,
        sortOrder: index,
      });
      continue;
    }

    const entry = getEncyclopediaEntry(reference.referenceId);
    if (!entry) {
      throw new ReportAppealValidationError('引用的百科条目不存在');
    }

    resolved.push({
      referenceType: reference.referenceType,
      referenceId: reference.referenceId,
      labelSnapshot: entry.title,
      urlSnapshot: `/encyclopedia/${entry.slug}`,
      note: reference.note?.trim() || null,
      sortOrder: index,
    });
  }

  return resolved;
};

const buildEvidenceSummaryJson = (references: ResolvedAppealReferenceSnapshot[]): string =>
  JSON.stringify({
    references: references.map((reference) => ({
      referenceType: reference.referenceType,
      referenceId: reference.referenceId,
      labelSnapshot: reference.labelSnapshot,
      note: reference.note,
    })),
  });

const createReportAppealsService = (deps: ReportAppealsServiceDeps) => ({
  async getReportAppealEntry(input: {
    db: ReportAppealsServiceDb;
    userId: number;
    reportCaseId: string;
  }): Promise<ReportAppealEntryDto> {
    const db = requireDb(input.db);
    const reportCase = await resolveAppealCaseOrThrow(deps, db, {
      reportCaseId: input.reportCaseId,
      userId: input.userId,
    });
    const existingAppeal = await deps.repo.getLatestNonWithdrawnAppealByCaseSnapshot(db, {
      reportCaseId: reportCase.id,
      caseUpdatedAtSnapshot: reportCase.updatedAt,
    });

    return {
      reportCaseId: reportCase.id,
      eligible: true,
      caseUpdatedAtSnapshot: reportCase.updatedAt,
      caseStatus: reportCase.status,
      caseResolutionCode: reportCase.resolutionCode,
      targetCard: { id: reportCase.targetEntityId, name: reportCase.targetCardName },
      reasonOptions: REPORT_APPEAL_REASON_OPTIONS,
      existingAppeal: existingAppeal ? mapAppealSummary(existingAppeal, reportCase.targetCardName) : null,
    };
  },

  async submitReportAppeal(input: {
    db: ReportAppealsServiceDb;
    userId: number;
    reportCaseId: string;
    caseUpdatedAtSnapshot: string;
    appealReasonCode: ReportAppealReasonCode;
    details: string;
    references: ReportAppealReferenceDraft[];
  }): Promise<SubmitReportAppealResult> {
    if (!reportAppealReasonCodeSet.has(input.appealReasonCode)) {
      throw new ReportAppealValidationError('申诉理由无效');
    }

    const db = requireDb(input.db);
    const reportCase = await resolveAppealCaseOrThrow(deps, db, {
      reportCaseId: input.reportCaseId,
      userId: input.userId,
    });

    if (reportCase.updatedAt !== input.caseUpdatedAtSnapshot) {
      throw new ReportAppealUnprocessableError('案件结果快照已变化，请刷新后重新确认');
    }

    const repairAppealReferencesIfNeeded = async (appealId: string) => {
      if (input.references.length === 0) return;

      const currentReferences = await deps.repo.listReportAppealReferences(db, appealId);
      if (currentReferences.length > 0) {
        return;
      }
      if (hasMatchingAppealReferences(currentReferences, input.references)) {
        return;
      }

      const referenceSnapshots = await deps.resolveReferenceSnapshots({
        db,
        targetEntityId: reportCase.targetEntityId,
        references: input.references,
      });
      const repairNow = deps.now();

      await deps.repo.replaceReportAppealReferences(db, {
        appealId,
        references: referenceSnapshots.map((reference, index) => ({
          id: `${appealId}-ref-${index + 1}`,
          referenceType: reference.referenceType,
          referenceId: reference.referenceId,
          labelSnapshot: reference.labelSnapshot,
          urlSnapshot: reference.urlSnapshot,
          note: reference.note,
          sortOrder: reference.sortOrder,
          createdAt: repairNow,
        })),
      });
    };

    const existingAppeal = await deps.repo.getLatestNonWithdrawnAppealByCaseSnapshot(db, {
      reportCaseId: reportCase.id,
      caseUpdatedAtSnapshot: input.caseUpdatedAtSnapshot,
    });
    if (existingAppeal) {
      if (canRepairExistingAppealReferences(existingAppeal.status)) {
        await repairAppealReferencesIfNeeded(existingAppeal.id);
      }
      return {
        appealId: existingAppeal.id,
        status: existingAppeal.status,
        entryUrl: `/report-appeals?appealId=${encodeURIComponent(existingAppeal.id)}`,
      };
    }

    const activeAppeal = await deps.repo.getActiveAppealByCase(db, reportCase.id);
    if (activeAppeal) {
      throw new ReportAppealConflictError('当前案件已有申诉处理中');
    }

    const normalizedDetails = normalizeAppealDetails(input.details);
    const referenceSnapshots =
      input.references.length > 0
        ? await deps.resolveReferenceSnapshots({
            db,
            targetEntityId: reportCase.targetEntityId,
            references: input.references,
          })
        : [];
    const evidenceSummaryJson = buildEvidenceSummaryJson(referenceSnapshots);
    const now = deps.now();
    const appealId = deps.idFactory();

    try {
      await deps.repo.createReportAppeal(db, {
        id: appealId,
        reportCaseId: reportCase.id,
        appellantUserId: input.userId,
        targetUserId: reportCase.targetUserId,
        targetEntityType: 'data_card',
        targetEntityId: reportCase.targetEntityId,
        appealReasonCode: input.appealReasonCode,
        details: normalizedDetails,
        evidenceSummaryJson,
        status: 'submitted',
        resolutionCode: null,
        resolutionNote: null,
        caseStatusSnapshot: reportCase.status,
        caseResolutionCodeSnapshot: reportCase.resolutionCode,
        caseUpdatedAtSnapshot: input.caseUpdatedAtSnapshot,
        reviewedByUserId: null,
        reviewedAt: null,
        withdrawnAt: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      const racedExisting = await deps.repo.getLatestNonWithdrawnAppealByCaseSnapshot(db, {
        reportCaseId: reportCase.id,
        caseUpdatedAtSnapshot: input.caseUpdatedAtSnapshot,
      });
      if (racedExisting) {
        if (canRepairExistingAppealReferences(racedExisting.status)) {
          await repairAppealReferencesIfNeeded(racedExisting.id);
        }
        return {
          appealId: racedExisting.id,
          status: racedExisting.status,
          entryUrl: `/report-appeals?appealId=${encodeURIComponent(racedExisting.id)}`,
        };
      }
      throw error;
    }

    await deps.repo.replaceReportAppealReferences(db, {
      appealId,
      references: referenceSnapshots.map((reference, index) => ({
        id: `${appealId}-ref-${index + 1}`,
        referenceType: reference.referenceType,
        referenceId: reference.referenceId,
        labelSnapshot: reference.labelSnapshot,
        urlSnapshot: reference.urlSnapshot,
        note: reference.note,
        sortOrder: reference.sortOrder,
        createdAt: now,
      })),
    });

    return {
      appealId,
      status: 'submitted',
      entryUrl: `/report-appeals?appealId=${encodeURIComponent(appealId)}`,
    };
  },

  async withdrawReportAppeal(input: {
    db: ReportAppealsServiceDb;
    userId: number;
    appealId: string;
  }): Promise<WithdrawReportAppealResult> {
    const db = requireDb(input.db);
    const appeal = await deps.repo.getReportAppealByIdForAdmin(db, input.appealId);
    if (!appeal) {
      throw new ReportAppealNotFoundError('申诉记录不存在');
    }
    if (appeal.appellantUserId !== input.userId) {
      throw new ReportAppealForbiddenError('仅申诉发起者本人可查看');
    }
    if (appeal.status !== 'submitted' && appeal.status !== 'under_review') {
      throw new ReportAppealConflictError('当前申诉状态不可撤回');
    }

    const now = deps.now();
    const updated = await deps.repo.updateReportAppealStatus(db, {
      appealId: input.appealId,
      currentStatuses: ['submitted', 'under_review'],
      nextStatus: 'withdrawn',
      withdrawnAt: now,
      now,
    });
    if (!updated) {
      throw new ReportAppealConflictError('申诉状态已变化，请刷新后重试');
    }

    return {
      appealId: input.appealId,
      status: 'withdrawn',
    };
  },

  async listMyReportAppeals(input: {
    db: ReportAppealsServiceDb;
    userId: number;
    limit?: number;
  }): Promise<ReportAppealListDto> {
    const db = requireDb(input.db);
    const items = await deps.repo.listReportAppealsByAppellant(db, input.userId, input.limit ?? 20);
    return {
      items: items.map((item) => mapAppealSummary(item, item.targetCardName)),
      fetchedAt: deps.now(),
    };
  },

  async getReportAppealDetail(input: {
    db: ReportAppealsServiceDb;
    userId: number;
    appealId: string;
  }): Promise<ReportAppealDetailDto> {
    const db = requireDb(input.db);
    const appeal = await deps.repo.getReportAppealByIdForAppellant(db, {
      appealId: input.appealId,
      userId: input.userId,
    });
    if (!appeal) {
      const rawAppeal = await deps.repo.getReportAppealByIdForAdmin(db, input.appealId);
      if (!rawAppeal) {
        throw new ReportAppealNotFoundError('申诉记录不存在');
      }
      throw new ReportAppealForbiddenError('仅申诉发起者本人可查看');
    }
    const references = await deps.repo.listReportAppealReferences(db, appeal.id);
    return {
      ...mapAppealSummary(appeal, appeal.targetCardName),
      details: appeal.details,
      references: mapAppealReferences(references),
      caseSnapshot: {
        status: appeal.caseStatusSnapshot,
        resolutionCode: appeal.caseResolutionCodeSnapshot,
        updatedAt: appeal.caseUpdatedAtSnapshot,
      },
      currentCase: {
        status: appeal.currentCaseStatus,
        resolutionCode: appeal.currentCaseResolutionCode,
        closedAt: appeal.currentCaseClosedAt,
        updatedAt: appeal.currentCaseUpdatedAt,
      },
    };
  },

  async listReportAppealsForAdmin(input: {
    db: ReportAppealsServiceDb;
    adminUserId: number;
    status?: ReportAppealStatus;
    limit?: number;
  }): Promise<ReportAppealAdminListDto> {
    const db = requireDb(input.db);
    const items = await deps.repo.listReportAppealsForAdmin(db, {
      status: input.status,
      limit: input.limit ?? 50,
    });
    return {
      items: items.map((item) => ({
        ...mapAppealSummary(item, item.targetCardName),
        appellantUserId: item.appellantUserId,
        appellantUsername: item.appellantUsername,
      })),
      fetchedAt: deps.now(),
    };
  },

  async getReportAppealForAdmin(input: {
    db: ReportAppealsServiceDb;
    adminUserId: number;
    appealId: string;
  }): Promise<ReportAppealAdminDetailDto> {
    const db = requireDb(input.db);
    const appeal = await deps.repo.getReportAppealByIdForAdmin(db, input.appealId);
    if (!appeal) {
      throw new ReportAppealNotFoundError('申诉记录不存在');
    }
    const references = await deps.repo.listReportAppealReferences(db, appeal.id);
    return {
      ...mapAppealSummary(appeal, appeal.targetCardName),
      details: appeal.details,
      references: mapAppealReferences(references),
      caseSnapshot: {
        status: appeal.caseStatusSnapshot,
        resolutionCode: appeal.caseResolutionCodeSnapshot,
        updatedAt: appeal.caseUpdatedAtSnapshot,
      },
      currentCase: {
        status: appeal.currentCaseStatus,
        resolutionCode: appeal.currentCaseResolutionCode,
        closedAt: appeal.currentCaseClosedAt,
        updatedAt: appeal.currentCaseUpdatedAt,
      },
      appellantUserId: appeal.appellantUserId,
      targetUserId: appeal.targetUserId,
    };
  },

  async reviewReportAppeal(input: {
    db: ReportAppealsServiceDb;
    adminUserId: number;
    appealId: string;
    resolutionCode: ReportAppealResolutionCode;
    resolutionNote: string | null;
  }): Promise<ReviewReportAppealResult> {
    if (!reportAppealResolutionCodeSet.has(input.resolutionCode)) {
      throw new ReportAppealValidationError('管理员复核结论无效');
    }

    const db = requireDb(input.db);
    const appeal = await deps.repo.getReportAppealByIdForAdmin(db, input.appealId);
    if (!appeal) {
      throw new ReportAppealNotFoundError('申诉记录不存在');
    }
    if (appeal.status !== 'submitted' && appeal.status !== 'under_review') {
      throw new ReportAppealConflictError('该申诉已处理完成');
    }

    const now = deps.now();
    const updated = await deps.repo.updateReportAppealResolution(db, {
      appealId: input.appealId,
      resolutionCode: input.resolutionCode,
      resolutionNote: input.resolutionNote,
      reviewedByUserId: input.adminUserId,
      reviewedAt: now,
      now,
    });
    if (!updated) {
      throw new ReportAppealConflictError('申诉状态已变化，请刷新后重试');
    }

    if (input.resolutionCode === 'overturned_no_violation') {
      await deps.repo.updateReportCaseAfterAppealReview(db, {
        reportCaseId: appeal.reportCaseId,
        status: 'dismissed',
        resolutionCode: 'no_violation',
        closedAt: now,
        now,
      });
    } else if (input.resolutionCode === 'reopened_under_review') {
      await deps.repo.updateReportCaseAfterAppealReview(db, {
        reportCaseId: appeal.reportCaseId,
        status: 'under_review',
        resolutionCode: null,
        closedAt: null,
        now,
      });
    }

    try {
      await deps.createUserMessageEntry({
        db,
        recipientUserId: appeal.appellantUserId,
        messageType: 'moderation',
        templateKey: 'user.moderation.report_appeal_resolved',
        payload: {
          dataCardId: appeal.targetEntityId,
          dataCardName: appeal.targetCardName,
          resolutionCode: input.resolutionCode,
          resolutionLabel: buildResolutionLabel(input.resolutionCode),
        },
        actionUrl: `/report-appeals?appealId=${encodeURIComponent(appeal.id)}`,
        sourceEntityType: 'report_appeal',
        sourceEntityId: appeal.id,
        priority: 'high',
      });
    } catch (error) {
      await deps.repo.restoreReportAppealAfterReviewFailure(db, {
        appealId: appeal.id,
        status: appeal.status,
        now,
      });
      if (input.resolutionCode !== 'upheld') {
        await deps.repo.updateReportCaseAfterAppealReview(db, {
          reportCaseId: appeal.reportCaseId,
          status: appeal.currentCaseStatus,
          resolutionCode: appeal.currentCaseResolutionCode,
          closedAt: appeal.currentCaseClosedAt,
          now,
        });
      }
      throw error;
    }

    return {
      appealId: appeal.id,
      status: 'resolved',
      resolutionCode: input.resolutionCode,
      resolutionNote: input.resolutionNote,
    };
  },

  async notifyReportCaseResolutionIfNeeded(input: {
    db: ReportAppealsServiceDb;
    reportCaseId: string;
  }): Promise<boolean> {
    const db = requireDb(input.db);
    const reportCase = await deps.repo.getReportCaseForResolutionNotification(db, input.reportCaseId);
    if (!reportCase) {
      throw new ReportAppealNotFoundError('举报案件不存在');
    }
    if (reportCase.status !== 'resolved' || !isAppealableFinalResolutionCode(reportCase.resolutionCode)) {
      return false;
    }

    const marked = await deps.repo.markReportCaseResolutionNotified(db, {
      reportCaseId: reportCase.id,
      expectedCaseUpdatedAt: reportCase.updatedAt,
      now: deps.now(),
    });
    if (!marked) {
      return false;
    }

    try {
      await deps.createUserMessageEntry({
        db,
        recipientUserId: reportCase.targetUserId,
        messageType: 'moderation',
        templateKey: 'user.moderation.report_case_resolved',
        payload: {
          dataCardId: reportCase.targetEntityId,
          dataCardName: reportCase.targetCardName,
          resolutionCode: reportCase.resolutionCode,
          resolutionLabel: buildResolutionLabel(reportCase.resolutionCode),
        },
        actionUrl: `/report-appeals?reportCaseId=${encodeURIComponent(reportCase.id)}`,
        sourceEntityType: 'report_case',
        sourceEntityId: reportCase.id,
        priority: 'high',
      });
    } catch (error) {
      await deps.repo.clearReportCaseResolutionNotified(db, {
        reportCaseId: reportCase.id,
        expectedCaseUpdatedAt: reportCase.updatedAt,
      });
      throw error;
    }

    return true;
  },

  async getOwnerModerationSummary(input: {
    db: ReportAppealsServiceDb;
    userId: number;
    reportCaseId: string;
  }): Promise<DataCardOwnerModerationSummaryDto | null> {
    const db = requireDb(input.db);
    const reportCase = await deps.repo.getAppealableCaseForUser(db, {
      reportCaseId: input.reportCaseId,
      userId: input.userId,
    });
    if (!reportCase) {
      return null;
    }

    const existingAppeal = await deps.repo.getLatestNonWithdrawnAppealByCaseSnapshot(db, {
      reportCaseId: reportCase.id,
      caseUpdatedAtSnapshot: reportCase.updatedAt,
    });

    return {
      latestCaseId: reportCase.id,
      status: reportCase.status,
      resolutionCode: reportCase.resolutionCode,
      canAppeal:
        reportCase.status === 'resolved' &&
        isAppealableFinalResolutionCode(reportCase.resolutionCode) &&
        existingAppeal == null,
      activeAppealId: existingAppeal?.id ?? null,
      activeAppealStatus: existingAppeal?.status ?? null,
      appealEntryUrl: `/report-appeals?reportCaseId=${encodeURIComponent(reportCase.id)}`,
      statusSummary: buildAppealStatusSummary({
        resolutionCode: reportCase.resolutionCode,
        existingAppealStatus: existingAppeal?.status ?? null,
        existingAppealId: existingAppeal?.id ?? null,
      }),
    };
  },
});

export function createReportAppealsServiceForTests(
  deps: Partial<Omit<ReportAppealsServiceDeps, 'repo'>> & { repo?: Partial<ReportAppealsRepository> } = {},
) {
  const missing = (name: string) => {
    throw new Error(`Missing test dependency: ${name}`);
  };

  return createReportAppealsService({
    now: deps.now ?? (() => new Date().toISOString()),
    idFactory: deps.idFactory ?? (() => crypto.randomUUID()),
    repo: {
      getAppealableCaseForUser: deps.repo?.getAppealableCaseForUser ?? (async () => missing('getAppealableCaseForUser')),
      getLatestNonWithdrawnAppealByCaseSnapshot:
        deps.repo?.getLatestNonWithdrawnAppealByCaseSnapshot ?? (async () => null),
      getActiveAppealByCase: deps.repo?.getActiveAppealByCase ?? (async () => null),
      createReportAppeal: deps.repo?.createReportAppeal ?? (async () => missing('createReportAppeal')),
      replaceReportAppealReferences: deps.repo?.replaceReportAppealReferences ?? (async () => undefined),
      getReportAppealByIdForAppellant: deps.repo?.getReportAppealByIdForAppellant ?? (async () => null),
      getReportAppealByIdForAdmin: deps.repo?.getReportAppealByIdForAdmin ?? (async () => null),
      listReportAppealReferences: deps.repo?.listReportAppealReferences ?? (async () => []),
      listReportAppealsByAppellant: deps.repo?.listReportAppealsByAppellant ?? (async () => []),
      listReportAppealsForAdmin: deps.repo?.listReportAppealsForAdmin ?? (async () => []),
      restoreReportAppealAfterReviewFailure:
        deps.repo?.restoreReportAppealAfterReviewFailure ?? (async () => false),
      updateReportAppealStatus: deps.repo?.updateReportAppealStatus ?? (async () => false),
      updateReportAppealResolution: deps.repo?.updateReportAppealResolution ?? (async () => false),
      updateReportCaseAfterAppealReview: deps.repo?.updateReportCaseAfterAppealReview ?? (async () => false),
      getReportCaseForResolutionNotification:
        deps.repo?.getReportCaseForResolutionNotification ?? (async () => null),
      markReportCaseResolutionNotified: deps.repo?.markReportCaseResolutionNotified ?? (async () => false),
      clearReportCaseResolutionNotified: deps.repo?.clearReportCaseResolutionNotified ?? (async () => false),
    },
    resolveReferenceSnapshots: deps.resolveReferenceSnapshots ?? resolveReferenceSnapshots,
    createUserMessageEntry: deps.createUserMessageEntry ?? (async () => ({ id: null })),
  });
}

const defaultService = createReportAppealsService({
  now: () => new Date().toISOString(),
  idFactory: () => crypto.randomUUID(),
  repo: {
    getAppealableCaseForUser: repo.getAppealableCaseForUser,
    getLatestNonWithdrawnAppealByCaseSnapshot: repo.getLatestNonWithdrawnAppealByCaseSnapshot,
    getActiveAppealByCase: repo.getActiveAppealByCase,
    createReportAppeal: repo.createReportAppeal,
    replaceReportAppealReferences: repo.replaceReportAppealReferences,
    getReportAppealByIdForAppellant: repo.getReportAppealByIdForAppellant,
    getReportAppealByIdForAdmin: repo.getReportAppealByIdForAdmin,
    listReportAppealReferences: repo.listReportAppealReferences,
    listReportAppealsByAppellant: repo.listReportAppealsByAppellant,
    listReportAppealsForAdmin: repo.listReportAppealsForAdmin,
    restoreReportAppealAfterReviewFailure: repo.restoreReportAppealAfterReviewFailure,
    updateReportAppealStatus: repo.updateReportAppealStatus,
    updateReportAppealResolution: repo.updateReportAppealResolution,
    updateReportCaseAfterAppealReview: repo.updateReportCaseAfterAppealReview,
    getReportCaseForResolutionNotification: repo.getReportCaseForResolutionNotification,
    markReportCaseResolutionNotified: repo.markReportCaseResolutionNotified,
    clearReportCaseResolutionNotified: repo.clearReportCaseResolutionNotified,
  },
  resolveReferenceSnapshots,
  createUserMessageEntry,
});

export async function getReportAppealEntry(input: {
  db: ReportAppealsServiceDb;
  userId: number;
  reportCaseId: string;
}): Promise<ReportAppealEntryDto> {
  return defaultService.getReportAppealEntry(input);
}

export async function submitReportAppeal(input: {
  db: ReportAppealsServiceDb;
  userId: number;
  reportCaseId: string;
  caseUpdatedAtSnapshot: string;
  appealReasonCode: ReportAppealReasonCode;
  details: string;
  references: ReportAppealReferenceDraft[];
}): Promise<SubmitReportAppealResult> {
  return defaultService.submitReportAppeal(input);
}

export async function withdrawReportAppeal(input: {
  db: ReportAppealsServiceDb;
  userId: number;
  appealId: string;
}): Promise<WithdrawReportAppealResult> {
  return defaultService.withdrawReportAppeal(input);
}

export async function reviewReportAppeal(input: {
  db: ReportAppealsServiceDb;
  adminUserId: number;
  appealId: string;
  resolutionCode: ReportAppealResolutionCode;
  resolutionNote: string | null;
}): Promise<ReviewReportAppealResult> {
  return defaultService.reviewReportAppeal(input);
}

export async function listMyReportAppeals(input: {
  db: ReportAppealsServiceDb;
  userId: number;
  limit?: number;
}): Promise<ReportAppealListDto> {
  return defaultService.listMyReportAppeals(input);
}

export async function getReportAppealDetail(input: {
  db: ReportAppealsServiceDb;
  userId: number;
  appealId: string;
}): Promise<ReportAppealDetailDto> {
  return defaultService.getReportAppealDetail(input);
}

export async function listReportAppealsForAdmin(input: {
  db: ReportAppealsServiceDb;
  adminUserId: number;
  status?: ReportAppealStatus;
  limit?: number;
}): Promise<ReportAppealAdminListDto> {
  return defaultService.listReportAppealsForAdmin(input);
}

export async function getReportAppealForAdmin(input: {
  db: ReportAppealsServiceDb;
  adminUserId: number;
  appealId: string;
}): Promise<ReportAppealAdminDetailDto> {
  return defaultService.getReportAppealForAdmin(input);
}

export async function notifyReportCaseResolutionIfNeeded(input: {
  db: ReportAppealsServiceDb;
  reportCaseId: string;
}): Promise<boolean> {
  return defaultService.notifyReportCaseResolutionIfNeeded(input);
}

export async function getOwnerModerationSummary(input: {
  db: ReportAppealsServiceDb;
  userId: number;
  reportCaseId: string;
}): Promise<DataCardOwnerModerationSummaryDto | null> {
  return defaultService.getOwnerModerationSummary(input);
}
