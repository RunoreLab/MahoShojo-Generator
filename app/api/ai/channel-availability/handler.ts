import { withEdgeCache } from '@/lib/edge-cache';
import { rebuildSnapshot } from '@/lib/ai/availability';

const EDGE_CACHE_TTL_SECONDS = 45;

const json = (payload: unknown, status = 200, extraHeaders?: Record<string, string>): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}`,
      'Cloudflare-CDN-Cache-Control': `public, s-maxage=${EDGE_CACHE_TTL_SECONDS}`,
      ...extraHeaders,
    },
  });

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json({ error: 'Method not allowed' }, 405);
  }

  return withEdgeCache(req, { key: 'ai-channel-availability', ttlSeconds: EDGE_CACHE_TTL_SECONDS }, async () => {
    const snapshot = await rebuildSnapshot();
    return json(snapshot);
  });
}

export const appRouteHandler = handler;
export default appRouteHandler;
