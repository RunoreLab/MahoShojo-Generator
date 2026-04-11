import { type MessageServiceDb, MessagesServiceUnavailableError, getMessageSummary } from '@/lib/messages/service';
import { getAuthUser, json, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  getAuthUser: typeof getAuthUser;
  getDb: () => MessageServiceDb;
  getMessageSummary: typeof getMessageSummary;
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

const defaultDeps: HandlerDeps = {
  getAuthUser,
  getDb: () => null,
  getMessageSummary,
};

export const createMessagesSummaryHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.getAuthUser ?? defaultDeps.getAuthUser)(req);
    if (!auth) {
      return json(
        {
          unreadTotal: 0,
          siteUnread: 0,
          directUnread: 0,
          latest: null,
          fetchedAt: new Date().toISOString(),
          isAuthenticated: false,
          hasCrowdReviewPending: false,
          crowdReviewPrompt: null,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    try {
      const payload = await (deps.getMessageSummary ?? defaultDeps.getMessageSummary)({
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

export default withPvpErrorBoundary(createMessagesSummaryHandler());
