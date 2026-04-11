import { type MessageServiceDb, MessagesServiceUnavailableError, markSiteMessagesRead } from '@/lib/messages/service';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type RequireAuthResult = Awaited<ReturnType<typeof requireAuthUser>> | { user: { id: number } } | Response;

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser | ((req: Request) => Promise<RequireAuthResult>);
  getDb: () => MessageServiceDb;
  markSiteMessagesRead: typeof markSiteMessagesRead;
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  markSiteMessagesRead,
};

const resolveRequiredAuth = async (
  req: Request,
  resolver: HandlerDeps['requireAuthUser'],
): Promise<{ user: { id: number } } | { response: Response }> => {
  const result = await resolver(req);
  if (result instanceof Response) {
    return { response: result };
  }
  if ('response' in result) {
    return { response: result.response };
  }
  return { user: result.user };
};

export const createMessagesSiteReadHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await resolveRequiredAuth(req, deps.requireAuthUser ?? defaultDeps.requireAuthUser);
    if ('response' in auth) {
      return auth.response;
    }

    const parsed = await readJson<{ lastReadSiteMessageId?: unknown }>(req);
    if ('response' in parsed) {
      return parsed.response;
    }

    if (
      typeof parsed.data.lastReadSiteMessageId !== 'number' ||
      !Number.isInteger(parsed.data.lastReadSiteMessageId) ||
      parsed.data.lastReadSiteMessageId < 0
    ) {
      return json({ error: 'lastReadSiteMessageId 必须是非负整数' }, { status: 400 });
    }

    try {
      const payload = await (deps.markSiteMessagesRead ?? defaultDeps.markSiteMessagesRead)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        userId: auth.user.id,
        lastReadSiteMessageId: parsed.data.lastReadSiteMessageId,
      });

      return json(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error instanceof MessagesServiceUnavailableError) {
        return json({ error: error.message }, { status: 503 });
      }
      throw error;
    }
  };

export default withPvpErrorBoundary(createMessagesSiteReadHandler());
