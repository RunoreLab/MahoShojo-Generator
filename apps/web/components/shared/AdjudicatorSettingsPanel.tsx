'use client';

import AdjudicatorEditor from '@/components/AdjudicatorEditor';
import type { AdjudicatorEvent } from '@/types/arena';
import { Eraser } from 'lucide-react';

type Props = {
  events: AdjudicatorEvent[];
  onEventsChange: (events: AdjudicatorEvent[]) => void;
  onClearEvents?: () => void;
  disabled?: boolean;
};

/**
 * 随机判定器设置面板（可复用）。
 * 让用户配置与 battle / 竞技场一致的判定事件链。
 */
export function AdjudicatorSettingsPanel({ events, onEventsChange, onClearEvents, disabled }: Props) {
  return (
    <div className="input-group">
      <h3 className="input-label">🎲 随机判定器 (可选)</h3>
      <p className="text-xs text-gray-500 mb-2">
        为故事添加自定义掷骰事件链；留空时沿用 AI 默认判定逻辑。支持成功/失败及多结果分支，亦可串联后续事件。
      </p>
      {events.length > 0 && onClearEvents ? (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onClearEvents}
            disabled={disabled}
            aria-label="清空全部判定事件"
            title="清空全部判定事件"
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
            清空全部
          </button>
        </div>
      ) : null}
      <div className={disabled ? 'opacity-70 pointer-events-none' : ''}>
        <AdjudicatorEditor events={events} onEventsChange={onEventsChange} />
      </div>
      {events.length === 0 && <p className="text-xs text-gray-500 mt-2">当前未设置判定器，系统将自动推断战斗/剧情结果。</p>}
    </div>
  );
}
