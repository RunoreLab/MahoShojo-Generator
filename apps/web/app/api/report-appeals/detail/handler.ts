import { getRequestUrl } from '@/lib/request-url';
import { getReportAppealDetail, ReportAppealForbiddenError, ReportAppealNotFoundError, ReportAppealServiceUnavailableError, ReportAppealUnprocessableError, ReportAppealValidationError } from '@/lib/report-appeals/service';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  getReportAppealDetail: typeof getReportAppealDetail;
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  getReportAppealDetail,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof ReportAppealValidationError) return json({ error: error.message }, { status: 400 });
  if (error instanceof ReportAppealForbiddenError) return json({ error: error.message }, { status: 403 });
  if (error instanceof ReportAppealNotFoundError) return json({ error: error.message }, { status: 404 });
  if (error instanceof ReportAppealUnprocessableError) return json({ error: error.message }, { status: 422 });
  if (error instanceof ReportAppealServiceUnavailableError) return json({ error: error.message }, { status: 503 });
  return null;
};

export const createReportAppealDetailHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    const appealId = getRequestUrl(req).searchParams.get('appealId')?.trim() ?? '';
    if (!appealId) {
      return json({ error: '缺少 appealId' }, { status: 400 });
    }

    try {
      const payload = await (deps.getReportAppealDetail ?? defaultDeps.getReportAppealDetail)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        userId: auth.user.id,
        appealId,
      });
      return json(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export const appRouteHandler = withPvpErrorBoundary(createReportAppealDetailHandler());
export default appRouteHandler;
