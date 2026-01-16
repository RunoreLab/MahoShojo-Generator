import type { MagicTeaPartyPreferences, MagicTeaPartyTachieAsset } from '@/lib/magic-tea-party/types';
import {
  deleteMagicTeaPartyTachieAssetsByIds,
  listAllMagicTeaPartyTachieAssets,
  listMagicTeaPartyTachieAssets,
} from '@/lib/magic-tea-party/storage';

const MB = 1024 * 1024;

export const MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_PER_SESSION = 24;
export const MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_GLOBAL = 200;
export const MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_BYTES = 300 * MB;

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeCount = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampNumber(Math.floor(value), min, max);
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return clampNumber(Math.floor(Number(value)), min, max);
  }
  return fallback;
};

const normalizeBytes = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampNumber(Math.floor(value), min, max);
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return clampNumber(Math.floor(Number(value)), min, max);
  }
  return fallback;
};

export type MagicTeaPartyCacheLimits = {
  maxPerSession: number;
  maxGlobal: number;
  maxBytes: number;
};

export type MagicTeaPartyCacheStats = {
  totalCount: number;
  totalBytes: number;
  unknownCount: number;
};

export const resolveMagicTeaPartyCacheLimits = (preferences: MagicTeaPartyPreferences): MagicTeaPartyCacheLimits => {
  const maxPerSession = normalizeCount(
    preferences.tachieCacheMaxPerSession,
    MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_PER_SESSION,
    1,
    200
  );
  const maxGlobal = normalizeCount(
    preferences.tachieCacheMaxGlobal,
    MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_GLOBAL,
    maxPerSession,
    1000
  );
  const maxBytes = normalizeBytes(
    preferences.tachieCacheMaxBytes,
    MAGIC_TEA_PARTY_CACHE_DEFAULT_MAX_BYTES,
    32 * MB,
    5 * 1024 * MB
  );
  return {
    maxPerSession,
    maxGlobal,
    maxBytes,
  };
};

export const calculateMagicTeaPartyCacheStats = (assets: MagicTeaPartyTachieAsset[]): MagicTeaPartyCacheStats => {
  let totalBytes = 0;
  let unknownCount = 0;
  for (const asset of assets) {
    const size = typeof asset.blobSize === 'number' && Number.isFinite(asset.blobSize) ? asset.blobSize : null;
    if (size === null) {
      unknownCount += 1;
      continue;
    }
    totalBytes += Math.max(0, size);
  }
  return {
    totalCount: assets.length,
    totalBytes,
    unknownCount,
  };
};

export const formatMagicTeaPartyBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
};

export const cleanupMagicTeaPartyTachieCache = async (params: {
  sessionId?: string | null;
  limits: MagicTeaPartyCacheLimits;
}): Promise<MagicTeaPartyCacheStats> => {
  const removedIds = new Set<string>();

  if (params.sessionId) {
    const sessionAssets = await listMagicTeaPartyTachieAssets(params.sessionId);
    if (sessionAssets.length > params.limits.maxPerSession) {
      const overflow = sessionAssets.slice(params.limits.maxPerSession);
      if (overflow.length > 0) {
        overflow.forEach((asset) => removedIds.add(asset.id));
        await deleteMagicTeaPartyTachieAssetsByIds(overflow.map((asset) => asset.id));
      }
    }
  }

  let allAssets = await listAllMagicTeaPartyTachieAssets();
  if (removedIds.size > 0) {
    allAssets = allAssets.filter((asset) => !removedIds.has(asset.id));
  }

  if (allAssets.length > params.limits.maxGlobal) {
    const overflow = allAssets.slice(0, allAssets.length - params.limits.maxGlobal);
    if (overflow.length > 0) {
      overflow.forEach((asset) => removedIds.add(asset.id));
      await deleteMagicTeaPartyTachieAssetsByIds(overflow.map((asset) => asset.id));
      allAssets = allAssets.slice(allAssets.length - params.limits.maxGlobal);
    }
  }

  const afterCountStats = calculateMagicTeaPartyCacheStats(allAssets);
  if (afterCountStats.totalBytes > params.limits.maxBytes) {
    const removable = allAssets.filter((asset) => !removedIds.has(asset.id));
    let totalBytes = afterCountStats.totalBytes;
    const toRemove: string[] = [];
    for (const asset of removable) {
      if (totalBytes <= params.limits.maxBytes) break;
      const size = typeof asset.blobSize === 'number' && Number.isFinite(asset.blobSize) ? asset.blobSize : 0;
      totalBytes = Math.max(0, totalBytes - Math.max(0, size));
      toRemove.push(asset.id);
    }
    if (toRemove.length > 0) {
      await deleteMagicTeaPartyTachieAssetsByIds(toRemove);
    }
  }

  const finalAssets = await listAllMagicTeaPartyTachieAssets();
  return calculateMagicTeaPartyCacheStats(finalAssets);
};

export const getMagicTeaPartyCacheStats = async (): Promise<MagicTeaPartyCacheStats> => {
  const assets = await listAllMagicTeaPartyTachieAssets();
  return calculateMagicTeaPartyCacheStats(assets);
};

export const parseMagicTeaPartyCacheLimitInput = (value: string, fallback: number): number => {
  if (!value.trim()) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.floor(numeric)) * MB;
};
