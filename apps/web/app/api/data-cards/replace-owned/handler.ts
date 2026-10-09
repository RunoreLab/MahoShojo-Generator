import { DataCardExpectedOwnerSchema, OwnedDataCardReplaceRequestSchema } from '@mahoshojo/contracts/data-cards';
import { requireAuthUser } from '@/lib/auth/server';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getOwnedReplacementVersion, readOwnedReplacementSnapshot } from '@/lib/db/repositories/data-card-owned-replacement';
import { targetChangedResponse, updateDataCardForUser } from '../handler';

export async function appRouteHandler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'PUT') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;
  const user = Object.freeze({ ...auth.user });
  const url = new URL(req.url);
  const payload = req.method === 'PUT' ? await req.json().catch(() => null) : null;
  const rawOwner = req.method === 'GET' ? url.searchParams.get('expectedUserId') : payload?.expectedUserId;
  const owner = DataCardExpectedOwnerSchema.safeParse(req.method === 'GET' && typeof rawOwner === 'string' && /^[1-9]\d*$/.test(rawOwner) ? Number(rawOwner) : rawOwner);
  if (!owner.success) return Response.json({ error: '无效的 expectedUserId' }, { status: 400 });
  if (owner.data !== user.id) return Response.json({ error: 'ACCOUNT_MISMATCH' }, { status: 409 });
  const parsed = req.method === 'PUT' ? OwnedDataCardReplaceRequestSchema.safeParse(payload) : null;
  if (parsed && !parsed.success) return Response.json({ error: '无效的替换参数' }, { status: 400 });
  const id = parsed?.success ? parsed.data.id : url.searchParams.get('id')?.trim();
  if (!id || id.length > 200) return Response.json({ error: '无效的数据卡 ID' }, { status: 400 });
  try {
    const db = getDrizzleDbFromRuntime();
    if (!db) return Response.json({ error: '数据卡存储不可用' }, { status: 503 });
    const snapshot = await readOwnedReplacementSnapshot(db, id, user.id);
    if (!snapshot) return Response.json({ error: '数据卡不存在或无权访问' }, { status: 404 });
    if (snapshot.pending_id !== null && snapshot.pending_user_id !== user.id) return targetChangedResponse();
    const version = await getOwnedReplacementVersion(snapshot);
    if (req.method === 'GET') return Response.json({
      success: true, accountFenceVersion: 1, ownerUserId: user.id,
      target: { id, type: snapshot.type, name: snapshot.name, description: snapshot.description,
        isPublic: snapshot.is_public, reviewStatus: snapshot.review_status,
        hasPendingUpdate: snapshot.pending_id !== null, version },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
    if (!parsed?.success || parsed.data.expectedVersion !== version || parsed.data.type !== snapshot.type) return targetChangedResponse();
    return updateDataCardForUser(req, user, {
      id, name: snapshot.name, description: snapshot.description, isPublic: snapshot.is_public, data: parsed.data.data,
    }, { snapshot });
  } catch (error) {
    console.error('Owned replacement failed:', error);
    return Response.json({ error: '替换数据卡失败' }, { status: 500 });
  }
}
