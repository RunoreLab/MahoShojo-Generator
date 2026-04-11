import {
  getAdminCrowdReviewCaseDetail,
  AdminGovernanceNotFoundError,
  AdminGovernanceServiceUnavailableError,
  AdminGovernanceValidationError,
} from '@/lib/admin/governance';
import { json, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  getAdminCrowdReviewCaseDetail: typeof getAdminCrowdReviewCaseDetail;
};

type HandlerContext = {
  params?: {
    roundId?: string;
  };
};

const defaultDeps: HandlerDeps = {
  getAdminCrowdReviewCaseDetail,
};

const getRoundId = (req: Request, context?: HandlerContext): string => {
  const fromContext = context?.params?.roundId?.trim();
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

export const createAdminCrowdReviewCaseDetailHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request, context?: HandlerContext): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const roundId = getRoundId(req, context);
    if (!roundId) {
      return json({ error: '缺少 roundId' }, { status: 400 });
    }

    try {
      const detail = await (deps.getAdminCrowdReviewCaseDetail ?? defaultDeps.getAdminCrowdReviewCaseDetail)(roundId);
      if (!detail) {
        return json({ error: '众查轮次不存在' }, { status: 404 });
      }
      return json(detail, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createAdminCrowdReviewCaseDetailHandler());
