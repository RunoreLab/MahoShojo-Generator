import { type MessageServiceDb, MessagesServiceUnavailableError, markAllMessagesRead } from '@/lib/messages/service';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

type RequireAuthResult = Awaited<ReturnType<typeof requireAuthUser>> | { user: { id: number } } | Response;

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser | ((req: Request) => Promise<RequireAuthResult>);
  getDb: () => MessageServiceDb;
  markAllMessagesRead: typeof markAllMessagesRead;
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  markAllMessagesRead,
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

export const createMessagesReadAllHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await resolveRequiredAuth(req, deps.requireAuthUser ?? defaultDeps.requireAuthUser);
    if ('response' in auth) {
      return auth.response;
    }

    try {
      const payload = await (deps.markAllMessagesRead ?? defaultDeps.markAllMessagesRead)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        userId: auth.user.id,
      });

      return json(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error instanceof MessagesServiceUnavailableError) {
        return json({ error: error.message }, { status: 503 });
      }
      throw error;
    }
  };

export default withPvpErrorBoundary(createMessagesReadAllHandler());
