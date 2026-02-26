import type { NextRequest } from 'next/server';

import { verifyCardOwnership } from '@/lib/database/data-cards';
import { requireAuthUser } from '@/lib/auth/server';
import { replaceUserTagsForDataCard } from '@/lib/database/tags';

export const config = {
  runtime: 'edge',
};

type PutBody = {
  dataCardId?: unknown;
  tagIds?: unknown;
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;
  const user = auth.user;

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return new Response(JSON.stringify({ error: '请求体不是合法 JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dataCardId = typeof body.dataCardId === 'string' ? body.dataCardId.trim() : '';
  const tagIds = Array.isArray(body.tagIds)
    ? (body.tagIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : null;

  if (!dataCardId || !tagIds) {
    return new Response(JSON.stringify({ error: '缺少 dataCardId 或 tagIds' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const isOwner = await verifyCardOwnership(dataCardId, user.id);
  if (!isOwner) {
    return new Response(JSON.stringify({ error: '无权修改该数据卡的标签' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await replaceUserTagsForDataCard({
    dataCardId,
    userId: user.id,
    tagIds,
  });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error ?? '写入失败' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

