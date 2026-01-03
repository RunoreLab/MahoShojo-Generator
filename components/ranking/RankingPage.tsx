'use client';

import Head from 'next/head';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
};

export function RankingPage() {
  const [queue, setQueue] = useState<Queue>('strict');
  const [sort, setSort] = useState<Sort>('rating');
  const [includePresets, setIncludePresets] = useState(true);
  const [isNative, setIsNative] = useState<'any' | '1' | '0'>('any');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: () => fetchJson<{ success: boolean; tags: Tag[] }>('/api/tags'),
    staleTime: 60_000,
  });

  const activeTags = useMemo(
    () => (tagsQuery.data?.tags ?? []).filter((t) => t.isActive),
    [tagsQuery.data?.tags]
  );

  const leaderboardQuery = useQuery({
    queryKey: ['arenaLeaderboard', queue, sort, includePresets, isNative, selectedTagIds.join(',')],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('queue', queue);
      params.set('sort', sort);
      params.set('limit', '50');
      params.set('offset', '0');
      params.set('includePresets', includePresets ? '1' : '0');
      params.set('isNative', isNative);
      if (selectedTagIds.length > 0) params.set('tagIds', selectedTagIds.join(','));
      return fetchJson<{ success: boolean; items: LeaderboardItem[] }>(`/api/arena/leaderboard?${params.toString()}`);
    },
    staleTime: 10_000,
  });

  const items = leaderboardQuery.data?.items ?? [];

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) => {
      if (prev.includes(tagId)) return prev.filter((id) => id !== tagId);
      return [...prev, tagId];
    });
  };

  return (
    <>
      <Head>
        <title>排位排行榜 - MahoShojo Generator</title>
      </Head>

      <div className="magic-background-white">
        <div className="container">
          <div className="card">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-800">排位排行榜</h1>
              <div className="flex items-center gap-3 text-sm">
                <Link href="/encyclopedia/ranking" className="text-blue-600 hover:underline">排位说明</Link>
                <Link href="/arena" className="text-blue-600 hover:underline">返回竞技场</Link>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-5">
              <label className="text-sm text-gray-700">
                梯子
                <select
                  value={queue}
                  onChange={(e) => setQueue(e.target.value === 'free' ? 'free' : 'strict')}
                  className="input-field mt-1"
                >
                  <option value="strict">strict（严格）</option>
                  <option value="free">free（自由）</option>
                </select>
              </label>

              <label className="text-sm text-gray-700">
                排序
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value === 'tech' ? 'tech' : 'rating')}
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

              <label className="text-sm text-gray-700 md:col-span-2">
                预设角色
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includePresets}
                    onChange={(e) => setIncludePresets(e.target.checked)}
                  />
                  <span>在榜单中包含预设</span>
                </div>
              </label>
            </div>

            <div className="mt-4">
              <div className="text-sm font-medium text-gray-700 mb-2">标签筛选（OR）</div>
              {tagsQuery.isLoading ? (
                <div className="text-sm text-gray-500">正在加载标签库...</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {activeTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                        selectedTagIds.includes(tag.id)
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      }`}
                      title={tag.description ?? undefined}
                    >
                      {tag.name}
                    </button>
                  ))}
                  {activeTags.length === 0 && (
                    <div className="text-sm text-gray-500">暂无可用标签（可先运行 scripts/init-tags.ts 同步种子）</div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6">
              {leaderboardQuery.isLoading ? (
                <div className="text-sm text-gray-500">正在加载排行榜...</div>
              ) : leaderboardQuery.isError ? (
                <div className="text-sm text-red-600">加载失败：{String(leaderboardQuery.error)}</div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-600 border-b">
                        <th className="py-2 pr-3">#</th>
                        <th className="py-2 pr-3">角色</th>
                        <th className="py-2 pr-3">段位</th>
                        <th className="py-2 pr-3">分</th>
                        <th className="py-2 pr-3">局</th>
                        <th className="py-2 pr-3">W/L/D</th>
                        <th className="py-2 pr-3">技</th>
                        <th className="py-2 pr-3">原生</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={`${item.entityType}:${item.entityId}`} className="border-b last:border-b-0">
                          <td className="py-2 pr-3 text-gray-500">{item.rank}</td>
                          <td className="py-2 pr-3">
                            <div className="font-medium text-gray-800">{item.displayName}</div>
                            <div className="text-xs text-gray-500">{item.entityType === 'preset' ? '预设' : '数据卡'}</div>
                          </td>
                          <td className="py-2 pr-3">{item.tier}</td>
                          <td className="py-2 pr-3 font-mono">{item.rating}</td>
                          <td className="py-2 pr-3 font-mono">{item.games}</td>
                          <td className="py-2 pr-3 font-mono">{item.wins}/{item.losses}/{item.draws}</td>
                          <td className="py-2 pr-3 font-mono">
                            {item.techScore == null ? '-' : `${item.techScore} (${item.techLevel ?? '-'})`}
                          </td>
                          <td className="py-2 pr-3">
                            {item.isNative == null ? '-' : item.isNative ? '是' : '否'}
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-6 text-center text-gray-500">
                            暂无数据
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
