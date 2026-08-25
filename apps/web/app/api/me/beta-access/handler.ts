import { getUserProfileCardDataStats } from '@/lib/database/data-cards';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

const handler = withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const stats = await getUserProfileCardDataStats(auth.user.id);

  return json(
    {
      success: true,
      stats: {
        publicCards: stats.publicCards ?? 0,
        publicUsageTotal: stats.publicUsageTotal ?? 0,
        publicFavoriteTotal: stats.publicFavoriteTotal ?? 0,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});

export const appRouteHandler = handler;
export default appRouteHandler;
