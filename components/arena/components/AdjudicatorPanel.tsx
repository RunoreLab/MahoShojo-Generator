'use client';

import AdjudicatorEditor from '@/components/AdjudicatorEditor';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState } from '../types';

/**
 * 随机判定器设置面板。
 * 让用户在竞技场中配置与 battle 页面一致的判定事件链。
 */
export function AdjudicatorPanel() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const adjudicationEvents = useBattleSelector((state) => state.adjudicationEvents);
  const setAdjudicationEvents = useBattleSelector((state) => state.setAdjudicationEvents);
  const isGenerating = useBattleSelector((state) => state.isGenerating);

  return (
    <div className="input-group">
      <h3 className="input-label">🎲 随机判定器 (可选)</h3>
      <p className="text-xs text-gray-500 mb-2">
        为故事添加自定义掷骰事件链；留空时沿用 AI 默认判定逻辑。支持成功/失败及多结果分支，亦可串联后续事件。
      </p>
      <div className={isGenerating ? 'opacity-70 pointer-events-none' : ''}>
        <AdjudicatorEditor events={adjudicationEvents} onEventsChange={setAdjudicationEvents} />
      </div>
      {adjudicationEvents.length === 0 && (
        <p className="text-xs text-gray-500 mt-2">当前未设置判定器，系统将自动推断战斗/剧情结果。</p>
      )}
    </div>
  );
}
