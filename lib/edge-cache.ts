type MemoryCacheEntry = {
  status: number;
  headers: Array<[string, string]>;
  bodyText: string;
  expiresAt: number;
};

const memoryCache = new Map<string, MemoryCacheEntry>();

const readDefaultCache = (): Cache | null => {
  const anyCaches = (globalThis as any)?.caches;
  const cache = anyCaches?.default;
  if (!cache) return null;
  if (typeof cache.match !== 'function' || typeof cache.put !== 'function') return null;
  return cache as Cache;
};

const readMemoryCache = (key: string, now: number): MemoryCacheEntry | null => {
  const cached = memoryCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt > now) return cached;
  memoryCache.delete(key);
  return null;
};

export async function withEdgeCache(
  req: Request,
  options: { key: string; ttlSeconds: number },
  handler: () => Promise<Response>,
): Promise<Response> {
  const ttlSeconds = Math.max(0, Math.floor(options.ttlSeconds));
  if (ttlSeconds <= 0) return handler();
  if (req.method !== 'GET' && req.method !== 'HEAD') return handler();

  const key = options.key;
  const now = Date.now();

  const memoryHit = readMemoryCache(key, now);
  if (memoryHit) {
    return new Response(memoryHit.bodyText, { status: memoryHit.status, headers: memoryHit.headers });
  }

  const cache = readDefaultCache();
  const cacheReq = new Request(key, { method: 'GET' });

  if (cache) {
    const hit = await cache.match(cacheReq);
    if (hit) return hit;
  }

  const res = await handler();
  if (res.status !== 200) return res;

  try {
    const bodyText = await res.clone().text();
    memoryCache.set(key, {
      status: res.status,
      headers: Array.from(res.headers.entries()),
      bodyText,
      expiresAt: now + ttlSeconds * 1000,
    });
  } catch {
  }

  if (cache) {
    try {
      await cache.put(cacheReq, res.clone());
    } catch {
    }
  }

  return res;
}
