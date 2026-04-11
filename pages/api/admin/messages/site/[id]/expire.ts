import { expireAdminSiteMessageNow } from '@/lib/admin/messages';
import { getAuthUser, json, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  getAuthUser: typeof getAuthUser;
  getDb: () => any;
  expireAdminSiteMessageNow: typeof expireAdminSiteMessageNow;
};

type HandlerContext = {
  params?: {
    id?: string;
  };
};

const defaultDeps: HandlerDeps = {
  getAuthUser,
  getDb: () => null,
  expireAdminSiteMessageNow,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const getId = (req: Request, context?: HandlerContext): number | null => {
  const fromContext = context?.params?.id?.trim();
  if (fromContext && /^\d+$/.test(fromContext)) {
    return Number.parseInt(fromContext, 10);
  }

  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const expireIndex = parts.lastIndexOf('expire');
  if (expireIndex <= 1) return null;
  const rawId = parts[expireIndex - 1] ?? '';
  return /^\d+$/.test(rawId) ? Number.parseInt(rawId, 10) : null;
};

export const createAdminMessagesExpireSiteHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request, context?: HandlerContext): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    await (deps.getAuthUser ?? defaultDeps.getAuthUser)(req);

    const id = getId(req, context);
    if (!id) {
      return json({ error: '消息 ID 无效' }, { status: 400 });
    }

    const ok = await (deps.expireAdminSiteMessageNow ?? defaultDeps.expireAdminSiteMessageNow)({
      db: deps.getDb ? deps.getDb() : await getDefaultDb(),
      id,
    });

    if (!ok) {
      return json({ error: '消息不存在' }, { status: 404 });
    }

    return json({ success: true, id }, { headers: { 'Cache-Control': 'no-store' } });
  };

export default withPvpErrorBoundary(createAdminMessagesExpireSiteHandler());
