import { getUserProfileByUserId, updateUserSignature } from '@/lib/d1';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

const MAX_SIGNATURE_LENGTH = 120;

function toProfileResponse(row: { signature: string | null; avatar_webp_base64: string | null } | null) {
  const signature = row?.signature ?? '';
  const avatarDataUrl = row?.avatar_webp_base64 ? `data:image/webp;base64,${row.avatar_webp_base64}` : null;
  return { signature, avatarDataUrl };
}

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  if (req.method === 'GET') {
    const row = await getUserProfileByUserId(auth.user.id);
    return json({ success: true, profile: toProfileResponse(row) }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (req.method === 'PUT') {
    const parsed = await readJson<{ signature?: unknown }>(req);
    if ('response' in parsed) return parsed.response;

    const raw = parsed.data.signature;
    const signature = raw == null ? '' : typeof raw === 'string' ? raw : null;
    if (signature === null) return json({ error: 'signature 必须是字符串或 null' }, { status: 400 });

    const normalized = signature.replace(/\r\n/g, '\n').slice(0, MAX_SIGNATURE_LENGTH);
    const ok = await updateUserSignature(auth.user.id, normalized ? normalized : null);
    if (!ok) return json({ error: '保存签名失败' }, { status: 500 });

    const row = await getUserProfileByUserId(auth.user.id);
    return json({ success: true, profile: toProfileResponse(row) }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
});

