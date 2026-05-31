import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getAuthMigrationStatusByBusinessUserId } from '@/lib/db/repositories/user-auth-links';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const db = getDrizzleDbFromRuntime();
  if (!db) return json({ error: '数据库不可用，请稍后重试' }, { status: 503 });

  const status = await getAuthMigrationStatusByBusinessUserId(db, auth.user.id);
  const migrationRequired = !status.hasAuthLink || !status.hasPassword;
  const legacyOnly = auth.source === 'legacy-bearer' || migrationRequired;

  return json(
    {
      success: true,
      status: {
        ...status,
        authSource: auth.source,
        migrationRequired,
        legacyOnly,
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
});
