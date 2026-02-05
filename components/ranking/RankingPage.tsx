'use client';

import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LeaderboardEntityDetailsModal, type LeaderboardEntityDetailsTarget } from '@/components/ranking/LeaderboardEntityDetailsModal';
import { TechBadge } from '@/components/ranking/TechBadge';
import { TierBadge } from '@/components/ranking/TierBadge';
import { getArenaApproxRankLabel, getArenaCachedRank, isCanonicalPublicLeaderboardQuery, upsertArenaRankCacheFromLeaderboard } from '@/lib/arena/rank-cache';
import { ARENA_QUEEN_MIN_SCEPTER_COUNT, applyQueenTier, computeArenaBaseTier, isArenaScepterTier } from '@/lib/arena/tier';
import { formatDateTime } from '@/lib/constants';
import type { SeasonArchive, SeasonsConfig, SeasonMeta } from '@/lib/seasons';
import { formatSeasonTitle, formatYmdSlash, getCurrentSeason, seasonArchiveUrl } from '@/lib/seasons';
import { getScenarioPresetByFilename } from '@/lib/scenario-presets';
import { buildTitleDisplay } from '@/lib/text';

type Queue = 'strict' | 'free';
type Sort = 'rating' | 'tech';
type SortOrder = 'desc' | 'asc';
type NativeFilter = 'any' | '1' | '0';

type RankingFilters = {
  queue: Queue;
  sort: Sort;
  order: SortOrder;
  includePresets: boolean;
  isNative: NativeFilter;
  includeTagIds: string[];
  excludeTagIds: string[];
  minRating: string;
  maxRating: string;
  minGames: string;
  maxGames: string;
  minTechScore: string;
  maxTechScore: string;
};

type LeaderboardItem = {
  rank: number;
  entityType: 'data_card' | 'preset';
  entityId: string;
  displayName: string;
  authorName: string | null;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  tier: string;
  techScore: number | null;
  techLevel: string | null;
  isNative: boolean | null;
  tagIds: string[];
  ratingUpdatedAt?: string | null;
};

type HistoryBaseItem = Omit<LeaderboardItem, 'rank' | 'tier'>;

const buildRowKey = (entityType: LeaderboardItem['entityType'], entityId: string): string => `${entityType}:${entityId}`;

const compareQueenCandidate = (a: HistoryBaseItem, b: HistoryBaseItem): number => {
  if (a.rating !== b.rating) return a.rating > b.rating ? -1 : 1;
  if (a.games !== b.games) return a.games > b.games ? -1 : 1;

  const aUpdated = typeof a.ratingUpdatedAt === 'string' ? a.ratingUpdatedAt : '';
  const bUpdated = typeof b.ratingUpdatedAt === 'string' ? b.ratingUpdatedAt : '';
  if (aUpdated !== bUpdated) return aUpdated > bUpdated ? -1 : 1;

  if (a.entityType !== b.entityType) return a.entityType.localeCompare(b.entityType);
  if (a.entityId !== b.entityId) return a.entityId.localeCompare(b.entityId);
  return 0;
};

const deriveArchiveQueenKey = (items: HistoryBaseItem[]): string | null => {
  const candidates = items.filter((item) => isArenaScepterTier(item.rating, item.games));
  if (candidates.length < ARENA_QUEEN_MIN_SCEPTER_COUNT) return null;

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const next = candidates[i];
    if (next && compareQueenCandidate(next, best) < 0) best = next;
  }

  return buildRowKey(best.entityType, best.entityId);
};

type Tag = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: 'user' | 'system' | 'admin';
  isActive: boolean;
};

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
};

const defaultFilters: RankingFilters = {
  queue: 'strict',
  sort: 'rating',
  order: 'desc',
  includePresets: true,
  isNative: 'any',
  includeTagIds: [],
  excludeTagIds: [],
  minRating: '',
  maxRating: '',
  minGames: '',
  maxGames: '',
  minTechScore: '',
  maxTechScore: '',
};

const normalizeFilters = (filters: RankingFilters): RankingFilters => ({
  ...filters,
  order: filters.order === 'asc' ? 'asc' : 'desc',
  includeTagIds: Array.from(new Set(filters.includeTagIds)).sort(),
  excludeTagIds: Array.from(new Set(filters.excludeTagIds)).sort(),
  minRating: filters.minRating.trim(),
  maxRating: filters.maxRating.trim(),
  minGames: filters.minGames.trim(),
  maxGames: filters.maxGames.trim(),
  minTechScore: filters.minTechScore.trim(),
  maxTechScore: filters.maxTechScore.trim(),
});

const filtersKey = (filters: RankingFilters) => JSON.stringify(filters);

const parseOptionalInt = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
};

const formatBattleModeLabel = (mode: string): string => {
  const normalized = mode.trim();
  const map: Record<string, string> = {
    classic: '经典',
    scenario: '情景',
    daily: '日常',
    kizuna: '羁绊',
  };
  return map[normalized] ?? normalized;
};

export function RankingPage() {
  const [draftFilters, setDraftFilters] = useState<RankingFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<RankingFilters>(defaultFilters);
  const [offset, setOffset] = useState(0);
  const [tagSearch, setTagSearch] = useState('');
  const [isTagFilterExpanded, setIsTagFilterExpanded] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [searchResults, setSearchResults] = useState<LeaderboardItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [focusRowKey, setFocusRowKey] = useState<string | null>(null);
  const [detailsEntity, setDetailsEntity] = useState<LeaderboardEntityDetailsTarget | null>(null);
  const lastAutoScrolledRowKeyRef = useRef<string | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const limit = 50;

  const seasonsQuery = useQuery({
    queryKey: ['seasonsConfig'],
    queryFn: () => fetchJson<SeasonsConfig>('/config/seasons.json'),
    staleTime: 60_000,
  });

  const seasons = useMemo(() => {
    const items = seasonsQuery.data?.seasons ?? [];
    return Array.isArray(items) ? items : [];
  }, [seasonsQuery.data?.seasons]);

  const seasonsSorted = useMemo(() => {
    const list = seasons.slice();
    list.sort((a, b) => {
      const aRank = a.status === 'current' ? 0 : 1;
      const bRank = b.status === 'current' ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;
      const aDate = typeof a.startsAt === 'string' ? a.startsAt : '';
      const bDate = typeof b.startsAt === 'string' ? b.startsAt : '';
      return bDate.localeCompare(aDate);
    });
    return list;
  }, [seasons]);

  const currentSeason = useMemo(() => getCurrentSeason(seasonsQuery.data), [seasonsQuery.data]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');

  useEffect(() => {
    if (selectedSeasonId) return;
    const fallback = currentSeason?.id ?? seasonsSorted[0]?.id ?? '';
    if (fallback) setSelectedSeasonId(fallback);
  }, [currentSeason?.id, seasonsSorted, selectedSeasonId]);

  const selectedSeason = useMemo<SeasonMeta | null>(() => {
    const id = selectedSeasonId.trim();
    if (!id) return null;
    return seasons.find((s) => s.id === id) ?? null;
  }, [seasons, selectedSeasonId]);

  const isHistoryMode = selectedSeason?.status === 'history';
  const [useSeasonSnapshot, setUseSeasonSnapshot] = useState(false);
  const isArchiveMode = isHistoryMode || useSeasonSnapshot;

  useEffect(() => {
    setUseSeasonSnapshot(false);
  }, [selectedSeasonId]);

  const selectedSeasonScenarioPreset = useMemo(() => {
    const filename = selectedSeason?.specialRules?.scenarioPresetFilename;
    if (typeof filename !== 'string' || !filename.trim()) return null;
    return getScenarioPresetByFilename(filename);
  }, [selectedSeason?.specialRules?.scenarioPresetFilename]);

  const archiveQuery = useQuery({
    queryKey: ['seasonArchive', selectedSeasonId],
    queryFn: () => fetchJson<SeasonArchive>(seasonArchiveUrl(selectedSeasonId)),
    enabled: Boolean(selectedSeasonId) && isArchiveMode,
    staleTime: Infinity,
  });

  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: () => fetchJson<{ success: boolean; tags: Tag[] }>('/api/tags'),
    staleTime: 60_000,
  });

  const activeTags = useMemo(
    () => (tagsQuery.data?.tags ?? []).filter((t) => t.isActive),
    [tagsQuery.data?.tags]
  );

  const tagById = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const tag of activeTags) map.set(tag.id, tag);
    return map;
  }, [activeTags]);

  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    const tags = activeTags.slice().sort((a, b) => {
      const category = (a.category ?? '').localeCompare(b.category ?? '', 'zh-CN');
      if (category !== 0) return category;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    if (!q) return tags;
    return tags.filter((tag) => {
      return (
        tag.name.toLowerCase().includes(q) ||
        tag.id.toLowerCase().includes(q) ||
        (tag.category ?? '').toLowerCase().includes(q) ||
        (tag.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [activeTags, tagSearch]);

  const groupedFilteredTags = useMemo(() => {
    const map = new Map<string, Tag[]>();
    for (const tag of filteredTags) {
      const key = tag.category ?? '未分类';
      const list = map.get(key) ?? [];
      list.push(tag);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'zh-CN'));
  }, [filteredTags]);

  const hasPendingChanges = useMemo(() => {
    const normalizedDraft = normalizeFilters(draftFilters);
    return filtersKey(appliedFilters) !== filtersKey(normalizedDraft);
  }, [appliedFilters, draftFilters]);

  const applyDraft = () => {
    const normalizedDraft = normalizeFilters(draftFilters);
    setAppliedFilters(normalizedDraft);
    setOffset(0);
    setSearchResults(null);
    setSearchError(null);
    setFocusRowKey(null);
  };

  const resetFilters = () => {
    setDraftFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setTagSearch('');
    setOffset(0);
    setSearchResults(null);
    setSearchError(null);
    setFocusRowKey(null);
  };

  const toggleTag = (mode: 'include' | 'exclude', tagId: string) => {
    setDraftFilters((prev) => {
      const include = new Set(prev.includeTagIds);
      const exclude = new Set(prev.excludeTagIds);

      if (mode === 'include') {
        if (include.has(tagId)) include.delete(tagId);
        else include.add(tagId);
        exclude.delete(tagId);
      } else {
        if (exclude.has(tagId)) exclude.delete(tagId);
        else exclude.add(tagId);
        include.delete(tagId);
      }

      return {
        ...prev,
        includeTagIds: Array.from(include).sort(),
        excludeTagIds: Array.from(exclude).sort(),
      };
    });
  };

  const selectedTagChips = useMemo(() => {
    const chips: Array<{ mode: 'include' | 'exclude'; id: string; label: string }> = [];
    for (const id of draftFilters.includeTagIds) {
      chips.push({ mode: 'include', id, label: tagById.get(id)?.name ?? id });
    }
    for (const id of draftFilters.excludeTagIds) {
      chips.push({ mode: 'exclude', id, label: tagById.get(id)?.name ?? id });
    }
    return chips;
  }, [draftFilters.excludeTagIds, draftFilters.includeTagIds, tagById]);

  const leaderboardQuery = useQuery({
    queryKey: [
      'arenaLeaderboard',
      appliedFilters.queue,
      appliedFilters.sort,
      appliedFilters.order,
      appliedFilters.includePresets,
      appliedFilters.isNative,
      appliedFilters.includeTagIds.join(','),
      appliedFilters.excludeTagIds.join(','),
      appliedFilters.minRating,
      appliedFilters.maxRating,
      appliedFilters.minGames,
      appliedFilters.maxGames,
      appliedFilters.minTechScore,
      appliedFilters.maxTechScore,
      offset,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('queue', appliedFilters.queue);
      params.set('sort', appliedFilters.sort);
      params.set('order', appliedFilters.order);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      params.set('includePresets', appliedFilters.includePresets ? '1' : '0');
      params.set('isNative', appliedFilters.isNative);
      if (appliedFilters.includeTagIds.length > 0) params.set('tagIds', appliedFilters.includeTagIds.join(','));
      if (appliedFilters.excludeTagIds.length > 0) params.set('excludeTagIds', appliedFilters.excludeTagIds.join(','));
      if (appliedFilters.minRating) params.set('minRating', appliedFilters.minRating);
      if (appliedFilters.maxRating) params.set('maxRating', appliedFilters.maxRating);
      if (appliedFilters.minGames) params.set('minGames', appliedFilters.minGames);
      if (appliedFilters.maxGames) params.set('maxGames', appliedFilters.maxGames);
      if (appliedFilters.minTechScore) params.set('minTechScore', appliedFilters.minTechScore);
      if (appliedFilters.maxTechScore) params.set('maxTechScore', appliedFilters.maxTechScore);
      return fetchJson<{ success: boolean; items: LeaderboardItem[] }>(`/api/arena/leaderboard?${params.toString()}`);
    },
    staleTime: 10_000,
    enabled: !isArchiveMode,
  });

  const historySnapshot = useMemo(() => {
    if (!isArchiveMode) return null;
    const data = archiveQuery.data;
    if (!data) return null;
    const queue: Queue = appliedFilters.queue === 'free' ? 'free' : 'strict';
    const entities = Array.isArray(data.entities) ? data.entities : [];

    const items: HistoryBaseItem[] = [];
    for (const entity of entities) {
      if (!entity) continue;
      const entityType = entity.entityType === 'preset' ? 'preset' : 'data_card';
      const entityId = typeof entity.entityId === 'string' ? entity.entityId : '';
      if (!entityId) continue;

      const snapshot = queue === 'free' ? entity.queues?.free : entity.queues?.strict;
      if (!snapshot) continue;

      items.push({
        entityType,
        entityId,
        displayName: entity.displayName ?? entityId,
        authorName: typeof entity.authorName === 'string' ? entity.authorName : null,
        rating: typeof snapshot.rating === 'number' && Number.isFinite(snapshot.rating) ? snapshot.rating : 0,
        games: typeof snapshot.games === 'number' && Number.isFinite(snapshot.games) ? snapshot.games : 0,
        wins: typeof snapshot.wins === 'number' && Number.isFinite(snapshot.wins) ? snapshot.wins : 0,
        losses: typeof snapshot.losses === 'number' && Number.isFinite(snapshot.losses) ? snapshot.losses : 0,
        draws: typeof snapshot.draws === 'number' && Number.isFinite(snapshot.draws) ? snapshot.draws : 0,
        techScore: entity.techScore,
        techLevel: entity.techLevel,
        isNative: entity.isNative,
        tagIds: Array.isArray(entity.tagIds) ? entity.tagIds : [],
        ratingUpdatedAt: typeof snapshot.ratingUpdatedAt === 'string' ? snapshot.ratingUpdatedAt : null,
      });
    }

    const queenKey = deriveArchiveQueenKey(items);

    const totalEligible = (() => {
      if (data.schemaVersion === 3) {
        const raw = queue === 'free' ? data.totalEligible?.free : data.totalEligible?.strict;
        return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
      }
      const board = queue === 'free' ? data.leaderboards?.free : data.leaderboards?.strict;
      const raw = board?.total;
      return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    })();

    const { topCount, bottomCount, snapshotMode } = (() => {
      if (data.schemaVersion === 2) {
        const board = queue === 'free' ? data.leaderboards?.free : data.leaderboards?.strict;
        return {
          snapshotMode: 'top_bottom' as const,
          topCount: Array.isArray(board?.top) ? board.top.length : 0,
          bottomCount: Array.isArray(board?.bottom) ? board.bottom.length : 0,
        };
      }

      const policy = data.snapshotPolicy;
      if (policy?.mode === 'top_bottom') {
        return {
          snapshotMode: 'top_bottom' as const,
          topCount: Math.min(Math.max(0, Math.floor(policy.top)), totalEligible),
          bottomCount: Math.min(Math.max(0, Math.floor(policy.bottom)), totalEligible),
        };
      }

      return { snapshotMode: 'full' as const, topCount: 0, bottomCount: 0 };
    })();

    return { totalEligible, topCount, bottomCount, items, queenKey, snapshotMode };
  }, [appliedFilters.queue, archiveQuery.data, isArchiveMode]);

  const historyFilteredSortedItems = useMemo((): LeaderboardItem[] => {
    if (!isArchiveMode) return [];
    const list = historySnapshot?.items ?? [];
    const queenKey = historySnapshot?.queenKey ?? null;
    const minRating = parseOptionalInt(appliedFilters.minRating);
    const maxRating = parseOptionalInt(appliedFilters.maxRating);
    const minGames = parseOptionalInt(appliedFilters.minGames);
    const maxGames = parseOptionalInt(appliedFilters.maxGames);
    const minTechScore = parseOptionalInt(appliedFilters.minTechScore);
    const maxTechScore = parseOptionalInt(appliedFilters.maxTechScore);
    const includeTags = new Set(appliedFilters.includeTagIds);
    const excludeTags = new Set(appliedFilters.excludeTagIds);

    const filtered = list.filter((item) => {
      if (!appliedFilters.includePresets && item.entityType === 'preset') return false;

      if (appliedFilters.isNative === '1') {
        if (item.entityType !== 'data_card') return false;
        if (item.isNative !== true) return false;
      } else if (appliedFilters.isNative === '0') {
        if (item.entityType !== 'data_card') return false;
        if (item.isNative !== false) return false;
      }

      if (includeTags.size > 0 && item.entityType === 'data_card') {
        const hasAny = item.tagIds.some((id) => includeTags.has(id));
        if (!hasAny) return false;
      }
      if (includeTags.size > 0 && item.entityType === 'preset') {
        // 与线上规则对齐：预设不受标签筛选影响
      }

      if (excludeTags.size > 0 && item.entityType === 'data_card') {
        const hasExcluded = item.tagIds.some((id) => excludeTags.has(id));
        if (hasExcluded) return false;
      }

      if (minRating != null && item.rating < minRating) return false;
      if (maxRating != null && item.rating > maxRating) return false;
      if (minGames != null && item.games < minGames) return false;
      if (maxGames != null && item.games > maxGames) return false;

      if (minTechScore != null || maxTechScore != null) {
        if (item.entityType !== 'data_card') return false;
        if (typeof item.techScore !== 'number' || !Number.isFinite(item.techScore)) return false;
        if (minTechScore != null && item.techScore < minTechScore) return false;
        if (maxTechScore != null && item.techScore > maxTechScore) return false;
      }

      return true;
    });

    const order = appliedFilters.order === 'asc' ? 'asc' : 'desc';
    const sort = appliedFilters.sort === 'tech' ? 'tech' : 'rating';

    const compareText = (a: string, b: string) => a.localeCompare(b, 'zh-CN');
    const compareNumber = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

    filtered.sort((a, b) => {
      if (sort === 'tech') {
        const aNull = a.techScore == null;
        const bNull = b.techScore == null;
        if (aNull !== bNull) return aNull ? 1 : -1;

        if (a.techScore != null && b.techScore != null) {
          const tech = compareNumber(a.techScore, b.techScore);
          if (tech !== 0) return order === 'asc' ? tech : -tech;
        }

        const rating = compareNumber(a.rating, b.rating);
        if (rating !== 0) return -rating;
        const games = compareNumber(a.games, b.games);
        if (games !== 0) return -games;
      } else {
        const rating = compareNumber(a.rating, b.rating);
        if (rating !== 0) return order === 'asc' ? rating : -rating;
        const games = compareNumber(a.games, b.games);
        if (games !== 0) return -games;
      }

      const aUpdated = typeof a.ratingUpdatedAt === 'string' ? a.ratingUpdatedAt : '';
      const bUpdated = typeof b.ratingUpdatedAt === 'string' ? b.ratingUpdatedAt : '';
      if (aUpdated !== bUpdated) return bUpdated.localeCompare(aUpdated);

      if (a.entityType !== b.entityType) return compareText(a.entityType, b.entityType);
      if (a.entityId !== b.entityId) return compareText(a.entityId, b.entityId);
      return 0;
    });

    return filtered.map((item, index) => {
      const baseTier = computeArenaBaseTier(item.rating, item.games);
      const isQueen = queenKey === buildRowKey(item.entityType, item.entityId);
      const tier = applyQueenTier(baseTier, isQueen);
      return {
        ...item,
        rank: index + 1,
        tier,
      };
    });
  }, [appliedFilters, historySnapshot, isArchiveMode]);

  const historyIndexByKey = useMemo(() => {
    if (!isArchiveMode) return new Map<string, number>();
    const map = new Map<string, number>();
    historyFilteredSortedItems.forEach((item, index) => {
      map.set(`${item.entityType}:${item.entityId}`, index);
    });
    return map;
  }, [historyFilteredSortedItems, isArchiveMode]);

  const historyItemsPage = useMemo(() => {
    if (!isArchiveMode) return [] as LeaderboardItem[];
    return historyFilteredSortedItems.slice(offset, offset + limit);
  }, [historyFilteredSortedItems, isArchiveMode, limit, offset]);

  const items = useMemo<LeaderboardItem[]>(() => {
    if (!isArchiveMode) return leaderboardQuery.data?.items ?? [];
    return historyItemsPage;
  }, [historyItemsPage, isArchiveMode, leaderboardQuery.data?.items]);

  const isCanonicalPublicQuery = useMemo(() => {
    if (isArchiveMode) return false;
    return isCanonicalPublicLeaderboardQuery({
      sort: appliedFilters.sort,
      order: appliedFilters.order,
      includePresets: appliedFilters.includePresets,
      isNative: appliedFilters.isNative,
      includeTagIds: appliedFilters.includeTagIds,
      excludeTagIds: appliedFilters.excludeTagIds,
      minRating: appliedFilters.minRating,
      maxRating: appliedFilters.maxRating,
      minGames: appliedFilters.minGames,
      maxGames: appliedFilters.maxGames,
      minTechScore: appliedFilters.minTechScore,
      maxTechScore: appliedFilters.maxTechScore,
    });
  }, [appliedFilters, isArchiveMode]);

  useEffect(() => {
    if (isArchiveMode) return;
    const list = leaderboardQuery.data?.items;
    if (!Array.isArray(list) || list.length === 0) return;
    if (!isCanonicalPublicQuery) return;

    upsertArenaRankCacheFromLeaderboard({
      queue: appliedFilters.queue,
      items: list,
      maxRankSeen: offset + list.length,
    });
  }, [appliedFilters.queue, isCanonicalPublicQuery, isArchiveMode, leaderboardQuery.data?.items, offset]);

  useEffect(() => {
    setSearchResults(null);
    setSearchError(null);
    setFocusRowKey(null);
  }, [isArchiveMode, selectedSeasonId]);

  useEffect(() => {
    if (focusTimerRef.current != null) {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    lastAutoScrolledRowKeyRef.current = null;
  }, [focusRowKey]);

  useEffect(() => {
    return () => {
      if (focusTimerRef.current != null) {
        window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!focusRowKey) return;
    if (lastAutoScrolledRowKeyRef.current === focusRowKey) return;

    const existsInCurrentPage = items.some((item) => `${item.entityType}:${item.entityId}` === focusRowKey);
    if (!existsInCurrentPage) return;

    lastAutoScrolledRowKeyRef.current = focusRowKey;

    const escaped = focusRowKey.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\"');
    const selector = `[data-row-key="${escaped}"]`;
    window.requestAnimationFrame(() => {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    focusTimerRef.current = window.setTimeout(() => {
      setFocusRowKey(null);
    }, 6000);
  }, [focusRowKey, items]);

  const formatAuthorLabel = (item: LeaderboardItem): string => {
    if (item.entityType === 'preset') return '官方';
    const author = typeof item.authorName === 'string' ? item.authorName.trim() : '';
    if (author) return author;
    return isArchiveMode ? '—' : '未知';
  };

  const runSearch = async () => {
    const q = listSearch.trim();
    setSearchError(null);
    if (!q) {
      setSearchResults(null);
      setFocusRowKey(null);
      return;
    }

    if (isArchiveMode) {
      const qLower = q.toLowerCase();
      const matched = historyFilteredSortedItems.filter((item) => {
        const author = formatAuthorLabel(item);
        return (
          item.displayName.toLowerCase().includes(qLower) ||
          author.toLowerCase().includes(qLower) ||
          item.entityId.toLowerCase().includes(qLower)
        );
      }).slice(0, 10);
      setSearchResults(matched);
      return;
    }

    setIsSearching(true);
    try {
      const params = new URLSearchParams();
      params.set('q', q);
      params.set('queue', appliedFilters.queue);
      params.set('sort', appliedFilters.sort);
      params.set('order', appliedFilters.order);
      params.set('limit', '10');
      params.set('includePresets', appliedFilters.includePresets ? '1' : '0');
      params.set('isNative', appliedFilters.isNative);
      if (appliedFilters.includeTagIds.length > 0) params.set('tagIds', appliedFilters.includeTagIds.join(','));
      if (appliedFilters.excludeTagIds.length > 0) params.set('excludeTagIds', appliedFilters.excludeTagIds.join(','));
      if (appliedFilters.minRating) params.set('minRating', appliedFilters.minRating);
      if (appliedFilters.maxRating) params.set('maxRating', appliedFilters.maxRating);
      if (appliedFilters.minGames) params.set('minGames', appliedFilters.minGames);
      if (appliedFilters.maxGames) params.set('maxGames', appliedFilters.maxGames);
      if (appliedFilters.minTechScore) params.set('minTechScore', appliedFilters.minTechScore);
      if (appliedFilters.maxTechScore) params.set('maxTechScore', appliedFilters.maxTechScore);

      const data = await fetchJson<{ success: boolean; items: LeaderboardItem[]; error?: string }>(
        `/api/arena/leaderboard/search?${params.toString()}`
      );
      if (!data.success) {
        setSearchResults([]);
        setSearchError(data.error ?? '搜索失败');
        return;
      }
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setSearchResults(nextItems);
    } catch (err) {
      setSearchResults([]);
      setSearchError(String(err));
    } finally {
      setIsSearching(false);
    }
  };

  const jumpToResult = (item: LeaderboardItem) => {
    const rowKey = `${item.entityType}:${item.entityId}`;
    setFocusRowKey(rowKey);

    if (isArchiveMode) {
      const index = historyIndexByKey.get(rowKey);
      if (typeof index === 'number' && Number.isFinite(index) && index >= 0) {
        const targetOffset = Math.floor(index / limit) * limit;
        setOffset(targetOffset);
      }
      return;
    }

    const rankFromItem = typeof item.rank === 'number' && Number.isFinite(item.rank) ? Math.floor(item.rank) : 0;
    const cachedRank = rankFromItem > 0 || !isCanonicalPublicQuery
      ? null
      : getArenaCachedRank({
        queue: appliedFilters.queue,
        entityType: item.entityType,
        entityId: item.entityId,
      });
    const rank = rankFromItem > 0 ? rankFromItem : cachedRank ?? 0;

    if (rank > 0) {
      const targetOffset = Math.floor((rank - 1) / limit) * limit;
      setOffset(targetOffset);
      return;
    }

    const winRate = item.games > 0 ? Math.round((item.wins / item.games) * 1000) / 10 : null;
    const detailsNotice = `搜索结果：段位 ${item.tier} · 分 ${item.rating} · 局 ${item.games} · W/L/D ${item.wins}/${item.losses}/${item.draws}${winRate == null ? '' : ` · 胜率 ${winRate}%`}`;
    setDetailsEntity({
      entityType: item.entityType,
      entityId: item.entityId,
      displayName: item.displayName,
      authorName: item.authorName ?? null,
      pendingNotice: detailsNotice,
    });
  };

  const listIsLoading = isArchiveMode ? archiveQuery.isLoading : leaderboardQuery.isLoading;
  const listIsError = isArchiveMode ? archiveQuery.isError : leaderboardQuery.isError;
  const listError = isArchiveMode ? archiveQuery.error : leaderboardQuery.error;

  const historyTotal = isArchiveMode ? historyFilteredSortedItems.length : 0;
  const canGoPrev = offset > 0;
  const canGoNext = isArchiveMode ? offset + limit < historyTotal : items.length >= limit;
  const pageIndex = Math.floor(offset / limit) + 1;

  const appliedSummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(appliedFilters.queue === 'strict' ? '严格天梯' : '自由天梯');
    parts.push(appliedFilters.sort === 'rating' ? '按排位分排序' : '按技术值排序');
    parts.push(appliedFilters.order === 'asc' ? '升序' : '降序');
    if (appliedFilters.isNative === '1') parts.push('仅原生');
    else if (appliedFilters.isNative === '0') parts.push('仅非原生');
    if (!appliedFilters.includePresets) parts.push('不含预设');
    if (appliedFilters.includeTagIds.length > 0) parts.push(`包含标签 ${appliedFilters.includeTagIds.length} 个`);
    if (appliedFilters.excludeTagIds.length > 0) parts.push(`排除标签 ${appliedFilters.excludeTagIds.length} 个`);
    if (appliedFilters.minRating || appliedFilters.maxRating) parts.push(`分数 ${appliedFilters.minRating || '—'}~${appliedFilters.maxRating || '—'}`);
    if (appliedFilters.minGames || appliedFilters.maxGames) parts.push(`对局 ${appliedFilters.minGames || '—'}~${appliedFilters.maxGames || '—'}`);
    if (appliedFilters.minTechScore || appliedFilters.maxTechScore) parts.push(`技术值 ${appliedFilters.minTechScore || '—'}~${appliedFilters.maxTechScore || '—'}`);
    return parts.join(' · ');
  }, [appliedFilters]);

  const seasonSummary = useMemo(() => {
    if (!selectedSeason) return '';
    if (!isArchiveMode) return appliedSummary;
    const topCount = historySnapshot?.topCount ?? 0;
    const bottomCount = historySnapshot?.bottomCount ?? 0;
    const snapshotCount = historySnapshot?.items.length ?? 0;
    const totalEligible = historySnapshot?.totalEligible ?? 0;
    const snapshotLabel = historySnapshot?.snapshotMode === 'full'
      ? '全量快照'
      : topCount > 0 || bottomCount > 0 ? `Top ${topCount} + Bottom ${bottomCount}` : '快照';
    const totalLabel = totalEligible > 0 ? `全榜 ${totalEligible}` : '全榜未知';
    const prefix = isHistoryMode ? '历史赛季快照' : '当前赛季快照（测试）';
    return `${appliedSummary} · ${prefix}：${snapshotLabel}（已去重 ${snapshotCount} 条，${totalLabel}）`;
  }, [appliedSummary, historySnapshot, isArchiveMode, isHistoryMode, selectedSeason]);

  const archiveGeneratedAtLabel = useMemo(() => {
    if (!isArchiveMode) return null;
    const generatedAt = typeof archiveQuery.data?.generatedAt === 'string' ? archiveQuery.data.generatedAt.trim() : '';
    if (generatedAt) return formatDateTime(generatedAt);
    if (archiveQuery.isLoading) return '加载中...';
    if (archiveQuery.isError) return '加载失败';
    return '未知';
  }, [archiveQuery.data?.generatedAt, archiveQuery.isError, archiveQuery.isLoading, isArchiveMode]);

  const seasonArchivedAtLabel = useMemo(() => {
    if (!isHistoryMode) return null;
    const archivedAt = typeof selectedSeason?.archivedAt === 'string' ? selectedSeason.archivedAt.trim() : '';
    if (!archivedAt) return null;
    return formatDateTime(archivedAt);
  }, [isHistoryMode, selectedSeason?.archivedAt]);

  return (
    <>
      <Head>
        <title>排位排行榜 - MahoShojo Generator</title>
      </Head>

      <div className="magic-background-white">
        <div className="mx-auto w-full max-w-screen-2xl px-4 py-10 sm:px-6 lg:px-10">
          <div className="rounded-2xl bg-white/95 shadow-[0_20px_40px_rgba(0,0,0,0.10)] ring-1 ring-white/50 backdrop-blur">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-6 py-5 sm:px-8">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h1 className="truncate text-xl font-bold text-gray-900">排位排行榜</h1>
                  <select
                    value={selectedSeasonId}
                    onChange={(e) => {
                      setSelectedSeasonId(e.target.value);
                      setOffset(0);
                    }}
                    className="input-field h-8 py-1 text-sm"
                    aria-label="赛季选择"
                    disabled={seasonsQuery.isLoading || seasonsSorted.length === 0}
                  >
                    {seasonsQuery.isLoading ? <option value="">正在加载赛季...</option> : null}
                    {!seasonsQuery.isLoading && seasonsSorted.length === 0 ? <option value="">暂无赛季配置</option> : null}
                    {seasonsSorted.map((season) => (
                      <option key={season.id} value={season.id}>
                        {formatSeasonTitle(season)}{season.status === 'current' ? ' · 当前' : ' · 历史'}
                      </option>
                    ))}
                  </select>
                  {selectedSeason?.status === 'current' ? (
                    <button
                      type="button"
                      onClick={() => {
                        const next = !useSeasonSnapshot;
                        setUseSeasonSnapshot(next);
                        setOffset(0);
                        setSearchResults(null);
                        setSearchError(null);
                        setFocusRowKey(null);
                      }}
                      className={`rounded-lg border px-3 py-1 text-sm transition-colors ${
                        useSeasonSnapshot
                          ? 'border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                      title="用于测试：不改变赛季状态的前提下，查看同赛季的归档快照文件（archive_<season_id>.json）。"
                    >
                      {useSeasonSnapshot ? '查看实时榜单' : '查看快照（测试）'}
                    </button>
                  ) : null}
                  <span className="text-sm text-gray-500">每页 {limit} 条</span>
                </div>
                <div className="mt-1 text-sm text-gray-600 line-clamp-2">{seasonSummary || appliedSummary}</div>
                {selectedSeason ? (
                  <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3 text-xs text-gray-600">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-gray-800">赛季</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-800 ring-1 ring-gray-200">
                        {formatSeasonTitle(selectedSeason)}
                      </span>
                      <span className="text-gray-500">
                        {formatYmdSlash(selectedSeason.startsAt)} ~ {selectedSeason.endsAt ? formatYmdSlash(selectedSeason.endsAt) : '未定'}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                          selectedSeason.status === 'current'
                            ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                            : 'bg-gray-100 text-gray-700 ring-gray-200'
                        }`}
                      >
                        {selectedSeason.status === 'current' ? '当前赛季' : '历史赛季'}
                      </span>
                      {useSeasonSnapshot ? (
                        <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-800 ring-1 ring-purple-200">
                          快照测试
                        </span>
                      ) : null}
                    </div>
                    {isArchiveMode ? (
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
                        <span>快照生成：{archiveGeneratedAtLabel}</span>
                        {seasonArchivedAtLabel ? <span>归档标记：{seasonArchivedAtLabel}</span> : null}
                      </div>
                    ) : null}
                    <div className="mt-1 text-xs text-gray-500">{selectedSeason.description}</div>
                    {isArchiveMode ? (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-900">
                        <div>
                          提示：当前展示的是{isHistoryMode ? '历史赛季' : '当前赛季'}快照，段位/排序按当前版本规则重算，可能与结算时略有差异。
                        </div>
                        <div className="mt-1">
                          提示：点击条目后的“角色详情”读取的是当前公开卡内容，可能与快照不一致，或因下架/转私有而无法加载。
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-2 border-t border-gray-200/70 pt-2 text-xs text-gray-600">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-800">特殊规则</span>
                        {!selectedSeason.specialRules ||
                        typeof selectedSeason.specialRules !== 'object' ||
                        Object.keys(selectedSeason.specialRules).length === 0 ? (
                          <span className="text-gray-500">无</span>
                        ) : null}
                      </div>
                      {selectedSeason.specialRules && typeof selectedSeason.specialRules === 'object' ? (
                        <div className="mt-1 grid gap-1">
                          {typeof selectedSeason.specialRules.mode === 'string' && selectedSeason.specialRules.mode.trim() ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-gray-500">指定模式</span>
                              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-800 ring-1 ring-gray-200">
                                {formatBattleModeLabel(selectedSeason.specialRules.mode)}
                              </span>
                            </div>
                          ) : null}

                          {typeof selectedSeason.specialRules.scenarioPresetFilename === 'string' &&
                          selectedSeason.specialRules.scenarioPresetFilename.trim() ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-gray-500">预设情景</span>
                              <Link
                                href={`/scenario-presets/${encodeURIComponent(
                                  selectedSeasonScenarioPreset?.filename ?? selectedSeason.specialRules.scenarioPresetFilename.trim(),
                                )}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50"
                                title="打开预设情景"
                              >
                                {selectedSeasonScenarioPreset?.title ?? selectedSeason.specialRules.scenarioPresetFilename.trim()}
                                <span className="text-gray-400">↗</span>
                              </Link>
                            </div>
                          ) : null}

                          {typeof selectedSeason.specialRules.storyGuidance === 'string' && selectedSeason.specialRules.storyGuidance.trim() ? (
                            <details className="group rounded-lg bg-white px-2 py-1 ring-1 ring-gray-200">
                              <summary className="flex cursor-pointer items-center justify-between gap-2 text-[11px] font-medium text-gray-700 hover:text-gray-900 [&::-webkit-details-marker]:hidden">
                                <span>赛季故事引导（点开查看）</span>
                                <span className="text-gray-400 transition-transform group-open:rotate-180">▾</span>
                              </summary>
                              <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-gray-700">
                                {selectedSeason.specialRules.storyGuidance.trim()}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : seasonsQuery.isError ? (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
                    赛季配置加载失败：{String(seasonsQuery.error)}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <Link href="/encyclopedia/ranking" className="text-blue-600 hover:underline">排位说明</Link>
                <Link href="/arena" className="text-blue-600 hover:underline">返回竞技场</Link>
              </div>
            </header>

            <div className="px-6 py-6 sm:px-8 sm:py-8">
              <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
                <aside className="lg:sticky lg:top-6 lg:self-start">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-gray-900">筛选</div>
                      {hasPendingChanges ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
                          有未应用更改
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">已应用</span>
                      )}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                      <label className="text-sm text-gray-700">
                        天梯
                        <select
                          value={draftFilters.queue}
                          onChange={(e) => setDraftFilters((prev) => ({ ...prev, queue: e.target.value === 'free' ? 'free' : 'strict' }))}
                          className="input-field mt-1"
                        >
                          <option value="strict">严格</option>
                          <option value="free">自由</option>
                        </select>
                      </label>
                      {draftFilters.queue === 'strict' ? (
                        <div className="-mt-1 text-xs text-gray-500 sm:col-span-2 lg:col-span-1">
                          严格榜单仅展示连续公开满 3 天且审核通过的角色卡（新创建且在 10 分钟内公开的卡可豁免；预设不受影响）。
                        </div>
                      ) : null}

                      <label className="text-sm text-gray-700">
                        排序
                        <select
                          value={draftFilters.sort}
                          onChange={(e) => setDraftFilters((prev) => ({ ...prev, sort: e.target.value === 'tech' ? 'tech' : 'rating' }))}
                          className="input-field mt-1"
                        >
                          <option value="rating">排位分</option>
                          <option value="tech">技术值</option>
                        </select>
                      </label>

                      <label className="text-sm text-gray-700">
                        顺序
                        <select
                          value={draftFilters.order}
                          onChange={(e) => setDraftFilters((prev) => ({ ...prev, order: e.target.value === 'asc' ? 'asc' : 'desc' }))}
                          className="input-field mt-1"
                        >
                          <option value="desc">降序（高 → 低）</option>
                          <option value="asc">升序（低 → 高）</option>
                        </select>
                      </label>

                      <label className="text-sm text-gray-700">
                        原生性
                        <select
                          value={draftFilters.isNative}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraftFilters((prev) => ({ ...prev, isNative: v === '1' ? '1' : v === '0' ? '0' : 'any' }));
                          }}
                          className="input-field mt-1"
                        >
                          <option value="any">不限</option>
                          <option value="1">原生</option>
                          <option value="0">非原生</option>
                        </select>
                      </label>

                      <label className="text-sm text-gray-700 sm:col-span-2 lg:col-span-1">
                        预设角色
                        <div className="mt-2 flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={draftFilters.includePresets}
                            onChange={(e) => setDraftFilters((prev) => ({ ...prev, includePresets: e.target.checked }))}
                          />
                          <span>在榜单中包含预设</span>
                        </div>
                      </label>
                    </div>

                    <hr className="my-4 border-gray-200" />

                    <div className="text-sm font-medium text-gray-700">数值范围</div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm text-gray-700">
                        最低分
                        <input
                          type="number"
                          value={draftFilters.minRating}
                          onChange={(e) => setDraftFilters((prev) => ({ ...prev, minRating: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') applyDraft();
                          }}
                          className="input-field mt-1"
                          placeholder="如 800"
                        />
                      </label>
                      <label className="text-sm text-gray-700">
                        最高分
                        <input
                          type="number"
                          value={draftFilters.maxRating}
                          onChange={(e) => setDraftFilters((prev) => ({ ...prev, maxRating: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') applyDraft();
                          }}
                          className="input-field mt-1"
                          placeholder="如 1500"
                        />
                      </label>
                      <label className="text-sm text-gray-700">
                        最少对局
                        <input
                          type="number"
                          value={draftFilters.minGames}
                          onChange={(e) => setDraftFilters((prev) => ({ ...prev, minGames: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') applyDraft();
                          }}
                          className="input-field mt-1"
                          placeholder="如 5"
                        />
                      </label>
                      <label className="text-sm text-gray-700">
                        最多对局
                        <input
                          type="number"
                          value={draftFilters.maxGames}
                          onChange={(e) => setDraftFilters((prev) => ({ ...prev, maxGames: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') applyDraft();
                          }}
                          className="input-field mt-1"
                          placeholder="可留空"
                        />
                      </label>
                      <label className="text-sm text-gray-700">
                        最低技术值
                        <input
                          type="number"
                          value={draftFilters.minTechScore}
                          onChange={(e) => setDraftFilters((prev) => ({ ...prev, minTechScore: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') applyDraft();
                          }}
                          className="input-field mt-1"
                          placeholder="0-100"
                        />
                      </label>
                      <label className="text-sm text-gray-700">
                        最高技术值
                        <input
                          type="number"
                          value={draftFilters.maxTechScore}
                          onChange={(e) => setDraftFilters((prev) => ({ ...prev, maxTechScore: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') applyDraft();
                          }}
                          className="input-field mt-1"
                          placeholder="0-100"
                        />
                      </label>
                    </div>

                    <hr className="my-4 border-gray-200" />

                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-gray-700">标签筛选</div>
                        <span className="text-xs text-gray-500">包含为 OR</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsTagFilterExpanded((prev) => !prev)}
                        className="text-xs font-medium text-blue-600 hover:underline"
                        aria-expanded={isTagFilterExpanded}
                      >
                        {isTagFilterExpanded ? '收起' : '展开'}
                      </button>
                    </div>

                    {!isTagFilterExpanded ? (
                      <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                          <div>
                            包含 {draftFilters.includeTagIds.length} · 排除 {draftFilters.excludeTagIds.length}
                          </div>
                          {(draftFilters.includeTagIds.length > 0 || draftFilters.excludeTagIds.length > 0) && (
                            <button
                              type="button"
                              onClick={() => {
                                setDraftFilters((prev) => ({ ...prev, includeTagIds: [], excludeTagIds: [] }));
                              }}
                              className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline"
                            >
                              清空标签
                            </button>
                          )}
                        </div>

                        {(draftFilters.includeTagIds.length > 0 || draftFilters.excludeTagIds.length > 0) && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedTagChips.slice(0, 12).map((chip) => (
                              <button
                                key={`${chip.mode}:${chip.id}`}
                                type="button"
                                onClick={() => toggleTag(chip.mode, chip.id)}
                                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                                  chip.mode === 'include'
                                    ? 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100'
                                    : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                }`}
                                title="点击移除"
                              >
                                {chip.label}
                              </button>
                            ))}
                            {selectedTagChips.length > 12 && (
                              <div className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-500">
                                还有 {selectedTagChips.length - 12} 个…
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : tagsQuery.isLoading ? (
                      <div className="mt-2 text-sm text-gray-500">正在加载标签库...</div>
                    ) : tagsQuery.isError ? (
                      <div className="mt-2 text-sm text-red-600">标签库加载失败：{String(tagsQuery.error)}</div>
                    ) : activeTags.length === 0 ? (
                      <div className="mt-2 text-sm text-gray-500">暂无可用标签（可先运行 scripts/init-tags.ts 同步种子）</div>
                    ) : (
                      <>
                        <input
                          value={tagSearch}
                          onChange={(e) => setTagSearch(e.target.value)}
                          placeholder="搜索标签名称 / 分类 / 描述 / id..."
                          className="input-field mt-3 w-full"
                        />

                        <div className="mt-3 text-xs text-gray-500">
                          排除标签会过滤掉包含任意排除项的数据卡（预设不受标签影响）。同一标签不能同时出现在“包含”和“排除”。
                        </div>

                        <div className="mt-3">
                          <div className="mb-2 text-xs font-medium text-gray-700">包含标签（OR）</div>
                          <div className="max-h-56 overflow-auto pr-1 space-y-3">
                            {groupedFilteredTags.map(([category, categoryTags]) => (
                              <div key={`include:${category}`}>
                                <div className="text-[11px] font-medium text-gray-600">
                                  {category}（{categoryTags.length}）
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {categoryTags.map((tag) => (
                                    <button
                                      key={`include:${tag.id}`}
                                      type="button"
                                      onClick={() => toggleTag('include', tag.id)}
                                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                                        draftFilters.includeTagIds.includes(tag.id)
                                          ? 'bg-purple-600 text-white border-purple-600'
                                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                                      }`}
                                      title={tag.description ?? undefined}
                                    >
                                      {tag.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="mt-4">
                          <div className="mb-2 text-xs font-medium text-gray-700">排除标签</div>
                          <div className="max-h-56 overflow-auto pr-1 space-y-3">
                            {groupedFilteredTags.map(([category, categoryTags]) => (
                              <div key={`exclude:${category}`}>
                                <div className="text-[11px] font-medium text-gray-600">
                                  {category}（{categoryTags.length}）
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {categoryTags.map((tag) => (
                                    <button
                                      key={`exclude:${tag.id}`}
                                      type="button"
                                      onClick={() => toggleTag('exclude', tag.id)}
                                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                                        draftFilters.excludeTagIds.includes(tag.id)
                                          ? 'bg-red-600 text-white border-red-600'
                                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                                      }`}
                                      title={tag.description ?? undefined}
                                    >
                                      {tag.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={applyDraft}
                        disabled={!hasPendingChanges}
                        className="flex-1 rounded-lg bg-purple-600 px-3 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 disabled:hover:bg-purple-600"
                      >
                        应用筛选
                      </button>
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        重置
                      </button>
                    </div>
                  </div>
                </aside>

                <main className="min-w-0">
                  <div className="rounded-xl border border-gray-200 bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                      <div className="text-sm text-gray-700">
                        {listIsLoading
                          ? (isArchiveMode ? '正在加载赛季快照...' : '正在加载排行榜...')
                          : listIsError
                            ? '加载失败'
                            : `第 ${pageIndex} 页${isArchiveMode ? ' · 快照' : ''}`}
                        {!isArchiveMode && leaderboardQuery.isFetching && !leaderboardQuery.isLoading ? (
                          <span className="ml-2 text-xs text-gray-500">更新中…</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <button
                          type="button"
                          onClick={() => setOffset((v) => Math.max(0, v - limit))}
                          disabled={!canGoPrev}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white"
                        >
                          上一页
                        </button>
                        <button
                          type="button"
                          onClick={() => setOffset((v) => v + limit)}
                          disabled={!canGoNext}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white"
                        >
                          下一页
                        </button>
                      </div>
                    </div>

                    <div className="border-b border-gray-100 px-4 py-3">
                      <form
                        className="flex flex-wrap items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void runSearch();
                        }}
                      >
                        <input
                          value={listSearch}
                          onChange={(e) => setListSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setListSearch('');
                              setSearchResults(null);
                              setSearchError(null);
                              setFocusRowKey(null);
                            }
                        }}
                          className="input-field h-9 w-full sm:w-[320px]"
                          placeholder="搜索角色名 / 作者 / ID"
                          aria-label="排行榜搜索"
                        />
                        <button
                          type="submit"
                          disabled={isSearching || listIsLoading}
                          className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-gray-900"
                        >
                          {isSearching ? '搜索中…' : '搜索'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setListSearch('');
                            setSearchResults(null);
                            setSearchError(null);
                            setFocusRowKey(null);
                          }}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          清空
                        </button>
                        <span className="text-xs text-gray-500">
                          {isArchiveMode
                            ? '提示：快照模式仅在已归档范围内搜索与筛选。'
                            : '提示：搜索结果默认不计算全榜名次；若本地已缓存名次，可点击尝试跳转，否则将打开详情。'}
                        </span>
                      </form>

                      {searchError ? (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                          搜索失败：{searchError}
                        </div>
                      ) : null}

                      {searchResults ? (
                        <div className="mt-3">
                          {searchResults.length === 0 ? (
                            <div className="text-xs text-gray-500">未找到匹配结果。</div>
                          ) : (
                            <div className="grid gap-2">
                              {searchResults.map((item) => {
                                const author = formatAuthorLabel(item);
                                const approx = !isArchiveMode && isCanonicalPublicQuery
                                  ? getArenaApproxRankLabel({ queue: appliedFilters.queue, entityType: item.entityType, entityId: item.entityId })
                                  : null;
                                const rankTitle = approx?.title ?? (item.rank > 0 ? `全榜 #${item.rank}` : '名次未计算');
                                const rankLabel = item.rank > 0 ? `#${item.rank}` : approx?.label ?? '#—';
                                const canJump = item.rank > 0 || Boolean(approx);
                                const { display: displayName, full: fullName } = buildTitleDisplay(item.displayName || '未命名');
                                return (
                                  <button
                                    key={`search:${item.entityType}:${item.entityId}:${item.rank}`}
                                    type="button"
                                    onClick={() => jumpToResult(item)}
                                    className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left hover:bg-gray-50"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-semibold text-gray-900" title={fullName}>
                                        <span title={rankTitle}>{rankLabel}</span> · {displayName}
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
                                          {item.entityType === 'preset' ? '预设' : '数据卡'}
                                        </span>
                                        <span className="min-w-0 truncate">作者：{author}</span>
                                        <span className="hidden sm:inline">分：{item.rating}</span>
                                        <span className="hidden sm:inline">局：{item.games}</span>
                                        <span className="hidden md:inline">id：{item.entityId}</span>
                                      </div>
                                    </div>
                                    <span className="text-xs text-gray-500">{canJump ? '点击跳转' : '查看详情'}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>

                    {listIsError ? (
                      <div className="px-4 py-6">
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                          <div className="font-medium">排行榜加载失败</div>
                          <div className="mt-1 break-words text-xs text-red-700">{String(listError)}</div>
                          <button
                            type="button"
                            onClick={() => {
                              if (isArchiveMode) void archiveQuery.refetch();
                              else void leaderboardQuery.refetch();
                            }}
                            className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                          >
                            重试
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-[760px] w-full text-sm">
                          <thead className="sticky top-0 bg-gray-50">
                            <tr className="text-left text-gray-600 border-b">
                              <th className="px-4 py-3 pr-3 font-medium">#</th>
                              <th className="px-4 py-3 pr-3 font-medium">角色</th>
                              <th className="px-4 py-3 pr-3 font-medium">段位</th>
                              <th className="px-4 py-3 pr-3 font-medium">分</th>
                              <th className="hidden sm:table-cell px-4 py-3 pr-3 font-medium">局</th>
                              <th className="hidden md:table-cell px-4 py-3 pr-3 font-medium">W/L/D</th>
                              <th className="hidden lg:table-cell px-4 py-3 pr-3 font-medium">胜率</th>
                              <th className="hidden sm:table-cell px-4 py-3 pr-3 font-medium">技术值</th>
                              <th className="hidden sm:table-cell px-4 py-3 pr-3 font-medium">原生</th>
                            </tr>
                          </thead>
                          <tbody>
                            {listIsLoading ? (
                              <tr>
                                <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                                  {isArchiveMode ? '正在加载赛季快照...' : '正在加载排行榜...'}
                                </td>
                              </tr>
                            ) : items.length === 0 ? (
                              <tr>
                                <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                                  暂无数据
                                </td>
                              </tr>
	                            ) : (
	                              items.map((item) => {
                                  const rowKey = `${item.entityType}:${item.entityId}`;
                                  const isFocused = rowKey === focusRowKey;
	                                const winRate = item.games > 0 ? Math.round((item.wins / item.games) * 1000) / 10 : null;
	                                const authorName = formatAuthorLabel(item);
	                                const { display: displayName, full: fullName } = buildTitleDisplay(item.displayName || '未命名');
	                                const tagPreviewIds = item.tagIds.slice(0, 4);
	                                const remainingTagCount = Math.max(0, item.tagIds.length - tagPreviewIds.length);
	                                const nativeBadge = item.isNative == null ? (
	                                  <span className="text-gray-500">-</span>
	                                ) : item.isNative ? (
	                                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
	                                    原生
	                                  </span>
	                                ) : (
	                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
	                                    非原
	                                  </span>
	                                );
	                                return (
	                                  <tr
	                                    key={rowKey}
                                      data-row-key={rowKey}
	                                    className={`border-b last:border-b-0 ${isFocused ? 'bg-amber-50/80' : 'hover:bg-gray-50/70'}`}
	                                  >
                                    <td className="px-4 py-3 pr-3 text-gray-500">{item.rank}</td>
	                                    <td className="px-4 py-3 pr-3">
	                                      <div className="min-w-0">
	                                        <button
	                                          type="button"
	                                          onClick={() => {
	                                            const detailsNotice = `${isArchiveMode ? (isHistoryMode ? '历史快照' : '快照测试') : '当前榜单'}：#${item.rank} · 段位 ${item.tier} · 分 ${item.rating} · 局 ${item.games} · W/L/D ${item.wins}/${item.losses}/${item.draws}${winRate == null ? '' : ` · 胜率 ${winRate}%`}`;
	                                            setDetailsEntity({
	                                              entityType: item.entityType,
	                                              entityId: item.entityId,
	                                              displayName: item.displayName,
	                                              authorName: item.authorName ?? null,
	                                              pendingNotice: detailsNotice,
	                                            });
	                                          }}
	                                          className="block w-full truncate text-left font-medium text-gray-900 hover:underline underline-offset-2"
	                                          aria-label={`查看角色详情：${fullName}`}
	                                          title={fullName}
	                                        >
	                                          {displayName}
	                                        </button>
	                                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
	                                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
	                                            {item.entityType === 'preset' ? '预设' : '数据卡'}
	                                          </span>
	                                          <span className="min-w-0 truncate">作者：{authorName}</span>
	                                          <span className="sm:hidden inline-flex items-center gap-1">
	                                            <span>技术：</span>
	                                            <TechBadge techScore={item.techScore} techLevel={item.techLevel} className="text-gray-600" />
	                                          </span>
	                                          <span className="sm:hidden inline-flex items-center gap-1">
	                                            <span>原生：</span>
	                                            {nativeBadge}
	                                          </span>
	                                          <span className="hidden lg:inline">id：{item.entityId}</span>
	                                        </div>
	                                        {tagPreviewIds.length > 0 ? (
	                                          <div className="mt-2 hidden sm:flex flex-wrap gap-1.5">
	                                            {tagPreviewIds.map((tagId) => {
	                                              const tag = tagById.get(tagId);
	                                              const label = tag?.name ?? tagId;
	                                              return (
	                                                <span
	                                                  key={tagId}
	                                                  className="max-w-[10rem] truncate rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800 ring-1 ring-violet-200"
	                                                  title={tag?.description ?? label}
	                                                >
	                                                  {label}
	                                                </span>
	                                              );
	                                            })}
	                                            {remainingTagCount > 0 ? (
	                                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200">
	                                                +{remainingTagCount}
	                                              </span>
	                                            ) : null}
	                                          </div>
	                                        ) : null}
	                                      </div>
	                                    </td>
	                                    <td className="px-4 py-3 pr-3"><TierBadge tier={item.tier} /></td>
	                                    <td className="px-4 py-3 pr-3 font-mono text-gray-900">{item.rating}</td>
	                                    <td className="hidden sm:table-cell px-4 py-3 pr-3 font-mono text-gray-900">{item.games}</td>
                                    <td className="hidden md:table-cell px-4 py-3 pr-3 font-mono text-gray-900">
                                      {item.wins}/{item.losses}/{item.draws}
                                    </td>
                                    <td className="hidden lg:table-cell px-4 py-3 pr-3 font-mono text-gray-900">
                                      {winRate == null ? '-' : `${winRate}%`}
                                    </td>
	                                    <td className="hidden sm:table-cell px-4 py-3 pr-3">
	                                      <TechBadge techScore={item.techScore} techLevel={item.techLevel} />
	                                    </td>
	                                    <td className="hidden sm:table-cell px-4 py-3 pr-3">
	                                      {nativeBadge}
	                                    </td>
	                                  </tr>
	                                );
	                              })
	                            )}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-sm">
                      <div className="text-gray-500">
                        当前：第 {pageIndex} 页 · 偏移 {offset}（每页 {limit}）
                        {hasPendingChanges ? <span className="ml-2 text-amber-700">（有未应用更改）</span> : null}
                        {isArchiveMode ? (
                          <div className="mt-1 text-xs text-gray-500">
                            {isHistoryMode ? '历史赛季结算快照' : '当前赛季快照（测试）'}：
                            {historySnapshot?.snapshotMode === 'full'
                              ? '全量快照'
                              : `Top ${historySnapshot?.topCount ?? 0} + Bottom ${historySnapshot?.bottomCount ?? 0}`}
                            （已去重 {historySnapshot?.items.length ?? 0} 条 / 全榜 {historySnapshot?.totalEligible ? historySnapshot.totalEligible : '—'}）。
                            仅在快照范围内支持筛选/搜索/排序/分页。
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setOffset((v) => Math.max(0, v - limit))}
                          disabled={!canGoPrev}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white"
                        >
                          上一页
                        </button>
                        <button
                          type="button"
                          onClick={() => setOffset((v) => v + limit)}
                          disabled={!canGoNext}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white"
                        >
                          下一页
                        </button>
                      </div>
                    </div>
                  </div>
                </main>
              </div>
            </div>
          </div>
        </div>
      </div>

      <LeaderboardEntityDetailsModal
        isOpen={Boolean(detailsEntity)}
        onClose={() => setDetailsEntity(null)}
        entity={detailsEntity}
      />
    </>
  );
}
