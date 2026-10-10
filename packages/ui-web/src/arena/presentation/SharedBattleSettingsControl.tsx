'use client';

import { ArenaDataSettingsPanel, type ArenaDataSettingsValue } from '../ArenaDataSettingsPanel';
import { NarrativeHistorySettings, type NarrativeHistorySettingsProps, type NarrativeHistorySettingsValue } from '../NarrativeHistorySettings';
export type SharedBattleSettingsValue = ArenaDataSettingsValue & NarrativeHistorySettingsValue;

export type SharedBattleSettingsControlProps = {
  value: SharedBattleSettingsValue;
  onChange: (patch: Partial<SharedBattleSettingsValue>) => void;
  disabled?: boolean;
  narrativeNotes?: Pick<NarrativeHistorySettingsProps, 'persistenceNote' | 'readingNote'>;
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
  narrativeNotes,
  combatantCountForEstimate = 0,
}: SharedBattleSettingsControlProps) {
  const updateSharedSettings = (patch: Partial<SharedBattleSettingsValue>) => onChange(patch);

  return (
    <>
      <ArenaDataSettingsPanel
        value={value}
        onChange={updateSharedSettings}
        disabled={disabled}
        combatantCountForEstimate={combatantCountForEstimate}
      />
      <NarrativeHistorySettings
        value={value}
        {...narrativeNotes}
        onChange={updateSharedSettings}
        disabled={disabled}
      />
    </>
  );
}
