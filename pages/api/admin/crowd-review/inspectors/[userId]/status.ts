import {
  AdminGovernanceConflictError,
  AdminGovernanceNotFoundError,
  AdminGovernanceServiceUnavailableError,
  AdminGovernanceValidationError,
  updateAdminCrowdReviewInspectorStatus,
} from '@/lib/admin/governance';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => any;
  updateAdminCrowdReviewInspectorStatus: typeof updateAdminCrowdReviewInspectorStatus;
};

type HandlerContext = {
  params?: {
    userId?: string;
  };
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  updateAdminCrowdReviewInspectorStatus,
};

const allowedStatuses = new Set(['active', 'suspended', 'revoked']);

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const getUserId = (req: Request, context?: HandlerContext): number => {
  const raw = context?.params?.userId?.trim() ?? '';
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);

  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const statusIndex = parts.lastIndexOf('status');
  const value = statusIndex > 0 ? parts[statusIndex - 1] ?? '' : '';
  return /^\d+$/.test(value) ? Number.parseInt(value, 10) : 0;
};

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof AdminGovernanceValidationError) return json({ error: error.message }, { status: 400 });
  if (error instanceof AdminGovernanceNotFoundError) return json({ error: error.message }, { status: 404 });
  if (error instanceof AdminGovernanceConflictError) return json({ error: error.message }, { status: 409 });
  if (error instanceof AdminGovernanceServiceUnavailableError) return json({ error: error.message }, { status: 503 });
  return null;
};

export const createAdminCrowdReviewInspectorStatusHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request, context?: HandlerContext): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    const userId = getUserId(req, context);
    if (!Number.isInteger(userId) || userId <= 0) {
      return json({ error: 'userId 无效' }, { status: 400 });
    }

    const payload = await readJson<Record<string, unknown>>(req);
    if ('response' in payload) return payload.response;

    const nextStatus =
      typeof payload.data?.nextStatus === 'string' ? payload.data.nextStatus.trim() : '';
    if (!allowedStatuses.has(nextStatus)) {
      return json({ error: 'nextStatus 无效' }, { status: 400 });
    }

    try {
      const result = await (
        deps.updateAdminCrowdReviewInspectorStatus ?? defaultDeps.updateAdminCrowdReviewInspectorStatus
      )({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        userId,
        adminUserId: auth.user.id,
        nextStatus: nextStatus as 'active' | 'suspended' | 'revoked',
        reasonCode: typeof payload.data?.reasonCode === 'string' ? payload.data.reasonCode : null,
        reasonDetail: typeof payload.data?.reasonDetail === 'string' ? payload.data.reasonDetail : null,
        suspendedUntil: typeof payload.data?.suspendedUntil === 'string' ? payload.data.suspendedUntil : null,
      });
      return json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createAdminCrowdReviewInspectorStatusHandler());
