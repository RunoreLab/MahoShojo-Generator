import { reviewReportAppeal, ReportAppealConflictError, ReportAppealForbiddenError, ReportAppealNotFoundError, ReportAppealServiceUnavailableError, ReportAppealUnprocessableError, ReportAppealValidationError } from '@/lib/report-appeals/service';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  reviewReportAppeal: typeof reviewReportAppeal;
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  reviewReportAppeal,
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

const requireAdmin = async (
  req: Request,
  deps: Partial<HandlerDeps>,
): Promise<{ user: { id: number; is_admin: number } } | { response: Response }> => {
  const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
  if ('response' in auth) return auth;
  if (auth.user.is_admin !== 1) {
    return { response: json({ error: '仅管理员可访问' }, { status: 403 }) };
  }
  return auth as any;
};

export const createReportAppealAdminReviewHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request, context?: { params?: { appealId?: string } }): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await requireAdmin(req, deps);
    if ('response' in auth) return auth.response;

    const appealId = context?.params?.appealId?.trim() ?? '';
    if (!appealId) {
      return json({ error: '缺少 appealId' }, { status: 400 });
    }

    const payload = await readJson<Record<string, unknown>>(req);
    if ('response' in payload) return payload.response;
    const resolutionCode =
      typeof payload.data?.resolutionCode === 'string' ? payload.data.resolutionCode.trim() : '';
    const resolutionNote =
      typeof payload.data?.resolutionNote === 'string' ? payload.data.resolutionNote : null;
    if (!resolutionCode) {
      return json({ error: '缺少 resolutionCode' }, { status: 400 });
    }

    try {
      const result = await (deps.reviewReportAppeal ?? defaultDeps.reviewReportAppeal)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        adminUserId: auth.user.id,
        appealId,
        resolutionCode: resolutionCode as any,
        resolutionNote,
      });
      return json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createReportAppealAdminReviewHandler());
