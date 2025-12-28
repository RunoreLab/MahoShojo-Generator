import { updateUserAvatarWebpBase64 } from '@/lib/d1';
import { json, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

const AVATAR_SIZE = 128;
const WEBP_QUALITY = 0.82;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const MAX_BASE64_LENGTH = 350_000;

function isProbablyBase64(s: string) {
  // 允许换行/空白的 base64 也很常见，这里做最小校验即可
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_BASE64_LENGTH) return false;
  return /^[A-Za-z0-9+/=\s]+$/.test(trimmed);
}

function stripWebpDataUrlPrefix(input: string) {
  const trimmed = input.trim();
  const prefix = 'data:image/webp;base64,';
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  return trimmed;
}

function arrayBufferToBase64(ab: ArrayBuffer) {
  const bytes = new Uint8Array(ab);
  const chunkSize = 4096;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...chunk));
  }
  return btoa(parts.join(''));
}

async function compressAvatarToWebpBase64(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('图片过大，请换一张更小的图片');

  const hasCanvas = typeof (globalThis as any).OffscreenCanvas === 'function';
  const hasCreateImageBitmap = typeof (globalThis as any).createImageBitmap === 'function';
  if (!hasCanvas || !hasCreateImageBitmap) {
    throw new Error('当前运行环境不支持后端图片压缩（缺少 OffscreenCanvas/createImageBitmap）');
  }

  const blob = new Blob([await file.arrayBuffer()], { type: file.type });
  const bitmap = (await (globalThis as any).createImageBitmap(blob)) as ImageBitmap;
  const canvas = new (globalThis as any).OffscreenCanvas(AVATAR_SIZE, AVATAR_SIZE) as OffscreenCanvas & {
    convertToBlob?: (opts: { type: string; quality?: number }) => Promise<Blob>;
  };
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持 Canvas 2D');

  const sw = bitmap.width;
  const sh = bitmap.height;
  const size = Math.min(sw, sh);
  const sx = Math.floor((sw - size) / 2);
  const sy = Math.floor((sh - size) / 2);

  ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  if (typeof canvas.convertToBlob !== 'function') {
    throw new Error('当前运行环境不支持后端图片压缩（缺少 OffscreenCanvas.convertToBlob）');
  }

  const out = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
  const base64 = arrayBufferToBase64(await out.arrayBuffer());
  if (typeof (bitmap as any).close === 'function') {
    (bitmap as any).close();
  }
  return base64;
}

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  if (req.method === 'PUT') {
    const contentType = req.headers.get('content-type') || '';

    // 优先支持 JSON：前端先压缩为 128×128 WebP，再上传 base64（Edge 环境更稳定）
    if (contentType.includes('application/json')) {
      const body = (await req.json().catch(() => null)) as any;
      if (!body) return json({ error: '请求体不是有效 JSON' }, { status: 400 });

      const raw = body.avatarWebpBase64 ?? body.avatar_base64 ?? body.avatarDataUrl ?? body.avatar_data_url;
      if (typeof raw !== 'string') return json({ error: '缺少头像内容（avatarWebpBase64/avatarDataUrl）' }, { status: 400 });

      const base64 = stripWebpDataUrlPrefix(raw).replace(/\s+/g, '');
      if (!isProbablyBase64(base64)) return json({ error: '头像内容不是有效 base64' }, { status: 400 });

      const ok = await updateUserAvatarWebpBase64(auth.user.id, base64);
      if (!ok) return json({ error: '保存头像失败' }, { status: 500 });

      return json(
        { success: true, avatarDataUrl: `data:image/webp;base64,${base64}` },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // 兼容 multipart/form-data：若运行环境支持则后端压缩；否则提示前端走 JSON 压缩上传
    const formData = await req.formData().catch(() => null);
    if (!formData) return json({ error: '请求体不是有效表单' }, { status: 400 });

    const file = (formData.get('file') ?? formData.get('avatar')) as unknown;
    if (!(file instanceof File)) return json({ error: '缺少头像文件（file/avatar）' }, { status: 400 });

    try {
      const base64 = await compressAvatarToWebpBase64(file);
      const ok = await updateUserAvatarWebpBase64(auth.user.id, base64);
      if (!ok) return json({ error: '保存头像失败' }, { status: 500 });

      return json(
        { success: true, avatarDataUrl: `data:image/webp;base64,${base64}` },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : '头像处理失败';
      if (String(message).includes('OffscreenCanvas') || String(message).includes('createImageBitmap')) {
        return json(
          { error: '当前运行环境不支持后端图片压缩，请改用前端压缩上传（JSON：avatarWebpBase64）' },
          { status: 400 },
        );
      }
      return json({ error: message }, { status: 400 });
    }
  }

  if (req.method === 'DELETE') {
    const ok = await updateUserAvatarWebpBase64(auth.user.id, null);
    if (!ok) return json({ error: '清除头像失败' }, { status: 500 });
    return json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
});

