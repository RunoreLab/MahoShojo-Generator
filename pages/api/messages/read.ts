import {
  InvalidMessageReadRequestError,
  type MessageServiceDb,
  MessagesServiceUnavailableError,
  markMessagesRead,
} from '@/lib/messages/service';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type RequireAuthResult = Awaited<ReturnType<typeof requireAuthUser>> | { user: { id: number } } | Response;

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser | ((req: Request) => Promise<RequireAuthResult>);
  getDb: () => MessageServiceDb;
  markMessagesRead: typeof markMessagesRead;
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: () => null,
  markMessagesRead,
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

const validateIds = (ids: unknown): ids is string[] =>
  Array.isArray(ids) && ids.every((value) => typeof value === 'string' && /^user:[1-9]\d*$/.test(value));

export const createMessagesReadHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await resolveRequiredAuth(req, deps.requireAuthUser ?? defaultDeps.requireAuthUser);
    if ('response' in auth) {
      return auth.response;
    }

    const parsed = await readJson<{ ids?: unknown }>(req);
    if ('response' in parsed) {
      return parsed.response;
    }

    if (!validateIds(parsed.data.ids)) {
      return json({ error: 'ids 必须是 user:* 字符串数组' }, { status: 400 });
    }

    try {
      const payload = await (deps.markMessagesRead ?? defaultDeps.markMessagesRead)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        userId: auth.user.id,
        ids: parsed.data.ids,
      });

      return json(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error instanceof InvalidMessageReadRequestError) {
        return json({ error: error.message }, { status: 400 });
      }
      if (error instanceof MessagesServiceUnavailableError) {
        return json({ error: error.message }, { status: 503 });
      }
      throw error;
    }
  };

export default withPvpErrorBoundary(createMessagesReadHandler());
