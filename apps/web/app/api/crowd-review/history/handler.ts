import {
  CrowdReviewForbiddenError,
  CrowdReviewServiceUnavailableError,
  listCrowdReviewHistory,
} from '@/lib/crowd-review/service';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  listCrowdReviewHistory: typeof listCrowdReviewHistory;
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  listCrowdReviewHistory,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof CrowdReviewForbiddenError) {
    return json({ error: error.message }, { status: 403 });
  }
  if (error instanceof CrowdReviewServiceUnavailableError) {
    return json({ error: error.message }, { status: 503 });
  }
  return null;
};

export const createCrowdReviewHistoryHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    try {
      const payload = await (deps.listCrowdReviewHistory ?? defaultDeps.listCrowdReviewHistory)({
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

export const appRouteHandler = withPvpErrorBoundary(createCrowdReviewHistoryHandler());
export default appRouteHandler;
