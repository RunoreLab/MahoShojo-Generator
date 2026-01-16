import React from 'react';
import { CharacterRank } from '../pages/api/get-stats';
import { buildTitleDisplay } from '@/lib/text';

interface LeaderboardProps {
  title: string;
  data: CharacterRank[];
  presetInfo: Map<string, string>;
}

/**
 * 排行榜组件
 * @param title - 排行榜标题
 * @param data - 排行榜数据
 * @param presetInfo - 预设角色的描述信息
 */
const Leaderboard: React.FC<LeaderboardProps> = ({ title, data, presetInfo }) => (
  <div className="rounded-lg bg-white/60 p-4 shadow-inner">
    <h4 className="text-center text-sm font-bold text-gray-700 mb-2">{title}</h4>
    {data && data.length > 0 ? (
      <ol className="mt-1 list-decimal pl-6 text-sm text-gray-800">
        {data.map((item, index) => {
          const { display, full } = buildTitleDisplay(item.name || '未命名');
          return (
            <li
              key={index}
              className="mb-1 flex items-center justify-between gap-2"
              title={`${full}${item.is_preset ? ` (${presetInfo.get(item.name)})` : ''}`}
            >
              <span className="min-w-0 truncate font-semibold">
                {display}
                {item.is_preset && <span className="ml-1 text-xs text-purple-600">[预设]</span>}
              </span>
              <span className="shrink-0 text-gray-600">{item.value}</span>
            </li>
          );
        })}
      </ol>
    ) : (
      <p className="text-center text-xs text-gray-500">暂无数据</p>
    )}
  </div>
);

export default Leaderboard;
