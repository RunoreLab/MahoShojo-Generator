'use client';
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import BattleDataModal from '@/components/BattleDataModal';
import { ONLINE_DATA_CARD_TYPES } from '@mahoshojo/contracts/data-cards';
import { DataCardRefSchema, type DataCardRef } from '@mahoshojo/contracts/arena-room';
import { RoomMemberProposalWorkspace, collectArenaMemberReferenceRequests, mapSharedConfigToArenaMemberView, type ArenaMemberSourcePickerProps } from '@mahoshojo/ui-web/arena-room';
import type { RoomProposalArenaEditorSession } from '../editor';
import { useLanguagesQuery } from '../hooks/useArenaData';
import type { ArenaRoomController, ArenaRoomControllerState } from '@/lib/arena-room/controller';
import { randomUUID } from '@/lib/crypto';
import { config } from '@/lib/config';
import { useArenaRoomContext } from './useArenaRoom';
import { ArenaRoomReferenceDetailsDialog } from './ArenaRoomReferenceDetailsDialog';
import { resolveArenaRoomReferenceName, useArenaRoomReferenceNames } from '@/lib/arena-room/reference-presentation';
import { arenaLanguageCopy } from './presentation/value-copy';
import { downloadBuiltinWebPackageArchive } from '../editor/features/web-package/useWebPackagePresetDownload';
import { webPackageViewHost } from '../editor/features/web-package/web-package-view-host';
import { useWebConsent } from '../components/ArenaWebReport';

type ProposalController = Pick<ArenaRoomController, 'endProposalTracking' | 'reconnect' | 'submitProposal' | 'withdrawProposal'>;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
/** Only called with the public/approved picker or public random endpoint response. Token is an observation, not a CAS fence. */
const publicReference = (card: unknown, kind: DataCardRef['kind']): DataCardRef => {
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('在线数据卡选择无效');
  const value = card as Record<string, unknown>;
  const id = text(value._cardId) || text(value.id);
  const versionToken = text(value._updatedAt) || text(value.updated_at) || text(value.updatedAt);
  if (!id || !versionToken) throw new Error('在线数据卡缺少可验证版本，请刷新后重试');
  return DataCardRefSchema.parse({ id, kind, versionToken });
};
function PublicSourcePicker({ open, kind, selectedIds, error, onClose, onSelect, onToggle }: ArenaMemberSourcePickerProps) {
  const [sourceError, setSourceError] = useState<string | null>(null);
  const refKind = kind === 'auxScenario' ? 'scenario' : kind;
  const choose = (card: unknown, selected?: boolean) => {
    try {
      const ref = publicReference(card, refKind);
      if (selected === undefined) onSelect(ref); else onToggle(ref, selected);
      setSourceError(null);
    } catch (cause) { setSourceError(cause instanceof Error ? cause.message : '在线数据卡选择无效'); }
  };
  return <BattleDataModal isOpen={open} onClose={onClose} visibleTabs={['public']} initialTab="public"
    selectedType={kind === 'character' ? 'character' : kind === 'material' ? 'all' : 'scenario'}
    allowedTypes={kind === 'material' ? [...ONLINE_DATA_CARD_TYPES] : undefined}
    titleOverride={kind === 'auxScenario' ? '选择辅助情景' : kind === 'material' ? '选择素材' : undefined}
    selectionMode={kind === 'scenario' ? 'single' : 'multi'} selectedCardIds={[...selectedIds]} selectedCountOverride={selectedIds.length}
    allowDeckImport={false} allowCardDetails={false} onSelectCard={kind === 'scenario' ? card => choose(card) : undefined}
    onToggleCard={kind !== 'scenario' ? (card, selected) => choose(card, selected) : undefined} externalError={sourceError ?? error} />;
}
async function randomPublicCharacter(): Promise<DataCardRef> {
  const response = await fetch('/api/random-public-card?type=character');
  const result = await response.json() as { success?: boolean; card?: unknown; error?: string };
  if (!response.ok || result.success !== true || !result.card) throw new Error(result.error || '无法获取随机公开角色');
  return publicReference(result.card, 'character');
}

/** Web owns sources and presentation services; all member editing and preview UI is shared. */
export function ArenaRoomProposalWorkspaceView({ editor, state, controller, onSyncFromRoom }: {
  readonly editor: RoomProposalArenaEditorSession; readonly state: ArenaRoomControllerState;
  readonly controller: ProposalController; readonly onSyncFromRoom?: () => void;
}) {
  const model = editor.memberModel;
  const modelState = useSyncExternalStore(model.store.subscribe, model.store.getState, model.store.getInitialState);
  const requests = useMemo(() => [
    ...collectArenaMemberReferenceRequests(mapSharedConfigToArenaMemberView(modelState.editor.workingConfig)),
    ...collectArenaMemberReferenceRequests(mapSharedConfigToArenaMemberView(modelState.editor.baselineConfig)),
  ], [modelState.editor.workingConfig, modelState.editor.baselineConfig]);
  const names = useArenaRoomReferenceNames(requests);
  const { data: languages } = useLanguagesQuery();
  const consent = useWebConsent(state.session?.roomId);
  return <RoomMemberProposalWorkspace model={model} scopeIdentity={controller}
    room={{ session: state.session, operation: state.proposalOperation, resultUnknown: state.proposalResultUnknown, tracking: state.proposalTracking, outcome: state.proposalOutcome }}
    host={{ SourcePicker: PublicSourcePicker, ReferenceDetails: ArenaRoomReferenceDetailsDialog, randomPublicCharacter,
      resolveReferenceName: request => resolveArenaRoomReferenceName(request, names) ?? undefined,
      languages, languageLabel: arenaLanguageCopy, enableUserGuidance: config.ENABLE_ARENA_USER_GUIDANCE, createId: randomUUID,
      presetDownloadHref: (kind, id) => `/${kind === 'character' ? 'presets' : 'scenario-presets'}/${encodeURIComponent(id)}`,
      downloadBuiltinWebPackage: downloadBuiltinWebPackageArchive, webPackageViewHost,
      webConsent: { accepted: consent.accepted, onAccept: consent.accept } }}
    actions={{ submit: controller.submitProposal, withdraw: controller.withdrawProposal, read: controller.reconnect,
      endTracking: controller.endProposalTracking, sync: onSyncFromRoom }} />;
}
export function ArenaRoomProposalWorkspace() {
  const runtime = useArenaRoomContext();
  const editor = runtime?.proposalWorkspace.editor;
  if (!runtime || !editor || runtime.state.session?.self.role !== 'member') return null;
  return <ArenaRoomProposalWorkspaceView editor={editor} state={runtime.state} controller={runtime.controller} onSyncFromRoom={runtime.proposalWorkspace.syncFromRoom} />;
}
export function ArenaEditorWorkspaceBoundary({ children }: { readonly children: ReactNode }) {
  const runtime = useArenaRoomContext();
  return runtime?.proposalWorkspace.editor && runtime.state.session?.self.role === 'member' ? <ArenaRoomProposalWorkspace /> : children;
}
