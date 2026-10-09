import { DataCardExpectedOwnerSchema } from '@mahoshojo/contracts/data-cards';
import { requireAuthUser } from '@/lib/auth/server';
import { createDataCardForUser } from '../handler';

export async function appRouteHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;
  const user = Object.freeze({ ...auth.user });
  const payload = await req.json().catch(() => null);
  const owner = DataCardExpectedOwnerSchema.safeParse(payload?.expectedUserId);
  if (!owner.success) return Response.json({ error: '无效的 expectedUserId' }, { status: 400 });
  if (owner.data !== user.id) {
    return Response.json({ error: 'ACCOUNT_MISMATCH' }, { status: 409 });
  }
  return createDataCardForUser(req, user, payload, true);
}
