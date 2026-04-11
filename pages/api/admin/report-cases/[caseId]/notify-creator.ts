import {
  AdminGovernanceConflictError,
  AdminGovernanceNotFoundError,
  AdminGovernanceServiceUnavailableError,
  AdminGovernanceValidationError,
  notifyAdminReportCaseCreator,
} from '@/lib/admin/governance';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  notifyAdminReportCaseCreator: typeof notifyAdminReportCaseCreator;
};

type HandlerContext = {
  params?: {
    caseId?: string;
  };
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  notifyAdminReportCaseCreator,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const getCaseId = (req: Request, context?: HandlerContext): string => {
  const fromContext = context?.params?.caseId?.trim();
  if (fromContext) return fromContext;

  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const notifyIndex = parts.lastIndexOf('notify-creator');
  if (notifyIndex <= 0) return '';
  return parts[notifyIndex - 1] ?? '';
};

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof AdminGovernanceValidationError) return json({ error: error.message }, { status: 400 });
  if (error instanceof AdminGovernanceNotFoundError) return json({ error: error.message }, { status: 404 });
  if (error instanceof AdminGovernanceConflictError) return json({ error: error.message }, { status: 409 });
  if (error instanceof AdminGovernanceServiceUnavailableError) return json({ error: error.message }, { status: 503 });
  return null;
};

export const createAdminReportCaseNotifyCreatorHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request, context?: HandlerContext): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    const caseId = getCaseId(req, context);
    if (!caseId) {
      return json({ error: '缺少 caseId' }, { status: 400 });
    }

    const payload = await readJson<Record<string, unknown>>(req);
    if ('response' in payload) return payload.response;

    try {
      const result = await (deps.notifyAdminReportCaseCreator ?? defaultDeps.notifyAdminReportCaseCreator)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        caseId,
        adminUserId: auth.user.id,
        sendMessage: typeof payload.data?.sendMessage === 'boolean' ? payload.data.sendMessage : true,
        reason: typeof payload.data?.reason === 'string' ? payload.data.reason : null,
      });
      return json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createAdminReportCaseNotifyCreatorHandler());
