import type { NextRequest } from 'next/server';

import { deleteTagAlias, getTagAliases, upsertTagAlias } from '@/lib/database/tags';

export const runtime = 'edge';

const parseIntParam = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

export default async function handler(req: NextRequest) {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const tagId = (url.searchParams.get('tagId') ?? '').trim();
      const search = (url.searchParams.get('search') ?? '').trim();
      const limit = Math.max(1, Math.min(500, parseIntParam(url.searchParams.get('limit'), 200)));
      const offset = Math.max(0, parseIntParam(url.searchParams.get('offset'), 0));

      const aliases = await getTagAliases({ tagId: tagId || undefined, search: search || undefined, limit, offset });
      return new Response(JSON.stringify({ success: true, aliases }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const alias = typeof body.alias === 'string' ? body.alias : '';
      const tagId = typeof body.tagId === 'string' ? body.tagId : '';
      const result = await upsertTagAlias({ alias, tagId });
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
      const url = new URL(req.url);
      const alias = (url.searchParams.get('alias') ?? '').trim();
      const result = await deleteTagAlias(alias);
      if (!result.ok) {
        return new Response(JSON.stringify({ success: false, error: result.error ?? '删除失败' }), {
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
    console.error('Admin tag-aliases API 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '标签别名接口异常' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

