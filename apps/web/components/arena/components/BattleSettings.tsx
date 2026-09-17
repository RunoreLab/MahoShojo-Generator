'use client';

import { useArenaRoomContext } from '../multiplayer/useArenaRoom';
import { useBattleStore } from '../stores/useBattleStore';
import {
  useArenaEditorActions,
  useArenaEditorSelector,
  useArenaEditorSession,
} from '../editor';
import { SharedBattleSettingsControl } from '../editor/presentation/SharedBattleSettingsControl';
import { ArenaReportFormatSelector } from './ArenaWebReport';
import { BattleReportCardWidthSettings } from './BattleReportCardWidthSettings';

function HostOnlyBattleReportCardWidthSettings({ disabled }: { readonly disabled: boolean }) {
  const localSettings = useBattleStore((state) => state.settings);
  const updateLocalSettings = useBattleStore((state) => state.updateSettings);
  return (
    <BattleReportCardWidthSettings
      value={localSettings}
      onChange={updateLocalSettings}
      disabled={disabled}
    />
  );
}

export function BattleSettings() {
  const session = useArenaEditorSession();
  const room = useArenaRoomContext();
  const settings = useArenaEditorSelector((state) => state.historySettings);
  const isGenerating = useArenaEditorSelector((state) => state.busy);
  const readableCombatantCount = useArenaEditorSelector((state) => (
    state.combatants.filter((item) => item.access === 'full').length
  ));
  const reportFormat = useArenaEditorSelector((state) => state.reportFormat);
  const roomId = useArenaEditorSelector((state) => state.roomId);
  const { updateHistorySettings, setReportFormat } = useArenaEditorActions();

  return (
    <>
      <ArenaReportFormatSelector value={reportFormat} onChange={setReportFormat} disabled={isGenerating} roomId={roomId ?? room?.state.session?.roomId} />
      <SharedBattleSettingsControl
        value={settings}
        onChange={updateHistorySettings}
        disabled={isGenerating}
        combatantCountForEstimate={readableCombatantCount}
      />
      {session.capabilities.canUseHostOnlyGenerationOptions ? (
        <HostOnlyBattleReportCardWidthSettings disabled={isGenerating} />
      ) : null}
    </>
  );
}
