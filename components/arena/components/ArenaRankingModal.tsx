'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { LeaderboardEntityDetailsModal, type LeaderboardEntityDetailsTarget } from '@/components/ranking/LeaderboardEntityDetailsModal';
import { TechBadge } from '@/components/ranking/TechBadge';
import { TierBadge } from '@/components/ranking/TierBadge';
import { addUsedCard, isCardUsed } from '@/lib/localStorage';
import { buildTitleDisplay } from '@/lib/text';
import type { Preset } from '@/lib/presets';
import type { SeasonsConfig } from '@/lib/seasons';
import { formatSeasonTitle, getCurrentSeason } from '@/lib/seasons';

import { useBattleActions } from '../hooks/useBattleActions';
import { usePresetQuery } from '../hooks/useArenaData';
import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, CombatantData, MAX_COMBATANTS } from '../types';
import { validateCanshouData, validateMagicalGirlData } from '../utils/characterValidator';

type Queue = 'strict' | 'free';
type Sort = 'rating' | 'tech';

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
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
};

export function ArenaRankingModal(props: { isOpen: boolean; onClose: () => void }) {
  const { isOpen, onClose } = props;
  const { handleSelectDataCard } = useBattleActions();

  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const addCombatant = useBattleSelector((state) => state.addCombatant);
  const removeCombatant = useBattleSelector((state) => state.removeCombatant);
  const setError = useBattleSelector((state) => state.setError);

  const { data: presets } = usePresetQuery();

  const [queue, setQueue] = useState<Queue>('strict');
  const [sort, setSort] = useState<Sort>('rating');
  const [includePresets, setIncludePresets] = useState(true);
  const [isNative, setIsNative] = useState<'any' | '1' | '0'>('any');
  const [includeTagIds, setIncludeTagIds] = useState<string[]>([]);
  const [excludeTagIds, setExcludeTagIds] = useState<string[]>([]);
  const [isTagFilterExpanded, setIsTagFilterExpanded] = useState(false);
  const [minRating, setMinRating] = useState('');
  const [maxRating, setMaxRating] = useState('');
  const [minGames, setMinGames] = useState('');
  const [maxGames, setMaxGames] = useState('');
  const [minTechScore, setMinTechScore] = useState('');
  const [maxTechScore, setMaxTechScore] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 30;
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [detailsEntity, setDetailsEntity] = useState<LeaderboardEntityDetailsTarget | null>(null);

  const selectedPresetFilenames = useMemo(() => {
    return new Set(
      combatants
        .filter((item): item is CombatantData => 'data' in item && 'filename' in item)
        .filter((item) => item.isPreset)
        .map((item) => item.filename),
    );
  }, [combatants]);

  const selectedDataCardIds = useMemo(() => {
    return new Set(
      combatants
        .filter((item): item is CombatantData => 'data' in item && 'sourceDataCardId' in item)
        .map((item) => (typeof item.sourceDataCardId === 'string' ? item.sourceDataCardId : null))
        .filter((id): id is string => Boolean(id)),
    );
  }, [combatants]);

  const presetByFilename = useMemo(() => {
    const map = new Map<string, Preset>();
    (presets ?? []).forEach((preset) => map.set(preset.filename, preset));
    return map;
  }, [presets]);

  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: () => fetchJson<{ success: boolean; tags: Tag[] }>('/api/tags'),
    staleTime: 60_000,
    enabled: isOpen,
  });

  const seasonsQuery = useQuery({
    queryKey: ['seasonsConfig'],
    queryFn: () => fetchJson<SeasonsConfig>('/config/seasons.json'),
    staleTime: 60_000,
    enabled: isOpen,
  });

  const currentSeason = useMemo(() => getCurrentSeason(seasonsQuery.data), [seasonsQuery.data]);

  const activeTags = useMemo(
    () => (tagsQuery.data?.tags ?? []).filter((t) => t.isActive),
    [tagsQuery.data?.tags],
  );

  const tagById = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const tag of activeTags) map.set(tag.id, tag);
    return map;
  }, [activeTags]);

  const groupedActiveTags = useMemo(() => {
    const sorted = activeTags.slice().sort((a, b) => {
      const category = (a.category ?? '').localeCompare(b.category ?? '', 'zh-CN');
      if (category !== 0) return category;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    const map = new Map<string, Tag[]>();
    for (const tag of sorted) {
      const key = tag.category ?? '未分类';
      const list = map.get(key) ?? [];
      list.push(tag);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'zh-CN'));
  }, [activeTags]);

  const selectedTagChips = useMemo(() => {
    const chips: Array<{ mode: 'include' | 'exclude'; id: string; label: string }> = [];
    for (const id of includeTagIds) chips.push({ mode: 'include', id, label: tagById.get(id)?.name ?? id });
    for (const id of excludeTagIds) chips.push({ mode: 'exclude', id, label: tagById.get(id)?.name ?? id });
    return chips;
  }, [excludeTagIds, includeTagIds, tagById]);

  const leaderboardQuery = useQuery({
    queryKey: [
      'arenaLeaderboardModal',
      queue,
      sort,
      includePresets,
      isNative,
      includeTagIds.join(','),
      excludeTagIds.join(','),
      minRating,
      maxRating,
      minGames,
      maxGames,
      minTechScore,
      maxTechScore,
      offset,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('queue', queue);
      params.set('sort', sort);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      params.set('includePresets', includePresets ? '1' : '0');
      params.set('isNative', isNative);
      if (includeTagIds.length > 0) params.set('tagIds', includeTagIds.join(','));
      if (excludeTagIds.length > 0) params.set('excludeTagIds', excludeTagIds.join(','));
      if (minRating.trim()) params.set('minRating', minRating.trim());
      if (maxRating.trim()) params.set('maxRating', maxRating.trim());
      if (minGames.trim()) params.set('minGames', minGames.trim());
      if (maxGames.trim()) params.set('maxGames', maxGames.trim());
      if (minTechScore.trim()) params.set('minTechScore', minTechScore.trim());
      if (maxTechScore.trim()) params.set('maxTechScore', maxTechScore.trim());
      return fetchJson<{ success: boolean; items: LeaderboardItem[] }>(`/api/arena/leaderboard?${params.toString()}`);
    },
    staleTime: 10_000,
    enabled: isOpen,
  });

  const items = leaderboardQuery.data?.items ?? [];

  const canGoPrev = offset > 0;
  const canGoNext = items.length >= limit;

  const toggleIncludeTag = (tagId: string) => {
    setOffset(0);
    setIncludeTagIds((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const toggleExcludeTag = (tagId: string) => {
    setOffset(0);
    setExcludeTagIds((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const handleAddFromLeaderboard = async (item: LeaderboardItem) => {
    if (addingKey) return;

    const existingCombatantsCount = combatants.filter((c) => 'data' in c).length;
    if (existingCombatantsCount >= MAX_COMBATANTS) {
      setError(`❌ 最多只能选择 ${MAX_COMBATANTS} 位参战者。`);
      return;
    }

    const key = `${item.entityType}:${item.entityId}`;
    setAddingKey(key);
    try {
      if (item.entityType === 'data_card') {
        if (selectedDataCardIds.has(item.entityId)) return;
        const result = await fetchJson<{ success: boolean; card?: any; error?: string }>(
          `/api/public-data-cards?id=${encodeURIComponent(item.entityId)}`,
        );
        if (!result.success || !result.card) {
          throw new Error(result.error ?? '无法读取数据卡');
        }

        const parsed = JSON.parse(result.card.data) as any;
        await handleSelectDataCard({
          ...parsed,
          _cardId: result.card.id,
          _cardName: result.card.name,
          _cardDescription: result.card.description || '',
          _isPublic: result.card.is_public,
          _updatedAt: result.card.updated_at,
          _createdAt: result.card.created_at,
          _author: result.card.username || '未知',
          _likeCount: typeof result.card.like_count === 'number' ? result.card.like_count : undefined,
          _favoriteCount: typeof result.card.favorite_count === 'number' ? result.card.favorite_count : undefined,
          _usageCount: typeof result.card.usage_count === 'number' ? result.card.usage_count : undefined,
        });

        // 排行榜入口加入参战时也要计入公开卡片的使用数。
        // 现有口径：同一浏览器仅记 1 次（localStorage 去重）。
        const cardId = typeof result.card.id === 'string' ? result.card.id : '';
        const isPublic = result.card.is_public === 1 || result.card.is_public === true;
        const wasAdded = Boolean(
          cardId &&
          useBattleStore
            .getState()
            .combatants.some((c) => 'data' in c && (c as any).sourceDataCardId === cardId),
        );
        if (wasAdded && isPublic && !isCardUsed(cardId)) {
          void (async () => {
            try {
              const response = await fetch('/api/data-card-stats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cardId, type: 'usage' }),
              });

              if (response.ok) {
                const json = (await response.json()) as { success?: boolean };
                if (json.success) addUsedCard(cardId);
              }
            } catch (error) {
              console.error('增加使用次数失败:', error);
            }
          })();
        }
        return;
      }

      if (item.entityType === 'preset') {
        if (selectedPresetFilenames.has(item.entityId)) {
          removeCombatant(item.entityId);
          setError(null);
          return;
        }

        const preset = presetByFilename.get(item.entityId);
        const response = await fetch(`/presets/${item.entityId}`);
        if (!response.ok) {
          throw new Error('无法加载预设设定文件');
        }
        const data = await response.json();

        const validation = preset?.type === 'canshou'
          ? validateCanshouData(data)
          : preset?.type === 'magical-girl'
            ? validateMagicalGirlData(data)
            : (() => {
              const asGirl = validateMagicalGirlData(data);
              if (asGirl.success) return asGirl;
              return validateCanshouData(data);
            })();

        if (!validation.success) {
          throw new Error(validation.errors?.[0] || '格式校验失败');
        }

        addCombatant({
          type: preset?.type ?? (typeof (validation.data as any)?.codename === 'string' ? 'magical-girl' : 'canshou'),
          data: validation.data ?? data,
          filename: item.entityId,
          isValid: true,
          isPreset: true,
        });
        setError(null);
      }
    } catch (error) {
      setError(`❌ 加入参战失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setAddingKey(null);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <div className="p-5 border-b flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-lg font-bold text-gray-800">排位排行榜（可加入参战）</div>
                {currentSeason ? (
                  <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-800 ring-1 ring-purple-200">
                    当前赛季：{formatSeasonTitle(currentSeason)}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                这里展示公共榜单（公开 + 已审核）与预设。点击“加入参战”会把角色加入当前对战阵容。
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Link href="/ranking" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                打开完整排行榜页
              </Link>
              <button
                onClick={onClose}
                className="px-3 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>

          <div className="p-5 overflow-auto">
            <div className="grid gap-3 md:grid-cols-6">
            <label className="text-sm text-gray-700">
              天梯
              <select
                value={queue}
                onChange={(e) => {
                  setOffset(0);
                  setQueue(e.target.value === 'free' ? 'free' : 'strict');
                }}
                className="input-field mt-1"
              >
                <option value="strict">严格</option>
                <option value="free">自由</option>
              </select>
            </label>
            <label className="text-sm text-gray-700">
              排序
              <select
                value={sort}
                onChange={(e) => {
                  setOffset(0);
                  setSort(e.target.value === 'tech' ? 'tech' : 'rating');
                }}
                className="input-field mt-1"
              >
                <option value="rating">排位分</option>
                <option value="tech">技术值</option>
              </select>
            </label>
            <label className="text-sm text-gray-700">
              原生性
              <select
                value={isNative}
                onChange={(e) => {
                  setOffset(0);
                  const v = e.target.value;
                  setIsNative(v === '1' ? '1' : v === '0' ? '0' : 'any');
                }}
                className="input-field mt-1"
              >
                <option value="any">不限</option>
                <option value="1">原生</option>
                <option value="0">非原生</option>
              </select>
            </label>
            <label className="text-sm text-gray-700">
              最低分
              <input
                type="number"
                value={minRating}
                onChange={(e) => {
                  setOffset(0);
                  setMinRating(e.target.value);
                }}
                className="input-field mt-1"
                placeholder="如 900"
              />
            </label>
            <label className="text-sm text-gray-700">
              最高分
              <input
                type="number"
                value={maxRating}
                onChange={(e) => {
                  setOffset(0);
                  setMaxRating(e.target.value);
                }}
                className="input-field mt-1"
                placeholder="如 1600"
              />
            </label>
            <label className="text-sm text-gray-700">
              最少对局
              <input
                type="number"
                value={minGames}
                onChange={(e) => {
                  setOffset(0);
                  setMinGames(e.target.value);
                }}
                className="input-field mt-1"
                placeholder="如 5"
              />
            </label>
            <label className="text-sm text-gray-700">
              最多对局
              <input
                type="number"
                value={maxGames}
                onChange={(e) => {
                  setOffset(0);
                  setMaxGames(e.target.value);
                }}
                className="input-field mt-1"
                placeholder="可留空"
              />
            </label>
            <label className="text-sm text-gray-700">
              最低技术值
              <input
                type="number"
                value={minTechScore}
                onChange={(e) => {
                  setOffset(0);
                  setMinTechScore(e.target.value);
                }}
                className="input-field mt-1"
                placeholder="0-100"
              />
            </label>
            <label className="text-sm text-gray-700">
              最高技术值
              <input
                type="number"
                value={maxTechScore}
                onChange={(e) => {
                  setOffset(0);
                  setMaxTechScore(e.target.value);
                }}
                className="input-field mt-1"
                placeholder="0-100"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
            <label className="text-sm text-gray-700 flex items-center gap-2">
              <input
                type="checkbox"
                checked={includePresets}
                onChange={(e) => {
                  setOffset(0);
                  setIncludePresets(e.target.checked);
                }}
              />
              <span>包含预设</span>
            </label>

            <div className="flex items-center gap-3">
              <div className="text-xs text-gray-500">标签筛选只作用于数据卡；预设不会被标签包含/排除。</div>
              <button
                type="button"
                onClick={() => setIsTagFilterExpanded((prev) => !prev)}
                className="text-xs font-medium text-blue-600 hover:underline"
                aria-expanded={isTagFilterExpanded}
              >
                {isTagFilterExpanded ? '收起标签' : '展开标签'}
              </button>
            </div>
          </div>

          <div className="mt-3">
            {!isTagFilterExpanded ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                  <div>
                    包含 {includeTagIds.length} · 排除 {excludeTagIds.length}
                  </div>
                  {(includeTagIds.length > 0 || excludeTagIds.length > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setOffset(0);
                        setIncludeTagIds([]);
                        setExcludeTagIds([]);
                      }}
                      className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline"
                    >
                      清空标签
                    </button>
                  )}
                </div>

                {(includeTagIds.length > 0 || excludeTagIds.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedTagChips.slice(0, 12).map((chip) => (
                      <button
                        key={`${chip.mode}:${chip.id}`}
                        type="button"
                        onClick={() => {
                          if (chip.mode === 'include') toggleIncludeTag(chip.id);
                          else toggleExcludeTag(chip.id);
                        }}
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
              <div className="text-sm text-gray-500">正在加载标签库...</div>
            ) : tagsQuery.isError ? (
              <div className="text-sm text-red-600">标签库加载失败：{String(tagsQuery.error)}</div>
            ) : activeTags.length === 0 ? (
              <div className="text-sm text-gray-500">暂无可用标签</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-2">包含标签（OR）</div>
                  <div className="max-h-56 overflow-auto pr-1 space-y-3">
                    {groupedActiveTags.map(([category, categoryTags]) => (
                      <div key={`include:${category}`}>
                        <div className="text-[11px] font-medium text-gray-600">
                          {category}（{categoryTags.length}）
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {categoryTags.map((tag) => (
                            <button
                              key={`include:${tag.id}`}
                              type="button"
                              onClick={() => toggleIncludeTag(tag.id)}
                              className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                                includeTagIds.includes(tag.id)
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
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-2">排除标签</div>
                  <div className="max-h-56 overflow-auto pr-1 space-y-3">
                    {groupedActiveTags.map(([category, categoryTags]) => (
                      <div key={`exclude:${category}`}>
                        <div className="text-[11px] font-medium text-gray-600">
                          {category}（{categoryTags.length}）
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {categoryTags.map((tag) => (
                            <button
                              key={`exclude:${tag.id}`}
                              type="button"
                              onClick={() => toggleExcludeTag(tag.id)}
                              className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                                excludeTagIds.includes(tag.id)
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
              </div>
            )}
          </div>

          <div className="mt-5">
            {leaderboardQuery.isLoading ? (
              <div className="text-sm text-gray-500">正在加载排行榜...</div>
            ) : leaderboardQuery.isError ? (
              <div className="text-sm text-red-600">加载失败：{String(leaderboardQuery.error)}</div>
            ) : (
              <div className="overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-600 border-b">
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">角色</th>
                      <th className="py-2 px-3">段位</th>
                      <th className="py-2 px-3">分</th>
                      <th className="py-2 px-3">局</th>
                      <th className="py-2 px-3">W/L/D</th>
                      <th className="py-2 px-3">技术</th>
                      <th className="py-2 px-3">原生</th>
                      <th className="py-2 px-3">操作</th>
                    </tr>
                  </thead>
	                  <tbody>
	                    {items.map((item) => {
	                      const isSelected =
	                        item.entityType === 'preset'
	                          ? selectedPresetFilenames.has(item.entityId)
	                          : selectedDataCardIds.has(item.entityId);
	                      const isBusy = addingKey === `${item.entityType}:${item.entityId}`;
	                      const { display: displayName, full: fullName } = buildTitleDisplay(item.displayName || '未命名');
	                      const authorName =
	                        item.entityType === 'preset'
	                          ? '官方'
	                          : typeof item.authorName === 'string' && item.authorName.trim()
	                            ? item.authorName.trim()
	                            : '未知';
	                      const nativeBadge = item.isNative == null ? (
	                        <span className="text-gray-500">-</span>
	                      ) : item.isNative ? (
	                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
	                          原生
	                        </span>
	                      ) : (
	                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
	                          非原生
	                        </span>
	                      );
	                      return (
	                        <tr key={`${item.entityType}:${item.entityId}`} className="border-b last:border-b-0">
	                          <td className="py-2 px-3 text-gray-500">{item.rank}</td>
	                          <td className="py-2 px-3">
	                            <button
	                              type="button"
	                              onClick={() => {
	                                const winRate =
	                                  item.games > 0 ? Math.round((item.wins / item.games) * 1000) / 10 : null;
	                                const detailsNotice = `当前榜单：#${item.rank} · 段位 ${item.tier} · 分 ${item.rating} · 局 ${item.games} · W/L/D ${item.wins}/${item.losses}/${item.draws}${winRate == null ? '' : ` · 胜率 ${winRate}%`}`;
	                                setDetailsEntity({
	                                  entityType: item.entityType,
	                                  entityId: item.entityId,
	                                  displayName: item.displayName,
	                                  authorName: item.authorName,
	                                  pendingNotice: detailsNotice,
	                                });
	                              }}
	                              className="block w-full text-left font-medium text-gray-800 hover:underline underline-offset-2"
	                              aria-label={`查看角色详情：${fullName}`}
	                              title={fullName}
	                            >
	                              {displayName}
	                            </button>
	                            <div className="text-xs text-gray-500">
	                              {item.entityType === 'preset' ? '预设' : '数据卡'} · 作者：{authorName}
	                            </div>
	                          </td>
	                          <td className="py-2 px-3"><TierBadge tier={item.tier} /></td>
	                          <td className="py-2 px-3 font-mono">{item.rating}</td>
	                          <td className="py-2 px-3 font-mono">{item.games}</td>
	                          <td className="py-2 px-3 font-mono">{item.wins}/{item.losses}/{item.draws}</td>
	                          <td className="py-2 px-3">
	                            <TechBadge techScore={item.techScore} techLevel={item.techLevel} />
	                          </td>
	                          <td className="py-2 px-3">
	                            {nativeBadge}
	                          </td>
	                          <td className="py-2 px-3">
	                            <button
	                              onClick={() => void handleAddFromLeaderboard(item)}
	                              disabled={isBusy || (isSelected && item.entityType === 'data_card')}
                              className={`px-3 py-1 rounded text-xs border ${
                                isSelected
                                  ? item.entityType === 'preset'
                                    ? 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                                    : 'bg-gray-50 border-gray-200 text-gray-500'
                                  : 'bg-purple-600 border-purple-600 text-white hover:bg-purple-700'
                              } disabled:opacity-50`}
                              title={isSelected && item.entityType === 'preset' ? '再次点击可移除预设参战者' : undefined}
                            >
                              {isBusy ? '处理中...' : isSelected ? (item.entityType === 'preset' ? '移除/已加入' : '已加入') : '加入参战'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-6 text-center text-gray-500">
                          暂无数据
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap text-sm">
            <div className="text-gray-500">
              已选择参战者：{combatants.filter((c) => 'data' in c).length}/{MAX_COMBATANTS}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOffset((v) => Math.max(0, v - limit))}
                disabled={!canGoPrev}
                className="px-3 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white"
              >
                上一页
              </button>
              <button
                onClick={() => setOffset((v) => v + limit)}
                disabled={!canGoNext}
                className="px-3 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white"
              >
                下一页
              </button>
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
