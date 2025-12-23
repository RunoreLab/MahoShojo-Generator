'use client';

import AdjudicatorEditor from '@/components/AdjudicatorEditor';
import type { AdjudicatorEvent } from '@/types/arena';

type Props = {
  events: AdjudicatorEvent[];
  onEventsChange: (events: AdjudicatorEvent[]) => void;
  disabled?: boolean;
};

/**
 * 随机判定器设置面板（可复用）。
 * 让用户配置与 battle / 竞技场一致的判定事件链。
 */
export function AdjudicatorSettingsPanel({ events, onEventsChange, disabled }: Props) {
  return (
    <div className="input-group">
      <h3 className="input-label">🎲 随机判定器 (可选)</h3>
      <p className="text-xs text-gray-500 mb-2">
        为故事添加自定义掷骰事件链；留空时沿用 AI 默认判定逻辑。支持成功/失败及多结果分支，亦可串联后续事件。
      </p>
      <div className={disabled ? 'opacity-70 pointer-events-none' : ''}>
        <AdjudicatorEditor events={events} onEventsChange={onEventsChange} />
      </div>
      {events.length === 0 && <p className="text-xs text-gray-500 mt-2">当前未设置判定器，系统将自动推断战斗/剧情结果。</p>}
    </div>
  );
}

