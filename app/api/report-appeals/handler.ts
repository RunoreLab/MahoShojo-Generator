import { getRequestUrl } from '@/lib/request-url';
import { listMyReportAppeals, submitReportAppeal, ReportAppealConflictError, ReportAppealForbiddenError, ReportAppealNotFoundError, ReportAppealServiceUnavailableError, ReportAppealUnprocessableError, ReportAppealValidationError } from '@/lib/report-appeals/service';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { ReportAppealReferenceDraft } from '@/lib/report-appeals/types';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  listMyReportAppeals: typeof listMyReportAppeals;
  submitReportAppeal: typeof submitReportAppeal;
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  listMyReportAppeals,
  submitReportAppeal,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof ReportAppealValidationError) return json({ error: error.message }, { status: 400 });
  if (error instanceof ReportAppealForbiddenError) return json({ error: error.message }, { status: 403 });
  if (error instanceof ReportAppealNotFoundError) return json({ error: error.message }, { status: 404 });
  if (error instanceof ReportAppealConflictError) return json({ error: error.message }, { status: 409 });
  if (error instanceof ReportAppealUnprocessableError) return json({ error: error.message }, { status: 422 });
  if (error instanceof ReportAppealServiceUnavailableError) return json({ error: error.message }, { status: 503 });
  return null;
};

const parseSubmitBody = async (
  req: Request,
): Promise<
  | {
      reportCaseId: string;
      caseUpdatedAtSnapshot: string;
      appealReasonCode: string;
      details: string;
      references: ReportAppealReferenceDraft[];
    }
  | { response: Response }
> => {
  const payload = await readJson<Record<string, unknown>>(req);
  if ('response' in payload) return payload;
  if (!isRecord(payload.data)) return { response: json({ error: '请求体格式无效' }, { status: 400 }) };

  const body = payload.data;
  const reportCaseId = typeof body.reportCaseId === 'string' ? body.reportCaseId.trim() : '';
  const caseUpdatedAtSnapshot =
    typeof body.caseUpdatedAtSnapshot === 'string' ? body.caseUpdatedAtSnapshot.trim() : '';
  const appealReasonCode = typeof body.appealReasonCode === 'string' ? body.appealReasonCode.trim() : '';
  const details = typeof body.details === 'string' ? body.details : '';
  const references = Array.isArray(body.references) ? (body.references as ReportAppealReferenceDraft[]) : [];

  if (!reportCaseId) return { response: json({ error: '缺少 reportCaseId' }, { status: 400 }) };
  if (!caseUpdatedAtSnapshot) return { response: json({ error: '缺少 caseUpdatedAtSnapshot' }, { status: 400 }) };
  if (!appealReasonCode) return { response: json({ error: '缺少 appealReasonCode' }, { status: 400 }) };
  if (!details.trim()) return { response: json({ error: 'details 不能为空' }, { status: 400 }) };

  return { reportCaseId, caseUpdatedAtSnapshot, appealReasonCode, details, references };
};

export const createReportAppealsHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    if (req.method === 'GET') {
      const url = getRequestUrl(req);
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
      try {
        const payload = await (deps.listMyReportAppeals ?? defaultDeps.listMyReportAppeals)({
          db: deps.getDb ? deps.getDb() : await getDefaultDb(),
          userId: auth.user.id,
          limit: Number.isFinite(limit) ? limit : 20,
        });
        return json(payload, { headers: { 'Cache-Control': 'no-store' } });
      } catch (error) {
        const response = toErrorResponse(error);
        if (response) return response;
        throw error;
      }
    }

    if (req.method === 'POST') {
      const parsed = await parseSubmitBody(req);
      if ('response' in parsed) return parsed.response;

      try {
        const payload = await (deps.submitReportAppeal ?? defaultDeps.submitReportAppeal)({
          db: deps.getDb ? deps.getDb() : await getDefaultDb(),
          userId: auth.user.id,
          reportCaseId: parsed.reportCaseId,
          caseUpdatedAtSnapshot: parsed.caseUpdatedAtSnapshot,
          appealReasonCode: parsed.appealReasonCode as any,
          details: parsed.details,
          references: parsed.references,
        });
        return json(payload, { headers: { 'Cache-Control': 'no-store' } });
      } catch (error) {
        const response = toErrorResponse(error);
        if (response) return response;
        throw error;
      }
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  };

export const appRouteHandler = withPvpErrorBoundary(createReportAppealsHandler());
export default appRouteHandler;
