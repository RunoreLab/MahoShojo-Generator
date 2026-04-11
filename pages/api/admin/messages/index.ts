import { getAuthUser, json, withPvpErrorBoundary } from '@/lib/pvp/server';
import { listAdminMessages, type AdminMessageScope } from '@/lib/admin/messages';

export const runtime = 'edge';

type HandlerDeps = {
  getAuthUser: typeof getAuthUser;
  getDb: () => any;
  listAdminMessages: typeof listAdminMessages;
};

const defaultDeps: HandlerDeps = {
  getAuthUser,
  getDb: () => null,
  listAdminMessages,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const parseScope = (value: string | null): AdminMessageScope => {
  if (!value || value === 'all') return 'all';
  if (value === 'site' || value === 'direct') return value;
  throw new Error('scope 无效');
};

export const createAdminMessagesHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      const url = new URL(req.url);
      const scope = parseScope(url.searchParams.get('scope'));
      const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
      const recipientUserIdRaw = url.searchParams.get('recipientUserId');
      const auth = await (deps.getAuthUser ?? defaultDeps.getAuthUser)(req);
      const payload = await (deps.listAdminMessages ?? defaultDeps.listAdminMessages)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        scope,
        templateKey: url.searchParams.get('templateKey')?.trim() || undefined,
        messageType: url.searchParams.get('messageType')?.trim() || undefined,
        recipientUserId:
          recipientUserIdRaw && /^\d+$/.test(recipientUserIdRaw)
            ? Number.parseInt(recipientUserIdRaw, 10)
            : undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : 20,
      });
      return json(
        {
          ...payload,
          actorUserId: auth?.user.id ?? null,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : '获取消息列表失败' },
        { status: 400 },
      );
    }
  };

export default withPvpErrorBoundary(createAdminMessagesHandler());
