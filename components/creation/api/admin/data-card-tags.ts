import type { NextRequest } from 'next/server';

import { queryFromD1 } from '@/lib/d1';
import { replaceScopedTagsForDataCard, type TagScope } from '@/lib/database/tags';

export const runtime = 'edge';

type PutBody =
  | {
      dataCardId?: unknown;
      updates?: unknown;
      createdByUserId?: unknown;
    }
  | {
      dataCardId?: unknown;
      scope?: unknown;
      tagIds?: unknown;
      createdByUserId?: unknown;
    };

const normalizeScope = (value: unknown): Exclude<TagScope, 'user'> | null => {
  if (value === 'system' || value === 'admin') return value;
  return null;
};

const normalizeTagIds = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  return (value as unknown[]).filter((id): id is string => typeof id === 'string');
};

const readRow = (result: unknown): { id: string } | null => {
  const row = (result as any)?.result?.[0]?.results?.[0];
  if (!row || typeof row !== 'object') return null;
  return typeof (row as any).id === 'string' ? ({ id: (row as any).id } as any) : null;
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as PutBody;
    const dataCardId = typeof (body as any).dataCardId === 'string' ? String((body as any).dataCardId).trim() : '';
    if (!dataCardId) {
      return new Response(JSON.stringify({ success: false, error: '缺少 dataCardId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const exists = readRow(await queryFromD1('SELECT id FROM data_cards WHERE id = ? LIMIT 1', [dataCardId]));
    if (!exists) {
      return new Response(JSON.stringify({ success: false, error: '数据卡不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const createdByUserId =
      typeof (body as any).createdByUserId === 'number' && Number.isFinite((body as any).createdByUserId)
        ? Math.floor((body as any).createdByUserId)
        : null;

    const updatesRaw = (body as any).updates;
    if (Array.isArray(updatesRaw)) {
      const updates = (updatesRaw as any[]).map((item) => ({
        scope: normalizeScope(item?.scope),
        tagIds: normalizeTagIds(item?.tagIds),
      }));

      const invalid = updates.some((u) => !u.scope || u.tagIds == null);
      if (invalid) {
        return new Response(JSON.stringify({ success: false, error: 'updates 格式不正确' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let processed = 0;
      for (const update of updates) {
        const result = await replaceScopedTagsForDataCard({
          dataCardId,
          scope: update.scope!,
          tagIds: update.tagIds!,
          createdByUserId,
        });
        if (!result.ok) {
          return new Response(JSON.stringify({ success: false, error: result.error ?? '写入失败', processed }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        processed += 1;
      }

      return new Response(JSON.stringify({ success: true, processed }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const scope = normalizeScope((body as any).scope);
    const tagIds = normalizeTagIds((body as any).tagIds);
    if (!scope || tagIds == null) {
      return new Response(JSON.stringify({ success: false, error: '缺少 scope 或 tagIds' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await replaceScopedTagsForDataCard({ dataCardId, scope, tagIds, createdByUserId });
    if (!result.ok) {
      return new Response(JSON.stringify({ success: false, error: result.error ?? '写入失败' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, processed: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin data-card-tags 失败:', error);
    return new Response(JSON.stringify({ success: false, error: '写入失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

