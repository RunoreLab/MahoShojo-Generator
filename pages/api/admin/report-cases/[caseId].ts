import {
  getAdminReportCaseDetail,
  AdminGovernanceNotFoundError,
  AdminGovernanceServiceUnavailableError,
  AdminGovernanceValidationError,
} from '@/lib/admin/governance';
import { json, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  getAdminReportCaseDetail: typeof getAdminReportCaseDetail;
};

type HandlerContext = {
  params?: {
    caseId?: string;
  };
};

const defaultDeps: HandlerDeps = {
  getAdminReportCaseDetail,
};

const getCaseId = (req: Request, context?: HandlerContext): string => {
  const fromContext = context?.params?.caseId?.trim();
  if (fromContext) return fromContext;

  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
};

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof AdminGovernanceValidationError) return json({ error: error.message }, { status: 400 });
  if (error instanceof AdminGovernanceNotFoundError) return json({ error: error.message }, { status: 404 });
  if (error instanceof AdminGovernanceServiceUnavailableError) return json({ error: error.message }, { status: 503 });
  return null;
};

export const createAdminReportCaseDetailHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request, context?: HandlerContext): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const caseId = getCaseId(req, context);
    if (!caseId) {
      return json({ error: '缺少 caseId' }, { status: 400 });
    }

    try {
      const detail = await (deps.getAdminReportCaseDetail ?? defaultDeps.getAdminReportCaseDetail)(caseId);
      if (!detail) {
        return json({ error: '举报案件不存在' }, { status: 404 });
      }
      return json(detail, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createAdminReportCaseDetailHandler());
