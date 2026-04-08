import type { AppDrizzleDb } from '@/lib/db/drizzle';
import type { DataCardByIdDbRow } from '@/lib/db/repositories/data-cards-core';
import { getDataCardByIdWithAuthorAndTags } from '@/lib/db/repositories/data-cards-core';
import * as repo from '@/lib/db/repositories/data-card-reports';
import { getEncyclopediaEntry } from '@/lib/encyclopedia';
import { createUserMessageEntry } from '@/lib/messages/service';
import {
  buildNormalizedReportPayloadHash,
  InvalidDataCardReportReferenceError,
  normalizeDataCardReportDetails,
  normalizeDataCardReportReferences,
} from '@/lib/data-card-reports/normalization';
import {
  DATA_CARD_REPORT_REASONS,
  getDataCardReportReasonLabel,
  isDataCardReportReasonCode,
} from '@/lib/data-card-reports/reasons';
import type {
  DataCardReportCapabilityDto,
  DataCardReportDraft,
  DataCardReportReferenceDraft,
  DataCardReportSubmissionDecision,
  NormalizedReportReference,
} from '@/lib/data-card-reports/types';

export type DataCardReportsServiceDb = AppDrizzleDb | null;

type ResolvedReferenceSnapshot = {
  referenceType: 'public_data_card' | 'encyclopedia_entry';
  referenceId: string;
  labelSnapshot: string;
  urlSnapshot: string | null;
  note: string | null;
  sortOrder: number;
};

type DataCardReportsRepository = {
  getOpenReportCaseByTarget: typeof repo.getOpenReportCaseByTarget;
  createReportCase: typeof repo.createReportCase;
  getActiveReportByCaseAndReporter: typeof repo.getActiveReportByCaseAndReporter;
  createReport: typeof repo.createReport;
  updateActiveReportForReporter: typeof repo.updateActiveReportForReporter;
  replaceReportReferences: typeof repo.replaceReportReferences;
  listReportReferencesByReport: typeof repo.listReportReferencesByReport;
  listActiveReportsByCase: typeof repo.listActiveReportsByCase;
  countActiveReportsByCase: typeof repo.countActiveReportsByCase;
  withdrawActiveReportByReporter: typeof repo.withdrawActiveReportByReporter;
  dismissCaseIfNoActiveReports: typeof repo.dismissCaseIfNoActiveReports;
  markReportCaseCreatorNotified: typeof repo.markReportCaseCreatorNotified;
  clearReportCaseCreatorNotified: typeof repo.clearReportCaseCreatorNotified;
};

export type DataCardReportsServiceDeps = {
  now: () => string;
  idFactory: () => string;
  repo: DataCardReportsRepository;
  getTargetCard: (db: AppDrizzleDb, cardId: string) => Promise<DataCardByIdDbRow | null>;
  resolveReferenceSnapshots: (input: {
    db: AppDrizzleDb;
    targetEntityId: string;
    references: NormalizedReportReference[];
  }) => Promise<ResolvedReferenceSnapshot[]>;
  rateLimit: (input: { reporterUserId: number; targetEntityId: string }) => Promise<{ allowed: boolean }>;
  screenSubmission: (input: {
    reporterUserId: number;
    targetEntityId: string;
    reasonCode: string;
    details: string | null;
  }) => Promise<{ allowed: boolean }>;
  createUserMessageEntry: typeof createUserMessageEntry;
};

export type SubmitDataCardReportInput = {
  db: DataCardReportsServiceDb;
  reporterUserId: number;
  targetEntityId: string;
  reasonCode: string;
  details: string | null;
  references: DataCardReportReferenceDraft[];
};

export type SubmitDataCardReportResult = {
  submissionDecision: DataCardReportSubmissionDecision;
  caseId: string | null;
  reportId: string | null;
  creatorNotified: boolean;
};

export type WithdrawDataCardReportInput = {
  db: DataCardReportsServiceDb;
  reporterUserId: number;
  targetEntityId: string;
};

export type WithdrawDataCardReportResult = {
  withdrawn: boolean;
  caseDismissed: boolean;
};

export class DataCardReportsServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataCardReportsServiceUnavailableError';
  }
}

export class DataCardReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataCardReportValidationError';
  }
}

export class DataCardReportForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataCardReportForbiddenError';
  }
}

const DATA_CARD_REPORT_RATE_LIMIT_PER_HOUR = 3;
const DATA_CARD_REPORT_RATE_LIMIT_PER_DAY = 10;
const DATA_CARD_REPORT_SAME_TARGET_COOLDOWN_MS = 60 * 1000;

const requireDb = (db: DataCardReportsServiceDb): AppDrizzleDb => {
  if (!db) {
    throw new DataCardReportsServiceUnavailableError('举报服务当前不可用');
  }
  return db;
};

const toRepo = (): DataCardReportsRepository => ({
  getOpenReportCaseByTarget: (innerDb, input) => repo.getOpenReportCaseByTarget(innerDb, input),
  createReportCase: (innerDb, input) => repo.createReportCase(innerDb, input),
  getActiveReportByCaseAndReporter: (innerDb, input) => repo.getActiveReportByCaseAndReporter(innerDb, input),
  createReport: (innerDb, input) => repo.createReport(innerDb, input),
  updateActiveReportForReporter: (innerDb, input) => repo.updateActiveReportForReporter(innerDb, input),
  replaceReportReferences: (innerDb, input) => repo.replaceReportReferences(innerDb, input),
  listReportReferencesByReport: (innerDb, reportId) => repo.listReportReferencesByReport(innerDb, reportId),
  listActiveReportsByCase: (innerDb, caseId) => repo.listActiveReportsByCase(innerDb, caseId),
  countActiveReportsByCase: (innerDb, caseId) => repo.countActiveReportsByCase(innerDb, caseId),
  withdrawActiveReportByReporter: (innerDb, input) => repo.withdrawActiveReportByReporter(innerDb, input),
  dismissCaseIfNoActiveReports: (innerDb, input) => repo.dismissCaseIfNoActiveReports(innerDb, input),
  markReportCaseCreatorNotified: (innerDb, input) => repo.markReportCaseCreatorNotified(innerDb, input),
  clearReportCaseCreatorNotified: (innerDb, input) => repo.clearReportCaseCreatorNotified(innerDb, input),
});

const resolveTargetCard = async (db: AppDrizzleDb, cardId: string): Promise<DataCardByIdDbRow | null> =>
  getDataCardByIdWithAuthorAndTags(db, { cardId, publicOnly: true });

const resolveReferenceSnapshots = async (input: {
  db: AppDrizzleDb;
  targetEntityId: string;
  references: NormalizedReportReference[];
}): Promise<ResolvedReferenceSnapshot[]> => {
  const resolved: ResolvedReferenceSnapshot[] = [];

  for (const reference of input.references) {
    if (reference.referenceType === 'public_data_card') {
      if (reference.referenceId === input.targetEntityId) {
        throw new DataCardReportValidationError('引用公开数据卡时不能引用被举报目标自身');
      }
      const card = await resolveTargetCard(input.db, reference.referenceId);
      if (!card) {
        throw new DataCardReportValidationError('引用的公开数据卡不存在或不可访问');
      }
      resolved.push({
        referenceType: reference.referenceType,
        referenceId: reference.referenceId,
        labelSnapshot: card.name,
        urlSnapshot: `/character-manager?dataCardId=${encodeURIComponent(card.id)}`,
        note: reference.note,
        sortOrder: reference.sortOrder,
      });
      continue;
    }

    const entry = getEncyclopediaEntry(reference.referenceId);
    if (!entry) {
      throw new DataCardReportValidationError('引用的百科条目不存在');
    }

    resolved.push({
      referenceType: reference.referenceType,
      referenceId: reference.referenceId,
      labelSnapshot: entry.title,
      urlSnapshot: `/encyclopedia/${entry.slug}`,
      note: reference.note,
      sortOrder: reference.sortOrder,
    });
  }

  return resolved;
};

const previewDetails = (details: string | null): string | null => {
  if (!details) return null;
  return details.length <= 80 ? details : `${details.slice(0, 80)}…`;
};

const buildReferenceSummary = (references: ResolvedReferenceSnapshot[]): string[] =>
  references.map((reference) =>
    reference.referenceType === 'public_data_card'
      ? `引用公开数据卡：${reference.labelSnapshot}`
      : `引用百科：${reference.labelSnapshot}`,
  );

const buildEvidenceSummary = (input: {
  reasonCode: string;
  references: ResolvedReferenceSnapshot[];
  details: string | null;
}) => ({
  reasonLabels: [getDataCardReportReasonLabel(input.reasonCode)],
  referenceSummary: buildReferenceSummary(input.references),
  detailsPreview: previewDetails(input.details),
});

const parseEvidenceSummary = (payloadJson: string): {
  reasonLabels: string[];
  referenceSummary: string[];
  detailsPreview: string | null;
} => {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    return {
      reasonLabels: Array.isArray(parsed.reasonLabels)
        ? parsed.reasonLabels.filter((item): item is string => typeof item === 'string')
        : [],
      referenceSummary: Array.isArray(parsed.referenceSummary)
        ? parsed.referenceSummary.filter((item): item is string => typeof item === 'string')
        : [],
      detailsPreview: typeof parsed.detailsPreview === 'string' ? parsed.detailsPreview : null,
    };
  } catch {
    return { reasonLabels: [], referenceSummary: [], detailsPreview: null };
  }
};

const subtractWindowFromIso = (now: string, windowMs: number): string => {
  const baseMs = Date.parse(now);
  if (!Number.isFinite(baseMs)) {
    return new Date(Date.now() - windowMs).toISOString();
  }
  return new Date(baseMs - windowMs).toISOString();
};

const isWithinCooldown = (updatedAt: string | null | undefined, now: string, cooldownMs: number): boolean => {
  if (!updatedAt) return false;
  const updatedAtMs = Date.parse(updatedAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - updatedAtMs >= 0 && nowMs - updatedAtMs < cooldownMs;
};

export async function screenDataCardReportSubmission(input: {
  reporterUserId: number;
  targetEntityId: string;
  reasonCode: string;
  details: string | null;
}): Promise<{ allowed: boolean }> {
  const normalizedDetails = normalizeDataCardReportDetails(input.details);

  if (input.reasonCode === 'rule_violation_other' && !normalizedDetails) {
    return { allowed: false };
  }

  return { allowed: true };
}

export async function rateLimitDataCardReportSubmission(
  db: AppDrizzleDb,
  input: {
    reporterUserId: number;
    targetEntityId: string;
    now?: string;
  },
): Promise<{ allowed: boolean }> {
  const now = input.now ?? new Date().toISOString();
  const openCase = await repo.getOpenReportCaseByTarget(db, {
    targetEntityType: 'data_card',
    targetEntityId: input.targetEntityId,
  });
  if (openCase) {
    const activeReport = await repo.getActiveReportByCaseAndReporter(db, {
      caseId: openCase.id,
      reporterUserId: input.reporterUserId,
    });
    if (isWithinCooldown(activeReport?.updatedAt, now, DATA_CARD_REPORT_SAME_TARGET_COOLDOWN_MS)) {
      return { allowed: false };
    }
  }

  const lastHourCount = await repo.countReportsUpdatedByReporterSince(db, {
    reporterUserId: input.reporterUserId,
    since: subtractWindowFromIso(now, 60 * 60 * 1000),
  });
  if (lastHourCount >= DATA_CARD_REPORT_RATE_LIMIT_PER_HOUR) {
    return { allowed: false };
  }

  const lastDayCount = await repo.countReportsUpdatedByReporterSince(db, {
    reporterUserId: input.reporterUserId,
    since: subtractWindowFromIso(now, 24 * 60 * 60 * 1000),
  });
  if (lastDayCount >= DATA_CARD_REPORT_RATE_LIMIT_PER_DAY) {
    return { allowed: false };
  }

  return { allowed: true };
}

const createDataCardReportsService = (deps: DataCardReportsServiceDeps) => {
  const getEligibleTargetCard = async (
    db: AppDrizzleDb,
    targetEntityId: string,
    reporterUserId: number,
  ): Promise<DataCardByIdDbRow> => {
    const targetCard = await deps.getTargetCard(db, targetEntityId);
    if (!targetCard) {
      throw new DataCardReportValidationError('目标数据卡不存在或当前不可举报');
    }
    if (targetCard.user_id === reporterUserId) {
      throw new DataCardReportForbiddenError('不能举报自己的公开数据卡');
    }
    return targetCard;
  };

  const buildNormalizedPayloadHashForTests = async (input: SubmitDataCardReportInput): Promise<string> =>
    buildNormalizedReportPayloadHash({
      targetEntityId: input.targetEntityId,
      reasonCode: input.reasonCode,
      details: normalizeDataCardReportDetails(input.details),
      references: normalizeDataCardReportReferences(input.references),
    });

  const buildSelfRemediationCandidateDto = (input: {
    caseId: string;
    creatorNotifiedAt: string | null;
    targetCardUpdatedAtAtNotice: string | null;
    currentTargetCardUpdatedAt: string | null;
  }) => {
    const remediationBaseline = input.targetCardUpdatedAtAtNotice ?? input.creatorNotifiedAt;
    const isCandidate =
      remediationBaseline != null &&
      input.currentTargetCardUpdatedAt != null &&
      input.currentTargetCardUpdatedAt > remediationBaseline;

    return {
      caseId: input.caseId,
      isSelfRemediationCandidate: isCandidate,
      selfRemediationDetectedAt: isCandidate ? input.currentTargetCardUpdatedAt : null,
    };
  };

  return {
    async getDataCardReportCapability(input: {
      db: DataCardReportsServiceDb;
      viewerUserId: number | null;
      targetEntityId: string;
    }): Promise<DataCardReportCapabilityDto> {
      if (input.viewerUserId == null) {
        return {
          canReport: false,
          reportDisabledReason: '登录后可举报',
          hasOpenCase: false,
          myActiveReport: null,
          reasons: DATA_CARD_REPORT_REASONS,
          caseSummary: null,
        };
      }

      const db = requireDb(input.db);
      const targetCard = await deps.getTargetCard(db, input.targetEntityId);
      if (!targetCard) {
        return {
          canReport: false,
          reportDisabledReason: '该数据卡当前不可举报',
          hasOpenCase: false,
          myActiveReport: null,
          reasons: DATA_CARD_REPORT_REASONS,
          caseSummary: null,
        };
      }

      if (targetCard.user_id === input.viewerUserId) {
        return {
          canReport: false,
          reportDisabledReason: '不能举报自己的公开数据卡',
          hasOpenCase: false,
          myActiveReport: null,
          reasons: DATA_CARD_REPORT_REASONS,
          caseSummary: null,
        };
      }

      const openCase = await deps.repo.getOpenReportCaseByTarget(db, {
        targetEntityType: 'data_card',
        targetEntityId: input.targetEntityId,
      });
      if (!openCase) {
        return {
          canReport: true,
          reportDisabledReason: null,
          hasOpenCase: false,
          myActiveReport: null,
          reasons: DATA_CARD_REPORT_REASONS,
          caseSummary: null,
        };
      }

      const myReport = await deps.repo.getActiveReportByCaseAndReporter(db, {
        caseId: openCase.id,
        reporterUserId: input.viewerUserId,
      });
      const myReferences = myReport ? await deps.repo.listReportReferencesByReport(db, myReport.id) : [];
      const activeReports = await deps.repo.listActiveReportsByCase(db, openCase.id);

      const aggregatedReasonLabels = Array.from(
        new Set(
          activeReports.flatMap((report) => {
            const summary = parseEvidenceSummary(report.evidenceSummaryJson);
            return summary.reasonLabels.length > 0
              ? summary.reasonLabels
              : [getDataCardReportReasonLabel(report.reasonCode)];
          }),
        ),
      );
      const aggregatedReferenceSummary = Array.from(
        new Set(
          (
            await Promise.all(
              activeReports.map(async (report) => {
                const summary = parseEvidenceSummary(report.evidenceSummaryJson);
                if (summary.referenceSummary.length > 0) return summary.referenceSummary;
                const refs = await deps.repo.listReportReferencesByReport(db, report.id);
                return refs.map((reference) =>
                  reference.referenceType === 'public_data_card'
                    ? `引用公开数据卡：${reference.labelSnapshot}`
                    : `引用百科：${reference.labelSnapshot}`,
                );
              }),
            )
          ).flat(),
        ),
      );

      return {
        canReport: true,
        reportDisabledReason: null,
        hasOpenCase: true,
        myActiveReport: myReport
          ? {
              reasonCode: myReport.reasonCode as DataCardReportDraft['reasonCode'],
              details: myReport.details,
              references: myReferences.map((reference) => ({
                referenceType: reference.referenceType,
                referenceId: reference.referenceId,
                note: reference.note,
                sortOrder: reference.sortOrder,
              })),
            }
          : null,
        reasons: DATA_CARD_REPORT_REASONS,
        caseSummary: {
          caseId: openCase.id,
          reportCount: activeReports.length,
          reasonLabels: aggregatedReasonLabels,
          referenceSummary: aggregatedReferenceSummary,
        },
      };
    },

    async submitDataCardReport(input: SubmitDataCardReportInput): Promise<SubmitDataCardReportResult> {
      if (!isDataCardReportReasonCode(input.reasonCode)) {
        throw new DataCardReportValidationError('举报理由无效');
      }

      const db = requireDb(input.db);
      const targetCard = await getEligibleTargetCard(db, input.targetEntityId, input.reporterUserId);

      let normalizedReferences: NormalizedReportReference[];
      try {
        normalizedReferences = normalizeDataCardReportReferences(input.references);
      } catch (error) {
        if (error instanceof InvalidDataCardReportReferenceError) {
          throw new DataCardReportValidationError(error.message);
        }
        throw error;
      }

      const normalizedDetails = normalizeDataCardReportDetails(input.details);
      const payloadHash = await buildNormalizedReportPayloadHash({
        targetEntityId: input.targetEntityId,
        reasonCode: input.reasonCode,
        details: normalizedDetails,
        references: normalizedReferences,
      });

      let openCase = await deps.repo.getOpenReportCaseByTarget(db, {
        targetEntityType: 'data_card',
        targetEntityId: input.targetEntityId,
      });
      let existingActiveReport = openCase
        ? await deps.repo.getActiveReportByCaseAndReporter(db, {
            caseId: openCase.id,
            reporterUserId: input.reporterUserId,
          })
        : null;

      if (existingActiveReport && existingActiveReport.normalizedPayloadHash === payloadHash) {
        return {
          submissionDecision: 'noop_duplicate_payload',
          caseId: openCase?.id ?? null,
          reportId: existingActiveReport.id,
          creatorNotified: false,
        };
      }

      const rateLimit = await deps.rateLimit({
        reporterUserId: input.reporterUserId,
        targetEntityId: input.targetEntityId,
      });
      if (!rateLimit.allowed) {
        return {
          submissionDecision: 'rejected_rate_limited',
          caseId: null,
          reportId: null,
          creatorNotified: false,
        };
      }

      const screening = await deps.screenSubmission({
        reporterUserId: input.reporterUserId,
        targetEntityId: input.targetEntityId,
        reasonCode: input.reasonCode,
        details: normalizedDetails,
      });
      if (!screening.allowed) {
        return {
          submissionDecision: 'rejected_screened',
          caseId: null,
          reportId: null,
          creatorNotified: false,
        };
      }

      const referenceSnapshots = await deps.resolveReferenceSnapshots({
        db,
        targetEntityId: input.targetEntityId,
        references: normalizedReferences,
      });
      const evidenceSummary = buildEvidenceSummary({
        reasonCode: input.reasonCode,
        references: referenceSnapshots,
        details: normalizedDetails,
      });
      const now = deps.now();

      if (!openCase) {
        try {
          openCase = await deps.repo.createReportCase(db, {
            id: deps.idFactory(),
            targetEntityType: 'data_card',
            targetEntityId: input.targetEntityId,
            targetUserId: targetCard.user_id,
            now,
          });
        } catch (error) {
          const existingOpenCase = await deps.repo.getOpenReportCaseByTarget(db, {
            targetEntityType: 'data_card',
            targetEntityId: input.targetEntityId,
          });
          if (!existingOpenCase) {
            throw error;
          }
          openCase = existingOpenCase;
        }
      }

      if (!existingActiveReport) {
        existingActiveReport = await deps.repo.getActiveReportByCaseAndReporter(db, {
          caseId: openCase.id,
          reporterUserId: input.reporterUserId,
        });
        if (existingActiveReport && existingActiveReport.normalizedPayloadHash === payloadHash) {
          return {
            submissionDecision: 'noop_duplicate_payload',
            caseId: openCase.id,
            reportId: existingActiveReport.id,
            creatorNotified: false,
          };
        }
      }

      const reportWriteInput = {
        caseId: openCase.id,
        reporterUserId: input.reporterUserId,
        reasonCode: input.reasonCode,
        details: normalizedDetails,
        evidenceSummaryJson: JSON.stringify(evidenceSummary),
        normalizedPayloadHash: payloadHash,
        targetNameSnapshot: targetCard.name,
        targetDescriptionSnapshot: targetCard.description,
        targetDataSnapshot: targetCard.data,
        targetUpdatedAtSnapshot: targetCard.updated_at,
        now,
      };

      let submissionDecision: SubmitDataCardReportResult['submissionDecision'] = existingActiveReport ? 'updated' : 'created';
      let reportRow = existingActiveReport
        ? await deps.repo.updateActiveReportForReporter(db, reportWriteInput)
        : null;

      if (!existingActiveReport) {
        try {
          reportRow = await deps.repo.createReport(db, {
            id: deps.idFactory(),
            ...reportWriteInput,
          });
        } catch (error) {
          const concurrentActiveReport = await deps.repo.getActiveReportByCaseAndReporter(db, {
            caseId: openCase.id,
            reporterUserId: input.reporterUserId,
          });
          if (!concurrentActiveReport) {
            throw error;
          }

          if (concurrentActiveReport.normalizedPayloadHash === payloadHash) {
            return {
              submissionDecision: 'noop_duplicate_payload',
              caseId: openCase.id,
              reportId: concurrentActiveReport.id,
              creatorNotified: false,
            };
          }

          existingActiveReport = concurrentActiveReport;
          submissionDecision = 'updated';
          reportRow = await deps.repo.updateActiveReportForReporter(db, reportWriteInput);
        }
      }

      if (!reportRow) {
        throw new DataCardReportsServiceUnavailableError('更新举报失败');
      }

      await deps.repo.replaceReportReferences(db, {
        reportId: reportRow.id,
        references: referenceSnapshots.map((reference) => ({
          id: deps.idFactory(),
          referenceType: reference.referenceType,
          referenceId: reference.referenceId,
          labelSnapshot: reference.labelSnapshot,
          urlSnapshot: reference.urlSnapshot,
          note: reference.note,
          sortOrder: reference.sortOrder,
        })),
      });

      let creatorNotified = false;
      const reportCount = await deps.repo.countActiveReportsByCase(db, openCase.id);
      if (!openCase.creatorNotifiedAt) {
        creatorNotified = await deps.repo.markReportCaseCreatorNotified(db, {
          caseId: openCase.id,
          notifiedAt: now,
          reportCount,
          targetCardUpdatedAtAtNotice: targetCard.updated_at,
        });
        if (creatorNotified) {
          try {
            await deps.createUserMessageEntry({
              db,
              recipientUserId: targetCard.user_id,
              actorUserId: null,
              channel: 'system',
              messageType: 'moderation',
              templateKey: 'user.moderation.data_card_reported',
              payload: {
                dataCardId: targetCard.id,
                dataCardName: targetCard.name,
                reasonLabels: evidenceSummary.reasonLabels,
                referenceSummary: evidenceSummary.referenceSummary,
                detailsPreview: evidenceSummary.detailsPreview,
                reportCount,
                updatedAfterNotice: false,
              },
              actionUrl: '/character-manager',
              sourceEntityType: 'report_case',
              sourceEntityId: openCase.id,
              priority: 'high',
            });
          } catch (error) {
            await deps.repo.clearReportCaseCreatorNotified(db, {
              caseId: openCase.id,
              notifiedAt: now,
            });
            throw error;
          }
        }
      }

      return {
        submissionDecision,
        caseId: openCase.id,
        reportId: reportRow.id,
        creatorNotified,
      };
    },

    async withdrawDataCardReport(input: WithdrawDataCardReportInput): Promise<WithdrawDataCardReportResult> {
      const db = requireDb(input.db);
      const openCase = await deps.repo.getOpenReportCaseByTarget(db, {
        targetEntityType: 'data_card',
        targetEntityId: input.targetEntityId,
      });
      if (!openCase) {
        return { withdrawn: false, caseDismissed: false };
      }

      const withdrawn = await deps.repo.withdrawActiveReportByReporter(db, {
        caseId: openCase.id,
        reporterUserId: input.reporterUserId,
        now: deps.now(),
      });
      if (!withdrawn) {
        return { withdrawn: false, caseDismissed: false };
      }

      const caseDismissed = await deps.repo.dismissCaseIfNoActiveReports(db, {
        caseId: openCase.id,
        now: deps.now(),
      });
      return { withdrawn: true, caseDismissed };
    },

    buildSelfRemediationCandidateDto,
    buildNormalizedPayloadHashForTests,
  };
};

export function createDataCardReportsServiceForTests(
  deps: Partial<Omit<DataCardReportsServiceDeps, 'repo'>> & { repo?: Partial<DataCardReportsRepository> } = {},
) {
  const missing = (name: string) => {
    throw new Error(`Missing test dependency: ${name}`);
  };

  return createDataCardReportsService({
    now: deps.now ?? (() => new Date().toISOString()),
    idFactory: deps.idFactory ?? (() => crypto.randomUUID()),
    repo: {
      getOpenReportCaseByTarget: deps.repo?.getOpenReportCaseByTarget ?? (() => missing('getOpenReportCaseByTarget')),
      createReportCase: deps.repo?.createReportCase ?? (() => missing('createReportCase')),
      getActiveReportByCaseAndReporter:
        deps.repo?.getActiveReportByCaseAndReporter ?? (() => missing('getActiveReportByCaseAndReporter')),
      createReport: deps.repo?.createReport ?? (() => missing('createReport')),
      updateActiveReportForReporter:
        deps.repo?.updateActiveReportForReporter ?? (() => missing('updateActiveReportForReporter')),
      replaceReportReferences: deps.repo?.replaceReportReferences ?? (() => missing('replaceReportReferences')),
      listReportReferencesByReport:
        deps.repo?.listReportReferencesByReport ?? (async () => []),
      listActiveReportsByCase: deps.repo?.listActiveReportsByCase ?? (async () => []),
      countActiveReportsByCase: deps.repo?.countActiveReportsByCase ?? (() => missing('countActiveReportsByCase')),
      withdrawActiveReportByReporter:
        deps.repo?.withdrawActiveReportByReporter ?? (() => missing('withdrawActiveReportByReporter')),
      dismissCaseIfNoActiveReports:
        deps.repo?.dismissCaseIfNoActiveReports ?? (() => missing('dismissCaseIfNoActiveReports')),
      markReportCaseCreatorNotified:
        deps.repo?.markReportCaseCreatorNotified ?? (async () => false),
      clearReportCaseCreatorNotified:
        deps.repo?.clearReportCaseCreatorNotified ?? (async () => false),
    },
    getTargetCard: deps.getTargetCard ?? (async () => missing('getTargetCard')),
    resolveReferenceSnapshots: deps.resolveReferenceSnapshots ?? (async () => missing('resolveReferenceSnapshots')),
    rateLimit: deps.rateLimit ?? (async () => ({ allowed: true })),
    screenSubmission: deps.screenSubmission ?? (async () => ({ allowed: true })),
    createUserMessageEntry: deps.createUserMessageEntry ?? (async () => ({ id: null })),
  });
}

export async function getDataCardReportCapability(input: {
  db: DataCardReportsServiceDb;
  viewerUserId: number | null;
  targetEntityId: string;
}) {
  return createDataCardReportsService({
    now: () => new Date().toISOString(),
    idFactory: () => crypto.randomUUID(),
    repo: toRepo(),
    getTargetCard: resolveTargetCard,
    resolveReferenceSnapshots,
    rateLimit: async () => ({ allowed: true }),
    screenSubmission: screenDataCardReportSubmission,
    createUserMessageEntry,
  }).getDataCardReportCapability(input);
}

export async function submitDataCardReport(input: SubmitDataCardReportInput) {
  return createDataCardReportsService({
    now: () => new Date().toISOString(),
    idFactory: () => crypto.randomUUID(),
    repo: toRepo(),
    getTargetCard: resolveTargetCard,
    resolveReferenceSnapshots,
    rateLimit: ({ reporterUserId, targetEntityId }) =>
      rateLimitDataCardReportSubmission(requireDb(input.db), { reporterUserId, targetEntityId }),
    screenSubmission: screenDataCardReportSubmission,
    createUserMessageEntry,
  }).submitDataCardReport(input);
}

export async function withdrawDataCardReport(input: WithdrawDataCardReportInput) {
  return createDataCardReportsService({
    now: () => new Date().toISOString(),
    idFactory: () => crypto.randomUUID(),
    repo: toRepo(),
    getTargetCard: resolveTargetCard,
    resolveReferenceSnapshots,
    rateLimit: async () => ({ allowed: true }),
    screenSubmission: screenDataCardReportSubmission,
    createUserMessageEntry,
  }).withdrawDataCardReport(input);
}
