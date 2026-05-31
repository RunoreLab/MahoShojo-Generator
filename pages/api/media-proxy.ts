import type { NextRequest } from 'next/server';

import { isAllowedExternalMediaUrl } from '@/lib/markdown/externalMedia';

const buildJsonResponse = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const getProxyTarget = (req: NextRequest) => {
  const url = new URL(req.url);
  return url.searchParams.get('url')?.trim() ?? '';
};

const normalizeExternalTarget = (value: string) => {
  if (value.startsWith('//')) return `https:${value}`;
  return value;
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return buildJsonResponse(405, { error: 'Method not allowed' });
  }

  const target = getProxyTarget(req);
  if (!target) {
    return buildJsonResponse(400, { error: '缺少 url 参数' });
  }

  const normalizedTarget = normalizeExternalTarget(target);
  let parsed: URL;
  try {
    parsed = new URL(normalizedTarget);
  } catch {
    return buildJsonResponse(400, { error: '无效的 url 参数' });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return buildJsonResponse(400, { error: '仅支持 http/https 协议' });
  }

  if (!isAllowedExternalMediaUrl(normalizedTarget, 'image')) {
    return buildJsonResponse(403, { error: '该外链不在白名单' });
  }

  let upstream: Response;
  try {
    upstream = await fetch(normalizedTarget, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'MahoShojo-Generator Media Proxy',
      },
    });
  } catch (error) {
    console.error('媒体代理请求失败:', error);
    return buildJsonResponse(502, { error: '代理请求失败' });
  }

  if (!upstream.ok || !upstream.body) {
    return buildJsonResponse(502, { error: `上游响应异常: ${upstream.status}` });
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  const cacheControl = upstream.headers.get('cache-control') ?? 'public, max-age=86400';

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
