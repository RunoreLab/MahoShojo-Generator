import { listAdminCrowdReviewCases } from '@/lib/admin/governance';
import { json, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  listAdminCrowdReviewCases: typeof listAdminCrowdReviewCases;
};

const defaultDeps: HandlerDeps = {
  listAdminCrowdReviewCases,
};

export const createAdminCrowdReviewCasesHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const url = new URL(req.url);
    const statusRaw = url.searchParams.get('status');
    const status =
      statusRaw === 'pending_dispatch' ||
      statusRaw === 'active' ||
      statusRaw === 'waiting_more_votes' ||
      statusRaw === 'concluded' ||
      statusRaw === 'escalated' ||
      statusRaw === 'cancelled'
        ? statusRaw
        : undefined;
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);

    const payload = await (deps.listAdminCrowdReviewCases ?? defaultDeps.listAdminCrowdReviewCases)({
      status,
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    });
    return json(payload, { headers: { 'Cache-Control': 'no-store' } });
  };

export default withPvpErrorBoundary(createAdminCrowdReviewCasesHandler());
