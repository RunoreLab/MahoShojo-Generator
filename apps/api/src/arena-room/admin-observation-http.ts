import type { Hono } from 'hono';
import { ADMIN_ARENA_OBSERVATION_PATH, AdminArenaObservationQuerySchema } from '@mahoshojo/contracts/admin-arena-observation';
import { verifyAdminArenaObservationToken } from '@mahoshojo/hosted-runtime/admin/arena-observation';
import type { HonoAppVariables } from '../middleware/request-metadata';
import type { AdminArenaObservationService } from './admin-observation';

export function registerAdminArenaObservationRoute(app: Hono<{ Variables: HonoAppVariables }>, input: { secret: string; service: AdminArenaObservationService }): void {
  app.all(ADMIN_ARENA_OBSERVATION_PATH, async (context) => {
    context.header('Cache-Control', 'no-store');
    if (context.req.method !== 'GET') return context.json({ code: 'METHOD_NOT_ALLOWED' }, 405);
    const authorization = context.req.header('Authorization');
    const identity = authorization?.startsWith('Bearer ') ? await verifyAdminArenaObservationToken(input.secret, authorization.slice(7)) : null;
    if (!identity) return context.json({ code: 'ADMIN_ARENA_UNAUTHORIZED' }, 401);
    const entries = [...new URL(context.req.url).searchParams.entries()];
    if (new Set(entries.map(([name]) => name)).size !== entries.length) return context.json({ code: 'ADMIN_ARENA_QUERY_INVALID' }, 400);
    const query = AdminArenaObservationQuerySchema.safeParse(Object.fromEntries(entries));
    if (!query.success) return context.json({ code: 'ADMIN_ARENA_QUERY_INVALID' }, 400);
    try { return context.json(await input.service.read(query.data)); }
    catch { return context.json({ code: 'ADMIN_ARENA_UNAVAILABLE' }, 503); }
  });
}
