import { overrideAdminCrowdReviewRound } from '@/lib/admin/crowd-review';
import {
  AdminGovernanceConflictError,
  AdminGovernanceNotFoundError,
  AdminGovernanceServiceUnavailableError,
  AdminGovernanceValidationError,
} from '@/lib/admin/governance';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  overrideAdminCrowdReviewRound: typeof overrideAdminCrowdReviewRound;
};

type HandlerContext = {
  params?: {
    roundId?: string;
  };
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  overrideAdminCrowdReviewRound,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const getRoundId = (req: Request, context?: HandlerContext): string => {
  const fromContext = context?.params?.roundId?.trim();
  if (fromContext) return fromContext;

  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const actionIndex = parts.lastIndexOf('override');
  if (actionIndex <= 0) return '';
  return parts[actionIndex - 1] ?? '';
};

const isAdminUser = (user: { is_admin?: number | null }): boolean => user.is_admin === 1;

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof AdminGovernanceValidationError) return json({ error: error.message }, { status: 400 });
  if (error instanceof AdminGovernanceNotFoundError) return json({ error: error.message }, { status: 404 });
  if (error instanceof AdminGovernanceConflictError) return json({ error: error.message }, { status: 409 });
  if (error instanceof AdminGovernanceServiceUnavailableError) return json({ error: error.message }, { status: 503 });
  return null;
};

const isCaseDecision = (value: string): value is 'violation' | 'no_violation' | 'reopen_under_review' =>
  value === 'violation' || value === 'no_violation' || value === 'reopen_under_review';

export const createAdminCrowdReviewRoundOverrideHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request, context?: HandlerContext): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;
    if (!isAdminUser(auth.user)) {
      return json({ error: '需要管理员权限' }, { status: 403 });
    }

    const roundId = getRoundId(req, context);
    if (!roundId) {
      return json({ error: '缺少 roundId' }, { status: 400 });
    }

    const payload = await readJson<Record<string, unknown>>(req);
    if ('response' in payload) return payload.response;

    const caseDecision = typeof payload.data?.caseDecision === 'string' ? payload.data.caseDecision.trim() : '';
    if (!isCaseDecision(caseDecision)) {
      return json({ error: 'caseDecision 无效' }, { status: 400 });
    }

    try {
      const result = await (
        deps.overrideAdminCrowdReviewRound ?? defaultDeps.overrideAdminCrowdReviewRound
      )({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        roundId,
        adminUserId: auth.user.id,
        caseDecision,
        reasonDetail: typeof payload.data?.reasonDetail === 'string' ? payload.data.reasonDetail : null,
      });
      return json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createAdminCrowdReviewRoundOverrideHandler());
