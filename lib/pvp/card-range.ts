import { DEFAULT_PVP_RULES } from '@/lib/pvp/defaults';
import type { PvpCombatantType, PvpRoomCardRange, PvpRoomRules } from '@/lib/pvp/types';

const clampIntOrNull = (raw: unknown, fallback: number | null, min: number, max: number): number | null => {
  if (raw === null) return null;
  if (raw === undefined) return fallback;
  const n = Number.isFinite(raw as number) ? Math.floor(raw as number) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const dedupeStringArray = (input: unknown): string[] => {
  const items = Array.isArray(input) ? input : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = typeof item === 'string' ? item.trim() : '';
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

export const normalizePvpRoomCardRange = (rules: Pick<PvpRoomRules, 'cardRange'>): PvpRoomCardRange => {
  const defaults = DEFAULT_PVP_RULES.cardRange!;
  const raw = (rules as any)?.cardRange ?? null;

  const allowedSet = new Set<PvpCombatantType>(['magical-girl', 'canshou', 'general-character']);
  const allowedCombatantTypes = dedupeStringArray((raw as any)?.allowedCombatantTypes).filter((t): t is PvpCombatantType => allowedSet.has(t as any));
  const safeAllowed = allowedCombatantTypes.length > 0 ? allowedCombatantTypes : defaults.allowedCombatantTypes;

  return {
    allowedCombatantTypes: safeAllowed,
    minLikeCount: clampIntOrNull((raw as any)?.minLikeCount, defaults.minLikeCount, 0, 1_000_000_000),
    maxLikeCount: clampIntOrNull((raw as any)?.maxLikeCount, defaults.maxLikeCount, 0, 1_000_000_000),
    minUsageCount: clampIntOrNull((raw as any)?.minUsageCount, defaults.minUsageCount, 0, 1_000_000_000),
    maxUsageCount: clampIntOrNull((raw as any)?.maxUsageCount, defaults.maxUsageCount, 0, 1_000_000_000),
    minFavoriteCount: clampIntOrNull((raw as any)?.minFavoriteCount, defaults.minFavoriteCount, 0, 1_000_000_000),
    maxFavoriteCount: clampIntOrNull((raw as any)?.maxFavoriteCount, defaults.maxFavoriteCount, 0, 1_000_000_000),
  };
};

export const isPvpCombatantTypeAllowedByRange = (type: PvpCombatantType, range: PvpRoomCardRange): boolean => {
  return Array.isArray(range.allowedCombatantTypes) && range.allowedCombatantTypes.includes(type);
};

export type PvpDataCardStats = { likeCount?: number | null; usageCount?: number | null; favoriteCount?: number | null };

export const isPvpDataCardStatsAllowedByRange = (stats: PvpDataCardStats, range: PvpRoomCardRange): boolean => {
  const like = Number.isFinite(stats.likeCount as number) ? Math.floor(stats.likeCount as number) : 0;
  const usage = Number.isFinite(stats.usageCount as number) ? Math.floor(stats.usageCount as number) : 0;
  const fav = Number.isFinite(stats.favoriteCount as number) ? Math.floor(stats.favoriteCount as number) : 0;

  if (range.minLikeCount !== null && like < range.minLikeCount) return false;
  if (range.maxLikeCount !== null && like > range.maxLikeCount) return false;
  if (range.minUsageCount !== null && usage < range.minUsageCount) return false;
  if (range.maxUsageCount !== null && usage > range.maxUsageCount) return false;
  if (range.minFavoriteCount !== null && fav < range.minFavoriteCount) return false;
  if (range.maxFavoriteCount !== null && fav > range.maxFavoriteCount) return false;
  return true;
};

export const describePvpRoomCardRange = (range: PvpRoomCardRange): string => {
  const typeLabel = (t: PvpCombatantType): string => {
    if (t === 'magical-girl') return '魔法少女';
    if (t === 'canshou') return '残兽';
    return '通用角色';
  };
  const types = (range.allowedCombatantTypes || []).map(typeLabel).join(' / ') || '（无）';

  const fmt = (min: number | null, max: number | null): string => {
    if (min === null && max === null) return '不限';
    if (min !== null && max === null) return `≥${min}`;
    if (min === null && max !== null) return `≤${max}`;
    return `${min}~${max}`;
  };

  return `类型：${types}；点赞：${fmt(range.minLikeCount, range.maxLikeCount)}；使用：${fmt(range.minUsageCount, range.maxUsageCount)}；收藏：${fmt(range.minFavoriteCount, range.maxFavoriteCount)}`;
};

