'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type ComponentType } from 'react';
import type { PublicRankingItem as LeaderboardItem, PublicSeasonMeta as SeasonMeta, PublicRankingTag as Tag,
  PublicRankingRequest, PublicRankingData } from '@mahoshojo/contracts/public-ranking';
import { defaultFilters, normalizeFilters, filtersKey, LIVE_LEADERBOARD_TOP_RANK_LIMIT, formatBattleModeLabel,
  deriveRankingArchiveSnapshot, filterRankingArchive, getCurrentSeason, formatSeasonTitle, formatYmdSlash,
  rankingTransportFilters, type RankingFilters } from '@mahoshojo/domain/public-ranking';
import { getScenarioPresetByFilename } from '@mahoshojo/domain/scenario-presets';
import { TechBadge, TierBadge, buildTitleDisplay } from '../card-library';
import { PageJump } from '../pagination';
import { LeaderboardSeasonExtrema } from './LeaderboardSeasonExtrema';
import { formatRankingDateTime as formatDateTime, isMissingRankingArchive } from './presentation';

export type PublicRankingReader = <R extends PublicRankingRequest>(request: R, signal?: AbortSignal) => Promise<PublicRankingData<R['kind']>>;
export type RankingDetailsTarget = Pick<LeaderboardItem, 'entityType' | 'entityId' | 'displayName' | 'authorName'> & { pendingNotice: string };
export type RankingQueryResult<T> = { data?: T; isLoading: boolean; isFetching?: boolean; isError: boolean; error: unknown; refetch: () => unknown };
export type RankingQueryHook = <R extends PublicRankingRequest>(options: { request: R; enabled?: boolean; staleTime?: number }) => RankingQueryResult<PublicRankingData<R['kind']>>;
export type RankingLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
export type RankingRankCache = {
  isCanonicalQuery: (filters: RankingFilters) => boolean;
  getRank: (entity: { queue: 'strict' | 'free'; entityType: LeaderboardItem['entityType']; entityId: string }) => number | null;
  onLiveItems: (page: { queue: 'strict' | 'free'; items: LeaderboardItem[]; maxRankSeen: number }) => void;
};
export type RankingPageViewProps = {
  useRankingQuery: RankingQueryHook;
  readRanking: PublicRankingReader;
  Link: ComponentType<RankingLinkProps>;
  cache?: RankingRankCache;
  onOpenEntityDetails?: (target: RankingDetailsTarget) => void;
  canOpenEntityDetails?: (target: Pick<RankingDetailsTarget, 'entityType' | 'entityId'>) => boolean;
  canOpenScenarioPresets?: boolean;
};

export function RankingPageView({ useRankingQuery, readRanking, Link, cache, onOpenEntityDetails, canOpenEntityDetails, canOpenScenarioPresets = false }: RankingPageViewProps) {
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
  const canViewDetails = (target: Pick<RankingDetailsTarget, 'entityType' | 'entityId'>) => Boolean(onOpenEntityDetails) && (canOpenEntityDetails?.(target) ?? true);
  const setDetailsEntity = (target: RankingDetailsTarget) => { if (canViewDetails(target)) onOpenEntityDetails?.(target); };
  const viewRef = useRef<HTMLDivElement | null>(null);
  const lastAutoScrolledRowKeyRef = useRef<string | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const limit = 50;
  const searchGenerationRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const cancelSearch = useCallback(() => {
    searchGenerationRef.current += 1;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setIsSearching(false);
  }, []);
  useEffect(() => () => {
    searchGenerationRef.current += 1;
    searchAbortRef.current?.abort();
  }, []);


  const seasonsQuery = useRankingQuery({
    request: { kind: 'seasons' },
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

  const archiveQuery = useRankingQuery({
    request: { kind: 'archive', seasonId: selectedSeasonId },
    enabled: Boolean(selectedSeasonId) && isArchiveMode,
    staleTime: Infinity,
  });

  const tagsQuery = useRankingQuery({
    request: { kind: 'tags' },
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
    cancelSearch();
    const normalizedDraft = normalizeFilters(draftFilters);
    setAppliedFilters(normalizedDraft);
    setOffset(0);
    setSearchResults(null);
    setSearchError(null);
    setFocusRowKey(null);
  };

  const resetFilters = () => {
    cancelSearch();
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

  const leaderboardQuery = useRankingQuery({
    request: { kind: 'leaderboard', filters: rankingTransportFilters(appliedFilters), limit, offset },
    staleTime: 10_000,
    enabled: !isArchiveMode,
  });

  const historySnapshot = useMemo(() => isArchiveMode && archiveQuery.data
    ? deriveRankingArchiveSnapshot(archiveQuery.data, appliedFilters.queue) : null,
  [appliedFilters.queue, archiveQuery.data, isArchiveMode]);
  const historyFilteredSortedItems = useMemo(() => isArchiveMode
    ? filterRankingArchive(historySnapshot, appliedFilters) : [], [appliedFilters, historySnapshot, isArchiveMode]);

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

  const isCanonicalPublicQuery = !isArchiveMode && Boolean(cache?.isCanonicalQuery(appliedFilters));

  useEffect(() => {
    if (isArchiveMode) return;
    const list = leaderboardQuery.data?.items;
    if (!Array.isArray(list) || list.length === 0) return;
    if (!isCanonicalPublicQuery) return;

    cache?.onLiveItems({
      queue: appliedFilters.queue,
      items: list,
      maxRankSeen: offset + list.length,
    });
  }, [appliedFilters.queue, isCanonicalPublicQuery, isArchiveMode, leaderboardQuery.data?.items, offset, cache]);

  useEffect(() => {
    cancelSearch();
    setSearchResults(null);
    setSearchError(null);
    setFocusRowKey(null);
  }, [appliedFilters, isArchiveMode, selectedSeasonId, cancelSearch]);

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

    const frame = window.requestAnimationFrame(() => {
      const el = Array.from(viewRef.current?.querySelectorAll<HTMLElement>('[data-row-key]') ?? [])
        .find((row) => row.dataset.rowKey === focusRowKey);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    focusTimerRef.current = window.setTimeout(() => {
      setFocusRowKey(null);
    }, 6000);
    return () => window.cancelAnimationFrame(frame);
  }, [focusRowKey, items]);

  const formatAuthorLabel = (item: LeaderboardItem): string => {
    if (item.entityType === 'preset') return '官方';
    const author = typeof item.authorName === 'string' ? item.authorName.trim() : '';
    if (author) return author;
    return isArchiveMode ? '—' : '未知';
  };

  const runSearch = async () => {
    cancelSearch();
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

    cancelSearch();
    const generation = searchGenerationRef.current;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setIsSearching(true);
    try {
      const data = await readRanking({ kind: 'search', q, limit: 10, filters: rankingTransportFilters(appliedFilters) }, controller.signal);
      if (generation !== searchGenerationRef.current || controller.signal.aborted) return;
      setSearchResults(data.items);
    } catch (err) {
      if (generation !== searchGenerationRef.current || controller.signal.aborted) return;
      setSearchResults([]);
      setSearchError(String(err));
    } finally {
      if (generation === searchGenerationRef.current && !controller.signal.aborted) setIsSearching(false);
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
    const cachedRankRaw = rankFromItem > 0 || !isCanonicalPublicQuery
      ? null
      : cache?.getRank({
        queue: appliedFilters.queue,
        entityType: item.entityType,
        entityId: item.entityId,
      });
    const cachedRank =
      typeof cachedRankRaw === 'number' && Number.isFinite(cachedRankRaw) && cachedRankRaw > 0 && cachedRankRaw <= 300
        ? Math.floor(cachedRankRaw)
        : null;
    const rank = rankFromItem > 0 ? rankFromItem : cachedRank ?? 0;

    if (rank > 0) {
      const targetOffset = Math.floor((rank - 1) / limit) * limit;
      setOffset(targetOffset);
      return;
    }

    const winRate = item.games > 0 ? Math.round((item.wins / item.games) * 1000) / 10 : null;
    const detailsNotice = `搜索结果：段位 ${item.tier} · 分 ${item.rating} · 局 ${item.games} · W/L/D ${item.wins}/${item.losses}/${item.draws}${winRate == null ? '' : ` · 胜率 ${winRate}%`}`;
    setDetailsEntity?.({
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
  const canGoNext = isArchiveMode
    ? offset + limit < historyTotal
    : items.length >= limit && offset + limit < LIVE_LEADERBOARD_TOP_RANK_LIMIT;
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
      <div ref={viewRef} className="magic-background-white">
        <div className="mx-auto w-full max-w-screen-2xl px-4 pb-10 pt-4 sm:px-6 lg:px-10">
          <div className="rounded-2xl bg-white/95 shadow-[0_20px_40px_rgba(0,0,0,0.10)] ring-1 ring-white/50 backdrop-blur">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-6 py-5 sm:px-8">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h1 className="truncate text-xl font-bold text-gray-900">排位排行榜</h1>
                  <select
                    value={selectedSeasonId}
                    onChange={(e) => {
                      cancelSearch();
                      setSearchResults(null);
                      setSearchError(null);
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
                        cancelSearch();
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
                        {onOpenEntityDetails ? <div className="mt-1">
                          提示：点击条目后的“角色详情”读取的是当前公开卡内容，可能与快照不一致，或因下架/转私有而无法加载。
                        </div> : null}
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
                              {canOpenScenarioPresets ? (
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
                              ) : <span>{selectedSeasonScenarioPreset?.title ?? selectedSeason.specialRules.scenarioPresetFilename.trim()}</span>}

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
                            : `第 ${pageIndex} 页${isArchiveMode ? ' · 快照' : ' · Top300'}`}
                        {!isArchiveMode && leaderboardQuery.isFetching && !leaderboardQuery.isLoading ? (
                          <span className="ml-2 text-xs text-gray-500">更新中…</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {isArchiveMode && <PageJump
                          currentPage={pageIndex}
                          totalPages={Math.max(1, Math.ceil(historyTotal / limit))}
                          onPageChange={(page) => setOffset((page - 1) * limit)}
                          disabled={listIsLoading || listIsError}
                          label="跳转到赛季快照页"
                        />}
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
                          onClick={() => setOffset((v) => Math.min(v + limit, isArchiveMode ? Math.max(0, Math.ceil(historyTotal / limit) - 1) * limit : LIVE_LEADERBOARD_TOP_RANK_LIMIT - limit))}
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
                          onChange={(e) => { cancelSearch(); setListSearch(e.target.value); }}
                          maxLength={80}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              cancelSearch();
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
                            cancelSearch();
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
                            : onOpenEntityDetails ? '提示：搜索结果不提供精确名次（仅 Top300 在排行榜页展示名次）；若本地缓存过 Top300 名次，可点击跳转，否则将打开详情。' : '提示：搜索结果不提供精确名次，仅 Top300 在排行榜页展示名次。'}
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
                                const cachedRankRaw = !isArchiveMode && isCanonicalPublicQuery
                                  ? cache?.getRank({ queue: appliedFilters.queue, entityType: item.entityType, entityId: item.entityId })
                                  : null;
                                const cachedRank =
                                  typeof cachedRankRaw === 'number' && Number.isFinite(cachedRankRaw) && cachedRankRaw > 0 && cachedRankRaw <= 300
                                    ? Math.floor(cachedRankRaw)
                                    : null;
                                const rank = item.rank > 0 ? item.rank : cachedRank ?? 0;
                                const rankTitle = rank > 0 ? `${isArchiveMode ? '快照' : 'Top300'} #${rank}` : '名次仅在 Top300 展示';
                                const rankLabel = rank > 0 ? `#${rank}` : '#—';
                                const canJump = rank > 0;
                                const SearchResult = canJump || canViewDetails(item) ? 'button' : 'div';
                                const { display: displayName, full: fullName } = buildTitleDisplay(item.displayName || '未命名');
                                return (
                                  <SearchResult
                                    key={`search:${item.entityType}:${item.entityId}:${item.rank}`}
                                    type={canJump || canViewDetails(item) ? 'button' : undefined}
                                    onClick={canJump || canViewDetails(item) ? () => jumpToResult(item) : undefined}
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
                                    <span className="text-xs text-gray-500">{canJump ? '点击跳转' : canViewDetails(item) ? '查看详情' : '正文未收录'}</span>
                                  </SearchResult>
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
                          <div className="font-medium">{isArchiveMode && isMissingRankingArchive(listError) ? '此赛季尚无归档快照' : '排行榜加载失败'}</div>
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
                                    const EntityName = canViewDetails(item) ? 'button' : 'span';
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
	                                        <EntityName
	                                          type={canViewDetails(item) ? 'button' : undefined}
	                                          onClick={canViewDetails(item) ? () => {
	                                            const detailsNotice = `${isArchiveMode ? (isHistoryMode ? '历史快照' : '快照测试') : '当前榜单'}：#${item.rank} · 段位 ${item.tier} · 分 ${item.rating} · 局 ${item.games} · W/L/D ${item.wins}/${item.losses}/${item.draws}${winRate == null ? '' : ` · 胜率 ${winRate}%`}`;
	                                            setDetailsEntity?.({
	                                              entityType: item.entityType,
	                                              entityId: item.entityId,
	                                              displayName: item.displayName,
	                                              authorName: item.authorName ?? null,
	                                              pendingNotice: detailsNotice,
	                                            });
	                                          } : undefined}
	                                          className={`block w-full truncate text-left font-medium text-gray-900 ${canViewDetails(item) ? 'hover:underline underline-offset-2' : ''}`}
	                                          aria-label={canViewDetails(item) ? `查看角色详情：${fullName}` : undefined}
	                                          title={canViewDetails(item) ? fullName : `${fullName}（此客户端未收录该正文）`}
	                                        >
	                                          {displayName}
	                                        </EntityName>
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
                                          {appliedFilters.queue === 'strict' &&
                                          (item.seasonPeak || item.seasonLow || item.seasonPeakTier) ? (
                                            <div className="mt-2" data-season-extrema-block="1">
                                              <LeaderboardSeasonExtrema
                                                seasonPeak={item.seasonPeak ?? null}
                                                seasonPeakTier={item.seasonPeakTier ?? null}
                                                seasonLow={item.seasonLow ?? null}
                                              />
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
                        当前：第 {pageIndex} 页 · 偏移 {offset}（每页 {limit}{isArchiveMode ? '' : ' · Top300'}）
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
                      <div className="flex flex-wrap items-center gap-2">
                        {isArchiveMode && <PageJump
                          currentPage={pageIndex}
                          totalPages={Math.max(1, Math.ceil(historyTotal / limit))}
                          onPageChange={(page) => setOffset((page - 1) * limit)}
                          disabled={listIsLoading || listIsError}
                          label="跳转到赛季快照页"
                        />}
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
                          onClick={() => setOffset((v) => Math.min(v + limit, isArchiveMode ? Math.max(0, Math.ceil(historyTotal / limit) - 1) * limit : LIVE_LEADERBOARD_TOP_RANK_LIMIT - limit))}
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

    </>
  );
}
