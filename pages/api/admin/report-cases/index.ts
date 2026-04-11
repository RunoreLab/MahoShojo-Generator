import { listAdminReportCases } from '@/lib/admin/governance';
import { json, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  listAdminReportCases: typeof listAdminReportCases;
};

const defaultDeps: HandlerDeps = {
  listAdminReportCases,
};

export const createAdminReportCasesHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const url = new URL(req.url);
    const statusRaw = url.searchParams.get('status');
    const status =
      statusRaw === 'open' ||
      statusRaw === 'under_review' ||
      statusRaw === 'resolved' ||
      statusRaw === 'dismissed'
        ? statusRaw
        : undefined;
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);

    const payload = await (deps.listAdminReportCases ?? defaultDeps.listAdminReportCases)({
      status,
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    });
    return json(payload, { headers: { 'Cache-Control': 'no-store' } });
  };

export default withPvpErrorBoundary(createAdminReportCasesHandler());
