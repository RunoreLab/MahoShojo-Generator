import { withdrawReportAppeal, ReportAppealConflictError, ReportAppealForbiddenError, ReportAppealNotFoundError, ReportAppealServiceUnavailableError, ReportAppealUnprocessableError, ReportAppealValidationError } from '@/lib/report-appeals/service';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  withdrawReportAppeal: typeof withdrawReportAppeal;
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  withdrawReportAppeal,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
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

export const createReportAppealWithdrawHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    const payload = await readJson<Record<string, unknown>>(req);
    if ('response' in payload) return payload.response;
    const appealId = typeof payload.data?.appealId === 'string' ? payload.data.appealId.trim() : '';
    if (!appealId) {
      return json({ error: '缺少 appealId' }, { status: 400 });
    }

    try {
      const result = await (deps.withdrawReportAppeal ?? defaultDeps.withdrawReportAppeal)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        userId: auth.user.id,
        appealId,
      });
      return json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export const appRouteHandler = withPvpErrorBoundary(createReportAppealWithdrawHandler());
export default appRouteHandler;
