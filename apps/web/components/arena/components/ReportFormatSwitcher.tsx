'use client';

import { useArenaEditorActions, useArenaEditorSelector, useArenaEditorSession } from '../editor';
import { SoloArenaWebPackageSection } from '../editor/features/web-package/SoloArenaWebPackageSection';
import { ProposalArenaWebPackageSection } from '../editor/features/web-package/ProposalArenaWebPackageSection';
import { useArenaRoomContext } from '../multiplayer/useArenaRoom';
import { useBattleStore } from '../stores/useBattleStore';
import { ArenaReportFormatSelector } from './ArenaWebReport';

/** 复用单人 / 多人提案编辑器的格式与权限状态；Web 包区块按 session 能力收口。 */
export function ReportFormatSwitcher() {
  const room = useArenaRoomContext();
  const session = useArenaEditorSession();
  const value = useArenaEditorSelector((state) => state.reportFormat);
  const disabled = useArenaEditorSelector((state) => state.busy);
  const roomId = useArenaEditorSelector((state) => state.roomId);
  const { setReportFormat } = useArenaEditorActions();
  const setError = useBattleStore((state) => state.setError);
  const multiplayerRoomId = roomId ?? room?.state.session?.roomId ?? null;
  const inMultiplayer = session.mode === 'room-proposal' || Boolean(multiplayerRoomId);
  const onActionError = (message: string) => setError(`❌ ${message}`);

  return (
    <ArenaReportFormatSelector
      value={value}
      onChange={setReportFormat}
      disabled={disabled}
      roomId={multiplayerRoomId ?? undefined}
    >
      {session.mode === 'room-proposal' ? (
        <ProposalArenaWebPackageSection disabled={disabled} onActionError={onActionError} />
      ) : (
        <SoloArenaWebPackageSection
          reportFormat={value}
          disabled={disabled}
          allowLocalImport={!inMultiplayer}
        />
      )}
    </ArenaReportFormatSelector>
  );
}
