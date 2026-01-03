'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { TierBadge } from '@/components/ranking/TierBadge';
import type { Preset } from '@/lib/presets';

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
  const [minRating, setMinRating] = useState('');
  const [minGames, setMinGames] = useState('');
  const [minTechScore, setMinTechScore] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 30;
  const [addingKey, setAddingKey] = useState<string | null>(null);

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

  const activeTags = useMemo(
    () => (tagsQuery.data?.tags ?? []).filter((t) => t.isActive),
    [tagsQuery.data?.tags],
  );

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
      minGames,
      minTechScore,
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
      if (minGames.trim()) params.set('minGames', minGames.trim());
      if (minTechScore.trim()) params.set('minTechScore', minTechScore.trim());
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-bold text-gray-800">排位排行榜（可加入参战）</div>
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
              梯子
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

            <div className="text-xs text-gray-500">
              标签筛选只作用于数据卡；预设不会被标签包含/排除。
            </div>
          </div>

          <div className="mt-3">
            {tagsQuery.isLoading ? (
              <div className="text-sm text-gray-500">正在加载标签库...</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-2">包含标签（OR）</div>
                  <div className="flex flex-wrap gap-2">
                    {activeTags.map((tag) => (
                      <button
                        key={`include:${tag.id}`}
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
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-2">排除标签</div>
                  <div className="flex flex-wrap gap-2">
                    {activeTags.map((tag) => (
                      <button
                        key={`exclude:${tag.id}`}
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
                      <th className="py-2 px-3">技</th>
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
                      return (
                        <tr key={`${item.entityType}:${item.entityId}`} className="border-b last:border-b-0">
                          <td className="py-2 px-3 text-gray-500">{item.rank}</td>
                          <td className="py-2 px-3">
                            <div className="font-medium text-gray-800">{item.displayName}</div>
                            <div className="text-xs text-gray-500">{item.entityType === 'preset' ? '预设' : '数据卡'}</div>
                          </td>
                          <td className="py-2 px-3"><TierBadge tier={item.tier} /></td>
                          <td className="py-2 px-3 font-mono">{item.rating}</td>
                          <td className="py-2 px-3 font-mono">{item.games}</td>
                          <td className="py-2 px-3 font-mono">{item.wins}/{item.losses}/{item.draws}</td>
                          <td className="py-2 px-3 font-mono">
                            {item.techScore == null ? '-' : `${item.techScore} (${item.techLevel ?? '-'})`}
                          </td>
                          <td className="py-2 px-3">
                            {item.isNative == null ? '-' : item.isNative ? '是' : '否'}
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
  );
}

