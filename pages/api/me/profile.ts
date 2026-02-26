import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  getBusinessUserProfileById,
  updateBusinessUserSignatureById,
} from '@/lib/db/repositories/business-users';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

const MAX_SIGNATURE_LENGTH = 120;

function toProfileResponse(row: { signature: string | null; avatar_webp_base64: string | null } | null) {
  const signature = row?.signature ?? '';
  const avatarDataUrl = row?.avatar_webp_base64 ? `data:image/webp;base64,${row.avatar_webp_base64}` : null;
  return { signature, avatarDataUrl };
}

const loadUserProfile = async (
  userId: number,
): Promise<{ signature: string | null; avatar_webp_base64: string | null } | null> => {
  const db = getDrizzleDbFromRuntime();
  if (!db) return null;

  const row = await getBusinessUserProfileById(db, userId);
  if (!row) return null;

  return {
    signature: row.signature,
    avatar_webp_base64: row.avatarWebpBase64,
  };
};

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  if (req.method === 'GET') {
    const row = await loadUserProfile(auth.user.id);
    return json({ success: true, profile: toProfileResponse(row) }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (req.method === 'PUT') {
    const parsed = await readJson<{ signature?: unknown }>(req);
    if ('response' in parsed) return parsed.response;

    const raw = parsed.data.signature;
    const signature = raw == null ? '' : typeof raw === 'string' ? raw : null;
    if (signature === null) return json({ error: 'signature 必须是字符串或 null' }, { status: 400 });

    const normalized = signature.replace(/\r\n/g, '\n').slice(0, MAX_SIGNATURE_LENGTH);
    const db = getDrizzleDbFromRuntime();
    if (!db) return json({ error: '数据库不可用，请稍后重试' }, { status: 503 });

    const changed = await updateBusinessUserSignatureById(db, auth.user.id, normalized ? normalized : null);
    if (changed <= 0) return json({ error: '保存签名失败' }, { status: 500 });

    const row = await loadUserProfile(auth.user.id);
    return json({ success: true, profile: toProfileResponse(row) }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
});

