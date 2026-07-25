import { createAdminSiteMessage } from '@/lib/admin/messages';
import { getAuthUser, json, readJson, withPvpErrorBoundary } from '@/lib/pvp/server';
import type { MessagePriority } from '@/lib/messages/types';

export const runtime = 'edge';

type HandlerDeps = {
  getAuthUser: typeof getAuthUser;
  getDb: () => any;
  createAdminSiteMessage: typeof createAdminSiteMessage;
};

const defaultDeps: HandlerDeps = {
  getAuthUser,
  getDb: () => null,
  createAdminSiteMessage,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const allowedPriority = new Set<MessagePriority>(['low', 'normal', 'high']);

export const createAdminSiteMessagesHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const payload = await readJson<Record<string, unknown>>(req);
    if ('response' in payload) return payload.response;

    const messageType = typeof payload.data?.messageType === 'string' ? payload.data.messageType.trim() : '';
    const templateKey = typeof payload.data?.templateKey === 'string' ? payload.data.templateKey.trim() : '';
    const rawPriority = typeof payload.data?.priority === 'string' ? payload.data.priority.trim() : '';
    const priority = allowedPriority.has(rawPriority as MessagePriority) ? (rawPriority as MessagePriority) : 'normal';
    const auth = await (deps.getAuthUser ?? defaultDeps.getAuthUser)(req);

    if (!messageType || !templateKey) {
      return json({ error: '缺少 messageType 或 templateKey' }, { status: 400 });
    }

    const result = await (deps.createAdminSiteMessage ?? defaultDeps.createAdminSiteMessage)({
      db: deps.getDb ? deps.getDb() : await getDefaultDb(),
      actorUserId: auth?.user.id ?? null,
      messageType,
      templateKey,
      payload:
        payload.data?.payload && typeof payload.data.payload === 'object' && !Array.isArray(payload.data.payload)
          ? (payload.data.payload as Record<string, unknown>)
          : {},
      titleText: typeof payload.data?.titleText === 'string' ? payload.data.titleText : null,
      bodyText: typeof payload.data?.bodyText === 'string' ? payload.data.bodyText : null,
      actionUrl: typeof payload.data?.actionUrl === 'string' ? payload.data.actionUrl : null,
      priority,
      expiresAt: typeof payload.data?.expiresAt === 'string' ? payload.data.expiresAt : null,
    });

    return json(result, { headers: { 'Cache-Control': 'no-store' } });
  };

export default withPvpErrorBoundary(createAdminSiteMessagesHandler());
