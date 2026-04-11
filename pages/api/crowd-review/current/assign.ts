import {
  assignCrowdReviewCurrentCase,
  CrowdReviewConflictError,
  CrowdReviewForbiddenError,
  CrowdReviewNotFoundError,
  CrowdReviewServiceUnavailableError,
} from '@/lib/crowd-review/service';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  assignCrowdReviewCurrentCase: typeof assignCrowdReviewCurrentCase;
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  assignCrowdReviewCurrentCase,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof CrowdReviewForbiddenError) {
    return json({ error: error.message }, { status: 403 });
  }
  if (error instanceof CrowdReviewNotFoundError) {
    return json({ error: error.message }, { status: 404 });
  }
  if (error instanceof CrowdReviewConflictError) {
    return json({ error: error.message }, { status: 409 });
  }
  if (error instanceof CrowdReviewServiceUnavailableError) {
    return json({ error: error.message }, { status: 503 });
  }
  return null;
};

export const createCrowdReviewCurrentAssignHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    try {
      const payload = await (deps.assignCrowdReviewCurrentCase ?? defaultDeps.assignCrowdReviewCurrentCase)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        userId: auth.user.id,
      });

      return json(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createCrowdReviewCurrentAssignHandler());
