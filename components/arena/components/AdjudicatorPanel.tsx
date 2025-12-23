'use client';

import { AdjudicatorSettingsPanel } from '@/components/shared/AdjudicatorSettingsPanel';

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

  return <AdjudicatorSettingsPanel events={adjudicationEvents} onEventsChange={setAdjudicationEvents} disabled={isGenerating} />;
}
