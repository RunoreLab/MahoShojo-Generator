import { and, eq } from 'drizzle-orm';

import {
  AdminGovernanceConflictError,
  AdminGovernanceNotFoundError,
  AdminGovernanceServiceUnavailableError,
  AdminGovernanceValidationError,
} from '@/lib/admin/governance';
import {
  getReportCaseStatusLabel,
  getReportResolutionCodeLabel,
} from '@/lib/admin/governance-labels';
import { sendDataCardModerationMessages } from '@/lib/admin/messages';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { updateReportCaseDecision as updateReportCaseDecisionRow } from '@/lib/db/repositories/data-card-reports';
import { dataCards, reportCases, type ReportCaseStatus, type ReportResolutionCode } from '@/lib/db/schema';
import { batchUpdateDataCards, getDataCardNotificationTargets } from '@/lib/database/admin';
import { createUserMessageEntry } from '@/lib/messages/service';

type AdminReportCaseDecisionRow = {
  id: string;
  targetEntityType: string;
  targetEntityId: string;
  targetUserId: number | null;
  targetCardName: string | null;
  status: ReportCaseStatus;
  resolutionCode: ReportResolutionCode | null;
  updatedAt: string;
};

export type AdminReportCaseDecisionInput = {
  db: AppDrizzleDb | null;
  caseId: string;
  adminUserId: number;
  nextStatus: 'resolved' | 'dismissed' | 'under_review';
  resolutionCode: string | null;
  resolutionNote?: string | null;
  notifyCreator?: boolean;
  creatorMessageReason?: string | null;
  cardModerationAction?: {
    action: 'reject' | 'set_public_status';
    value?: 0 | -1;
    messageOptions?: {
      send?: boolean;
      defaultReason?: string | null;
    };
  } | null;
};

type AdminReportCasesServiceDeps = {
  now: () => string;
  getReportCaseById: (db: AppDrizzleDb, caseId: string) => Promise<AdminReportCaseDecisionRow | null>;
  updateReportCaseDecision: typeof updateReportCaseDecisionRow;
  createUserMessageEntry: typeof createUserMessageEntry;
  batchUpdateDataCards: typeof batchUpdateDataCards;
  getDataCardNotificationTargets: typeof getDataCardNotificationTargets;
  sendDataCardModerationMessages: typeof sendDataCardModerationMessages;
};

const RESOLVED_RESOLUTION_CODES = new Set<ReportResolutionCode>([
  'confirmed_violation',
  'content_removed',
  'self_remediated',
]);

const DISMISSED_RESOLUTION_CODES = new Set<ReportResolutionCode>(['no_violation', 'malicious_report']);

const trimToNull = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const requireDb = (db: AppDrizzleDb | null): AppDrizzleDb => {
  if (!db) {
    throw new AdminGovernanceServiceUnavailableError('治理后台数据库不可用');
  }
  return db;
};

const defaultDeps: AdminReportCasesServiceDeps = {
  now: () => new Date().toISOString(),
  getReportCaseById: async (db, caseId) => {
    const rows = await db
      .select({
        id: reportCases.id,
        targetEntityType: reportCases.targetEntityType,
        targetEntityId: reportCases.targetEntityId,
        targetUserId: reportCases.targetUserId,
        targetCardName: dataCards.name,
        status: reportCases.status,
        resolutionCode: reportCases.resolutionCode,
        updatedAt: reportCases.updatedAt,
      })
      .from(reportCases)
      .leftJoin(
        dataCards,
        and(eq(dataCards.id, reportCases.targetEntityId), eq(reportCases.targetEntityType, 'data_card')),
      )
      .where(eq(reportCases.id, caseId));

    return rows[0] ?? null;
  },
  updateReportCaseDecision: updateReportCaseDecisionRow,
  createUserMessageEntry,
  batchUpdateDataCards,
  getDataCardNotificationTargets,
  sendDataCardModerationMessages,
};

const validateDecisionInput = (
  nextStatus: AdminReportCaseDecisionInput['nextStatus'],
  resolutionCode: ReportResolutionCode | null,
): void => {
  if (nextStatus === 'under_review') {
    if (resolutionCode !== null) {
      throw new AdminGovernanceValidationError('重新打开人工复核时不能附带 resolutionCode');
    }
    return;
  }

  if (nextStatus === 'resolved') {
    if (!resolutionCode || !RESOLVED_RESOLUTION_CODES.has(resolutionCode)) {
      throw new AdminGovernanceValidationError('resolved 状态仅允许违规类处理结论');
    }
    return;
  }

  if (!resolutionCode || !DISMISSED_RESOLUTION_CODES.has(resolutionCode)) {
    throw new AdminGovernanceValidationError('dismissed 状态仅允许无违规或恶意举报结论');
  }
};

const getDecisionMessageLabel = (
  nextStatus: AdminReportCaseDecisionInput['nextStatus'],
  resolutionCode: ReportResolutionCode | null,
): string => {
  if (resolutionCode) {
    return getReportResolutionCodeLabel(resolutionCode);
  }
  return getReportCaseStatusLabel(nextStatus);
};

const applyCardModerationAction = async (
  deps: AdminReportCasesServiceDeps,
  input: {
    db: AppDrizzleDb;
    action: NonNullable<AdminReportCaseDecisionInput['cardModerationAction']>;
    adminUserId: number;
    targetCardId: string;
  },
): Promise<boolean> => {
  let updates: { review_status?: 'approved' | 'rejected'; is_public?: 0 | 1 | -1 } | null = null;
  let messageTemplateKey: 'user.moderation.data_card_rejected' | 'user.moderation.data_card_banned' | null = null;

  if (input.action.action === 'reject') {
    updates = { review_status: 'rejected' };
    messageTemplateKey = 'user.moderation.data_card_rejected';
  } else if (input.action.value === 0 || input.action.value === -1) {
    updates = { is_public: input.action.value };
    messageTemplateKey = input.action.value === -1 ? 'user.moderation.data_card_banned' : null;
  } else {
    throw new AdminGovernanceValidationError('set_public_status 仅允许 value 为 0 或 -1');
  }

  const updated = await deps.batchUpdateDataCards([input.targetCardId], updates);
  if (!updated) {
    throw new AdminGovernanceServiceUnavailableError('数据卡处罚执行失败');
  }

  if (input.action.messageOptions?.send && messageTemplateKey) {
    const targets = await deps.getDataCardNotificationTargets([input.targetCardId]);
    await deps.sendDataCardModerationMessages({
      db: input.db,
      actorUserId: input.adminUserId,
      templateKey: messageTemplateKey,
      targets,
      defaultReason: trimToNull(input.action.messageOptions.defaultReason),
    });
  }

  return true;
};

const createAdminReportCasesService = (deps: AdminReportCasesServiceDeps) => ({
  async decideAdminReportCase(input: AdminReportCaseDecisionInput): Promise<{
    reportCaseId: string;
    status: string;
    resolutionCode: string | null;
    closedAt: string | null;
    notifiedCreator: boolean;
    dataCardModerationApplied: boolean;
  }> {
    const db = requireDb(input.db);
    const resolutionCode = trimToNull(input.resolutionCode) as ReportResolutionCode | null;

    validateDecisionInput(input.nextStatus, resolutionCode);

    const reportCase = await deps.getReportCaseById(db, input.caseId);
    if (!reportCase) {
      throw new AdminGovernanceNotFoundError('举报案件不存在');
    }

    if (input.cardModerationAction) {
      if (reportCase.targetEntityType !== 'data_card') {
        throw new AdminGovernanceValidationError('只有数据卡案件支持附带数据卡处罚');
      }
      if (input.nextStatus !== 'resolved' || !resolutionCode || !RESOLVED_RESOLUTION_CODES.has(resolutionCode)) {
        throw new AdminGovernanceValidationError('只有违规成立的正式结案允许附带数据卡处罚');
      }
    }

    const now = deps.now();
    const closedAt = input.nextStatus === 'under_review' ? null : now;
    const updated = await deps.updateReportCaseDecision(db, {
      reportCaseId: input.caseId,
      status: input.nextStatus,
      resolutionCode,
      closedAt,
      now,
      expectedUpdatedAt: reportCase.updatedAt,
    });
    if (!updated) {
      throw new AdminGovernanceConflictError('举报案件状态已变化，请刷新后重试');
    }

    let dataCardModerationApplied = false;
    if (input.cardModerationAction) {
      dataCardModerationApplied = await applyCardModerationAction(deps, {
        db,
        action: input.cardModerationAction,
        adminUserId: input.adminUserId,
        targetCardId: reportCase.targetEntityId,
      });
    }

    let notifiedCreator = false;
    if (input.notifyCreator) {
      if (reportCase.targetUserId == null) {
        throw new AdminGovernanceValidationError('案件缺少目标作者信息');
      }

      await deps.createUserMessageEntry({
        db,
        recipientUserId: reportCase.targetUserId,
        actorUserId: input.adminUserId,
        channel: 'admin',
        messageType: 'moderation',
        templateKey: 'user.moderation.report_case_resolved',
        payload: {
          dataCardId: reportCase.targetEntityId,
          dataCardName: reportCase.targetCardName,
          resolutionCode,
          resolutionLabel: getDecisionMessageLabel(input.nextStatus, resolutionCode),
          reason: trimToNull(input.creatorMessageReason) ?? trimToNull(input.resolutionNote),
        },
        actionUrl: `/report-appeals?reportCaseId=${encodeURIComponent(reportCase.id)}`,
        sourceEntityType: 'report_case',
        sourceEntityId: reportCase.id,
        priority: 'high',
      });
      notifiedCreator = true;
    }

    return {
      reportCaseId: input.caseId,
      status: input.nextStatus,
      resolutionCode,
      closedAt,
      notifiedCreator,
      dataCardModerationApplied,
    };
  },
});

export function createAdminReportCasesServiceForTests(
  overrides: Partial<AdminReportCasesServiceDeps> = {},
) {
  return createAdminReportCasesService({
    ...defaultDeps,
    ...overrides,
  });
}

const defaultService = createAdminReportCasesService(defaultDeps);

export async function decideAdminReportCase(input: AdminReportCaseDecisionInput) {
  return defaultService.decideAdminReportCase(input);
}
