'use client';

import { useArenaEditorActions, useArenaEditorSelector } from '../editor';
import { useArenaRoomContext } from '../multiplayer/useArenaRoom';
import { ArenaReportFormatSelector } from './ArenaWebReport';

/** 复用单人 / 多人提案编辑器的格式与权限状态。 */
export function ReportFormatSwitcher() {
  const room = useArenaRoomContext();
  const value = useArenaEditorSelector((state) => state.reportFormat);
  const webPackageRef = useArenaEditorSelector((state) => state.webPackageRef);
  const disabled = useArenaEditorSelector((state) => state.busy);
  const roomId = useArenaEditorSelector((state) => state.roomId);
  const { setReportFormat, setWebPackageRef } = useArenaEditorActions();
  return <ArenaReportFormatSelector value={value} onChange={setReportFormat} webPackageRef={webPackageRef} onWebPackageChange={setWebPackageRef} disabled={disabled} roomId={roomId ?? room?.state.session?.roomId} />;
}
