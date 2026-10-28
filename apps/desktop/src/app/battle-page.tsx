import { projectDesktopGenerationRanking } from '../features/arena/generation-ranking-projection';
import { DesktopManualRepairPanel } from '../features/arena/manual-repair-panel';
import { isArenaRealCombatant } from '../features/arena/roster-types';
import { useDesktopRosterRatings } from '../features/arena/use-roster-ratings';
import { buildDesktopRosterExtras, snapshotDesktopRosterDetails, readDesktopRosterMetadata, type DesktopRosterMetadataSnapshot } from '../features/arena/roster-presentation';
import { DesktopCardDetailsModal } from '../features/card-details/card-details-modal';
import { BattleReportCardWidthSettings, resolveBattleReportCardManualWidthPx } from '@mahoshojo/ui-web/arena';
import { useDesktopReportCardWidth } from '../features/arena/use-report-card-width';
import { createDesktopBattleReportPorts } from '../features/arena/report-ports';
import { projectDesktopArenaReport } from '../features/arena/report-presentation';
import { projectDesktopRoleUpdates } from '../features/arena/role-update-presentation';
import { DesktopArenaRoleUpdateActions, useArenaResultActionLocks } from '../features/arena/role-update-actions';
import { DesktopArenaErrorMessage, DesktopArenaFeedbackMessage } from '../features/arena/error-message';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from '@tanstack/react-router';
import type { DesktopArenaHostedRecoveryHint } from '@mahoshojo/contracts/desktop-arena-hosted';
import type { ArenaHostedRecoveryReplacement } from '../features/arena/hosted-recovery';
import { readArenaHostedRecoveryHint } from '../platform/arena-hosted-bridge';
import { getArenaHostedErrorDiagnostic } from '../features/arena/hosted-json';
import { ArenaSessionBackup, DesktopArenaRecoveryControls, arenaRecoveryStatusLabel, buildArenaSafeDiagnostic, type ArenaBackupFeedback } from '../features/arena/recovery-controls';
import { ARENA_CANONICAL_CAPABILITIES } from '@mahoshojo/contracts/arena-capabilities';
import { PRESET_LIST } from '@mahoshojo/domain/presets';
import { SCENARIO_PRESET_LIST } from '@mahoshojo/domain/scenario-presets';
import { normalizeCustomStoryLength } from '@mahoshojo/domain/story-length';
import { getCombatantTypeLabel, getCombatantCardLibrarySelectionId, parseCombatantsFromText } from '@mahoshojo/domain/arena-file-parser';
import { buildArenaMaterialState, type ArenaMaterialState } from '@mahoshojo/domain/arena-materials';
import type { NarrativeHistorySort } from '@mahoshojo/domain/narrative-history-operations';
import { getArenaCardLibrarySelectionOptions, AdvancedArenaHeader, ArenaPageLinks, ArenaRankingLinks, AdvancedArenaPageView, ArenaEditorWorkspaceLayout, buildArenaEditorSections, BattleLitePageView, BattleLiteHeader, ArenaRosterSection, ArenaRankingQueueFeedback, ArenaRosterImportPanel, ArenaMaterialSection, ArenaScenarioSection, BattleModeSelector, ArenaCharacterDatabaseSelector, StoryOptionsPanel, CharacterPresetPicker, ArenaDataSettingsPanel, NarrativeHistorySettings, type ArenaRosterSectionModel, type ArenaScenarioSectionModel, type StoryLengthOption } from '@mahoshojo/ui-web/arena';
import { ArenaReportFormatSelectorView, BattleReportCard, StreamingBattleReportCard, CombatantUpdatesPresentation } from '@mahoshojo/ui-web/arena-report';
import { Button, CardLibraryModal, mapPublicDataCardRowToSourceData, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { NarrativeDraftsPanel, NarrativeLegacyDraftsSection } from '@mahoshojo/ui-web/narrative-history';
import { buildNarrativeDraftArchive, type NarrativeDraft } from '@mahoshojo/domain/narrative-drafts';
import { GenerationModeSwitcher, StreamStopButton, useResultAutoScroll } from '@mahoshojo/ui-web/details-controls';
import { ThemeImage } from '@mahoshojo/ui-web/media';
import { DENY_EXTERNAL_MEDIA, MarkdownBlock } from '@mahoshojo/ui-web/markdown';
import { BackHomeLink, ProductFooter } from '@mahoshojo/ui-web/shell';
import { generationActionClassNames, generationSubmitClassName } from '@mahoshojo/ui-web/generation-actions';
import { DesktopArenaSession, arenaReadinessMessage, arenaReferenceCount, inheritedArenaAdjudication, type ArenaDraft, type DesktopArenaProduct } from '../features/arena/session';
import { getCombatantAdjudicationSourceKey, removeAdjudicationEventsForKeys } from '@mahoshojo/domain/arena-adjudication-events';
import { AdvancedArenaControls } from '../features/arena/advanced-controls';
import { DesktopArenaHistoryControls } from '../features/arena/history-controls';
import { DesktopArenaHistoryPicker } from '../features/arena/history-picker';
import { readDesktopMemberRandomCharacter as readDesktopRandomPublicCharacter } from '../features/arena/room-member-source-data';
import { retainDesktopArenaSelectionSource } from '../features/arena/strict-source';
import { prepareDesktopStrictDraft } from '../features/arena/strict-preparation';
import { describeDesktopStrictSetup } from '../features/arena/strict-setup';
import type { PublicSeasonMeta } from '@mahoshojo/contracts/public-ranking';
import { DesktopStrictConfigurationDiagnostics, type DesktopStrictCheckSnapshot } from '../features/arena/strict-configuration-diagnostics';
import { applyArenaLibraryReferenceSelection, getArenaReferenceSelectionId, resolveArenaLibrarySource } from '../features/arena/library-selection';
import { addAdvancedCombatants, addAdvancedAuxScenario, removeAdvancedCombatants, removeAdvancedAuxScenarios, setAdvancedMainScenario } from '../features/arena/advanced-input';
import { addArenaCombatants, arenaItemName, fetchArenaPreset, moveArenaItem, parseArenaJson, parseArenaScenario, readArenaFile } from '../features/arena/input';
import { useArenaPresetDownload } from '../features/arena/use-preset-download';
import { DesktopArenaRankingModal } from '../features/ranking/arena-ranking-modal';
import { readSublimationHistorySource, type SublimationHistorySource } from '../features/sublimation/history-source';
import { useDesktopAiConfig } from '../features/ai-config/use-desktop-ai-config';
import { resolveDesktopAiTarget, type ResolvedDesktopAiTarget } from '../features/ai-config/desktop-ai-config';
import { DesktopAiProviderPanel } from '../features/ai-config/desktop-ai-provider-panel';
import { useDesktopCloudSession } from '../features/account/use-desktop-cloud-session';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { useDesktopCardLibraryHost } from '../platform/card-library-host';
import { IpcLocalCardRepository } from '../platform/local-card-bridge';
import { DesktopArenaWebPackages } from '../features/arena/web-packages';
import { DesktopArenaWebPackageControls, DesktopArenaWebResult } from '../features/arena/web-controls';
import { IpcWebPackageRepository } from '../platform/web-package-bridge';
import { downloadTextFile } from '../platform/download-text-file';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';
import { useLeaveGuard } from './useLeaveGuard';
import { DesktopArenaRoomSession, readDesktopRoomDocumentNonce } from '../features/arena/room-session';
import { DesktopRoomMemberWorkspace } from '../features/arena/room-member-workspace';
import { DesktopRoomStoryDraft } from '../features/arena/room-story-draft';
import { DesktopArenaRoomPanel } from '../features/arena/room-panel';
import { DesktopArenaStorySession, type PrepareStoryExecution } from '../features/arena/story-session';
import { DesktopArenaStoryControls } from '../features/arena/story-controls';
import { createIpcStoryPendingPort, createIpcStoryPendingExportPort } from '../platform/arena-story-pending-native';
import { createIpcStoryNativePort, createIpcStoryMarkdownExportPort } from '../platform/arena-story-native';
import { createIpcStoryBranchNativePort, createIpcStoryBranchSourcePort } from '../platform/arena-story-branch-native';
import { exportCommittedStoryMarkdown } from '../platform/arena-story-storage';
import type { BattleStoryChapterPlan } from '@mahoshojo/domain/arena-battle-story-session';
import type { StoryBranchAnchorRequest } from '@mahoshojo/contracts/desktop-arena-story-branch';

const secondary = generationActionClassNames.secondary;
const infoClass = 'battle-lite-info-box mt-3 rounded-lg p-3 text-sm leading-relaxed wrap-anywhere';
const limits = ARENA_CANONICAL_CAPABILITIES;
const characterPresets = { magicalGirl: PRESET_LIST.filter(preset => preset.type === 'magical-girl'), canshou: PRESET_LIST.filter(preset => preset.type === 'canshou') };
type LibraryPurpose = 'character' | 'scenario' | 'auxScenario' | 'material';
const reject = () => { throw new Error('当前页面未开放此能力。'); };
const strictTargetIdentity = (target: ResolvedDesktopAiTarget) => JSON.stringify([target.location, target.providerTarget, target.modelId, target.generationOverrides, target.unavailableReason]);

const createWebPackages = () => {
  const repository = new IpcWebPackageRepository((command, args) => invoke(command, args as never));
  return new DesktopArenaWebPackages({ repository, confirmRestore: (title) => window.confirm(`「${title}」已在回收站。确认恢复并导入这份包？`),
    write: async (record, archive) => ({ repaired: (await repository.putWithOutcome(record, archive)).blobOutcome === 'repaired' }) });
};

const createStorySession = (product: DesktopArenaProduct) => {
  const port = createIpcStoryNativePort(invoke), sink = createIpcStoryMarkdownExportPort(invoke);
  return new DesktopArenaStorySession({ port, branch: { port: createIpcStoryBranchNativePort(invoke), source: createIpcStoryBranchSourcePort(invoke) }, hosted: { product, invoke, storage: window.localStorage, port: createIpcStoryPendingPort(invoke), sink: createIpcStoryPendingExportPort(invoke) }, exportMarkdown: (head, signal, onProgress) => exportCommittedStoryMarkdown(port, sink, head, { signal, onProgress }) });
};

/** Desktop owns session/IO only. The actual Web controls, layout and report are shared. */
export function DesktopBattleForm({ session, repository, product = 'battle', webPackages, story }: { session: DesktopArenaSession; repository: IpcLocalCardRepository; product?: DesktopArenaProduct; webPackages?: DesktopArenaWebPackages; story: DesktopArenaStorySession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const draftArchive = useSyncExternalStore(session.narrativeDrafts.subscribe, session.narrativeDrafts.getState);
  const storyOwner = story;
  const storyState = useSyncExternalStore(storyOwner.subscribe, storyOwner.getSnapshot);
  useEffect(() => { void storyOwner.initialize(); }, [storyOwner]);
  const packageOwner = useMemo(() => webPackages ?? createWebPackages(), [webPackages]);
  const packageState = useSyncExternalStore(packageOwner.subscribe, packageOwner.getSnapshot);
  const recovery = useSyncExternalStore(session.hostedRecovery.subscribe, session.hostedRecovery.getSnapshot);
  useEffect(() => {
    if (!storyState.hosted?.active && !storyState.hosted?.busy) session.hostedRecovery.refreshFromStorage();
  }, [session, storyState.hosted?.active, storyState.hosted?.busy, storyState.hosted?.abandonment]);
  useEffect(() => () => { if (!webPackages) packageOwner.dispose(); }, [packageOwner, webPackages]);
  const { state: aiState, store: aiStore } = useDesktopAiConfig();
  const { state: cloudState, store: cloudStore } = useDesktopCloudSession();
  const [strictActive, setStrictActive] = useState(false);
  const strictActiveRef = useRef(false);
  const roomStartAllowed = useRef<() => boolean>(() => false);
  const roomOwner = useMemo(() => new DesktopArenaRoomSession({ invoke, account: cloudStore, documentNonce: readDesktopRoomDocumentNonce, canStart: () => product === 'arena' && roomStartAllowed.current() }), [cloudStore, product]);
  const roomState = useSyncExternalStore(roomOwner.subscribe, roomOwner.getSnapshot);
  const memberWorkspaceSession = roomOwner.memberWorkspaceSession();
  useEffect(() => { roomOwner.activate(); return () => roomOwner.dispose(); }, [roomOwner]);
  const [strictRevision, setStrictRevision] = useState(0);
  const [strictCheck, setStrictCheck] = useState<DesktopStrictCheckSnapshot | null>(null);
  const strictCheckRef = useRef<DesktopStrictCheckSnapshot | null>(null);
  const checkedStrict = useCallback((snapshot: DesktopStrictCheckSnapshot | null) => { strictCheckRef.current = snapshot; setStrictCheck(snapshot); }, []);
  const strictPreparation = useRef<{ token: symbol; controller: AbortController } | null>(null);
  const roomHostPreview = roomState.constrained && roomState.session?.self.role === 'host';
  const effectiveSelection = (strictActive || roomHostPreview) ? { ...aiState.selection, executionPreference: 'server' as const } : aiState.selection;
  const target = resolveDesktopAiTarget(effectiveSelection, aiState.profiles, aiState.generationOverrides, aiState.modelsByProfileId, aiState.presetsByProviderId, roomHostPreview ? 'fixed-default' : undefined);
  const readStrictTargetIdentity = () => { const state = aiStore.getSnapshot(); return strictTargetIdentity(resolveDesktopAiTarget({ ...state.selection, executionPreference: 'server' }, state.profiles, state.generationOverrides, state.modelsByProfileId, state.presetsByProviderId)); };
  const hostedTarget = target.location === 'server';
  const hostedUnavailable = hostedTarget && !cloudState.bootstrapped ? '正在确认本机账号身份，请稍后。' : null;
  const router = useRouter(); const { openFixed, openContent } = useExternalLinks(); const libraryHost = useDesktopCardLibraryHost();
  const [library, setLibrary] = useState<LibraryPurpose | null>(null);
  const libraryEpoch = useRef(0);
  const closeLibrary = () => { libraryEpoch.current += 1; setLibrary(null); };
  const [rankingOpen, setRankingOpen] = useState(false);
  const [rosterDetails, setRosterDetails] = useState<ReturnType<typeof snapshotDesktopRosterDetails> | null>(null);

  const [isMatchingCharacter, setIsMatchingCharacter] = useState(false);
  const matchingRequest = useRef<symbol | null>(null);
  const [recoveryHint, setRecoveryHint] = useState<{ value: DesktopArenaHostedRecoveryHint; repair: ArenaHostedRecoveryReplacement; epoch: number } | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const diagnosisFlight = useRef<symbol | null>(null);
  // 沿用同一个反馈槽和覆盖/清理时机，仅区分原导出错误框与操作区呈现。
  const [feedback, setFeedback] = useState<{ message: string; presentation: 'operation' | 'default' } | null>(null);
  const error = feedback?.message ?? null;
  const setError = useCallback((message: string | null) => {
    setFeedback(message === null ? null : { message, presentation: 'operation' });
  }, []);
  // 当前结果与历史章节可同时截图，最后一次导出完成后才解除离开保护。
  const exportingReport = useRef(0);
  const [reportExporting, setReportExporting] = useState(false);
  const onReportExportingChange = useCallback((value: boolean) => {
    exportingReport.current = Math.max(0, exportingReport.current + (value ? 1 : -1));
    setReportExporting(exportingReport.current > 0);
  }, []);
  const [backupFeedback, setBackupFeedback] = useState<ArenaBackupFeedback>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [magicalGirlPage, setMagicalGirlPage] = useState(1);
  const [canshouPage, setCanshouPage] = useState(1);
  const [loadingPresetFilename, setLoadingPresetFilename] = useState<string | null>(null);
  const presetSelection = useRef<symbol | null>(null);
  const presetDownload = useArenaPresetDownload();
  const [languages, setLanguages] = useState([{ code: 'zh-CN', name: '简体中文' }]);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySource, setHistorySource] = useState<SublimationHistorySource | null>(null);
  const [historySort, setHistorySort] = useState<NarrativeHistorySort>('created_desc');
  const [historyRevision, setHistoryRevision] = useState(0);
  const resultActionLocks = useArenaResultActionLocks(invoke);
  const [advancedBusy, setAdvancedBusy] = useState(false);
  const advancedBusyRef = useRef(false);
  // Each editor/import owns a slot so finishing one cannot release another operation's leave guard.
  const controlBusy = useRef({ advanced: false, history: false, historyImport: false });
  const onAdvancedBusy = useCallback((value: boolean) => { controlBusy.current.advanced = value; advancedBusyRef.current = Object.values(controlBusy.current).some(Boolean); setAdvancedBusy(advancedBusyRef.current); }, []);
  const onHistoryBusy = useCallback((value: boolean) => { controlBusy.current.history = value; advancedBusyRef.current = Object.values(controlBusy.current).some(Boolean); setAdvancedBusy(advancedBusyRef.current); }, []);
  const onHistoryImportBusy = useCallback((value: boolean) => { controlBusy.current.historyImport = value; advancedBusyRef.current = Object.values(controlBusy.current).some(Boolean); setAdvancedBusy(advancedBusyRef.current); }, []);
  const ownerEpoch = useRef(0), preparing = useRef(false), historyLoading = useRef(false);
  const dirtyControls = useRef({ roster: false, rosterTeam: false, scenario: false, material: false, ai: false, advanced: false, history: false });
  const onRosterDirty = useCallback((dirty: boolean) => { dirtyControls.current.roster = dirty; }, []);
  const onRosterTeamDirty = useCallback((dirty: boolean) => { dirtyControls.current.rosterTeam = dirty; }, []);
  const onScenarioDirty = useCallback((dirty: boolean) => { dirtyControls.current.scenario = dirty; }, []);
  const onMaterialDirty = useCallback((dirty: boolean) => { dirtyControls.current.material = dirty; }, []);
  const onAiDirty = useCallback((dirty: boolean) => { dirtyControls.current.ai = dirty; }, []);
  const onAdvancedDirty = useCallback((value: boolean) => { dirtyControls.current.advanced = value; }, []);
  const onHistoryDirty = useCallback((value: boolean) => { dirtyControls.current.history = value; }, []);
  const reportCardWidth = useDesktopReportCardWidth();
  const cardWidthPx = resolveBattleReportCardManualWidthPx(reportCardWidth.value);
  const draft = state.draft;
  const readinessMessage = useMemo(() => arenaReadinessMessage(draft, product, true), [draft, product]);
  const referenceCount = useMemo(() => arenaReferenceCount(draft), [draft]);
  const inheritedAdjudication = useMemo(() => inheritedArenaAdjudication(draft, product), [draft, product]);
  // Do not include credential presence probes or preparing-state changes: they do not change target identity.
  const accountCredentialEpoch = cloudStore.getCredentialEpoch();
  const providerCredentialIntent = aiStore.getCredentialIntentRevision();
  const scope = JSON.stringify({ account: cloudState.account?.userId ?? null, credentialEpoch: accountCredentialEpoch, strictActive, selection: aiState.selection,
    profiles: aiState.profiles, models: aiState.modelsByProfileId, presets: aiState.presetsByProviderId, overrides: aiState.generationOverrides });
  const rosterMetadata = useMemo(() => new Map<string, DesktopRosterMetadataSnapshot>(), [scope]);
  useEffect(() => { setRosterDetails(null); }, [scope]);
  useEffect(() => {
    const ids = new Set(draft.combatants.map(getCombatantCardLibrarySelectionId));
    for (const id of rosterMetadata.keys()) if (!ids.has(id)) rosterMetadata.delete(id);
  }, [draft.combatants, rosterMetadata]);
  useLayoutEffect(() => { matchingRequest.current = null; setIsMatchingCharacter(false); }, [scope]);
  useEffect(() => () => { matchingRequest.current = null; }, []);
  const strictSnapshotKey = useMemo(() => ({}), [draft, scope, state.phase, state.generation, cloudState.verification, cloudState.authFlow.kind, providerCredentialIntent, strictRevision]);
  const strictSnapshotKeyRef = useRef(strictSnapshotKey); strictSnapshotKeyRef.current = strictSnapshotKey;
  const strictInput = { draft, executionLocation: target.location, modelId: target.modelId, modelUnavailable: !!target.unavailableReason,
    isAuthenticated: cloudState.verification === 'verified' && !!cloudState.account ? true : cloudState.verification === 'signed-out' || cloudState.verification === 'expired' ? false : null,
    adjudicationEventCount: inheritedAdjudication.events.length };
  const strictReady = !strictActive || Boolean(strictCheck?.key === strictSnapshotKey && strictCheck.result.willCount && describeDesktopStrictSetup(strictInput, strictCheck.season).reasons.length === 0);
  const invalidateStrict = () => { strictSnapshotKeyRef.current = {}; strictPreparation.current?.controller.abort(); strictPreparation.current = null; checkedStrict(null); setStrictRevision(value => value + 1); };

  const narrativeScope = cloudState.bootstrapped ? cloudState.account ? `account:${cloudState.account.userId}` : 'anonymous' : null;
  useLayoutEffect(() => { session.setNarrativeDraftScope(narrativeScope); }, [session, narrativeScope]);
  useEffect(() => {
    const observe = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(`mahoshojo.desktop.arena.${product}.narrative-drafts:v2:`)) session.narrativeDrafts.loadDrafts(); };
    window.addEventListener('storage', observe);
    return () => window.removeEventListener('storage', observe);
  }, [session, product]);
  useLayoutEffect(() => { ownerEpoch.current += 1; session.setScope(scope); packageOwner.setScope(scope); aiStore.cancelPreparingGeneration(); setError(null); setBackupFeedback(null); setImportWarnings([]); setRecoveryHint(null); diagnosisFlight.current = null; setDiagnosing(false); }, [scope, session, aiStore, packageOwner]);
  // Resolving an initially anonymous account updates the Hosted actor without
  // cancelling unrelated Direct credential preparation at the same target scope.
  useLayoutEffect(() => { storyOwner.setExecutionScope(scope, cloudState.bootstrapped ? cloudState.account ? { kind: 'account', expectedUserId: cloudState.account.userId } : { kind: 'anonymous' } : null); }, [scope, cloudState.bootstrapped, cloudState.account?.userId, storyOwner]);
  useEffect(() => () => { ownerEpoch.current += 1; diagnosisFlight.current = null; strictActiveRef.current = false; strictPreparation.current?.controller.abort(); strictPreparation.current = null; aiStore.cancelPreparingGeneration(); }, [aiStore]);
  const guard = useLeaveGuard(
    () => resultActionLocks.isSourceLocked() || exportingReport.current > 0 || roomOwner.needsLeaveConfirmation() || storyOwner.isBusy() || storyOwner.hasUnsavedResult() || Boolean(diagnosisFlight.current) || session.isBusy() || packageOwner.isBusy() || preparing.current || aiStore.isPreparingGeneration() || aiStore.getSnapshot().savingConnection || aiStore.getSnapshot().savingCredential || aiStore.getSnapshot().deletingConnection || historyLoading.current || advancedBusyRef.current || packageOwner.getSnapshot().temporary.length > 0 || session.hasUnsavedDraft() || Object.values(dirtyControls.current).some(Boolean),
    '当前生成、读取或保存尚未完成，或仍有未保存的内容。',
    '窗口关闭保护初始化失败，生成、导入与保存暂不可用，请重新打开页面。',
    () => {
      if (resultActionLocks.isSourceLocked() || exportingReport.current || storyOwner.getSnapshot().hosted?.busy && storyOwner.getSnapshot().hosted?.busy !== 'model' || storyOwner.getSnapshot().saving || storyOwner.getSnapshot().exporting || storyOwner.getSnapshot().phase === 'preparing' || diagnosisFlight.current || packageOwner.isBusy() || session.getSnapshot().saving || session.getSnapshot().importing || preparing.current || aiStore.isPreparingGeneration() || aiStore.getSnapshot().savingConnection || aiStore.getSnapshot().savingCredential || aiStore.getSnapshot().deletingConnection || historyLoading.current || advancedBusyRef.current) return false;
      const roomWarning = roomOwner.needsLeaveConfirmation() ? '成员提案草稿将丢弃，普通 Arena 草稿、结果和模型保留。多人房间只会断开本机连接，不代表退出、关闭或停止生成；未知操作仍可能已发生，建议先核对。' : '';
      if (!window.confirm(roomWarning + (storyOwner.hosted?.hasCandidate() || session.getSnapshot().hosted || session.getSnapshot().generation?.intent.mode === 'hosted' ? '确认离开？只停止本机订阅，服务器可能继续生成；已封存原件可从原页面恢复，尚未封存的最新正文仅在当前窗口，请先导出。' : '确认离开？正在生成的请求会取消，未保存的输入或原文可能丢失。'))) return false;
      roomOwner.detach(); storyOwner.detach(); session.detach(); return true;
    },
  );
  const busy = Boolean(state.repairing) || reportExporting || Boolean(storyState.hosted?.stopping) || Boolean(storyState.hosted?.busy) || storyState.saving || storyState.exporting || storyState.phase === 'preparing' || storyState.phase === 'generating' || diagnosing || state.roleUpdates.status === 'updating' || state.phase === 'generating' || state.saving || state.importing || aiState.generationActive || advancedBusy || packageState.busy;
  roomStartAllowed.current = () => !resultActionLocks.isSourceLocked() && guard.ready && !strictActiveRef.current && !session.isBusy() && !storyOwner.isBusy() && !storyOwner.hosted?.hasCandidate() && !storyOwner.getSnapshot().hosted?.slots[product] && !packageOwner.isBusy() && !preparing.current && !diagnosisFlight.current && !advancedBusyRef.current && !session.getSnapshot().pendingRestore && !aiStore.isPreparingGeneration() && !aiStore.getSnapshot().generationActive && !aiStore.getSnapshot().savingConnection && !aiStore.getSnapshot().savingCredential && !aiStore.getSnapshot().deletingConnection;
  const resultActionsDisabled = !guard.ready || busy || state.pendingRestore || roomState.constrained;
  const disabled = resultActionsDisabled || resultActionLocks.sourceLocked;
  const update = (patch: Partial<ArenaDraft>) => { if (!resultActionLocks.isSourceLocked() && !roomOwner.isConstrained() && !disabled) session.updateDraft({ ...session.getSnapshot().draft, ...patch }); };
  const resultRef = useRef<HTMLDivElement>(null);
  useResultAutoScroll(resultRef, state.phase === 'completed' || state.phase === 'generating' && Boolean(state.markdown.trim() || state.reasoning.trim()), { restored: state.restored });
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/languages.json', { signal: controller.signal, credentials: 'omit', redirect: 'error' }).then((response) => response.ok ? response.json() : null)
      .then((value: unknown) => { if (!controller.signal.aborted && Array.isArray(value)) setLanguages(value.filter((entry) => entry && typeof entry.code === 'string' && typeof entry.name === 'string')); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!historyOpen) return;
    const controller = new AbortController(); historyLoading.current = true; setHistorySource(null);
    void readSublimationHistorySource(repository, controller.signal).then((source) => { if (!controller.signal.aborted) setHistorySource(source); }).catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) historyLoading.current = false; });
    return () => { controller.abort(); historyLoading.current = false; };
  }, [historyOpen, historyRevision, repository, scope]);
  const reportError = (cause: unknown, presentation: 'operation' | 'default' = 'operation') => {
    setFeedback({ message: cause instanceof Error ? cause.message : '操作失败，原输入仍保留。', presentation });
  };
  const performImport = async (load: Parameters<DesktopArenaSession['importInput']>[0]) => {
    if (resultActionLocks.isSourceLocked() || roomOwner.isConstrained() || !guard.ready || diagnosisFlight.current || preparing.current || aiState.generationActive || packageOwner.isBusy()) throw new Error('请等待当前操作完成。');
    const epoch = ownerEpoch.current; setError(null); try { await session.importInput(load); } catch (cause) { if (epoch === ownerEpoch.current && !(cause instanceof Error && cause.name === 'AbortError')) reportError(cause); throw cause; }
  };
  const prepareStrict = async (season: PublicSeasonMeta) => {
    if (resultActionLocks.isSourceLocked() || roomOwner.isConstrained() || disabled || preparing.current || strictPreparation.current || session.isBusy() || storyOwner.isBusy() || aiStore.getSnapshot().savingConnection || aiStore.getSnapshot().savingCredential || aiStore.getSnapshot().deletingConnection) return;
    const token = Symbol(), controller = new AbortController(), epoch = ownerEpoch.current;
    const preparationIdentity = () => {
      const ai = aiStore.getSnapshot(), account = cloudStore.getSnapshot();
      return JSON.stringify([account.account?.userId, account.verification, account.authFlow, cloudStore.getCredentialEpoch(), aiStore.getCredentialIntentRevision(),
        ai.selection, ai.profiles, ai.modelsByProfileId, ai.presetsByProviderId, ai.generationOverrides]);
    };
    const originalIdentity = preparationIdentity();
    const original = session.getSnapshot().draft;
    const current = () => strictPreparation.current?.token === token && ownerEpoch.current === epoch && !controller.signal.aborted && preparationIdentity() === originalIdentity;
    strictPreparation.current = { token, controller }; checkedStrict(null); setError(null);
    try {
      await session.importInput(async signal => {
        const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
        try {
          const prepared = await prepareDesktopStrictDraft(original, season, controller.signal);
          if (!current() || session.getSnapshot().draft !== original) throw new DOMException('Aborted', 'AbortError');
          return () => { if (!current() || session.getSnapshot().draft !== original) throw new DOMException('Aborted', 'AbortError'); return prepared; };
        } finally { signal.removeEventListener('abort', abort); }
      });
      if (!current()) return;
      strictActiveRef.current = true; ownerEpoch.current += 1; setStrictActive(true);
    } catch (cause) { if (current()) reportError(cause); }
    finally { if (strictPreparation.current?.token === token) strictPreparation.current = null; }
  };
  const exitStrict = () => {
    if (busy || preparing.current || session.isBusy() || storyOwner.isBusy()) return;
    strictActiveRef.current = false; ownerEpoch.current += 1; invalidateStrict(); setStrictActive(false);
  };
  const parseCharacters = async (text: string, warnings: string[]) => {
    if (new TextEncoder().encode(text).byteLength > 12 * 1024 * 1024) throw new Error('输入超过 Arena 12 MiB 上限。');
    const parsed = await parseCombatantsFromText(text, { existingCount: 0, maxCombatants: product === 'arena' ? null : limits.maxCombatants, onWarn: (warning) => warnings.push(warning) });
    return parsed.map((item) => ({ ...item, isValid: false, isPreset: false }));
  };
  const applyCharacters = (current: ArenaDraft, items: ArenaDraft['combatants'], warnings: string[], textImport = false) => { const next = product === 'arena' ? addAdvancedCombatants(current, items, (message) => warnings.push(message), textImport) : addArenaCombatants(current, items); setImportWarnings(warnings); return next; };
  const pasteCharacters = (text: string) => performImport(async () => { const warnings: string[] = []; const items = await parseCharacters(text, warnings); return (current) => applyCharacters(current, items, warnings, true); });
  const uploadCharacters = (files: FileList) => performImport(async (signal) => {
    const warnings: string[] = []; const items = (await Promise.all(Array.from(files).map(async (file) => parseCharacters(await readArenaFile(file, signal), warnings)))).flat();
    return (current) => applyCharacters(current, items, warnings, true);
  });
  const selectPreset = async (filename: string, nextSelected: boolean, selectionSignal?: AbortSignal): Promise<void | false> => {
    if (disabled || session.isBusy() || selectionSignal?.aborted) return false;
    const epoch = ownerEpoch.current;
    const currentSelection = () => epoch === ownerEpoch.current && !selectionSignal?.aborted && !roomOwner.isConstrained();
    const original = session.getSnapshot().draft;
    const indices = original.combatants.flatMap((item, index) => isArenaRealCombatant(item) && item.isPreset && item.filename === filename ? [index] : []);
    if (!nextSelected) {
      if (!indices.length) return false;
      const combatants = original.combatants.filter((_, index) => !indices.includes(index));
      const retainedKeys = new Set(combatants.map(getCombatantAdjudicationSourceKey));
      const removedKeys = indices.flatMap(index => {
        const item = original.combatants[index]!, key = getCombatantAdjudicationSourceKey(item);
        // A preset's fallback filename is not ownership of a remaining upload's events.
        const explicitKey = 'adjudicationSourceKey' in item && typeof item.adjudicationSourceKey === 'string' && item.adjudicationSourceKey.trim();
        return key && (explicitKey || !retainedKeys.has(key)) ? [key] : [];
      });
      update({ combatants, ...(product === 'arena' ? { adjudicationEvents: removeAdjudicationEventsForKeys(original.adjudicationEvents, removedKeys) } : {}) });
      return;
    }
    if (indices.length) return false;
    const token = Symbol(); presetSelection.current = token; setLoadingPresetFilename(filename);
    let applied = false;
    try {
      await performImport(async signal => {
        const controller = new AbortController(), abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true }); selectionSignal?.addEventListener('abort', abort, { once: true });
        try {
          if (signal.aborted || !currentSelection()) throw new DOMException('Aborted', 'AbortError');
          const warnings: string[] = [], text = await fetchArenaPreset('character', filename, controller.signal);
          const items = retainDesktopArenaSelectionSource(await parseCharacters(text, warnings), parseArenaJson(text), { kind: 'preset', filename });
          return current => {
            if (signal.aborted || !currentSelection()) throw new DOMException('Aborted', 'AbortError');
            if (current.combatants.some(item => isArenaRealCombatant(item) && item.isPreset && item.filename === filename)) return current;
            const next = applyCharacters(current, items, warnings); applied = true; return next;
          };
        } finally { signal.removeEventListener('abort', abort); selectionSignal?.removeEventListener('abort', abort); }
      });
    } catch (cause) {
      if (!currentSelection() || cause instanceof Error && cause.name === 'AbortError') return false;
      throw cause;
    } finally { if (presetSelection.current === token) { presetSelection.current = null; setLoadingPresetFilename(null); } }
    return applied && currentSelection() ? undefined : false;
  };
  const togglePreset = (filename: string) => {
    void selectPreset(filename, !session.getSnapshot().draft.combatants.some(item => isArenaRealCombatant(item) && item.isPreset && item.filename === filename)).catch(() => undefined);
  };
  const loadScenario = (read: (signal: AbortSignal) => Promise<string>, filename: string | null = null, auxiliary = false, sourceIdentity?: string, isPreset = false) => performImport(async (signal) => {
    const content = parseArenaScenario(await read(signal)); return (current) => {
      const warnings: string[] = [];
      const next = product === 'arena' ? auxiliary ? addAdvancedAuxScenario(current, content, filename, crypto.randomUUID(), (warning) => warnings.push(warning), sourceIdentity) : setAdvancedMainScenario(current, content, filename, (warning) => warnings.push(warning), sourceIdentity) : { ...current, scenario: { content, fileName: filename }, scenarioDisplayName: arenaItemName(content) };
      setImportWarnings(warnings); return auxiliary ? { ...next, auxScenarios: next.auxScenarios.map((item, index) => index === next.auxScenarios.length - 1 ? { ...item, isPreset } : item) } : { ...next, scenario: { ...next.scenario, isPreset } };
    };
  });
  const uploadAuxScenarios = (files: FileList | null) => performImport(async (signal) => {
    const inputs = await Promise.all(Array.from(files ?? []).map(async (file) => ({ content: parseArenaScenario(await readArenaFile(file, signal)), filename: file.name })));
    return (current) => { const warnings: string[] = []; const next = inputs.reduce((value, item) => addAdvancedAuxScenario(value, item.content, item.filename, crypto.randomUUID(), (warning) => warnings.push(warning)), current); setImportWarnings(warnings); return next; };
  });
  const materials = draft.materials as ArenaMaterialState[];
  const loadMaterials = (read: (signal: AbortSignal) => Promise<{ text: string; filename: string | null }[]>) => performImport(async (signal) => {
    const source = await read(signal); const items = source.map(({ text, filename }) => buildArenaMaterialState({ payload: parseArenaJson(text), fileName: filename, isNative: false }));
    return (current) => {
      if (arenaReferenceCount(current) + items.length > limits.maxReferenceItemsSanity) throw new Error('参考项超过 256 项，未导入新素材。');
      return { ...current, materials: [...current.materials, ...items] };
    };
  });
  const parseSelectedCharacters = async (context: CardLibrarySelectionContext, warnings: string[]) => {
    const parsed = await parseCharacters(JSON.stringify(context.rawSourceData), warnings);
    const { selectionId, onlineId } = resolveArenaLibrarySource(context);
    const selected = (onlineId ? retainDesktopArenaSelectionSource(parsed, context.rawSourceData, { kind: 'online', cardId: onlineId }) : parsed)
      .map(item => ({ ...item, cardLibrarySelectionId: selectionId,
        adjudicationSourceKey: `library:${selectionId}`,
        ...(onlineId && context.cloudCardUpdatedAt?.trim() ? { sourceDataCardUpdatedAt: context.cloudCardUpdatedAt.trim() } : {}) }));
    if (onlineId && context.displayMetadata) for (const item of selected.filter(isArenaRealCombatant)) rosterMetadata.set(selectionId, { body: JSON.stringify(item.data), metadata: { ...context.displayMetadata } });
    return selected;
  };
  const randomMatchCharacter = async () => {
    if (disabled || matchingRequest.current || draft.combatants.length >= limits.maxCombatants) return;
    const token = Symbol(), epoch = ownerEpoch.current;
    matchingRequest.current = token; setIsMatchingCharacter(true);
    try {
      await performImport(async signal => {
        // 复用既有公开卡实时读取；本地和缓存正文不能升级为线上引用。
        const { ref, row } = await readDesktopRandomPublicCharacter(invoke, libraryHost.online, signal, () => epoch === ownerEpoch.current);
        const warnings: string[] = [];
        const items = await parseSelectedCharacters({ selectionId: `cloud:${ref.id}`, storageLocation: 'cloud', cloudCardId: ref.id, cloudCardUpdatedAt: ref.versionToken,
          rawSourceData: mapPublicDataCardRowToSourceData(row) }, warnings);
        return current => applyCharacters(current, items, warnings);
      });
    } catch { /* performImport 已报告当前作用域错误，原草稿保持不变。 */ }
    finally { if (matchingRequest.current === token) { matchingRequest.current = null; setIsMatchingCharacter(false); } }
  };
  const toggleSelectedCharacter = async (_payload: unknown, selected: boolean, context: CardLibrarySelectionContext): Promise<void | false> => {
    if (disabled || context.signal?.aborted) return false;
    const epoch = ownerEpoch.current, selectionId = context.rowSelectionId ?? context.selectionId;
    const currentSelection = () => epoch === ownerEpoch.current && !context.signal?.aborted && !roomOwner.isConstrained();
    let applied = false;
    try {
      await performImport(async signal => {
        const warnings: string[] = [];
        if (selected && !context.rawSourceData) throw new Error('卡库未提供完整原文，请重新选择。');
        const items = selected ? await parseSelectedCharacters(context, warnings) : [];
        return current => {
          if (!currentSelection() || signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const indices = current.combatants.flatMap((item, index) => getCombatantCardLibrarySelectionId(item) === selectionId ? [index] : []);
          if (selected) {
            if (indices.length) return current;
            const next = applyCharacters(current, items, warnings);
            applied = true;
            return next;
          }
          if (!indices.length) return current;
          applied = true;
          return product === 'arena' ? removeAdvancedCombatants(current, indices)
            : { ...current, combatants: current.combatants.filter((_, index) => !indices.includes(index)) };
        };
      });
    } catch (cause) {
      if (!currentSelection() || cause instanceof Error && cause.name === 'AbortError') return false;
      throw cause;
    }
    return applied && currentSelection() ? undefined : false;
  };
  const toggleCharacterCard = (payload: unknown, selected: boolean, context: CardLibrarySelectionContext): Promise<void | false> =>
    library === 'character' ? toggleSelectedCharacter(payload, selected, context) : Promise.resolve(false);
  const toggleReferenceCard = async (_payload: unknown, selected: boolean, context: CardLibrarySelectionContext): Promise<void | false> => {
    const purpose = library;
    if (!purpose || purpose === 'character' || disabled || context.signal?.aborted) return false;
    const epoch = ownerEpoch.current, pickerEpoch = libraryEpoch.current;
    const currentSelection = () => epoch === ownerEpoch.current && pickerEpoch === libraryEpoch.current
      && !context.signal?.aborted && !roomOwner.isConstrained();
    let applied = false;
    try {
      await performImport(async signal => current => {
        if (!currentSelection() || signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const warnings: string[] = [];
        const next = applyArenaLibraryReferenceSelection(current, purpose, selected, context, {
          advanced: product === 'arena', createId: () => crypto.randomUUID(), onWarning: warning => warnings.push(warning),
        });
        applied = next !== current;
        setImportWarnings(warnings);
        return next;
      });
    } catch (cause) {
      if (!currentSelection() || cause instanceof Error && cause.name === 'AbortError') return false;
      throw cause;
    }
    return applied && currentSelection() ? undefined : false;
  };
  const chooseCard = (payload: unknown, context: CardLibrarySelectionContext) => toggleReferenceCard(payload, true, context);
  const openLibrary = (purpose: LibraryPurpose) => { if (disabled) return; libraryEpoch.current += 1; setLibrary(purpose); void cloudStore.refresh(); };
  const librarySelectionOptions = getArenaCardLibrarySelectionOptions({
    purpose: library ?? 'character', characterCount: draft.combatants.length, characterMaxSelected: limits.maxCombatants,
    auxiliaryScenarioCount: draft.auxScenarios.length, materialCount: draft.materials.length,
    referenceRemainingCapacity: limits.maxReferenceItemsSanity - referenceCount,
  });
  const selectedLibraryIds = library === 'character'
    ? draft.combatants.map(getCombatantCardLibrarySelectionId)
    : (library === 'auxScenario' ? draft.auxScenarios : library === 'material' ? draft.materials : []).map(getArenaReferenceSelectionId);
  const rosterRatings = useDesktopRosterRatings(draft.combatants, JSON.stringify([scope, draft.battleMode, draft.reportFormat]), !roomState.constrained && !state.pendingRestore);
  const rankingProjection = useMemo(() => projectDesktopGenerationRanking({
    current: draft.combatants, frozen: state.generation?.input.combatants,
    ranking: state.hosted?.ranking, hostedGenerationId: state.hostedGenerationId,
  }), [draft.combatants, state.generation, state.hosted?.ranking, state.hostedGenerationId]);
  const rosterExtras = useMemo(() => draft.combatants.map((item, index) => {
    if (!isArenaRealCombatant(item)) return {};
    const metadata = readDesktopRosterMetadata(item, rosterMetadata);
    return buildDesktopRosterExtras(item, () => setRosterDetails(snapshotDesktopRosterDetails(item)), metadata, rosterRatings[index], rankingProjection.rows[index]);
  }), [draft.combatants, rosterMetadata, rosterRatings, rankingProjection]);
  const roster: ArenaRosterSectionModel = {
    rowExtras: row => rosterExtras[row.index],
    rows: draft.combatants.map((item, index) => ({ key: String(index), displayName: isArenaRealCombatant(item) ? arenaItemName(item.data) : item.filename, typeLabel: isArenaRealCombatant(item) ? getCombatantTypeLabel(item.type) : '随机占位符', guidance: isArenaRealCombatant(item) ? item.characterGuidance ?? '' : '', index, teamKey: item.teamId ? String(item.teamId) : null, isPlaceholder: !isArenaRealCombatant(item) })),
    teams: draft.teams.map((team) => ({ key: String(team.id), name: team.name, memberKeys: draft.combatants.flatMap((item, index) => item.teamId === team.id ? [String(index)] : []), collapsed: collapsedTeams.has(String(team.id)) })),
    disabled, combatantCountLabel: `${draft.combatants.length}/${limits.maxCombatants}`, combatantCapReached: draft.combatants.length >= limits.maxCombatants,
    capabilities: { reorderRows: true, removeRows: true, editGuidance: true, ranking: true, addPlaceholders: true, clearRoster: true, createTeams: true, renameTeams: true, removeTeams: true, reorderTeams: true, assignTeamMembers: true, reorderTeamMembers: true, collapseTeams: true },
    actions: {
      moveRow: (from, to) => update({ combatants: moveArenaItem(draft.combatants, from, to) }),
      removeRow: (key) => update(product === 'arena' ? removeAdvancedCombatants(draft, [Number(key)]) : { combatants: draft.combatants.filter((_, index) => index !== Number(key)) }),
      setGuidance: (key, value) => update({ combatants: draft.combatants.map((item, index) => index === Number(key) && isArenaRealCombatant(item) ? { ...item, characterGuidance: value } : item) }),
      addPlaceholder: type => { if (disabled || draft.combatants.length >= limits.maxCombatants) return; update({ combatants: [...draft.combatants, { type, id: crypto.randomUUID(), filename: type === 'random-magical-girl' ? '随机魔法少女' : '随机残兽' }] }); }, clearRoster: () => update(product === 'arena' ? removeAdvancedCombatants(draft, draft.combatants.map((_, index) => index)) : { combatants: [] }),
      createTeam: () => { const id = Math.max(0, ...draft.teams.map((team) => team.id)) + 1; update({ teams: [...draft.teams, { id, name: `分队 ${id}` }] }); return String(id); },
      renameTeam: (key, name) => update({ teams: draft.teams.map((team) => String(team.id) === key ? { ...team, name } : team) }),
      removeTeam: (key) => update({ teams: draft.teams.filter((team) => String(team.id) !== key), combatants: draft.combatants.map((item) => String(item.teamId) === key ? Object.fromEntries(Object.entries(item).filter(([field]) => field !== 'teamId')) as typeof item : item) }),
      moveTeam: (key, direction) => { const index = draft.teams.findIndex((team) => String(team.id) === key); update({ teams: moveArenaItem(draft.teams, index, index + direction) }); },
      assignCombatant: (key, teamKey) => update({ combatants: draft.combatants.map((item, index) => index === Number(key) ? teamKey ? { ...item, teamId: Number(teamKey) } : Object.fromEntries(Object.entries(item).filter(([field]) => field !== 'teamId')) as typeof item : item) }),
      moveTeamMember: (key, from, to) => { const indices = draft.combatants.flatMap((item, index) => String(item.teamId) === key ? [index] : []); const reordered = moveArenaItem(indices.map((index) => draft.combatants[index]!), from, to); const next = [...draft.combatants]; indices.forEach((index, i) => { next[index] = reordered[i]!; }); update({ combatants: next }); },
      toggleTeamCollapsed: (key) => setCollapsedTeams((prior) => { const next = new Set(prior); if (next.has(key)) next.delete(key); else next.add(key); return next; }),
    },
  };
  const scenario: ArenaScenarioSectionModel = {
    disabled, isAuthenticated: !!cloudState.account, isMatchingBlocked: true, isMatchingScenario: false, mainName: draft.scenarioDisplayName, mainIsNative: false,
    auxScenarios: product === 'arena' ? draft.auxScenarios.map((item, index) => ({ key: String(index), title: arenaItemName(item.content), isNative: false })) : [], auxBudgetLine: `参考项合计 ${referenceCount}/256`, auxBudgetExhausted: referenceCount >= limits.maxReferenceItemsSanity, presets: SCENARIO_PRESET_LIST, presetsLoading: false, presetsError: null,
    selectedPresetFilenames: [...(draft.scenario.isPreset && draft.scenario.fileName ? [draft.scenario.fileName] : []), ...(product === 'arena' ? draft.auxScenarios.flatMap((item) => item.isPreset && item.fileName ? [item.fileName] : []) : [])], loadingPresetFilename: null,
    capabilities: { browseMain: true, randomMatchMain: false, clearMain: true, uploadMain: true, pasteMain: true, presetRefs: true,
      auxSection: product === 'arena', addAux: product === 'arena', browseAux: product === 'arena', randomMatchAux: false, uploadAux: product === 'arena', pasteAux: product === 'arena', reorderAux: product === 'arena', removeAux: product === 'arena', clearAux: product === 'arena' },
    actions: { openMainModal: () => openLibrary('scenario'), randomMatchMain: reject, clearMain: () => update(product === 'arena' ? setAdvancedMainScenario(draft, null, null) : { scenario: { content: null, fileName: null }, scenarioDisplayName: null }),
      uploadMain: (file) => loadScenario((signal) => readArenaFile(file, signal), file.name), pasteMain: (text) => loadScenario(async () => text),
      togglePreset: (filename) => { if (draft.scenario.isPreset && draft.scenario.fileName === filename) { update(product === 'arena' ? setAdvancedMainScenario(draft, null, null) : { scenario: { content: null, fileName: null }, scenarioDisplayName: null }); return; }
        const auxIndex = draft.auxScenarios.findIndex((item) => item.isPreset && item.fileName === filename); if (product === 'arena' && auxIndex >= 0) { update(removeAdvancedAuxScenarios(draft, [auxIndex])); return; }
        void loadScenario((signal) => fetchArenaPreset('scenario', filename, signal), filename, product === 'arena' && !!draft.scenario.content, undefined, true).catch(() => undefined); },
      openAuxModal: () => openLibrary('auxScenario'), randomMatchAux: reject, uploadAux: uploadAuxScenarios, pasteAux: (text) => loadScenario(async () => text, null, true), moveAux: (from, to) => update({ auxScenarios: moveArenaItem(draft.auxScenarios, from, to) }), removeAux: (key) => update(removeAdvancedAuxScenarios(draft, [Number(key)])), clearAux: () => update(removeAdvancedAuxScenarios(draft, draft.auxScenarios.map((_, index) => index))) },
  };
  const diagnoseRecovery = async () => {
    if (disabled || preparing.current || diagnosisFlight.current || !cloudState.bootstrapped) return;
    const flight = Symbol(), epoch = ownerEpoch.current, repair = session.hostedRecovery.captureReplacement();
    diagnosisFlight.current = flight; setDiagnosing(true); setError(null); setRecoveryHint(null);
    try {
      const value = await readArenaHostedRecoveryHint(invoke, { product });
      if (epoch === ownerEpoch.current && session.hostedRecovery.isReplacementCurrent(repair)) setRecoveryHint({ value, repair, epoch });
    } catch (cause) { if (epoch === ownerEpoch.current) reportError(cause); }
    finally { if (diagnosisFlight.current === flight) { diagnosisFlight.current = null; setDiagnosing(false); } }
  };
  const currentHint = recoveryHint?.epoch === ownerEpoch.current && session.hostedRecovery.isReplacementCurrent(recoveryHint.repair) ? recoveryHint : null;
  const repairHint = currentHint && (currentHint.value.state === 'available' || currentHint.value.state === 'expired') ? currentHint : null;
  const generate = () => {
    if (roomOwner.isConstrained()) return;
    if (storyOwner.hosted?.hasCandidate() || storyState.hosted?.slots[product]) { setError('本产品有待处理的 Hosted 故事候选，请先处理原候选。'); return; }
    if (resultActionLocks.isSourceLocked() || disabled || diagnosisFlight.current || preparing.current || session.isBusy() || packageOwner.isBusy()) return;
    if (!target.modelId || !target.providerTarget || target.unavailableReason || hostedUnavailable) { setError(hostedUnavailable ?? target.unavailableReason ?? '请选择受支持的 AI 目标。'); return; }
    if (strictActiveRef.current && (session.getSnapshot().draft !== draft || readStrictTargetIdentity() !== strictTargetIdentity(target) || !strictReady || strictCheckRef.current?.key !== strictSnapshotKey || !strictCheckRef.current.result.willCount)) { setError('请先完成当前草稿的服务器预检；预检不保证最终计分。'); return; }
    const actor = cloudState.account ? { kind: 'account' as const, expectedUserId: cloudState.account.userId } : { kind: 'anonymous' as const };
    const repair = hostedTarget ? repairHint?.repair : undefined;
    const previousRequest = hostedTarget ? repairHint && 'requestId' in repairHint.value ? repairHint.value.requestId : recovery.pointer?.requestId : undefined;
    if (hostedTarget && recovery.blocked && !repair) { setError(recovery.error); return; }
    if (previousRequest && !window.confirm(repair ? '本机找到了上次服务器生成的恢复记录。确认放弃找回上次战报并开始新生成？旧服务器任务不会停止，新的恢复记录保存成功后才会替换原记录。' : '已有服务器恢复记录。确认以新请求替换？这会放弃原记录的页面恢复入口，不会停止旧服务器任务。')) return;
    if (state.rawText && !window.confirm('开始新生成将替换当前结果，请先保存或完整导出。继续？')) return;
    let sourceDraft: ArenaDraft;
    try { sourceDraft = session.materializeRandomPlaceholders(session.getSnapshot().draft); } catch (cause) { reportError(cause); return; }
    const checked = strictCheckRef.current, strictKey = strictSnapshotKey, strictIntent = strictActiveRef.current, credentialEpoch = cloudStore.getCredentialEpoch();
    const snapshot = structuredClone(sourceDraft); const frozen = { ...snapshot, customStoryLength: normalizeCustomStoryLength(snapshot.customStoryLength) };
    const readiness = arenaReadinessMessage(frozen, product); if (readiness) { setError(readiness); return; }
    const epoch = ownerEpoch.current; preparing.current = true; setError(null);
    void aiStore.withPreparedGeneration(async (prepared) => {
      if (roomOwner.isConstrained() || epoch !== ownerEpoch.current || !prepared.modelId || !prepared.providerTarget) return;
      if (strictIntent && (!strictActiveRef.current || prepared.location !== 'server' || strictTargetIdentity(prepared) !== strictTargetIdentity(target) || readStrictTargetIdentity() !== strictTargetIdentity(target) || session.getSnapshot().draft !== sourceDraft
        || strictSnapshotKeyRef.current !== strictKey || checked?.key !== strictKey || !checked.result.willCount || strictCheckRef.current !== checked
        || aiStore.getCredentialIntentRevision() !== providerCredentialIntent || cloudStore.getCredentialEpoch() !== credentialEpoch || cloudStore.getSnapshot().verification !== 'verified' || cloudStore.getSnapshot().authFlow.kind !== 'idle'
        || cloudStore.getSnapshot().account?.userId !== cloudState.account?.userId)) throw new Error('严格排位准备已失效，请重新检查当前配置。');
      // Credential preparation is finished; the session now owns the generation/leave flight.
      preparing.current = false;
      if (prepared.location === 'server') {
        if (prepared.providerTarget.kind === 'custom') throw new Error('自定义连接仅支持客户端。');
        const config = prepared.providerTarget.kind === 'preset'
          ? { presetConfig: { providerId: prepared.providerTarget.providerId, modelId: prepared.modelId, generationOverrides: prepared.generationOverrides } }
          : { systemConfig: { ...(prepared.modelId !== 'default' ? { modelId: prepared.modelId } : {}), generationOverrides: prepared.generationOverrides } };
        await session.generateHosted({ invoke }, frozen, { mode: 'hosted', generationMode: frozen.generationMode, modelId: prepared.modelId, ...config }, actor, previousRequest, repair);
        return;
      }
      if (!prepared.mode) return;
      await session.generate({ invoke, profileId: prepared.profile?.id ?? '', providerTarget: prepared.providerTarget }, frozen,
        { mode: prepared.mode, generationMode: frozen.generationMode, modelId: prepared.modelId,
          temperature: prepared.generationOverrides?.temperature, maxOutputTokens: prepared.generationOverrides?.maxOutputTokens });
    }, strictIntent ? { executionLocation: 'server' } : undefined).catch((cause: unknown) => { if (epoch === ownerEpoch.current) reportError(cause); }).finally(() => { preparing.current = false; });
  };
  const prepareStoryExecution: PrepareStoryExecution = (run) => {
    if (resultActionLocks.isSourceLocked()) return Promise.reject(new Error('请先完成或关闭当前角色云端操作。'));
    const epoch = ownerEpoch.current;
    const actor = cloudState.account ? { kind: 'account' as const, expectedUserId: cloudState.account.userId } : { kind: 'anonymous' as const };
    return aiStore.withPreparedGeneration(async (prepared) => {
      if (roomOwner.isConstrained() || epoch !== ownerEpoch.current) return;
      if (!prepared.modelId || !prepared.providerTarget) throw new Error('请选择可用的模型。');
      if (prepared.location === 'server') {
        if (!cloudState.bootstrapped || prepared.providerTarget.kind === 'custom') throw new Error('服务器故事目标或账号身份尚未就绪。');
        const funding = prepared.providerTarget.kind === 'preset'
          ? { presetConfig: { providerId: prepared.providerTarget.providerId, modelId: prepared.modelId, generationOverrides: prepared.generationOverrides } }
          : { systemConfig: { ...(prepared.modelId !== 'default' ? { modelId: prepared.modelId } : {}), generationOverrides: prepared.generationOverrides } };
        await run({ mode: 'hosted', invoke, actor, modelId: prepared.modelId, ...funding });
        return;
      }
      if (!prepared.mode || prepared.providerTarget.kind === 'system') throw new Error('客户端模型目标无效。');
      await run({ options: { invoke, profileId: prepared.profile?.id ?? '', providerTarget: prepared.providerTarget },
        intent: { mode: prepared.mode, modelId: prepared.modelId, temperature: prepared.generationOverrides?.temperature, maxOutputTokens: prepared.generationOverrides?.maxOutputTokens } });
    });
  };
  const allowStoryGeneration = () => {
    if (resultActionLocks.isSourceLocked()) return false;
    if (roomOwner.isConstrained()) return false;
    if (strictActiveRef.current) { setError('严格排位准备仅用于单次战报，请先退出准备再开始连续故事。'); return false; }
    if (!guard.ready || busy || diagnosisFlight.current || preparing.current || session.isBusy() || packageOwner.isBusy() || storyOwner.isBusy()) return false;
    if (!target.modelId || !target.providerTarget || target.unavailableReason || hostedUnavailable) { setError(hostedUnavailable ?? target.unavailableReason ?? '请选择可用的模型。'); return false; }
    if (storyOwner.hosted?.hasCandidate()) { setError('此产品仍有原 Hosted 故事候选，请先读取、导出或明确放弃。'); return false; }
    if (storyOwner.hasUnsavedResult()) { if (!window.confirm('开始新章节会清除当前未保存原文，请先导出。继续？')) return false; storyOwner.discardResult(); }
    return true;
  };
  const startStory = (chapterPlan?: BattleStoryChapterPlan) => { if (allowStoryGeneration()) void storyOwner.start({ draft: session.getSnapshot().draft, product, chapterPlan }, prepareStoryExecution); };
  const continueStory = (guidance: string) => { if (allowStoryGeneration()) void storyOwner.continue(guidance, prepareStoryExecution); };
  const branchStory = (anchor: StoryBranchAnchorRequest, guidance: string) => {
    if (hostedTarget) { setError('分支仅支持客户端 Direct，请自行选择客户端模型。'); return; }
    if (!allowStoryGeneration()) return;
    const epoch = ownerEpoch.current, originalState = storyOwner.getSnapshot(); setError(null);
    // Source preparation can reject before generateBranch owns its completion
    // callback. Entered runs report through their owner; only untouched preflight
    // failures need the page fallback. A cancelled old read must not publish here.
    void storyOwner.generateBranch({ mode: 'direct', anchor, userGuidance: guidance }, prepareStoryExecution)
      .catch((cause: unknown) => { if (epoch === ownerEpoch.current && storyOwner.getSnapshot() === originalState) reportError(cause); });
  };
  const restoreHosted = () => {
    const pointer = session.hostedRecovery.getSnapshot().pointer;
    if (resultActionLocks.isSourceLocked() || !pointer || disabled || diagnosisFlight.current || preparing.current || session.isBusy() || !cloudState.bootstrapped) return;
    if (pointer.actor.kind === 'account' && cloudState.account?.userId !== pointer.actor.expectedUserId) { setError('请先登录原生成账号，再显式恢复。不会切换到当前账号或匿名身份。'); return; }
    if (!window.confirm(`${pointer.actor.kind === 'anonymous' ? '以原匿名身份' : '以原账号'}恢复服务器请求？不会重新创建或携带供应商 Key；当前结果将被恢复正文替换。${pointer.version !== 1 && pointer.delivery === 'non-stream' ? ' 原完整非流式 JSON 及附加信息可能无法重新取得，建议先完整导出。' : ''}`)) return;
    void session.restoreHosted({ invoke }, pointer.requestId);
  };
  const reportProps = projectDesktopArenaReport(state);
  const reasoning = reportProps.aiReasoning;
  const reportPorts = createDesktopBattleReportPorts({
    username: cloudState.verification === 'verified' ? cloudState.account?.username : null, onNavigateExternal: openContent,
    onError: cause => reportError(cause, 'default'), onExportingChange: onReportExportingChange,
  });
  const download = (filename: string, text: string, mimeType: string) => { try { downloadTextFile(filename, text, mimeType); } catch (cause) { reportError(cause, 'default'); } };
  const exportAll = () => {
    setBackupFeedback(null);
    try { downloadTextFile('arena-complete.json', session.exportDocument(), 'application/json'); setBackupFeedback('download-started'); }
    catch { setBackupFeedback('failed'); }
  };
  const safeDiagnostic = buildArenaSafeDiagnostic({ phase: state.phase, failureDiagnostic: state.failureDiagnostic ?? state.hosted?.failureDiagnostic, location: state.generation ? state.generation.intent.mode === 'hosted' ? 'server' : 'client' : null, hosted: state.hosted, response: getArenaHostedErrorDiagnostic(state.hosted) });
  const exportNarrativeDrafts = (drafts: readonly NarrativeDraft[]) => download('arena-narrative-drafts.json', JSON.stringify(buildNarrativeDraftArchive(drafts), null, 2), 'application/json');
  const draftArchiveAction = (action: () => { ok: boolean; error?: string }) => {
    if (session.narrativeDrafts.getState().scope !== narrativeScope || cloudStore.getCredentialEpoch() !== accountCredentialEpoch) return { ok: false as const, error: '账号已切换，请重新操作。' };
    const result = action();
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error ?? session.narrativeDrafts.getState().error ?? '操作未完成，请重试或先导出。' };
  };
  const draftArchiveScopeKey = `${narrativeScope ?? 'pending'}:${accountCredentialEpoch}`;
  const copyNarrativeDraft = (content: string) => navigator.clipboard.writeText(content);
  const narrativeArchiveControls = {
    scopeKey: draftArchiveScopeKey, conflictingDrafts: draftArchive.conflictingDrafts, unsavedRequestIds: draftArchive.unsavedRequestIds, unsavedDrafts: draftArchive.unsavedDrafts,
    onRetryUnsaved: () => draftArchiveAction(() => session.narrativeDrafts.retryUnsavedDrafts(narrativeScope)), confirmAction: (message: string) => window.confirm(message), onCopy: copyNarrativeDraft,
    onDelete: (ids: readonly string[]) => draftArchiveAction(() => session.narrativeDrafts.deleteDrafts(ids, narrativeScope)),
  };
  const ranking = state.hosted?.ranking;
  const roleUpdateItems = projectDesktopRoleUpdates(state);
  const roleUpdatesByKey = new Map(roleUpdateItems.map(item => [item.key, item]));
  const hasResultSaveActions = session.canAppendHostedHistory()
    || (!state.repairs && (!!state.candidates?.characterEffects.length || session.hasHostedCharacterCopies()))
    || !!state.repairs || draft.narrativeHistoryEntries.length > 0;
  const result = (state.phase === 'generating' || state.rawText || state.reasoning || state.report) ? <section ref={resultRef} className="mt-6 space-y-4" aria-label="战报结果">
    {state.resultFormat === 'web' ? <DesktopArenaWebResult key={`${scope}:${state.generation?.intent.requestId ?? 'restored'}`} state={state} owner={packageOwner} disabled={disabled}>
      {(content, actions, showingWeb) => <StreamingBattleReportCard {...reportProps} cardWidthPx={cardWidthPx} ports={reportPorts}
        disableExport={showingWeb || !!state.renderSnapshot?.webPackage} reportContent={content} additionalActions={actions} />}
    </DesktopArenaWebResult>
      : state.report && state.activeGenerationMode !== 'stream'
        ? <BattleReportCard report={{ ...state.report, scenario: reportProps.scenarioName, aiModel: reportProps.aiModel, aiUsage: reportProps.aiUsage ?? undefined,
          aiReasoning: reasoning, reporterInfo: reportProps.reporterInfo ?? state.report.reporterInfo,
          userGuidance: reportProps.userGuidance ?? undefined, characterGuidances: reportProps.characterGuidances ?? undefined,
          adjudicationResults: reportProps.adjudicationResults ?? undefined, narrativeHistoryReadCount: reportProps.narrativeHistoryReadCount ?? undefined }} mode={reportProps.mode} cardWidthPx={cardWidthPx} ports={reportPorts} />
        : <StreamingBattleReportCard {...reportProps} cardWidthPx={cardWidthPx} onStopGeneration={() => session.cancel()} ports={reportPorts} />}
    <section className="card space-y-3 text-sm leading-relaxed" aria-label="生成状态与原始输出">
      <h3 className="text-lg font-semibold">生成状态与原始输出</h3>
      <details><summary>{state.hosted ? '服务器收到的正文（控制元数据单独保留）' : '完整原始输出（含元数据）'}</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">{state.rawText}</pre></details>
      {state.hosted ? <div className="battle-lite-info-box space-y-2 rounded-lg p-3" aria-label="服务器生成状态">
        <p role="status">{arenaRecoveryStatusLabel(state.hosted.connectionState)}。连接或恢复失败不表示服务器任务已停止。</p>
        <p role="status" aria-label="本次排位结算反馈">{!state.hosted.ranking ? '本次排位结算结果尚未取得，不能据此判断是否计分。'
          : !state.hosted.ranking.success ? '本次排位结算结果读取失败，是否已计分尚未确认。'
          : state.hosted.ranking.state === 'pending' ? '服务器返回本次排位仍待结算；当前未继续查询。'
          : '已取得本次服务器排位结算反馈。'}</p>
        {ranking?.success && ranking.state === 'ready' ? (
          rankingProjection.unmatched.length ? <div>
            <p className="text-sm text-gray-500">以下明细未关联到当前角色栏，仍保留本局生成时的结算结果。</p>
            <ul className="space-y-2" aria-label="本次参战者排位结算">
              {rankingProjection.unmatched.map(({ participant, index }) => <li key={`${ranking.generationId}:${index}`}>
                <p className="font-semibold break-words">{participant.displayName.trim() || `参战者 ${index + 1}`}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <ArenaRankingQueueFeedback queue="strict" result={participant.queues.strict} />
                  <ArenaRankingQueueFeedback queue="free" result={participant.queues.free} />
                </div>
              </li>)}
            </ul>
          </div> : !ranking.participants.length ? <p>服务器未返回参战者结算明细，不能据此判断是否计分。</p> : null
        ) : null}
        {state.hosted.metadataState !== 'available' ? <p role="status">本次判定、记者等附加元数据未取得；服务器可能已经执行判定，恢复时不会在本机重掷。</p> : null}
        {state.hosted.recoveryCredentialState === 'memory-only' ? <p role="alert">匿名恢复凭据保存失败，当前任务可继续；关闭应用后可能无法恢复，请完整导出。</p> : null}
        {state.hosted.validationMessage ? <p role="status">{state.hosted.validationMessage}</p> : null}
        {state.hosted.companionState === 'complete' ? <p role="status">完整非流式报告与附加元数据已保留；服务端判定 {state.hosted.companion?.metadata?.adjudicationResults?.length ?? 0} 条。完整导出包含全部原字段，状态面板不重复展开大体积 JSON。</p> : null}
      </div> : null}
    </section>
    {state.phase === 'completed' && (state.hosted || roleUpdateItems.length > 0 || session.manualRepairGenerationId()) ? <CombatantUpdatesPresentation
      title="角色更新" description={`可下载/保存本次更新的角色设定（共 ${roleUpdateItems.length} 个）`}
      defaultOpen itemDefaultOpen={false} keepMounted
      emptyMessage={state.hosted ? '本次尚未产生可展示的角色更新。你可以点击“重试角色更新”，重试应用本次服务器已生成的历战记录/当前状态摘要。' : '本次没有可展示的角色变化。'}
      renderMarkdown={content => <MarkdownBlock content={content} variant="light" externalMediaPolicy={DENY_EXTERNAL_MEDIA} onNavigateExternal={openContent} />}
      headerRight={state.hosted ? <button type="button" disabled={disabled || !session.canRetryHostedRoleUpdates()}
        title="重试应用本次服务器已生成的角色更新"
        className="px-3 py-1.5 text-xs font-semibold text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
        onClick={() => { if (!resultActionLocks.isSourceLocked()) void session.retryHostedRoleUpdates({ invoke }); }}>{state.roleUpdates.status === 'updating' ? '重试中...' : '重试角色更新'}</button> : undefined}
      items={roleUpdateItems}
      renderActions={item => {
        const result = roleUpdatesByKey.get(item.key);
        return result ? <DesktopArenaRoleUpdateActions key={result.key} data={result.data} selection={result.selection} repairSelection={result.repairSelection} session={session}
          locks={resultActionLocks} disabled={resultActionsDisabled} guard={guard}
          isBlocked={() => resultActionsDisabled || session.isBusy() || storyOwner.isBusy() || packageOwner.isBusy() || preparing.current || Boolean(diagnosisFlight.current) || advancedBusyRef.current || historyLoading.current || exportingReport.current > 0 || aiStore.isPreparingGeneration() || aiStore.getSnapshot().savingConnection || aiStore.getSnapshot().savingCredential || aiStore.getSnapshot().deletingConnection}
          onDownload={() => download(`${result.displayName}.json`, JSON.stringify(result.data, null, 2), 'application/json')} /> : null;
      }}
      renderBeforeItems={<>
        {session.manualRepairGenerationId() && !roomOwner.isConstrained() ? <DesktopManualRepairPanel
          key={`${scope}:${session.manualRepairGenerationId()}`} session={session}
          disabled={resultActionsDisabled || resultActionLocks.sourceLocked || session.isBusy()}
          canApply={() => guard.ready && !resultActionLocks.isSourceLocked() && cloudStore.getCredentialEpoch() === accountCredentialEpoch && !roomOwner.isConstrained()
            && !storyOwner.isBusy() && !packageOwner.isBusy() && !preparing.current && !diagnosisFlight.current && !advancedBusyRef.current && !historyLoading.current
            && exportingReport.current === 0 && !aiStore.isPreparingGeneration() && !aiStore.getSnapshot().savingConnection && !aiStore.getSnapshot().savingCredential && !aiStore.getSnapshot().deletingConnection} /> : null}
        {state.roleUpdates.message ? <p role="status">{state.roleUpdates.message}</p> : null}
        {resultActionLocks.sourceLocked ? <p role="status">云端操作保留了当前角色结果。请先完成或关闭原表单；结果不确定时按提示核对，再修改输入、重新生成或重试角色更新。本地原件仍可导出。</p> : null}
      </>}
      renderFooter={state.roleUpdates.status === 'updating' ? <button className={secondary} type="button" onClick={() => session.cancel()}>停止本机角色同步</button> : null}
    /> : null}
    {hasResultSaveActions || state.saveStatus === 'saved' || state.saveError ? <section className="card space-y-3 text-sm" aria-label="保存到本地库">
      <h3 className="text-lg font-semibold">保存到本地库</h3>
      <div className="flex flex-wrap gap-3">
        {session.canAppendHostedHistory() ? <button className={secondary} type="button" disabled={disabled} onClick={() => { if (!resultActionLocks.isSourceLocked()) session.appendHostedHistory(); }}>将本次正文加入活动历史</button> : null}
        {!state.repairs && (state.candidates?.characterEffects.length || session.hasHostedCharacterCopies()) ? <button className={secondary} type="button" disabled={disabled} onClick={() => { if (!resultActionLocks.isSourceLocked()) void session.save('characters'); }}>另存战后角色副本</button> : null}
        {state.repairs ? <button className={secondary} type="button" disabled={disabled || !session.canSaveRepairedCharacter()}
          onClick={() => { if (!resultActionLocks.isSourceLocked()) void session.saveRepairedCharacters(); }}>另存修复角色副本</button> : null}
        {draft.narrativeHistoryEntries.length ? <button className={secondary} type="button" disabled={disabled} onClick={() => { if (!resultActionLocks.isSourceLocked()) void session.save('history'); }}>保存叙事历史到本地库</button> : null}
      </div>
      {state.saveStatus === 'saved' ? <p role="status">已保存到本地库，可在卡库重新打开。</p> : null}
      {state.saveError ? <DesktopArenaErrorMessage message={state.saveError} /> : null}
    </section> : null}
    {state.narrativeDraftCandidate ? <NarrativeDraftsPanel {...narrativeArchiveControls} drafts={draftArchive.drafts.filter(item => item.requestId === state.narrativeDraftCandidate?.requestId)} candidate={state.narrativeDraftCandidate} status={state.narrativeDraftStatus}
      onSave={() => { session.saveNarrativeDraft(); }} onExport={exportNarrativeDrafts}
      renderMarkdown={content => <MarkdownBlock content={content} variant="light" externalMediaPolicy={DENY_EXTERNAL_MEDIA} onNavigateExternal={openContent} />} /> : null}
  </section> : null;
  const settings = <>
          {product === 'arena' && !roomState.constrained ? <>
            <BattleReportCardWidthSettings value={reportCardWidth.value} onChange={reportCardWidth.onChange} disabled={disabled} />
            {reportCardWidth.error ? <p role="status" className="text-xs">{reportCardWidth.error}</p> : null}
          </> : null}
          <ArenaDataSettingsPanel value={draft.settings} onChange={(patch) => update({ settings: { ...draft.settings, ...patch } })} disabled={disabled} footerNote={<p className="text-xs">设置与角色工作副本保存在本机草稿；原始库卡保持不变。</p>} />
          <NarrativeHistorySettings value={draft.settings} onChange={(patch) => update({ settings: { ...draft.settings, ...patch } })} disabled={disabled} persistenceNote="完成后追加正式历史。未完成草稿的自动保留请使用下面的独立本机开关。" readingNote="只有正式历史用于提示词，未完成草稿仅供查看和导出。" />
          <DesktopArenaHistoryControls session={session} draft={draft} scope={scope} disabled={disabled} importInput={performImport} onDirtyChange={onHistoryDirty} onBusyChange={onHistoryBusy} />
          <button type="button" className={secondary} disabled={disabled} onClick={() => setHistoryOpen(true)}>引用本地叙事历史</button>
          <p className="text-xs">已引用 {draft.historyReferences.length} 条；正式 {draft.narrativeHistoryEntries.length} 条 · 未完成草稿 {draft.narrativeDrafts?.length ?? 0} 条</p>
          {draftArchive.error && <p role="alert" className="text-xs">{draftArchive.error}</p>}
          <NarrativeDraftsPanel {...narrativeArchiveControls} drafts={draftArchive.drafts} candidate={draftArchive.candidate} status={draftArchive.status} onExport={exportNarrativeDrafts}
            onSave={() => { session.saveNarrativeDraft(); }} autoRetain={draftArchive.autoRetain}
            onAutoRetainChange={value => draftArchiveAction(() => session.narrativeDrafts.setAutoRetain(value))}
            renderLegacyAction={() => <NarrativeLegacyDraftsSection scopeKey={draftArchiveScopeKey} legacy={draftArchive.legacy}
              onLoad={() => { session.loadLegacyNarrativeDrafts(); }} confirmAction={message => window.confirm(message)}
              onDelete={ids => draftArchiveAction(() => session.narrativeDrafts.deleteLegacyDrafts(ids))}
              onCopyToCurrent={ids => draftArchiveAction(() => session.narrativeDrafts.copyLegacyDrafts(ids, narrativeScope))}
              onCopy={copyNarrativeDraft} onExport={exportNarrativeDrafts}
              onExportRaw={raw => download('arena-legacy-narrative-drafts.json', raw, 'application/json')} />}
            renderMarkdown={content => <MarkdownBlock content={content} variant="light" externalMediaPolicy={DENY_EXTERNAL_MEDIA} onNavigateExternal={openContent} />} />
  </>;
  const sessionNotice = state.pendingRestore || state.draftError || guard.message ? <section aria-label="本机草稿提示" className="my-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
    {state.pendingRestore ? <><p role="status">本机还有上次工作稿，请先恢复再继续编辑。恢复只读取本机内容，不会开始生成。</p><Button disabled={busy || roomState.constrained || resultActionLocks.sourceLocked} onClick={() => { if (!resultActionLocks.isSourceLocked() && !roomOwner.isConstrained()) session.restoreDraft(); }}>恢复草稿</Button><Button variant="danger" disabled={busy || roomState.constrained || resultActionLocks.sourceLocked} onClick={() => { if (!resultActionLocks.isSourceLocked() && !roomOwner.isConstrained() && window.confirm('清除旧草稿？此操作不会删除本地库。')) session.discardDraft(); }}>清除草稿</Button></> : null}
    {state.draftError ? <><p role="alert">{state.draftError}</p><div className="flex flex-wrap gap-2"><Button disabled={busy || roomState.constrained || resultActionLocks.sourceLocked} onClick={() => { if (!resultActionLocks.isSourceLocked() && !roomOwner.isConstrained()) session.retryDraftSave(); }}>重试保存草稿</Button><Button variant="danger" disabled={busy || roomState.constrained || resultActionLocks.sourceLocked} onClick={() => { if (!resultActionLocks.isSourceLocked() && !roomOwner.isConstrained() && window.confirm('清除旧草稿及当前页面内容？请先导出。')) session.discardDraft(); }}>清除草稿</Button></div></> : null}
    {guard.message ? <p role="alert">{guard.message}</p> : null}
    {state.pendingRestore || state.draftError ? <ArenaSessionBackup feedback={backupFeedback} onExport={exportAll} /> : null}
  </section> : null;
  const slots = {
        header: <><BattleLiteHeader Link={libraryHost.platform.Link} draftSharing="independent" illustrationAvailable={false} logo={<ThemeImage lightSrc="/arena-black.svg" darkSrc="/arena-white.svg" width={300} height={84} alt="魔法少女竞技场" />} />{sessionNotice}</>,
        rankingLinks: <ArenaRankingLinks Link={libraryHost.platform.Link} onOpenRankingModal={roomState.constrained ? undefined : () => setRankingOpen(true)} />,
        pageLinks: <ArenaPageLinks Link={libraryHost.platform.Link} variant="lite" />,
        presets: <><CharacterPresetPicker grouped={characterPresets} magicalGirlPage={magicalGirlPage} onMagicalGirlPageChange={setMagicalGirlPage} canshouPage={canshouPage} onCanshouPageChange={setCanshouPage} disabled={disabled} maxSelected={limits.maxCombatants} selectedCountOverride={draft.combatants.length} selectedFilenames={draft.combatants.filter((item) => isArenaRealCombatant(item) && item.isPreset).map((item) => item.filename)} loadingFilename={state.importing ? loadingPresetFilename : null} onToggle={(preset) => togglePreset(preset.filename)} onDownload={presetDownload.download} downloadDisabled={presetDownload.downloading} />
          {presetDownload.feedback && <p role={presetDownload.feedback.kind === 'error' ? 'alert' : 'status'} className={`mb-4 text-sm ${presetDownload.feedback.kind === 'error' ? 'text-red-600' : 'text-gray-600'}`}>{presetDownload.feedback.message}</p>}</>,
        database: <><ArenaCharacterDatabaseSelector className="!mb-0" title={null} layout={product === 'battle' ? 'column' : 'row'}
          onOpenCharacterModal={() => openLibrary('character')} onRandomMatchCharacter={() => { void randomMatchCharacter(); }}
          isAuthenticated={libraryHost.auth.status !== 'unauthenticated'} isGenerating={disabled} isMatching={isMatchingCharacter ? 'character' : null}
          combatantCount={draft.combatants.length} maxCombatants={limits.maxCombatants}
          loginLink={<libraryHost.platform.Link href="/character-manager" className="battle-lite-link underline">登录后可访问私有数据卡</libraryHost.platform.Link>} />
          <div className={product === 'battle' ? 'battle-lite-muted-text mt-2 text-xs' : 'mt-1 text-xs text-gray-600'}>
            提示：浏览在线角色库可选择公开/私有数据卡；随机匹配仅从公开角色库中抽取。
          </div></>,
        localImport: <ArenaRosterImportPanel disabled={disabled} limitReached={draft.combatants.length >= limits.maxCombatants} onUpload={uploadCharacters} onPaste={pasteCharacters} onDirtyChange={onRosterDirty} />,
        roster: <ArenaRosterSection model={roster} emptyLabel="尚未添加角色" onDirtyChange={onRosterTeamDirty} />,
        mode: <BattleModeSelector value={draft.battleMode} onChange={(battleMode) => { if (product === 'arena' && draft.battleMode === 'scenario' && battleMode !== 'scenario' && dirtyControls.current.scenario && !window.confirm('切换模式会关闭情景编辑，放弃尚未导入的情景文本？')) return; update({ battleMode }); }} disabled={disabled} />,
        scenario: <ArenaScenarioSection model={scenario} presentation={product === 'battle' ? { variant: 'lite', hasMain: !!draft.scenario.content, summary: draft.scenarioDisplayName ?? '未选择' } : undefined} onDirtyChange={onScenarioDirty} />,
        materials: <ArenaMaterialSection onDirtyChange={onMaterialDirty} model={{ disabled, items: materials.map((item, index) => ({ key: String(index), name: item.name, sourceLabel: item.sourceType, fileName: item.fileName })),
          notice: '素材仅作为参考；本地与缓存来源不代表服务器认证。', hasReferenceCapacity: referenceCount < limits.maxReferenceItemsSanity,
          capabilities: { browseOnline: true, clearAll: true, upload: true, paste: true, reorder: true },
          actions: { openModal: () => openLibrary('material'), clearAll: () => update({ materials: [] }),
            upload: (files) => loadMaterials(async (signal) => Promise.all(Array.from(files ?? []).map(async (file) => ({ text: await readArenaFile(file, signal), filename: file.name })))),
            paste: (text) => loadMaterials(async () => [{ text, filename: null }]), move: (from, to) => update({ materials: moveArenaItem(draft.materials, from, to) }), remove: (key) => update({ materials: draft.materials.filter((_, index) => String(index) !== key) }) } }} />,
        storyOptions: <>
          <StoryOptionsPanel isGenerating={disabled} enableUserGuidance afterUserGuidance={product === 'arena' ? <AdvancedArenaControls session={session} draft={draft} scope={scope} disabled={disabled} importInput={performImport} onDirtyChange={onAdvancedDirty} onBusyChange={onAdvancedBusy} /> : undefined} languages={languages} userGuidance={draft.settings.userGuidance} onUserGuidanceChange={(userGuidance) => update({ settings: { ...draft.settings, userGuidance } })}
            storyLength={draft.storyLength as StoryLengthOption} onStoryLengthChange={(storyLength) => update({ storyLength })} customStoryLength={draft.customStoryLength} onCustomStoryLengthChange={(customStoryLength) => update({ customStoryLength })} selectedLanguage={draft.selectedLanguage} onSelectedLanguageChange={(selectedLanguage) => update({ selectedLanguage })} />
          {product === 'battle' ? settings : null}
          <p className="text-xs">{product === 'arena' ? '手动及角色、主辅情景' : '角色与主情景继承'} {inheritedAdjudication.events.length} {hostedTarget ? '个随机判定由服务器在创建时执行，本机不会重掷；素材内判定不执行。' : '个随机判定每次生成只在本机掷骰一次，非服务器权威；素材内判定不执行。'}</p>
          {inheritedAdjudication.skippedLegacy ? <p role="status" className={infoClass}>{inheritedAdjudication.skippedLegacy} 个旧版随机事件格式不受支持，保留原字段但不执行。</p> : null}
          {roomHostPreview ? <p className={infoClass}>本次服务器生成的供应商、模型和参数请在上方房间开始区域确认；普通 AI 配置仍保留。</p> : null}<fieldset hidden={roomHostPreview} disabled={!guard.ready || roomHostPreview} className="min-w-0"><DesktopAiProviderPanel executionConstraint={strictActive ? { location: 'server', reason: '严格排位准备已将本次执行锁定为服务器，普通偏好及配置保持不变。' } : undefined} generationMode={draft.generationMode} onDirtyChange={onAiDirty} showConnectionTest={false} copy={{ serverOutput: { stream: '', nonStream: '' }, emptyProfilesHint: '请配置客户端连接。', serverFootnote: 'Arena 服务器支持流式或完整非流式报告；恢复与停止沿原请求，角色更新使用本次创建时冻结的选择。', payloadNoun: '角色与故事设定' }} /></fieldset>
          {hostedTarget ? <p role="status" className={infoClass}>官方服务器生成。创建前验证所选交付协议与原账号；不会自动改为客户端执行。符合服务器规则的对局可能计入严格排位，是否计分以服务器结算为准。</p> : null}
          <div hidden={roomHostPreview}><DesktopStrictConfigurationDiagnostics key={product} {...strictInput} journey={{ active: strictActive, disabled: disabled || aiState.savingConnection || aiState.savingCredential || aiState.deletingConnection, snapshotKey: strictSnapshotKey, target, expectedUserId: cloudState.account?.userId ?? null,
            isCurrent: key => readStrictTargetIdentity() === strictTargetIdentity(target) && key === strictSnapshotKeyRef.current && strictActiveRef.current && session.getSnapshot().draft === draft && cloudStore.getSnapshot().verification === 'verified'
              && aiStore.getCredentialIntentRevision() === providerCredentialIntent && cloudStore.getCredentialEpoch() === accountCredentialEpoch && cloudStore.getSnapshot().authFlow.kind === 'idle' && cloudStore.getSnapshot().account?.userId === cloudState.account?.userId,
            prepare: prepareStrict, exit: exitStrict, invalidate: invalidateStrict, checked: checkedStrict }} /></div>
        </>,
        generationMode: <>
          <ArenaReportFormatSelectorView value={draft.reportFormat} disabled={disabled} onChange={(reportFormat) => update({ reportFormat })} webDescription="生成网页或包目标源码，可校验、保存和导出；当前桌面端暂不支持运行 Web 战报。" />
          {draft.reportFormat === 'web' ? <DesktopArenaWebPackageControls key={`${product}:${scope}`} owner={packageOwner} selectedRef={draft.webPackageRef} disabled={disabled} onSelect={(webPackageRef) => { if (resultActionLocks.isSourceLocked()) return; const next = { ...session.getSnapshot().draft, webPackageRef }; delete next.webPackagePromptProjection; session.updateDraft(next); }} /> : null}
          <GenerationModeSwitcher optionDescriptions={{ stream: '生成时逐步显示正文；Web 输出仅显示源码，不执行内容。' }} value={draft.generationMode} disabled={disabled} onChange={(generationMode) => update({ generationMode })} helper={hostedTarget ? '流式逐步返回正文；非流式等待完整报告与附加元数据。连接断开只恢复原任务可用内容，停止需服务器确认。' : draft.reportFormat === 'web' ? '两种方式都生成相同 Web 目标；流式期间只显示安全源码，不执行内容。' : '非流式输出结构化战报；流式逐步显示 Markdown。'} />
        </>,
        actions: <>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button type="button" className={generationSubmitClassName} disabled={disabled || !strictReady || !!hostedUnavailable || !!target.unavailableReason || !!readinessMessage || (hostedTarget && recovery.blocked && !repairHint)} onClick={generate}>生成战报</button>
            {busy && (!storyOwner.isBusy() || !storyState.hosted?.busy || storyState.hosted.busy === 'model') ? <StreamStopButton compact disabled={state.saving || packageState.busy} onClick={() => { aiStore.cancelPreparingGeneration(); ownerEpoch.current += 1; if (storyOwner.isBusy()) storyOwner.cancel(); else session.cancel(); }} label={storyOwner.isBusy() ? storyState.hosted?.busy === 'model' ? '请求服务器停止' : '取消生成' : state.generation?.intent.mode === 'hosted' || state.hosted ? '请求服务器停止' : '取消生成'} /> : null}
          </div>
          <DesktopArenaRecoveryControls scopeKey={`${scope}:${state.generation?.intent.requestId ?? state.hostedGenerationId ?? 'draft'}`} pointer={recovery.pointer} showRecoveryCheck={hostedTarget || !!recovery.pointer || recovery.blocked}
            recoveryError={recovery.error} blocked={recovery.blocked} disabled={disabled} identityReady={cloudState.bootstrapped} diagnosing={diagnosing}
            hint={currentHint?.value ?? null} diagnostic={safeDiagnostic} backupFeedback={backupFeedback} showBackup={!state.pendingRestore && !state.draftError} onRestore={restoreHosted} onDiagnose={() => { void diagnoseRecovery(); }}
            onDiscard={() => { if (window.confirm('清除无法读取的本机恢复记录？不会停止服务器任务，也不会清除上次访问身份。')) session.hostedRecovery.discard(); }} onExport={exportAll} />
          {state.phase === 'generating' && state.hosted?.softTimeoutWarning ? <p role="status" className={infoClass}>{state.hosted.softTimeoutWarning} 此提示不会自动停止或重新创建请求。</p> : null}
          {hostedUnavailable ? <p role="status" className={infoClass}>{hostedUnavailable}</p> : null}
          {readinessMessage ? <p className={infoClass}>{readinessMessage}</p> : null}
          {importWarnings.length ? <ul role="status" className={`${infoClass} list-inside list-disc`}>{importWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
          {error ? feedback?.presentation === 'default'
            ? <DesktopArenaErrorMessage message={error} />
            : <DesktopArenaFeedbackMessage message={error} appearance={product === 'battle' ? 'lite' : 'full'} /> : null}
          {state.message ? state.phase === 'failed' ? <DesktopArenaFeedbackMessage message={state.message} appearance={product === 'battle' ? 'lite' : 'full'} generation /> : <p role="status" className={infoClass}>{state.message}</p> : null}
        </>,
        community: null, result, storySession: <DesktopArenaStoryControls cardWidthPx={cardWidthPx} reportPorts={reportPorts} reportExporting={reportExporting} owner={storyOwner} draft={draft} disabled={!guard.ready || busy} product={product} onNavigateStoryProduct={(original) => navigateByProductHref(router, original === 'arena' ? '/arena' : '/battle')} unavailableReason={strictActive ? '请先退出严格排位准备，再生成连续故事。' : hostedUnavailable ?? target.unavailableReason ?? (!target.modelId || !target.providerTarget ? '请选择可用的模型。' : null)} branchUnavailableReason={hostedTarget ? '分支仅支持客户端 Direct，请自行选择客户端模型。' : null} onStart={startStory} onContinue={continueStory} onBranch={branchStory} download={download} onNavigateExternal={openContent} />,
        homeLink: <BackHomeLink href="#/" onNavigate={() => navigateByProductHref(router, '/')} />,
        footer: <ProductFooter assetSource={{ baseUrl: '/' }} onNavigateInternal={(href) => navigateByProductHref(router, href)} resolveInternalHref={resolveInternalHrefForHashHistory} onNavigateExternal={openFixed} />,
  };
  return <>
    {rosterDetails && !roomState.constrained ? <DesktopCardDetailsModal isOpen onClose={() => setRosterDetails(null)} {...rosterDetails} /> : null}
    {product === 'arena' ? <AdvancedArenaPageView
      header={<AdvancedArenaHeader Link={libraryHost.platform.Link} draftSharing="independent" illustrationAvailable={false} logo={<ThemeImage lightSrc="/arena-black.svg" darkSrc="/arena-white.svg" width={320} height={90} alt="魔法少女竞技场" />} />}
      links={<><ArenaRankingLinks Link={libraryHost.platform.Link} onOpenRankingModal={roomState.constrained ? undefined : () => setRankingOpen(true)} /><ArenaPageLinks Link={libraryHost.platform.Link} variant="full" onNavigateExternal={openFixed} /></>} beforeWorkspace={<>{sessionNotice}<DesktopArenaRoomPanel createReportPorts={onError => createDesktopBattleReportPorts({ username: cloudState.verification === 'verified' ? cloudState.account?.username : null, onNavigateExternal: openContent, onError, onExportingChange: onReportExportingChange })} languages={languages} owner={roomOwner} draft={draft} isDraftCurrent={value => session.getSnapshot().draft === value} disabled={!guard.ready || busy || state.pendingRestore || strictActive} authenticated={cloudState.verification === 'verified' && cloudState.authFlow.kind === 'idle' && !!cloudState.account} displayName={cloudState.account?.username ?? '玩家'} onAuthenticate={() => { void cloudStore.requestAuth(); }} /><DesktopRoomStoryDraft roomOwner={roomOwner} localSession={session} languages={languages} isEditingAllowed={() => roomStartAllowed.current()} /></>} result={<fieldset className="min-w-0" disabled={roomState.constrained} hidden={roomState.constrained}>{result}{slots.storySession}</fieldset>} homeLink={slots.homeLink} footer={slots.footer}>
      {roomState.memberModel && memberWorkspaceSession ? <DesktopRoomMemberWorkspace owner={roomOwner} model={roomState.memberModel} session={memberWorkspaceSession} languages={languages} /> : null}
      {roomState.constrained ? <p>普通 Arena 草稿、结果和模型选择已保留在本机。结束房间操作或明确断开本机连接后，可恢复普通操作。</p> : null}<fieldset className="min-w-0" disabled={roomState.constrained} hidden={roomState.constrained && !roomHostPreview}><ArenaEditorWorkspaceLayout preview={roomHostPreview} disabled={disabled} sections={buildArenaEditorSections([
        { kind: 'presetCharacters', description: '选择内置角色', defaultOpen: true, content: slots.presets },
        { kind: 'characterDatabase', description: `当前已选 ${draft.combatants.length}/${limits.maxCombatants}`, defaultOpen: true, content: slots.database },
        { kind: 'localImport', description: '上传或粘贴角色 JSON', defaultOpen: true, keepMounted: true, content: slots.localImport },
        { kind: 'roster', description: `${draft.combatants.length}/32`, defaultOpen: true, keepMounted: true, content: slots.roster },
        { kind: 'battleMode', description: '普通单次故事模式', defaultOpen: true, content: slots.mode },
        ...(draft.battleMode === 'scenario' ? [{ kind: 'scenario' as const, autoOpen: draft.scenario.content === null, description: `主情景与 ${draft.auxScenarios.length} 个辅助情景`, defaultOpen: true, keepMounted: true, content: slots.scenario }] : []),
        { kind: 'materials', description: `参考项 ${referenceCount}/256`, defaultOpen: false, keepMounted: true, content: slots.materials },
        { kind: 'settings', description: '角色工作副本与叙事历史', defaultOpen: false, keepMounted: true, content: settings },
        { kind: 'story', description: '辅助设定与 AI 目标', defaultOpen: true, keepMounted: true, content: slots.storyOptions },
        { kind: 'generationMode', description: 'Markdown 或 Web 源码；流式/非流式', defaultOpen: true, content: slots.generationMode },
        { kind: 'generationActions', description: '确认设置后生成，可随时下载会话备份', collapsible: false, content: <div hidden={roomState.constrained}>{slots.actions}</div> },
      ])} /></fieldset>
    </AdvancedArenaPageView> : <BattleLitePageView isGenerating={disabled} presetCountLabel={String(draft.combatants.filter((item) => isArenaRealCombatant(item) && item.isPreset).length)} combatantCountLabel={`${draft.combatants.length}/${limits.maxCombatants}`}
      showScenario={draft.battleMode === 'scenario'} hasScenario={!!draft.scenario.content} materialCount={draft.materials.length} referenceItemCount={referenceCount} maxReferenceItems={limits.maxReferenceItemsSanity}
      copy={{ modeDescription: '不同模式决定故事风格', storyOptionsDescription: '设置故事方向、历史读写和 AI 目标' }} slots={slots} />}
    <DesktopArenaRankingModal key={scope} isOpen={rankingOpen && !roomState.constrained} onClose={() => setRankingOpen(false)} host={libraryHost}
      selectionDisabledReason={disabled ? '请先完成当前生成、恢复或导入操作，再调整参战者。' : null} combatants={draft.combatants} maxCombatants={limits.maxCombatants} onToggleCharacter={toggleSelectedCharacter} onTogglePreset={selectPreset} onSelectionError={setError} />
    <CardLibraryModal host={libraryHost} isOpen={library !== null && !roomState.constrained} onClose={closeLibrary}
      onSelectCard={library === 'scenario' ? chooseCard : undefined}
      onToggleCard={library === 'character' ? toggleCharacterCard : library === 'scenario' ? undefined : toggleReferenceCard}
      {...librarySelectionOptions}
      selectedSelectionIds={library === 'scenario' ? undefined : selectedLibraryIds.filter((id): id is string => id !== null)}
      selectedType={library === 'material' ? 'all' : library === 'auxScenario' ? 'scenario' : library ?? 'character'} allowedTypes={library === 'material' ? undefined : [library === 'auxScenario' ? 'scenario' : library ?? 'character']} allowDeckImport={false} />
    <DesktopArenaHistoryPicker onBusyChange={onHistoryImportBusy} repository={repository} onImported={() => setHistoryRevision((value) => value + 1)} scopeKey={scope} disabled={disabled} isOpen={historyOpen && !roomState.constrained} onClose={() => setHistoryOpen(false)} entries={historySource?.entries ?? []} lastUpdatedAt={historySource?.lastUpdatedAt ?? null} sort={historySort} onSort={setHistorySort}
      readStatus={historySource?.status ?? 'loading'} formatDateTime={(value) => value} sourceHint={historySource?.message ?? '引用不会修改源记录；导入 JSON 会保存独立的本地历史卡。'}
      onConfirm={(entries) => { update({ historyReferences: entries }); setHistoryOpen(false); }} />
    {historyOpen && !roomState.constrained && historySource?.status === 'error' ? <button type="button" className={secondary} onClick={() => setHistoryRevision((value) => value + 1)}>重试读取历史</button> : null}
  </>;
}

function DesktopArenaHost({ product }: { product: DesktopArenaProduct }) {
  const repository = useMemo(() => new IpcLocalCardRepository((command, args) => invoke(command, args as never)), []);
  const [owners, setOwners] = useState<{ session: DesktopArenaSession; packages: DesktopArenaWebPackages; story: DesktopArenaStorySession } | null>(null);
  useEffect(() => { const packages = createWebPackages(); const session = new DesktopArenaSession({ product, repository, storage: window.localStorage, resolveWebPackage: packages.resolveExact }); session.restoreDraft(); const story = createStorySession(product); setOwners({ session, packages, story }); return () => { session.dispose(); packages.dispose(); story.dispose(); }; }, [repository, product]);
  return owners ? <DesktopBattleForm session={owners.session} webPackages={owners.packages} story={owners.story} repository={repository} product={product} /> : <p role="status">正在读取本机草稿…</p>;
}

export function DesktopBattle() { return <DesktopArenaHost product="battle" />; }
export function DesktopAdvancedArena() { return <DesktopArenaHost product="arena" />; }
