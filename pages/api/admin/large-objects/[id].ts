import type { NextRequest } from 'next/server';

import { deleteObject, generatePresignedUrl } from '@/lib/r2';
import { deleteAdminLargeObjectById, getAdminLargeObjectById } from '@/lib/database/admin-large-objects';

export const runtime = 'edge';

const getIdFromUrl = (url: string): string | null => {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    // /api/admin/large-objects/:id
    const idx = parts.findIndex((p) => p === 'large-objects');
    if (idx === -1) return null;
    return parts[idx + 1] || null;
  } catch {
    return null;
  }
};

const parseIntParam = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

export default async function handler(req: NextRequest) {
  const id = getIdFromUrl(req.url);
  if (!id) {
    return new Response(JSON.stringify({ success: false, error: '缺少 id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const presign = url.searchParams.get('presign') === '1';
      const expires = Math.max(30, Math.min(3600, parseIntParam(url.searchParams.get('expiresInSeconds'), 600)));

      const row = await getAdminLargeObjectById(id);
      if (!row) {
        return new Response(JSON.stringify({ success: false, error: '记录不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!presign) {
        return new Response(JSON.stringify({ success: true, row }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const responseContentType = row.content_type ?? undefined;
      const downloadUrl = await generatePresignedUrl(row.r2_key, {
        method: 'GET',
        expiresInSeconds: expires,
        ...(responseContentType ? { responseContentType } : {}),
      });

      return new Response(JSON.stringify({ success: true, row, downloadUrl, expiresInSeconds: expires }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const deleteR2Flag = url.searchParams.get('deleteR2') === '1';

      const row = await getAdminLargeObjectById(id);
      if (!row) {
        return new Response(JSON.stringify({ success: false, error: '记录不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let r2Deleted: boolean | null = null;
      let r2Error: string | null = null;
      if (deleteR2Flag) {
        const del = await deleteObject(row.r2_key);
        r2Deleted = del.success;
        if (!del.success) {
          r2Error = del.error ?? 'R2 删除失败';
        }
      }

      const deleted = await deleteAdminLargeObjectById(id);
      if (!deleted.ok) {
        return new Response(JSON.stringify({ success: false, error: deleted.error ?? '删除失败', r2Deleted, r2Error }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, changes: deleted.changes, r2Deleted, r2Error }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin large-objects id API 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '请求失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

