type MemoryCacheEntry = {
  status: number;
  headers: Array<[string, string]>;
  bodyText: string;
  expiresAt: number;
};

const memoryCache = new Map<string, MemoryCacheEntry>();
const MAX_MEMORY_CACHE_ENTRIES = 300;
const MAX_MEMORY_CACHE_BODY_CHARS = 200_000;

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
  if (cached.expiresAt > now) {
    // LRU：命中后刷新顺序，避免热 key 被挤出。
    memoryCache.delete(key);
    memoryCache.set(key, cached);
    return cached;
  }
  memoryCache.delete(key);
  return null;
};

const pruneMemoryCache = (now: number): void => {
  if (memoryCache.size <= MAX_MEMORY_CACHE_ENTRIES) return;

  // 优先淘汰已过期的旧条目（按 LRU 顺序从老到新尝试）。
  for (const [k, v] of memoryCache) {
    if (v.expiresAt > now) break;
    memoryCache.delete(k);
    if (memoryCache.size <= MAX_MEMORY_CACHE_ENTRIES) return;
  }

  // 若仍超限，则按 LRU 淘汰最旧的。
  while (memoryCache.size > MAX_MEMORY_CACHE_ENTRIES) {
    const firstKey = memoryCache.keys().next().value as string | undefined;
    if (!firstKey) break;
    memoryCache.delete(firstKey);
  }
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
    const contentLength = res.headers.get('Content-Length');
    const contentLengthNum = contentLength ? Number(contentLength) : NaN;
    const shouldAttemptMemoryCache = !Number.isFinite(contentLengthNum) || contentLengthNum <= MAX_MEMORY_CACHE_BODY_CHARS;

    if (shouldAttemptMemoryCache) {
      const bodyText = await res.clone().text();
      if (bodyText.length <= MAX_MEMORY_CACHE_BODY_CHARS) {
        memoryCache.set(key, {
          status: res.status,
          headers: Array.from(res.headers.entries()),
          bodyText,
          expiresAt: now + ttlSeconds * 1000,
        });
        pruneMemoryCache(now);
      }
    }
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
