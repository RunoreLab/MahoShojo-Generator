import { getCrowdReviewSummary } from '@/lib/crowd-review/service';
import type { CrowdReviewSummaryDto } from '@/lib/crowd-review/types';
import { getAuthUser, json, withPvpErrorBoundary } from '@/lib/pvp/server';

type HandlerDeps = {
  getAuthUser: typeof getAuthUser;
  getDb: () => any;
  getCrowdReviewSummary: typeof getCrowdReviewSummary;
};

const defaultDeps: HandlerDeps = {
  getAuthUser,
  getDb: () => null,
  getCrowdReviewSummary,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof Error && error.name === 'CrowdReviewServiceUnavailableError') {
    return json({ error: error.message }, { status: 503 });
  }
  return null;
};

export const createCrowdReviewSummaryHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      const auth = await (deps.getAuthUser ?? defaultDeps.getAuthUser)(req);
      const payload: CrowdReviewSummaryDto = await (deps.getCrowdReviewSummary ?? defaultDeps.getCrowdReviewSummary)({
        db: auth ? (deps.getDb ? deps.getDb() : await getDefaultDb()) : null,
        userId: auth?.user.id ?? null,
      });

      return json(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export const appRouteHandler = withPvpErrorBoundary(createCrowdReviewSummaryHandler());
export default appRouteHandler;
