'use client';

import Leaderboard from '@/components/Leaderboard';
import { StatsData } from '@/pages/api/get-stats';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';

interface ArenaStatisticsProps {
  stats: StatsData | undefined;
  isLoading: boolean;
  presetInfo: Map<string, string>;
}

export function ArenaStatistics({ stats, isLoading, presetInfo }: ArenaStatisticsProps) {
  if (isLoading) {
    return <div className="card mt-6 text-center text-gray-500">正在加载数据中心...</div>;
  }

  if (!stats) {
    return (
      <div className="card mt-6 text-center text-gray-500">
        <p>数据库还未初始化或暂无数据</p>
        <p className="text-sm mt-2">开始使用竞技场功能后，这里将显示统计数据</p>
        <p className="text-xs mt-2 text-red-500">请在 Cloudflare D1 控制台执行建表 SQL 语句</p>
      </div>
    );
  }

  return (
    <div className="card mt-6">
      <CollapsibleSection
        title="竞技场数据中心"
        description="统计数据较长，默认收起以减少滚动"
        defaultOpen={false}
        storageKey="arena.section.statistics.open"
        variant="plain"
        titleClassName="text-xl font-bold text-gray-800 text-center"
        headerClassName="mb-4"
      >
        <div className="grid grid-cols-2 gap-4 text-center mb-6">
          <div className="p-4 bg-gray-100 rounded-lg">
            <p className="text-2xl font-bold text-pink-500">{stats.totalBattles || 0}</p>
            <p className="text-sm text-gray-600">故事/战斗总场数</p>
          </div>
          <div className="p-4 bg-gray-100 rounded-lg">
            <p className="text-2xl font-bold text-blue-500">{stats.totalParticipants || 0}</p>
            <p className="text-sm text-gray-600">总登场人次</p>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Leaderboard title="🏆 胜率排行榜" data={stats.winRateRank || []} presetInfo={presetInfo} />
          <Leaderboard title="⚔️ 登场数排行榜" data={stats.participationRank || []} presetInfo={presetInfo} />
          <Leaderboard title="🥇 胜利榜" data={stats.winsRank || []} presetInfo={presetInfo} />
          <Leaderboard title="💔 战败榜" data={stats.lossesRank || []} presetInfo={presetInfo} />
        </div>
      </CollapsibleSection>
    </div>
  );
}
