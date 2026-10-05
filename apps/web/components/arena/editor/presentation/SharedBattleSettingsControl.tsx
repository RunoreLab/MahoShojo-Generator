'use client';

import { ArenaDataSettingsPanel } from '@/components/shared/ArenaDataSettingsPanel';

import { NarrativeHistorySettings } from '../../components/NarrativeHistorySettings';
import type { BattleSettings } from '../../types';

export type SharedBattleSettingsValue = Pick<
  BattleSettings,
  | 'readArenaHistory'
  | 'readArenaHistoryLimit'
  | 'isArenaHistoryUnlimited'
  | 'writeArenaHistory'
  | 'readCurrentState'
  | 'writeCurrentState'
  | 'readNarrativeHistory'
  | 'readNarrativeHistoryLimit'
  | 'isNarrativeHistoryUnlimited'
  | 'writeNarrativeHistory'
>;

type SharedBattleSettingsControlProps = {
  value: SharedBattleSettingsValue;
  onChange: (patch: Partial<SharedBattleSettingsValue>) => void;
  disabled?: boolean;
  combatantCountForEstimate?: number;
};

/**
 * 房间 wire config 中可共享的 Arena/叙事历史设置。战报卡片宽度等浏览器本地偏好由
 * single adapter 单独渲染，不能出现在该受控层。
 */
export function SharedBattleSettingsControl({
  value,
  onChange,
  disabled = false,
  combatantCountForEstimate = 0,
}: SharedBattleSettingsControlProps) {
  const updateSharedSettings = (patch: Partial<BattleSettings>) => onChange(patch);

  return (
    <>
      <ArenaDataSettingsPanel
        value={value}
        onChange={updateSharedSettings}
        disabled={disabled}
        combatantCountForEstimate={combatantCountForEstimate}
      />
      <NarrativeHistorySettings
        value={value as BattleSettings}
        onChange={updateSharedSettings}
        disabled={disabled}
      />
    </>
  );
}
