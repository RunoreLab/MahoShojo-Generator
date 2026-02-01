import type { SeasonMeta, SeasonsConfig } from '@/lib/seasons';
import { getCurrentSeason } from '@/lib/seasons';

type CachedSeasonsConfig = {
  origin: string | null;
  fetchedAtMs: number;
  config: SeasonsConfig | null;
};

const CACHE_TTL_MS = 60_000;
let cached: CachedSeasonsConfig = { origin: null, fetchedAtMs: 0, config: null };

const isSeasonsConfigLike = (value: unknown): value is SeasonsConfig => {
  if (!value || typeof value !== 'object') return false;
  const anyValue = value as any;
  if (anyValue.schemaVersion !== 1) return false;
  return Array.isArray(anyValue.seasons);
};

export const fetchSeasonsConfigFromOrigin = async (origin: string): Promise<SeasonsConfig | null> => {
  const safeOrigin = typeof origin === 'string' ? origin.trim() : '';
  if (!safeOrigin) return null;

  const now = Date.now();
  if (cached.origin === safeOrigin && now - cached.fetchedAtMs < CACHE_TTL_MS) {
    return cached.config;
  }

  try {
    const url = new URL('/config/seasons.json', safeOrigin);
    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as unknown;
    const config = isSeasonsConfigLike(json) ? (json as SeasonsConfig) : null;
    cached = { origin: safeOrigin, fetchedAtMs: now, config };
    return config;
  } catch {
    cached = { origin: safeOrigin, fetchedAtMs: now, config: null };
    return null;
  }
};

export const fetchCurrentSeasonFromOrigin = async (origin: string): Promise<SeasonMeta | null> => {
  const config = await fetchSeasonsConfigFromOrigin(origin);
  return getCurrentSeason(config);
};

