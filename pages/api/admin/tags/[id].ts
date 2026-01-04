import type { NextRequest } from 'next/server';

import { getDecodedPathParamAfterSegment } from '@/lib/url';
import { queryFromD1 } from '@/lib/d1';
import { upsertTag, type TagScope } from '@/lib/database/tags';

export const runtime = 'edge';

const getTagIdFromUrl = (url: string): string | null => getDecodedPathParamAfterSegment(url, 'tags');

const normalizeScope = (value: unknown): TagScope | null => {
  if (value === 'user' || value === 'system' || value === 'admin') return value;
  return null;
};

const readRow = <T,>(result: unknown): T | null => {
  const row = (result as any)?.result?.[0]?.results?.[0];
  return row ? (row as T) : null;
};

export default async function handler(req: NextRequest) {
  const id = getTagIdFromUrl(req.url);
  if (!id) {
    return new Response(JSON.stringify({ success: false, error: '缺少 tag id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (req.method === 'PUT') {
      const existing = readRow<{
        id: string;
        name: string;
        description: string | null;
        category: string | null;
        scope: TagScope;
        is_active: number;
      }>(
        await queryFromD1(
          'SELECT id, name, description, category, scope, is_active FROM tags WHERE id = ? LIMIT 1',
          [id],
        ),
      );

      if (!existing) {
        return new Response(JSON.stringify({ success: false, error: '标签不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const body = await req.json().catch(() => ({}));
      const name = typeof body.name === 'string' ? body.name : existing.name;
      const description =
        body.description === null
          ? null
          : typeof body.description === 'string'
            ? body.description
            : existing.description;
      const category =
        body.category === null ? null : typeof body.category === 'string' ? body.category : existing.category;
      const scope = normalizeScope(body.scope) ?? existing.scope;
      const isActive = typeof body.isActive === 'boolean' ? body.isActive : existing.is_active === 1;

      const result = await upsertTag({
        id,
        name,
        description,
        category,
        scope,
        isActive,
      });

      if (!result.ok) {
        return new Response(JSON.stringify({ success: false, error: result.error ?? '写入失败' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'DELETE') {
      const existing = readRow<{
        id: string;
        name: string;
        description: string | null;
        category: string | null;
        scope: TagScope;
        is_active: number;
      }>(
        await queryFromD1(
          'SELECT id, name, description, category, scope, is_active FROM tags WHERE id = ? LIMIT 1',
          [id],
        ),
      );

      if (!existing) {
        return new Response(JSON.stringify({ success: false, error: '标签不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const result = await upsertTag({
        id,
        name: existing.name,
        description: existing.description,
        category: existing.category,
        scope: existing.scope,
        isActive: false,
      });

      if (!result.ok) {
        return new Response(JSON.stringify({ success: false, error: result.error ?? '写入失败' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin tag id API 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '标签更新失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
