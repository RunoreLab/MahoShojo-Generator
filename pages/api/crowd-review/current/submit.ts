import {
  CrowdReviewConflictError,
  CrowdReviewForbiddenError,
  CrowdReviewNotFoundError,
  CrowdReviewServiceUnavailableError,
  submitCrowdReviewDecision,
} from '@/lib/crowd-review/service';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  submitCrowdReviewDecision: typeof submitCrowdReviewDecision;
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  submitCrowdReviewDecision,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const isDecision = (value: unknown): value is 'violation' | 'no_violation' | 'abstain' =>
  value === 'violation' || value === 'no_violation' || value === 'abstain';

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

export const createCrowdReviewCurrentSubmitHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    const parsed = await readJson<Record<string, unknown>>(req);
    if ('response' in parsed) return parsed.response;
    const assignmentId = typeof parsed.data.assignmentId === 'string' ? parsed.data.assignmentId.trim() : '';
    const decision = parsed.data.decision;
    const note = typeof parsed.data.note === 'string' ? parsed.data.note : null;

    if (!assignmentId) {
      return json({ error: '缺少 assignmentId' }, { status: 400 });
    }
    if (!isDecision(decision)) {
      return json({ error: 'decision 非法' }, { status: 400 });
    }

    try {
      const payload = await (deps.submitCrowdReviewDecision ?? defaultDeps.submitCrowdReviewDecision)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        userId: auth.user.id,
        assignmentId,
        decision,
        note,
      });

      return json(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createCrowdReviewCurrentSubmitHandler());
