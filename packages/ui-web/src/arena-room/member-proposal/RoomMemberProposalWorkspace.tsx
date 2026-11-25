'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MAX_COMBATANTS, type DataCardRef } from '@mahoshojo/contracts/arena-room';
import type { ArenaMemberProposalActions, ArenaMemberProposalPreview, ArenaMemberProposalSourceKind } from '@mahoshojo/multiplayer-core/member-proposal';
import { ArenaEditorWorkspaceLayout } from '../../arena/ArenaEditorWorkspaceLayout';
import { buildArenaEditorSections } from '../../arena/editor-sections';
import { PresetGridPicker } from '../../arena/PresetGridPicker';
import { ArenaRosterSection } from '../../arena/features/roster/ArenaRosterSection';
import { ArenaScenarioSection } from '../../arena/features/scenario/ArenaScenarioSection';
import { ArenaMaterialSection } from '../../arena/features/material/ArenaMaterialSection';
import { BattleModeControl } from '../../arena/presentation/BattleModeControl';
import { SharedBattleSettingsControl } from '../../arena/presentation/SharedBattleSettingsControl';
import { StoryOptionsControl } from '../../arena/presentation/StoryOptionsControl';
import { ArenaWebPackageSection } from '../../arena/features/web-package/ArenaWebPackageSection';
import { ArenaReportFormatSelectorView } from '../../arena-report/ArenaWebResultView';
import { WebReportConsentDialogView } from '../../arena-report/WebReportConsentDialogView';
import { buttonClassName } from '../../card-library/Button';
import { MemberProposalDialog } from './MemberProposalDialog';
import { RoomMemberProposalPreview } from './RoomMemberProposalPreview';
import { RoomMemberProposalStatus, arenaMemberProposalBlocked, arenaMemberProposalScopeKey } from './RoomMemberProposalStatus';
import { mapSharedConfigToArenaMemberView } from './projection';
import { arenaMemberCharacterPresets, buildArenaMemberRosterModel, buildArenaMemberScenarioModel, buildArenaMemberMaterialModel } from './section-models';
import { buildArenaMemberWebPackageModel } from './web-package-model';
import { buildArenaMemberProposalLabels } from './labels';
import type { RoomMemberProposalWorkspaceProps, ArenaMemberReferenceRequest } from './types';
import { ArenaCharacterDatabaseSelector as DatabaseSelector } from '../../arena/ArenaCharacterDatabaseSelector';

const ResyncConfirmDialog = ({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) => <MemberProposalDialog
  open titleId="arena-proposal-resync-confirm-heading" title="确认同步房间配置？" description="当前未提交修改将被丢弃，并以房间最新配置重新建立提案草稿。"
  onClose={onCancel} widthClassName="max-w-md"><div className="flex flex-wrap justify-end gap-2">
    <button type="button" className={buttonClassName()} onClick={onCancel}>保留草稿</button>
    <button type="button" className={buttonClassName({ variant: 'danger' })} onClick={onConfirm}>确认丢弃并同步</button>
  </div></MemberProposalDialog>;

/** Full Arena member workspace; host ports supply IO only, never a second editor or persistence. */
export function RoomMemberProposalWorkspace({ model, scopeIdentity, room, host, actions }: RoomMemberProposalWorkspaceProps) {
  const state = useSyncExternalStore(model.store.subscribe, model.store.getState, model.store.getInitialState);
  const editorState = state.editor;
  const snapshot = useMemo(() => mapSharedConfigToArenaMemberView(editorState.workingConfig), [editorState.workingConfig]);
  const scopeKey = arenaMemberProposalScopeKey(room);
  const authorityKey = JSON.stringify([room.session?.snapshot.revision, room.session?.snapshot.sharedConfig]);
  const scope = useMemo(() => ({ model, scopeIdentity, scopeKey, authorityKey }), [model, scopeIdentity, scopeKey, authorityKey]);
  const current = useRef({ scope, room });
  current.current = { scope, room };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = () => mounted.current && current.current.scope === scope;
  const canAct = () => isCurrent() && !model.store.getState().disposed && !model.store.getState().editor.replacementRequired
    && !arenaMemberProposalBlocked(current.current.room) && current.current.room.session?.self.role === 'member'
    && current.current.room.session?.self.membershipState === 'active';
  const disabled = state.disposed || editorState.replacementRequired || arenaMemberProposalBlocked(room)
    || room.session?.self.role !== 'member' || room.session?.self.membershipState !== 'active';
  const [modalKind, setModalKind] = useState<ArenaMemberProposalSourceKind | null>(null);
  const sourceSelectionScope = useMemo(() => ({ scope, modalKind }), [scope, modalKind]);
  const currentSourceSelection = useRef(sourceSelectionScope);
  currentSourceSelection.current = sourceSelectionScope;
  const [magicalGirlPresetPage, setMagicalGirlPresetPage] = useState(1);
  const [canshouPresetPage, setCanshouPresetPage] = useState(1);
  const [matchingScope, setMatchingScope] = useState<object | null>(null);
  const isMatching = matchingScope === scope;
  const [previewState, setPreviewState] = useState<{ scope: object; preview: ArenaMemberProposalPreview } | null>(null);
  const preview = previewState?.scope === scope && model.isPreviewCurrent(previewState.preview) ? previewState.preview : null;
  const selected = new Set(preview?.selectedChangeIds ?? []);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmSync, setConfirmSync] = useState<object | null>(null);
  const [confirmWeb, setConfirmWeb] = useState<object | null>(null);
  const [rememberWeb, setRememberWeb] = useState(false);
  const [detailsRequest, setDetailsRequest] = useState<ArenaMemberReferenceRequest | null>(null);
  const [collapsedTeams, setCollapsedTeams] = useState<ReadonlySet<string>>(new Set());
  const [downloadingDigest, setDownloadingDigest] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadLock = useRef<object | null>(null);
  const submitLock = useRef<object | null>(null);
  const matchLock = useRef<object | null>(null);
  const previewDialogLabels = buildArenaMemberProposalLabels(preview?.editor.workingConfig ?? editorState.workingConfig, host.resolveReferenceName, host.languageLabel);
  const safeActions = Object.fromEntries(Object.entries(model.actions).map(([key, action]) => [key, (...args: unknown[]) => {
    if (!canAct()) return;
    try { (action as (...values: unknown[]) => void)(...args); setLocalError(null); }
    catch { setLocalError('该修改不满足房间安全配置约束'); }
  }])) as ArenaMemberProposalActions;
  const sectionInput = { state: snapshot, actions: safeActions, disabled, resolveName: host.resolveReferenceName };
  const roster = buildArenaMemberRosterModel({ ...sectionInput, collapsedTeams, createId: host.createId, requestDetails: setDetailsRequest,
    toggleTeamCollapsed: key => setCollapsedTeams(old => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next; }) });
  const scenario = buildArenaMemberScenarioModel({ ...sectionInput, openMain: () => setModalKind('scenario'), openAux: () => setModalKind('auxScenario') });
  const material = buildArenaMemberMaterialModel({ ...sectionInput, open: () => setModalKind('material') });
  const webPackage = buildArenaMemberWebPackageModel({ ...sectionInput, downloadingDigest, downloadError, onError: setLocalError,
    download: async digest => {
      if (!isCurrent() || downloadLock.current === scope) return;
      downloadLock.current = scope; setDownloadingDigest(digest); setDownloadError(null);
      try { await host.downloadBuiltinWebPackage(digest); }
      catch { if (isCurrent()) setDownloadError('Web 包下载失败，请稍后重试。'); }
      finally { if (downloadLock.current === scope) downloadLock.current = null; if (isCurrent()) setDownloadingDigest(null); }
    } });
  const selectedCharacterPresetFilenames = snapshot.combatants.filter(item => item.source === 'preset').map(item => item.reference!.id);
  const items = modalKind === 'character' ? snapshot.combatants : modalKind === 'scenario' ? (snapshot.scenario ? [snapshot.scenario] : []) : modalKind === 'auxScenario' ? snapshot.auxScenarios : snapshot.materials;
  const selectedIds = items.flatMap(item => item.source === 'data-card' && item.reference ? [item.reference.id] : []);
  const selectSource = (ref: DataCardRef, selected: boolean) => {
    if (!modalKind || currentSourceSelection.current !== sourceSelectionScope || !canAct() || model.store.getState().generation !== state.generation) return;
    model.invalidatePreview();
    safeActions.selectOnlineReference(modalKind, ref, selected);
    if (modalKind === 'scenario') setModalKind(null);
  };
  const randomMatchCharacter = async () => {
    if (matchLock.current === scope || !canAct() || snapshot.combatants.length >= MAX_COMBATANTS) return;
    matchLock.current = scope; setMatchingScope(scope); setLocalError(null);
    const generation = model.store.getState().generation;
    const sourceIsCurrent = () => canAct() && model.store.getState().generation === generation;
    try {
      const ref = await host.randomPublicCharacter();
      if (!sourceIsCurrent()) return;
      model.invalidatePreview();
      safeActions.selectOnlineReference('character', ref);
    } catch (error) {
      if (sourceIsCurrent()) { model.invalidatePreview(); setLocalError(`随机匹配失败：${error instanceof Error ? error.message : '未知错误'}`); }
    } finally { if (matchLock.current === scope) matchLock.current = null; if (isCurrent()) setMatchingScope(null); }
  };
  const buildPreview = () => {
    if (!canAct()) return;
    try { setPreviewState({ scope, preview: model.preparePreview(`proposal-${host.createId()}`) }); setLocalError(null); }
    catch { setLocalError(editorState.dirty ? '草稿包含暂不支持的变更，请检查后重试' : '草稿没有可提交的变更'); }
  };
  const performSync = () => {
    if (!isCurrent() || !actions.sync || matchLock.current === scope || !!current.current.room.blockedReason) return;
    model.dismissPreview(); setPreviewState(null); setLocalError(null); setConfirmSync(null); actions.sync();
  };
  const requestSync = () => { if (!isCurrent() || !actions.sync || !!current.current.room.blockedReason) return; if (editorState.dirty) setConfirmSync(scope); else performSync(); };
  const submit = async () => {
    if (!preview || !canAct() || submitLock.current === scope) return;
    try {
      const intent = model.takePreviewIntent(preview);
      submitLock.current = scope;
      setPreviewState(null);
      await actions.submit(intent);
      if (isCurrent()) setLocalError(null);
    } catch { if (isCurrent()) setLocalError('提案提交失败，请根据最新房间配置重试'); }
    finally { if (submitLock.current === scope) submitLock.current = null; }
  };

  return (
    <section aria-labelledby="arena-room-proposal-workspace-heading" className="mt-6 rounded-2xl border border-fuchsia-200 bg-fuchsia-50/40 p-4 dark:border-fuchsia-900 dark:bg-fuchsia-950/10 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="arena-room-proposal-workspace-heading" className="text-lg font-semibold text-gray-950 dark:text-gray-100">竞技场提案编辑模式</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">提案草稿与主编辑区隔离 · 本地编辑不联网</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions.sync ? (
            <button type="button" className={buttonClassName()} disabled={isMatching || !!room.blockedReason} onClick={requestSync}>同步配置</button>
          ) : null}
          <button type="button" className={buttonClassName({ variant: 'primary' })} disabled={!editorState.dirty || disabled} onClick={buildPreview}>预览提案</button>
        </div>
      </div>
      {editorState.stale ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{editorState.replacementRequired ? '房间实例已变化，请重新同步后再创建提案。' : '房间设置已更新；草稿仍可提交，冲突项将由房主审阅决定。'}</p> : null}
      {localError ? <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{localError}</p> : null}
      <RoomMemberProposalStatus room={room} scopeIdentity={scopeIdentity} actions={actions} />

      <ArenaEditorWorkspaceLayout
        disabled={disabled}
        sections={buildArenaEditorSections([
          {
            kind: 'presetCharacters',
            description: `已选 ${selectedCharacterPresetFilenames.length}`,
            defaultOpen: true,
            content: (
              <>
                <PresetGridPicker
                  title="选择预设魔法少女"
                  presets={arenaMemberCharacterPresets.filter((preset) => preset.type === 'magical-girl')}
                  currentPage={magicalGirlPresetPage}
                  onPageChange={setMagicalGirlPresetPage}
                  disabled={disabled}
                  maxSelected={MAX_COMBATANTS}
                  selectedCountOverride={snapshot.combatants.length}
                  selectedFilenames={selectedCharacterPresetFilenames}
                  onToggle={preset => safeActions.togglePreset('character', preset.filename)}
                  getDownloadHref={id => host.presetDownloadHref('character', id)}
                  onDownloadLinkClick={host.onCharacterPresetDownloadLinkClick}
                />
                <PresetGridPicker
                  title="选择预设残兽"
                  presets={arenaMemberCharacterPresets.filter((preset) => preset.type === 'canshou')}
                  currentPage={canshouPresetPage}
                  onPageChange={setCanshouPresetPage}
                  disabled={disabled}
                  maxSelected={MAX_COMBATANTS}
                  selectedCountOverride={snapshot.combatants.length}
                  selectedFilenames={selectedCharacterPresetFilenames}
                  onToggle={preset => safeActions.togglePreset('character', preset.filename)}
                  getDownloadHref={id => host.presetDownloadHref('character', id)}
                  onDownloadLinkClick={host.onCharacterPresetDownloadLinkClick}
                />
              </>
            ),
          },
          {
            kind: 'characterDatabase',
            description: `当前已选 ${snapshot.combatants.length}/${MAX_COMBATANTS}`,
            defaultOpen: true,
            content: (
              <>
                <DatabaseSelector
                  className="!mb-0"
                  title={null}
                  onOpenCharacterModal={() => setModalKind('character')}
                  onRandomMatchCharacter={() => { void randomMatchCharacter(); }}
                  isAuthenticated
                  isGenerating={disabled}
                  isMatching={isMatching ? 'character' : null}
                  combatantCount={snapshot.combatants.length}
                  maxCombatants={MAX_COMBATANTS}
                />
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  提案仅可引用公开且审核通过的数据卡；随机匹配同样只从公开角色库抽取。
                </p>
              </>
            ),
          },
          {
            kind: 'roster',
            description: `已选 ${snapshot.combatants.length}/${MAX_COMBATANTS}`,
            defaultOpen: true,
            keepMounted: true,
            content: (
              <ArenaRosterSection model={roster} emptyLabel="房间配置没有角色" />
            ),
          },
          {
            kind: 'battleMode',
            description: '不同模式会影响输出风格与计分规则',
            defaultOpen: true,
            content: <BattleModeControl value={snapshot.battleMode} disabled={disabled} onChange={safeActions.setBattleMode} />,
          },
          ...(snapshot.battleMode === 'scenario' ? [{
            kind: 'scenario' as const,
            description: snapshot.scenario?.name ?? '未选择主情景',
            defaultOpen: snapshot.battleMode === 'scenario',
            autoOpen: snapshot.battleMode === 'scenario',
            content: (
              <ArenaScenarioSection model={scenario} getPresetDownloadHref={id => host.presetDownloadHref('scenario', id)} />
            ),
          }] : []),
          {
            kind: 'materials',
            description: `已选 ${snapshot.materials.length}`,
            defaultOpen: false,
            keepMounted: true,
            content: (
              <ArenaMaterialSection model={material} />
            ),
          },
          {
            kind: 'settings',
            description: '建议保留默认；上下文过长或失败时可在这里精简',
            defaultOpen: false,
            keepMounted: true,
            content: <SharedBattleSettingsControl value={snapshot.historySettings} onChange={safeActions.updateHistorySettings} disabled={disabled} combatantCountForEstimate={0} />,
          },
          {
            kind: 'story',
            description: '提案共享故事选项；模型服务与本地判定仍由房主控制',
            defaultOpen: true,
            keepMounted: true,
            content: <StoryOptionsControl disabled={disabled} enableUserGuidance={host.enableUserGuidance} languages={host.languages}
              userGuidance={snapshot.userGuidance} onUserGuidanceChange={safeActions.setUserGuidance}
              storyLength={snapshot.storyLength} onStoryLengthChange={safeActions.setStoryLength}
              customStoryLength={snapshot.customStoryLength} onCustomStoryLengthChange={safeActions.setCustomStoryLength}
              selectedLanguage={snapshot.selectedLanguage} onSelectedLanguageChange={safeActions.setSelectedLanguage} />,
          },
        ])}
      />

      <section
        aria-labelledby="arena-room-proposal-actions-heading"
        className="mt-6 rounded-2xl border border-fuchsia-200 bg-white/70 p-4 dark:border-fuchsia-900 dark:bg-gray-900/60 sm:p-5"
      >
        <h3 id="arena-room-proposal-actions-heading" className="text-center text-base font-semibold text-gray-950 dark:text-gray-100">
          提案完成后由房主开始生成
        </h3>
        <p className="mt-1 text-center text-sm text-gray-600 dark:text-gray-400">
          多人生成只能由房主启动；把你的调整整理成提案，接受后会进入房间配置。
        </p>
        <div className="mt-4">
          <ArenaReportFormatSelectorView value={snapshot.reportFormat} disabled={disabled}
            webDescription="生成带自定义排版、动画或交互的网页；完成后经本地确认展示，可能加载第三方资源。"
            onChange={value => { if (value === 'web' && !host.webConsent.accepted) setConfirmWeb(scope); else safeActions.setReportFormat(value); }}>
            <ArenaWebPackageSection model={webPackage} host={host.webPackageViewHost} />
          </ArenaReportFormatSelectorView>
          <button
            type="button"
            className="arena-cta-button arena-cta-button--preview"
            disabled={!editorState.dirty || disabled}
            onClick={buildPreview}
          >
            🖆 预览提案
          </button>
          {actions.sync ? (
            <button
              type="button"
              className="arena-cta-button arena-cta-button--sync"
              disabled={isMatching || !!room.blockedReason}
              onClick={requestSync}
            >
              ↻‌ 同步配置
            </button>
          ) : null}
        </div>
        {!editorState.dirty ? (
          <p className="mt-1 text-center text-xs text-gray-500 dark:text-gray-400">
            当前草稿还没有可提交的修改；在上方调整配置后即可提交提案。
          </p>
        ) : null}
      </section>

      <host.SourcePicker open={modalKind !== null && !disabled} kind={modalKind ?? 'character'} selectedIds={selectedIds} error={localError}
        onClose={() => setModalKind(null)} onSelect={ref => selectSource(ref, true)} onToggle={selectSource} />
      <host.ReferenceDetails request={detailsRequest} onClose={() => setDetailsRequest(null)} />
      <WebReportConsentDialogView open={confirmWeb === scope && !disabled} onCancel={() => setConfirmWeb(null)}
        remember={{ checked: rememberWeb, onChange: setRememberWeb }} onAccept={() => {
          if (!canAct() || confirmWeb !== scope) return;
          host.webConsent.onAccept(rememberWeb); setConfirmWeb(null); safeActions.setReportFormat('web');
        }} />

      {preview ? (
        <RoomMemberProposalPreview
          changes={preview.changes}
          labels={previewDialogLabels}
          selected={selected}
          disabled={disabled}
          onSelectedChange={value => { if (canAct()) { try { setPreviewState({ scope, preview: model.selectPreview(preview, [...value]) }); } catch { setLocalError('提案预览已失效，请重新预览'); } } }}
          onClose={() => { model.dismissPreview(); setPreviewState(null); }}
          onSubmit={() => { void submit(); }}
        />
      ) : null}

      {confirmSync === scope ? (
        <ResyncConfirmDialog
          onConfirm={performSync}
          onCancel={() => setConfirmSync(null)}
        />
      ) : null}
    </section>
  );
};
