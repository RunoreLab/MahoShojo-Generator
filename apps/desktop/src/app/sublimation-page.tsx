import { DesktopSublimationLoreSelector } from '../features/sublimation/lore-selector';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from '@tanstack/react-router';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { inferSublimationSourceTemplate, type SublimationCharacterTemplate } from '@mahoshojo/domain/sublimation';
import { DATA_CARD_TEMPLATE_LABELS } from '@mahoshojo/domain/data-cards';
import type { NarrativeHistorySort } from '@mahoshojo/domain/narrative-history-operations';
import { CardLibraryModal, type BattleSelectionPayload, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { NarrativeHistoryPicker } from '@mahoshojo/ui-web/narrative-history';
import { MagicalGirlCard, CanshouCard, GeneralCharacterCard, resolveMagicalGirlGradient } from '@mahoshojo/ui-web/character-card';
import { AiReasoningPanel, GenerationModeSwitcher, JsonSizeIndicator, SaveJsonButton, TokenIndicator, useResultAutoScroll } from '@mahoshojo/ui-web/details-controls';
import { generationActionClassNames, generationSubmitClassName } from '@mahoshojo/ui-web/generation-actions';
import { SublimationPageFrame, SublimationPageHeader, SublimationTargetField, SublimationGuidanceField, SublimationNarrativeField, SublimationPreserveFields, SublimationCurrentStateFieldset, SublimationArenaHistoryStrategyFieldset, getDefaultPreserveFields, getPersonalityPreset } from '@mahoshojo/ui-web/sublimation';
import { ScenarioLanguageField } from '@mahoshojo/ui-web/scenario';
import { BackHomeLink, ProductFooter } from '@mahoshojo/ui-web/shell';
import { buildSafeFileName } from '@mahoshojo/ui-web/client';
import { SublimationSession, createInitialSublimationDraft, buildSublimationInput, type SublimationDraft } from '../features/sublimation/session';
import { prepareSublimationInput } from '../features/sublimation/generation';
import { readSublimationHistorySource, composeDesktopSublimationHistory, type SublimationHistorySource } from '../features/sublimation/history-source';
import { resolveDesktopAiTarget } from '../features/ai-config/desktop-ai-config';
import { DesktopAiProviderPanel } from '../features/ai-config/desktop-ai-provider-panel';
import { useDesktopAiConfig } from '../features/ai-config/use-desktop-ai-config';
import { asCharacterCardPreview, parseImportedCard, MAX_IMPORT_FILE_BYTES } from '../features/character-manager/editor';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { useDesktopCardLibraryHost } from '../platform/card-library-host';
import { IpcLocalCardRepository } from '../platform/local-card-bridge';
import { downloadTextFile } from '../platform/download-text-file';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';
import { GenerationMarkdownPreview } from './generation-markdown-preview';
import { QuestionnaireDraftPanel } from './questionnaire-draft-panel';
import { useLeaveGuard } from './useLeaveGuard';

const actionClass = generationActionClassNames.secondary;
const sourceName = (card: Record<string, unknown> | null): string => {
  const name = card?.codename ?? card?.name ?? card?.title;
  return typeof name === 'string' && name.trim() ? name : '未命名设定';
};

/** 宿主只装配端口；输入视图取自 Web，执行/草稿/签名/另存沿用 generation session。 */
function SublimationForm({ session, repository }: { session: SublimationSession; repository: IpcLocalCardRepository }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const router = useRouter();
  const { openFixed } = useExternalLinks();
  const cardLibraryHost = useDesktopCardLibraryHost();
  const { state: aiState, store: aiStore } = useDesktopAiConfig();
  const target = resolveDesktopAiTarget(aiState.selection, aiState.profiles, aiState.generationOverrides, aiState.modelsByProfileId, aiState.presetsByProviderId);
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [paste, setPaste] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const loreLoadingRef = useRef(false);
  const [loreLoading, setLoreLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const importEpoch = useRef(0);
  const [confirmation, setConfirmation] = useState<'unsaved' | 'uncertain' | null>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySource, setHistorySource] = useState<SublimationHistorySource | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historySort, setHistorySort] = useState<NarrativeHistorySort>('created_desc');
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const draft = state.draft;
  const busy = state.phase === 'generating' || state.saving || aiState.generationActive || importing || loreLoading;
  const blocked = state.pendingRestore;
  const updateDraft = (patch: Partial<SublimationDraft>) => session.updateDraft({ ...session.getSnapshot().draft, ...patch });
  const guard = useLeaveGuard(
    () => loreLoadingRef.current || importingRef.current || aiStore.isPreparingGeneration() || session.isBusy() || session.hasUnsavedDraft(),
    '生成、导入或保存尚未完成，或当前草稿未能保存。请等待、取消生成或重试保存草稿后再离开。',
    '窗口关闭保护初始化失败，生成与保存暂不可用。请重新打开页面后重试。',
    () => {
      if (loreLoadingRef.current || importingRef.current || aiStore.isPreparingGeneration() || session.getSnapshot().saving) return false;
      if (session.getSnapshot().phase !== 'generating') return !session.hasUnsavedDraft() || window.confirm('当前新内容尚未保存到本机草稿。确认放弃这些未保存更改并离开？原有存档不会被删除。');
      if (!window.confirm('生成尚未完成。确认终止生成并离开？未能保存到本机草稿的内容将丢失，可以先复制或保存。')) return false;
      session.cancel(); return true;
    },
  );
  useResultAutoScroll(resultRef, state.card !== null, { restored: state.resultRestored });
  useEffect(() => {
    if (confirmation && !confirmDialog.current?.open) confirmDialog.current?.showModal();
    else if (!confirmation && confirmDialog.current?.open) confirmDialog.current.close();
  }, [confirmation]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/languages.json', { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      .then((response) => response.ok ? response.json() : [])
      .then((value) => { if (!controller.signal.aborted && Array.isArray(value)) setLanguages(value); }).catch(() => undefined);
    return () => { controller.abort(); importEpoch.current += 1; aiStore.cancelPreparingGeneration(); };
  }, [aiStore]);
  useEffect(() => {
    if (!historyOpen) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    void readSublimationHistorySource(repository, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setHistorySource(value); setHistoryLoading(false); }
    }).catch(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [historyOpen, historyRevision, repository]);

  const sourceTemplate = draft.originalData ? inferSublimationSourceTemplate(draft.originalData) : 'unknown';
  const sourceTemplateLabel = sourceTemplate === 'unknown' ? '未知模板' : DATA_CARD_TEMPLATE_LABELS[sourceTemplate];
  const preparation = useMemo(() => {
    if (!draft.originalData) return { warnings: [] as string[], error: null as string | null };
    try { return { warnings: prepareSublimationInput(buildSublimationInput(draft)).conversionWarnings, error: null }; }
    catch (cause) { return { warnings: [], error: cause instanceof Error ? cause.message : '当前素材无法转换为目标模板。' }; }
  }, [draft]);
  const loadSource = (text: string) => {
    const parsed = parseImportedCard(text);
    if (!parsed.ok) { setActionError(parsed.error); return; }
    const data = parsed.draft.data;
    const kind = inferSublimationSourceTemplate(data);
    const selected: SublimationCharacterTemplate = kind === 'magical-girl' || kind === 'canshou' ? kind : 'general';
    updateDraft({ originalData: data, sourceTemplate: kind, targetTemplate: selected, fieldsToPreserve: kind === selected ? getDefaultPreserveFields(selected) : [] });
    setActionError(null); setActionInfo('已载入设定副本，升华结果将另存为新卡。');
  };
  const importFile = async (file: File | undefined, history = false) => {
    if (!file || busy || blocked || importingRef.current) return;
    if (file.size > MAX_IMPORT_FILE_BYTES) { setActionError('文件超过大小上限（4 MiB）。'); return; }
    const epoch = ++importEpoch.current;
    importingRef.current = true; setImporting(true); setActionError(null);
    try {
      const text = await file.text();
      if (epoch !== importEpoch.current) return;
      if (history) updateDraft({ narrativeHistory: text }); else loadSource(text);
    } catch { if (epoch === importEpoch.current) setActionError('读取文件失败，原有输入仍保留。'); }
    finally { if (epoch === importEpoch.current) { importingRef.current = false; setImporting(false); } }
  };
  const chooseCard = (_payload: BattleSelectionPayload, context: CardLibrarySelectionContext) => {
    if (busy || blocked) return;
    if (!context.rawSourceData) { setActionError('卡库未提供完整原文，请重新选择或导入 JSON。'); return; }
    loadSource(JSON.stringify(context.rawSourceData));
    setLibraryOpen(false);
  };
  const generate = (discardUnsavedResult = false) => {
    if (!guard.ready || busy || loreLoadingRef.current || importingRef.current || blocked || !draft.originalData || preparation.error || target.unavailableReason || (target.location === 'client' && !target.providerTarget)) return;
    if (!discardUnsavedResult) {
      if (session.hasUnsavedResult()) { setConfirmation('unsaved'); return; }
      if (state.phase === 'uncertain') { setConfirmation('uncertain'); return; }
    }
    // Freeze the selected history snapshot and all controls before credential preparation awaits.
    const frozenDraft = structuredClone(session.getSnapshot().draft);
    const input = buildSublimationInput(frozenDraft);
    setActionError(null); setActionInfo(null);
    void aiStore.withPreparedGeneration(async (prepared) => {
      await session.generate(
        { invoke, profileId: prepared.profile?.id ?? '', providerTarget: prepared.providerTarget },
        input,
        { mode: prepared.location === 'server' ? (frozenDraft.generationMode === 'stream' ? 'hosted-stream' : 'hosted-json') : prepared.mode!, generationMode: frozenDraft.generationMode, modelId: prepared.modelId ?? undefined, overrides: prepared.generationOverrides },
        discardUnsavedResult,
      );
    }).catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'AI 配置准备失败'));
  };
  const card = state.card;
  const preview = card ? asCharacterCardPreview({ original: null, cardType: 'character', title: sourceName(card), data: card }) : null;
  const signatureLabel = session.resultSignatureKind() === 'official-signed' ? '官方签名（服务器生成）' : session.resultSignatureKind() === 'signature-unverified' ? '含签名字段（本机未验证）' : '未签名（非原生卡）';
  const showStream = state.phase === 'generating' && state.activeGenerationMode === 'stream';
  const profilesBlocked = target.location === 'client' && target.profile !== null && aiState.profilesState !== 'ready';

  return <SublimationPageFrame afterContainer={<>
    <ProductFooter assetSource={{ baseUrl: '/' }} onNavigateInternal={(href) => navigateByProductHref(router, href)} resolveInternalHref={resolveInternalHrefForHashHistory} onNavigateExternal={openFixed} />
    <CardLibraryModal host={cardLibraryHost} isOpen={libraryOpen} onClose={() => setLibraryOpen(false)} onSelectCard={chooseCard} selectedType="all" allowedTypes={['character', 'scenario']} initialTab="local" titleOverride="选择升华素材" allowDeckImport={false} />
    <NarrativeHistoryPicker title="选择本地叙事历史" isOpen={historyOpen} onClose={() => setHistoryOpen(false)} entries={historySource?.entries ?? []} lastUpdatedAt={historySource?.lastUpdatedAt ?? null} readStatus={historyLoading ? 'loading' : historySource?.status ?? 'loading'} sort={historySort} onSort={setHistorySort} formatDateTime={(value) => new Date(value).toLocaleString()} sourceHint={historySource?.message ?? '只读取本地库叙事历史；确认后保存引用快照，源历史不会改动。'} initialSelectedIds={selectedHistoryIds} onConfirm={(entries) => { const ids = entries.map((entry) => entry.id); setSelectedHistoryIds(ids); updateDraft({ selectedHistoryReference: composeDesktopSublimationHistory(entries, ids, '') }); setHistoryOpen(false); }} />
  </>}>
    <div className="card">
      <SublimationPageHeader onNavigate={(href) => navigateByProductHref(router, href)} resolveInternalHref={resolveInternalHrefForHashHistory} loreEnabled={true} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span>{state.draftError ? '草稿保存不可用，当前输入仍保留' : state.draftSavedAt ? '已自动保存到本机草稿' : '填写后自动保存到本机草稿'}</span>
        <button className={actionClass} disabled={busy} onClick={() => { if (window.confirm('清除本机升华草稿及当前生成结果？已保存的本地卡和源卡不会删除。')) { session.discardDraft(); setPaste(''); setSelectedHistoryIds([]); } }}>清除草稿</button>
      </div>
      <QuestionnaireDraftPanel draftError={state.draftError} draftBlocked={session.isDraftBlocked()} busy={busy} actionClass={actionClass} onRetrySave={() => session.retryDraftSave()} />
      {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
      {guard.message && <p role="alert">{guard.message}</p>}
      <fieldset disabled={busy || blocked} className="min-w-0">
        <legend className="sr-only">升华素材与选项</legend>
        <div className="input-group">
          <label htmlFor="character-upload" className="input-label">上传设定文件</label>
          <input id="character-upload" type="file" accept=".json,application/json" className="input-field" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file); }} />
          {draft.originalData && <p className="mt-2 text-xs text-gray-500">已加载角色：{sourceName(draft.originalData)}（源卡保持不变）</p>}
        </div>
        <details className="mb-6"><summary className="text-purple-700">粘贴设定 JSON</summary><label className="sr-only" htmlFor="source-json">设定 JSON</label><textarea id="source-json" className="input-field h-32" value={paste} onChange={(event) => setPaste(event.target.value)} /><button className={actionClass} onClick={() => loadSource(paste)}>从文本加载设定</button></details>
        <button className={`${actionClass} mb-6`} onClick={() => setLibraryOpen(true)}>从本地 / 公共卡库选择</button>
        <SublimationTargetField targetTemplate={draft.targetTemplate} sourceTemplateLabel={sourceTemplateLabel} hasCrossTemplateSelection={!!draft.originalData && sourceTemplate !== draft.targetTemplate} disabled={busy || !draft.originalData} onChange={(value) => updateDraft({ targetTemplate: value, fieldsToPreserve: sourceTemplate === value ? getDefaultPreserveFields(value) : [] })} />
        <DesktopSublimationLoreSelector supplementalLore={{ text: draft.loreText, onChange: (loreText) => updateDraft({ loreText }) }} selections={draft.selectedQuestionnaires ?? []} onChange={(selectedQuestionnaires) => updateDraft({ selectedQuestionnaires })} disabled={busy || blocked} onLoadingChange={(loading) => { loreLoadingRef.current = loading; setLoreLoading(loading); }} />
        {preparation.warnings.map((warning) => <p key={warning} role="status" className="text-sm text-amber-700">{warning}</p>)}
        {preparation.error && <p role="alert">{preparation.error}</p>}
        <SublimationGuidanceField value={draft.userGuidance} disabled={busy} onChange={(userGuidance) => updateDraft({ userGuidance })} />
        <SublimationNarrativeField value={draft.narrativeHistory} disabled={busy} onChange={(narrativeHistory) => updateDraft({ narrativeHistory })}>
          <div className="mt-2 flex flex-wrap gap-2"><input aria-label="上传叙事历史" type="file" accept=".txt,.md,.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file, true); }} /><button className={actionClass} onClick={() => setHistoryOpen(true)}>从本地叙事历史选择</button></div>
          {historySource?.status === 'ready' && historySource.message && <p role="status">{historySource.message}</p>}
          {historySource?.status === 'error' && <p role="alert">{historySource.message}<button className={actionClass} onClick={() => { setHistoryRevision((value) => value + 1); setHistoryOpen(true); }}>重试读取历史</button></p>}
          {draft.selectedHistoryReference && <div className="mt-2"><details><summary>已选叙事历史引用（已保存快照）</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{draft.selectedHistoryReference}</pre></details><button className={actionClass} onClick={() => { updateDraft({ selectedHistoryReference: '' }); setSelectedHistoryIds([]); }}>清除历史引用</button></div>}
          {(draft.narrativeHistory.trim() || draft.selectedHistoryReference) && <p className="mt-1 text-xs text-yellow-700">已提供叙事历史，本次升华结果为衍生数据（非原生），不会保留原生签名。</p>}
        </SublimationNarrativeField>
        <div className="input-group"><p className="input-label">资料读写策略</p><div className="grid gap-4 md:grid-cols-2">
          <SublimationArenaHistoryStrategyFieldset readArenaHistory={draft.readArenaHistory} writeArenaHistory={draft.writeArenaHistory} retentionStrategy={draft.arenaHistoryRetentionStrategy} disabled={busy} onReadArenaHistoryChange={(readArenaHistory) => updateDraft({ readArenaHistory })} onWriteArenaHistoryChange={(writeArenaHistory) => updateDraft({ writeArenaHistory })} onRetentionStrategyChange={(arenaHistoryRetentionStrategy) => updateDraft({ arenaHistoryRetentionStrategy })} />
          <SublimationCurrentStateFieldset readCurrentState={draft.readCurrentState} writeCurrentState={draft.writeCurrentState} disabled={busy} streamMode={draft.generationMode === 'stream'} onReadChange={(readCurrentState) => updateDraft({ readCurrentState })} onWriteChange={(writeCurrentState) => updateDraft({ writeCurrentState })} />
        </div></div>
        <SublimationPreserveFields expanded={draft.isAdvancedVisible === true} hasSource={!!draft.originalData} disabled={busy} onToggle={() => updateDraft({ isAdvancedVisible: !draft.isAdvancedVisible })} targetTemplate={draft.targetTemplate} fieldsToPreserve={draft.fieldsToPreserve} allowReshapeNames={draft.allowReshapeNames} onAllowReshapeNamesChange={(allowReshapeNames) => updateDraft({ allowReshapeNames })} onFieldChange={(field) => updateDraft({ fieldsToPreserve: draft.fieldsToPreserve.includes(field) ? draft.fieldsToPreserve.filter((value) => value !== field) : [...draft.fieldsToPreserve, field] })} onPreset={(preset) => updateDraft({ fieldsToPreserve: preset === 'full' ? [] : preset === 'default' ? getDefaultPreserveFields(draft.targetTemplate) : getPersonalityPreset(draft.targetTemplate) })} />
        <ScenarioLanguageField value={draft.selectedLanguage} languages={languages.length ? languages : [{ code: draft.selectedLanguage, name: draft.selectedLanguage }]} onChange={(selectedLanguage) => updateDraft({ selectedLanguage })} disabled={busy} />
        <GenerationModeSwitcher value={draft.generationMode} onChange={(generationMode) => updateDraft({ generationMode })} helper={false} />
        <p className="mb-4 text-xs text-gray-500">{draft.generationMode === 'stream' ? '流式生成输出 Markdown 通用角色卡；保留字段作为生成要求，不能保证逐字段对应。' : '非流式生成返回所选模板的结构化角色卡。'}</p>
        <DesktopAiProviderPanel generationMode={draft.generationMode} copy={{ serverOutput: { stream: 'Markdown 流式输出（通用角色卡，未签名）', nonStream: '结构化 JSON 输出（签名以服务器实际返回为准）' }, emptyProfilesHint: '可以先载入角色，配置就绪后再生成。', serverFootnote: '由服务器系统默认配置执行，不消费客户端连接与凭据。', payloadNoun: '角色设定、成长引导与所选历史' }} />
      </fieldset>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={generationSubmitClassName} disabled={!guard.ready || busy || blocked || !draft.originalData || !!preparation.error || target.unavailableReason !== null || profilesBlocked || (target.location === 'client' && !target.providerTarget)} onClick={() => generate()}>{state.phase === 'generating' ? '正在升华…' : state.phase === 'idle' ? '开始升华' : '重新升华'}</button>
        {state.phase === 'generating' && <button className={actionClass} onClick={() => session.cancel()}>取消生成</button>}
        {aiState.generationActive && aiStore.isPreparingGeneration() && <button className={actionClass} onClick={() => { aiStore.cancelPreparingGeneration(); setActionInfo('尚未派发的生成已取消；已保存的 API Key 将保留。'); }}>取消准备</button>}
      </div>
      <TokenIndicator text={[JSON.stringify(draft.originalData ?? {}), draft.userGuidance, draft.narrativeHistory, draft.selectedHistoryReference].filter(Boolean).join('\n\n')} />
      {actionError && <p role="alert">{actionError}</p>}{actionInfo && <p role="status">{actionInfo}</p>}
      {state.message && <p role={state.phase === 'uncertain' ? 'alert' : 'status'}>{state.message}</p>}
      <dialog ref={confirmDialog} aria-labelledby="sublimation-confirm-title" className="m-auto max-w-lg rounded-lg border bg-(--app-surface) p-5 text-(--app-text) backdrop:bg-black/40" onCancel={(event) => { event.preventDefault(); if (!session.isBusy()) setConfirmation(null); }}>
        <h2 id="sublimation-confirm-title" className="text-xl font-semibold">重新升华？</h2><p className="my-3">{confirmation === 'unsaved' ? '当前结果尚未保存到本地卡库。重新升华将替换当前结果，即使失败或取消也无法恢复。可以先保存当前结果。' : '无法确认上次请求是否在服务器执行，它可能已完成并计费。再次升华可能产生重复调用与费用。'}</p>
        {state.saveError && <p role="alert">{state.saveError}</p>}
        <div className="flex flex-wrap gap-2"><button autoFocus className={actionClass} disabled={busy} onClick={() => setConfirmation(null)}>取消</button>{confirmation === 'unsaved' && <button className={actionClass} disabled={busy} onClick={async () => { if (await session.saveResult()) { setConfirmation(null); generate(true); } }}>保存后重新升华</button>}<button className={actionClass} disabled={busy} onClick={() => { setConfirmation(null); generate(true); }}>确定重新升华</button></div>
      </dialog>
    </div>
    <div ref={resultRef}>
      {card && <section aria-label="升华结果" className="mt-6 space-y-4">
        <p className="text-sm">升华结果 · {signatureLabel}</p>
        {preview?.kind === 'magical-girl' && <MagicalGirlCard magicalGirl={preview.data} gradientStyle={resolveMagicalGirlGradient(preview.data.appearance.colorScheme)} />}
        {preview?.kind === 'canshou' && <CanshouCard canshou={preview.data} />}
        {preview?.kind === 'general' && <GeneralCharacterCard general={preview.data} />}
        <div className="card"><h3 className="text-lg font-semibold">保存升华结果</h3><p className="mb-3 text-xs text-gray-500">另存新卡，原始角色与本地历史不会被覆盖。</p>
          <button className={generationActionClassNames.primary} disabled={!guard.ready || busy || state.saveStatus === 'saved' || state.saveStatus === 'already-present'} onClick={() => void session.saveResult()}>{state.saving ? '正在保存…' : '保存到本地卡库'}</button>
          {state.saveStatus === 'saved' && <p role="status">已保存到本地卡库。</p>}{state.saveStatus === 'already-present' && <p role="status">本地卡库已存在相同内容，原记录保持不变。</p>}{state.saveError && <p role="alert">{state.saveError}</p>}
          <div className="mt-3 flex flex-col gap-3"><SaveJsonButton data={card} mode="download" recommendedMode="download" resolveFileName={() => buildSafeFileName(`升华_${sourceName(card)}`, 'json', '升华结果')} downloadJson={downloadTextFile} /><button className={actionClass} onClick={() => { void Promise.resolve().then(() => navigator.clipboard.writeText(JSON.stringify(card, null, 2))).then(() => setActionInfo('数据卡 JSON 已复制到剪贴板')).catch(() => setActionError('复制失败，请手动选择 JSON 内容后复制。')); }}>复制到剪贴板</button></div>
          <JsonSizeIndicator data={card} maxBytes={MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES} hintText="按 UTF-8 字节估算，对照本地卡单条记录上限" warningText="接近本地卡单条上限（4 MiB），保存可能失败，请先精简数据。" />
          <details><summary>查看升华 JSON</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(card, null, 2)}</pre></details>
        </div>
      </section>}
    </div>
    {state.reasoning && <AiReasoningPanel reasoning={state.reasoning} />}
    <GenerationMarkdownPreview active={showStream} text={state.rawText} />
    {state.rawText && <details open={state.phase !== 'completed' && !showStream}><summary>原始输出正文</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-3">{state.rawText}</pre></details>}
    <div className="mt-8 text-center"><BackHomeLink href="#/" onNavigate={() => void router.navigate({ to: '/' })} /></div>
  </SublimationPageFrame>;
}

export function DesktopSublimation() {
  const [owner, setOwner] = useState<{ session: SublimationSession; repository: IpcLocalCardRepository } | null>(null);
  useEffect(() => {
    const repository = new IpcLocalCardRepository(invoke);
    const session = new SublimationSession({ repository, initialDraft: createInitialSublimationDraft(), storage: { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: (key) => window.localStorage.removeItem(key) } });
    session.restoreDraft(false); setOwner({ session, repository });
    const onPageHide = () => session.cancel(); window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); session.dispose(); };
  }, []);
  return owner ? <SublimationForm {...owner} /> : <p role="status">正在准备草稿…</p>;
}
