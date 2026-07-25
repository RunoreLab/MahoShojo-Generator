import { listAdminCrowdReviewInspectors } from '@/lib/admin/governance';
import { json, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  listAdminCrowdReviewInspectors: typeof listAdminCrowdReviewInspectors;
};

const defaultDeps: HandlerDeps = {
  listAdminCrowdReviewInspectors,
};

export const createAdminCrowdReviewInspectorsHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const url = new URL(req.url);
    const statusRaw = url.searchParams.get('status');
    const status =
      statusRaw === 'active' || statusRaw === 'suspended' || statusRaw === 'revoked'
        ? statusRaw
        : undefined;
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);

    const payload = await (deps.listAdminCrowdReviewInspectors ?? defaultDeps.listAdminCrowdReviewInspectors)({
      status,
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    });
    return json(payload, { headers: { 'Cache-Control': 'no-store' } });
  };

export default withPvpErrorBoundary(createAdminCrowdReviewInspectorsHandler());
