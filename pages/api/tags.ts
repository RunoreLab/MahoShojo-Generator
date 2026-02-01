import type { NextRequest } from 'next/server';

import { getTags } from '@/lib/database/tags';
import type { TagScope } from '@/lib/database/tags';
import { withEdgeCache } from '@/lib/edge-cache';

export const config = {
  runtime: 'edge',
};

type ApiTag = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: TagScope;
  isActive: boolean;
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return withEdgeCache(req, { key: req.url, ttlSeconds: 300 }, async () => {
    try {
      const url = new URL(req.url);
      const includeInactive = url.searchParams.get('includeInactive') === '1';
      const rows = await getTags({ includeInactive });
      const tags: ApiTag[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        category: row.category ?? null,
        scope: row.scope,
        isActive: row.is_active === 1,
      }));

      return new Response(JSON.stringify({ success: true, tags }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      });
    } catch (error) {
      console.error('获取 tags 失败:', error);
      return new Response(JSON.stringify({ success: false, error: '无法加载标签库' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });
}
