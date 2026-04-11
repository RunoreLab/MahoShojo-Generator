import type { ReportResolutionCode } from '@/lib/db/schema';
import { decideAdminReportCase } from '@/lib/admin/report-cases';
import {
  AdminGovernanceConflictError,
  AdminGovernanceNotFoundError,
  AdminGovernanceServiceUnavailableError,
  AdminGovernanceValidationError,
} from '@/lib/admin/governance';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  decideAdminReportCase: typeof decideAdminReportCase;
};

type HandlerContext = {
  params?: {
    caseId?: string;
  };
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  decideAdminReportCase,
};

const allowedStatuses = new Set(['resolved', 'dismissed', 'under_review']);
const allowedResolutionCodes = new Set<ReportResolutionCode>([
  'confirmed_violation',
  'content_removed',
  'self_remediated',
  'no_violation',
  'malicious_report',
]);
const resolvedResolutionCodes = new Set<ReportResolutionCode>([
  'confirmed_violation',
  'content_removed',
  'self_remediated',
]);

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const getCaseId = (req: Request, context?: HandlerContext): string => {
  const fromContext = context?.params?.caseId?.trim();
  if (fromContext) return fromContext;

  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const decisionIndex = parts.lastIndexOf('decision');
  if (decisionIndex <= 0) return '';
  return parts[decisionIndex - 1] ?? '';
};

const isAdminUser = (user: { is_admin?: number | null }): boolean => user.is_admin === 1;

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof AdminGovernanceValidationError) return json({ error: error.message }, { status: 400 });
  if (error instanceof AdminGovernanceNotFoundError) return json({ error: error.message }, { status: 404 });
  if (error instanceof AdminGovernanceConflictError) return json({ error: error.message }, { status: 409 });
  if (error instanceof AdminGovernanceServiceUnavailableError) return json({ error: error.message }, { status: 503 });
  return null;
};

export const createAdminReportCaseDecisionHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request, context?: HandlerContext): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;
    if (!isAdminUser(auth.user)) {
      return json({ error: '需要管理员权限' }, { status: 403 });
    }

    const caseId = getCaseId(req, context);
    if (!caseId) {
      return json({ error: '缺少 caseId' }, { status: 400 });
    }

    const payload = await readJson<Record<string, unknown>>(req);
    if ('response' in payload) return payload.response;

    const nextStatus = typeof payload.data?.nextStatus === 'string' ? payload.data.nextStatus.trim() : '';
    if (!allowedStatuses.has(nextStatus)) {
      return json({ error: 'nextStatus 无效' }, { status: 400 });
    }

    const resolutionCodeRaw =
      typeof payload.data?.resolutionCode === 'string' ? payload.data.resolutionCode.trim() : '';
    const resolutionCode =
      resolutionCodeRaw.length > 0 ? (resolutionCodeRaw as ReportResolutionCode) : null;
    if (resolutionCodeRaw.length > 0) {
      const resolutionCandidate = resolutionCodeRaw as ReportResolutionCode;
      if (!allowedResolutionCodes.has(resolutionCandidate)) {
        return json({ error: 'resolutionCode 无效' }, { status: 400 });
      }
    }

    const cardModerationAction =
      payload.data?.cardModerationAction &&
      typeof payload.data.cardModerationAction === 'object' &&
      !Array.isArray(payload.data.cardModerationAction)
        ? (payload.data.cardModerationAction as Record<string, unknown>)
        : null;

    if (cardModerationAction) {
      const action =
        typeof cardModerationAction.action === 'string' ? cardModerationAction.action.trim() : '';
      if (action !== 'reject' && action !== 'set_public_status') {
        return json({ error: 'cardModerationAction.action 无效' }, { status: 400 });
      }
      if (action === 'set_public_status' && cardModerationAction.value !== 0 && cardModerationAction.value !== -1) {
        return json({ error: 'cardModerationAction.value 无效' }, { status: 400 });
      }
      if (nextStatus !== 'resolved' || !resolutionCode || !resolvedResolutionCodes.has(resolutionCode)) {
        return json({ error: '当前处理结论不允许附带数据卡处罚' }, { status: 400 });
      }
    }

    try {
      const result = await (deps.decideAdminReportCase ?? defaultDeps.decideAdminReportCase)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        caseId,
        adminUserId: auth.user.id,
        nextStatus: nextStatus as 'resolved' | 'dismissed' | 'under_review',
        resolutionCode,
        resolutionNote: typeof payload.data?.resolutionNote === 'string' ? payload.data.resolutionNote : null,
        notifyCreator: payload.data?.notifyCreator === true,
        creatorMessageReason:
          typeof payload.data?.creatorMessageReason === 'string' ? payload.data.creatorMessageReason : null,
        cardModerationAction: cardModerationAction
          ? {
              action: cardModerationAction.action as 'reject' | 'set_public_status',
              value:
                cardModerationAction.value === 0 || cardModerationAction.value === -1
                  ? (cardModerationAction.value as 0 | -1)
                  : undefined,
              messageOptions: (() => {
                const messageOptions =
                  cardModerationAction.messageOptions &&
                  typeof cardModerationAction.messageOptions === 'object' &&
                  !Array.isArray(cardModerationAction.messageOptions)
                    ? (cardModerationAction.messageOptions as Record<string, unknown>)
                    : null;
                if (!messageOptions) {
                  return undefined;
                }
                return {
                  send: messageOptions.send === true,
                  defaultReason: typeof messageOptions.defaultReason === 'string' ? messageOptions.defaultReason : null,
                };
              })(),
            }
          : null,
      });
      return json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createAdminReportCaseDecisionHandler());
