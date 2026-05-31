import {
  InvalidMessageCursorError,
  decodeMessageCursor,
} from '@/lib/messages/cursor';
import {
  type MessageServiceDb,
  MessagesServiceUnavailableError,
  UnauthorizedMessagesFilterError,
  listMessages,
} from '@/lib/messages/service';
import { getAuthUser, json, withPvpErrorBoundary } from '@/lib/pvp/server';

type HandlerDeps = {
  getAuthUser: typeof getAuthUser;
  getDb: () => MessageServiceDb;
  listMessages: typeof listMessages;
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const defaultDeps: HandlerDeps = {
  getAuthUser,
  getDb: () => null,
  listMessages,
};

const parseFilter = (value: string | null): 'all' | 'unread' | 'site' | 'direct' => {
  if (value == null || value === 'all') return 'all';
  if (value === 'unread' || value === 'site' || value === 'direct') return value;
  throw new InvalidMessageCursorError('消息筛选参数无效');
};

const parseLimit = (value: string | null): number => {
  if (value == null) return 20;
  if (!/^\d+$/.test(value)) {
    throw new InvalidMessageCursorError('limit 必须是正整数');
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidMessageCursorError('limit 必须大于 0');
  }

  return Math.min(parsed, 50);
};

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof InvalidMessageCursorError) {
    return json({ error: error.message }, { status: 400 });
  }
  if (error instanceof UnauthorizedMessagesFilterError) {
    return json({ error: error.message }, { status: 401 });
  }
  if (error instanceof MessagesServiceUnavailableError) {
    return json({ error: error.message }, { status: 503 });
  }

  return null;
};

export const createMessagesHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      const url = new URL(req.url);
      const filter = parseFilter(url.searchParams.get('filter'));
      const limit = parseLimit(url.searchParams.get('limit'));
      const cursor = decodeMessageCursor(url.searchParams.get('cursor'));
      const auth = await (deps.getAuthUser ?? defaultDeps.getAuthUser)(req);

      if (!auth && (filter === 'direct' || filter === 'unread')) {
        return json({ error: '登录后才能查看该消息筛选' }, { status: 401 });
      }

      const payload = await (deps.listMessages ?? defaultDeps.listMessages)({
        db: deps.getDb ? deps.getDb() : await getDefaultDb(),
        userId: auth?.user.id ?? null,
        filter,
        limit,
        cursor,
      });

      return json(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) {
        return response;
      }
      throw error;
    }
  };

export default withPvpErrorBoundary(createMessagesHandler());
