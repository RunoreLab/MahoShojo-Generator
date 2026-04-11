import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import {
  getReportAppealForAdmin,
  ReportAppealConflictError,
  ReportAppealForbiddenError,
  ReportAppealNotFoundError,
  ReportAppealServiceUnavailableError,
  ReportAppealUnprocessableError,
  ReportAppealValidationError,
} from '@/lib/report-appeals/service';

export const runtime = 'edge';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  getReportAppealForAdmin: typeof getReportAppealForAdmin;
};

type HandlerContext = {
  params?: {
    appealId?: string;
  };
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  getReportAppealForAdmin,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const getAppealId = (req: Request, context?: HandlerContext): string => {
  const fromContext = context?.params?.appealId?.trim();
  if (fromContext) return fromContext;

  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
};

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof ReportAppealValidationError) return json({ error: error.message }, { status: 400 });
  if (error instanceof ReportAppealForbiddenError) return json({ error: error.message }, { status: 403 });
  if (error instanceof ReportAppealNotFoundError) return json({ error: error.message }, { status: 404 });
  if (error instanceof ReportAppealConflictError) return json({ error: error.message }, { status: 409 });
  if (error instanceof ReportAppealUnprocessableError) return json({ error: error.message }, { status: 422 });
  if (error instanceof ReportAppealServiceUnavailableError) return json({ error: error.message }, { status: 503 });
  return null;
};

export const createAdminReportAppealDetailHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request, context?: HandlerContext): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    const appealId = getAppealId(req, context);
    if (!appealId) {
      return json({ error: '缺少 appealId' }, { status: 400 });
    }

    try {
      const payload = await (deps.getReportAppealForAdmin ?? defaultDeps.getReportAppealForAdmin)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        adminUserId: auth.user.id,
        appealId,
      });
      return json(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createAdminReportAppealDetailHandler());
