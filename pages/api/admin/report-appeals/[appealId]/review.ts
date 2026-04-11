import type { ReportAppealResolutionCode } from '@/lib/db/schema';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import {
  reviewReportAppeal,
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
  reviewReportAppeal: typeof reviewReportAppeal;
};

type HandlerContext = {
  params?: {
    appealId?: string;
  };
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

const allowedResolutionCodes = new Set<ReportAppealResolutionCode>([
  'upheld',
  'overturned_no_violation',
  'reopened_under_review',
]);

const getAppealId = (req: Request, context?: HandlerContext): string => {
  const fromContext = context?.params?.appealId?.trim();
  if (fromContext) return fromContext;

  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const reviewIndex = parts.lastIndexOf('review');
  if (reviewIndex <= 0) return '';
  return parts[reviewIndex - 1] ?? '';
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

export const createAdminReportAppealReviewHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request, context?: HandlerContext): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    const appealId = getAppealId(req, context);
    if (!appealId) {
      return json({ error: '缺少 appealId' }, { status: 400 });
    }

    const payload = await readJson<Record<string, unknown>>(req);
    if ('response' in payload) return payload.response;

    const resolutionCode =
      typeof payload.data?.resolutionCode === 'string' ? payload.data.resolutionCode.trim() : '';
    const resolutionNote =
      typeof payload.data?.resolutionNote === 'string' ? payload.data.resolutionNote : null;

    if (!resolutionCode || !allowedResolutionCodes.has(resolutionCode as ReportAppealResolutionCode)) {
      return json({ error: 'resolutionCode 无效' }, { status: 400 });
    }

    try {
      const result = await (deps.reviewReportAppeal ?? defaultDeps.reviewReportAppeal)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        adminUserId: auth.user.id,
        appealId,
        resolutionCode: resolutionCode as ReportAppealResolutionCode,
        resolutionNote,
      });
      return json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createAdminReportAppealReviewHandler());
