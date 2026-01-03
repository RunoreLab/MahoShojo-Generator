'use client';

import Head from 'next/head';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { TierBadge } from '@/components/ranking/TierBadge';

type Queue = 'strict' | 'free';
type Sort = 'rating' | 'tech';
type NativeFilter = 'any' | '1' | '0';

type RankingFilters = {
  queue: Queue;
  sort: Sort;
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

export function RankingPage() {
  const [draftFilters, setDraftFilters] = useState<RankingFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<RankingFilters>(defaultFilters);
  const [offset, setOffset] = useState(0);
  const [tagSearch, setTagSearch] = useState('');
  const [isTagFilterExpanded, setIsTagFilterExpanded] = useState(false);
  const limit = 50;

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
  };

  const resetFilters = () => {
    setDraftFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setTagSearch('');
    setOffset(0);
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
  });

  const items = leaderboardQuery.data?.items ?? [];

  const canGoPrev = offset > 0;
  const canGoNext = items.length >= limit;
  const pageIndex = Math.floor(offset / limit) + 1;

  const appliedSummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(appliedFilters.queue === 'strict' ? '严格梯子' : '自由梯子');
    parts.push(appliedFilters.sort === 'rating' ? '按排位分排序' : '按技术值排序');
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

  return (
    <>
      <Head>
        <title>排位排行榜 - MahoShojo Generator</title>
      </Head>

      <div className="magic-background-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
          <div className="rounded-2xl bg-white/95 shadow-[0_20px_40px_rgba(0,0,0,0.10)] ring-1 ring-white/50 backdrop-blur">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-6 py-5 sm:px-8">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h1 className="truncate text-xl font-bold text-gray-900">排位排行榜</h1>
                  <span className="text-sm text-gray-500">每页 {limit} 条</span>
                </div>
                <div className="mt-1 text-sm text-gray-600 line-clamp-2">{appliedSummary}</div>
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
                        梯子
                        <select
                          value={draftFilters.queue}
                          onChange={(e) => setDraftFilters((prev) => ({ ...prev, queue: e.target.value === 'free' ? 'free' : 'strict' }))}
                          className="input-field mt-1"
                        >
                          <option value="strict">严格</option>
                          <option value="free">自由</option>
                        </select>
                      </label>

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
                          placeholder="如 900"
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
                          placeholder="如 1600"
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
                        {leaderboardQuery.isLoading ? '正在加载排行榜...' : leaderboardQuery.isError ? '加载失败' : `第 ${pageIndex} 页`}
                        {leaderboardQuery.isFetching && !leaderboardQuery.isLoading ? (
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

                    {leaderboardQuery.isError ? (
                      <div className="px-4 py-6">
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                          <div className="font-medium">排行榜加载失败</div>
                          <div className="mt-1 break-words text-xs text-red-700">{String(leaderboardQuery.error)}</div>
                          <button
                            type="button"
                            onClick={() => void leaderboardQuery.refetch()}
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
                            {leaderboardQuery.isLoading ? (
                              <tr>
                                <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                                  正在加载排行榜...
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
                                const winRate = item.games > 0 ? Math.round((item.wins / item.games) * 1000) / 10 : null;
                                return (
                                  <tr
                                    key={`${item.entityType}:${item.entityId}`}
                                    className="border-b last:border-b-0 hover:bg-gray-50/70"
                                  >
                                    <td className="px-4 py-3 pr-3 text-gray-500">{item.rank}</td>
                                    <td className="px-4 py-3 pr-3">
                                      <div className="min-w-0">
                                        <div className="truncate font-medium text-gray-900">{item.displayName}</div>
                                        <div className="mt-0.5 text-xs text-gray-500">
                                          {item.entityType === 'preset' ? '预设' : '数据卡'}
                                          <span className="hidden lg:inline"> · id：{item.entityId}</span>
                                        </div>
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
                                    <td className="hidden sm:table-cell px-4 py-3 pr-3 font-mono text-gray-900">
                                      {item.techScore == null ? '-' : `${item.techScore}${item.techLevel ? ` (${item.techLevel})` : ''}`}
                                    </td>
                                    <td className="hidden sm:table-cell px-4 py-3 pr-3">
                                      {item.isNative == null ? (
                                        <span className="text-gray-500">-</span>
                                      ) : item.isNative ? (
                                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                                          原生
                                        </span>
                                      ) : (
                                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
                                          非原生
                                        </span>
                                      )}
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
    </>
  );
}
