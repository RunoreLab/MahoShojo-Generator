import type { NextRequest } from 'next/server';

import { queryFromD1 } from '@/lib/d1';
import { upsertTag, type TagScope } from '@/lib/database/tags';

export const runtime = 'edge';

type ApiTag = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: TagScope;
  isActive: boolean;
  aliasCount: number;
  createdAt: string;
  updatedAt: string;
};

const parseIntParam = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const normalizeScope = (value: string | null): TagScope | null => {
  if (value === 'user' || value === 'system' || value === 'admin') return value;
  return null;
};

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

export default async function handler(req: NextRequest) {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const page = Math.max(1, parseIntParam(url.searchParams.get('page'), 1));
      const limit = Math.max(1, Math.min(200, parseIntParam(url.searchParams.get('limit'), 50)));
      const offset = (page - 1) * limit;

      const includeInactive = url.searchParams.get('includeInactive') !== '0';
      const scope = normalizeScope(url.searchParams.get('scope'));
      const category = (url.searchParams.get('category') ?? '').trim();
      const search = (url.searchParams.get('search') ?? '').trim();

      const whereParts: string[] = [];
      const params: unknown[] = [];

      if (!includeInactive) whereParts.push('t.is_active = 1');
      if (scope) {
        whereParts.push('t.scope = ?');
        params.push(scope);
      }
      if (category) {
        whereParts.push('t.category = ?');
        params.push(category);
      }
      if (search) {
        whereParts.push('(t.id LIKE ? OR t.name LIKE ? OR t.description LIKE ? OR t.category LIKE ?)');
        const term = `%${search}%`;
        params.push(term, term, term, term);
      }

      const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

      const dataSql = `
        SELECT
          t.id,
          t.name,
          t.description,
          t.category,
          t.scope,
          t.is_active,
          t.created_at,
          t.updated_at,
          COUNT(ta.alias) AS alias_count
        FROM tags t
        LEFT JOIN tag_aliases ta ON ta.tag_id = t.id
        ${whereSql}
        GROUP BY t.id
        ORDER BY t.category ASC, t.id ASC
        LIMIT ? OFFSET ?;
      `;

      const countSql = `
        SELECT COUNT(*) AS total
        FROM tags t
        ${whereSql};
      `;

      const [dataResult, countResult] = await Promise.all([
        queryFromD1(dataSql, [...params, limit, offset]),
        queryFromD1(countSql, params),
      ]);

      const rows = readRows<{
        id: string;
        name: string;
        description: string | null;
        category: string | null;
        scope: TagScope;
        is_active: number;
        created_at: string;
        updated_at: string;
        alias_count: number;
      }>(dataResult);

      const totalRow = readRows<{ total: number }>(countResult)[0];
      const total = typeof totalRow?.total === 'number' ? totalRow.total : 0;

      const tags: ApiTag[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        category: row.category ?? null,
        scope: row.scope,
        isActive: row.is_active === 1,
        aliasCount: typeof row.alias_count === 'number' ? row.alias_count : 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      return new Response(JSON.stringify({ success: true, tags, total, page, limit }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const payload = {
        id: typeof body.id === 'string' ? body.id : '',
        name: typeof body.name === 'string' ? body.name : '',
        description: typeof body.description === 'string' ? body.description : body.description ?? null,
        category: typeof body.category === 'string' ? body.category : body.category ?? null,
        scope: normalizeScope(typeof body.scope === 'string' ? body.scope : null) ?? 'user',
        isActive: body.isActive === false ? false : true,
      } satisfies Parameters<typeof upsertTag>[0];

      const result = await upsertTag(payload);
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
    console.error('Admin tags API 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '标签管理接口异常' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

