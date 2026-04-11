import type { ReportAppealStatus } from '@/lib/db/schema';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import {
  listReportAppealsForAdmin,
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
  listReportAppealsForAdmin: typeof listReportAppealsForAdmin;
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  listReportAppealsForAdmin,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const parseStatus = (value: string | null): ReportAppealStatus | undefined => {
  if (!value) return undefined;
  if (value === 'submitted' || value === 'under_review' || value === 'resolved' || value === 'withdrawn') {
    return value;
  }
  throw new ReportAppealValidationError('申诉状态筛选无效');
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

export const createAdminReportAppealsHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    try {
      const url = new URL(req.url);
      const status = parseStatus(url.searchParams.get('status'));
      const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 50;
      const payload = await (deps.listReportAppealsForAdmin ?? defaultDeps.listReportAppealsForAdmin)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        adminUserId: auth.user.id,
        status,
        limit,
      });
      return json(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createAdminReportAppealsHandler());
