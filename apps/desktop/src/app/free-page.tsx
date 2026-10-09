import { PrivateResultSave } from '../features/cloud-save/private-result-save';
import { GenerationMarkdownPreview } from './generation-markdown-preview';
import { generationActionClassNames, generationSubmitClassName } from '@mahoshojo/ui-web/generation-actions';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from '@tanstack/react-router';
import {
  formatReferenceAttachmentsForPrompt,
} from '@mahoshojo/ai-core/reference-attachments';
import { FREE_STREAM_SCHEMA_IDS, type FreeSchemaId } from '@mahoshojo/ai-core/free-generation';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { hostedGenerationBodyMaxBytes } from '@mahoshojo/contracts/desktop-cloud';

import {
  AiReasoningPanel,
  GenerationModeSwitcher,
  JsonSizeIndicator,
  TokenIndicator,
  isMobileFormFactor,
  recommendedSaveModes,
  SaveJsonButton,
  useResultAutoScroll,
} from '@mahoshojo/ui-web/details-controls';
import {
  CanshouCard,
  GeneralCharacterCard,
  MagicalGirlCard,
  type CanshouDetails,
  type GeneralCharacterCardData,
  type MagicalGirlCardData,
} from '@mahoshojo/ui-web/character-card';
import {
  FreePageLayout,
  FreeFormSections,
  FreePromptActions,
  FreeResultActions,
  FreeResultPanel,
  FreeJsonResult,
  FreeAttachmentPanel,
  FreeSchemaFields,
  FreePromptField,
  FreeLanguageField,
  formatBytes,
  freeSchemaOptionsForMode,
  readFreeAttachmentFiles,
  toPromptAttachments,
  useFreeAttachments,
} from '@mahoshojo/ui-web/free';
import { MarkdownBlock } from '@mahoshojo/ui-web/markdown';
import { BackHomeLink, ProductFooter } from '@mahoshojo/ui-web/shell';
import type { HomeAssetSource } from '@mahoshojo/ui-web/home';
import { FreeSession, createEmptyFreeDraftDocument, type FreeDraft } from '../features/free/session';
import type { FreeExecutionMode } from '../features/free/generation';
import { resolveDesktopAiTarget } from '../features/ai-config/desktop-ai-config';
import { DesktopAiProviderPanel } from '../features/ai-config/desktop-ai-provider-panel';
import { useDesktopAiConfig } from '../features/ai-config/use-desktop-ai-config';
import { downloadTextFile } from '../platform/download-text-file';
import { IpcLocalCardRepository } from '../platform/local-card-bridge';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';
import { useLeaveGuard } from './useLeaveGuard';

/**
 * Desktop 的资源服务根（与 `routes.tsx` 中同名常量同义）：Tauri 自定义协议伺服 `dist/`，
 * 品牌资源位于 origin 根。宿主事实按文件各自声明，不跨页面共享易变常量。
 */
const DESKTOP_ASSET_SOURCE: HomeAssetSource = { baseUrl: '/' };

const actionClass = generationActionClassNames.secondary;

type DeviceType = 'mobile' | 'desktop' | 'unknown';

const sanitizeFileNamePart = (value: string): string =>
  value.replace(/[^a-z0-9一-龥]/gi, '_').slice(0, 80) || 'data';

const resolveResultJsonFileName = (card: Record<string, unknown>, cardKind: FreeSchemaId): string => {
  const scenario = cardKind === 'scenario' || cardKind === 'general-scenario';
  const label = scenario
    ? (typeof card.title === 'string' && card.title ? card.title : typeof card.name === 'string' && card.name ? card.name : '自定义情景')
    : (typeof card.codename === 'string' && card.codename ? card.codename : typeof card.name === 'string' && card.name ? card.name : '自定义角色');
  return `${scenario ? '数据卡_情景' : '数据卡_角色'}_${sanitizeFileNamePart(label)}.json`;
};

type ConfirmRegenerateKind = 'unsaved' | 'uncertain';

/** 「重新生成」确认文案——与 `/canshou` 同一套语义（free 无 quick-random 分支）。 */
const describeRegenerateConfirm = (kind: ConfirmRegenerateKind): { title: string; description: string } => ({
  title: '重新生成？',
  description: kind === 'unsaved'
    ? '当前结果尚未保存到本地卡库。重新生成将替换当前结果；即使新生成失败或取消，也无法恢复。可以先保存当前结果再生成。'
    : '无法确认上次请求是否在服务器执行——它可能已经完成并计费。再次生成会发起新的请求，可能产生重复调用与费用。',
});

function FreeForm({ session }: { session: FreeSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const cloudSavingRef = useRef(false);
  const [cloudSaving, setCloudSaving] = useState(false);
  const onCloudSavingChange = useCallback((saving: boolean) => { cloudSavingRef.current = saving; setCloudSaving(saving); }, []);

  const router = useRouter();
  const { openFixed } = useExternalLinks();
  // AI 连接与执行位置与设置页共用同一份 overlay/profiles 状态（D5.0b）。
  const { state: aiState, store: aiStore } = useDesktopAiConfig();
  const target = resolveDesktopAiTarget(
    aiState.selection,
    aiState.profiles,
    aiState.generationOverrides,
    aiState.modelsByProfileId,
    aiState.presetsByProviderId,
  );
  const profilesLoading = aiState.profilesState === 'idle' || aiState.profilesState === 'loading';
  const profilesError = aiState.profilesState === 'failed' ? aiState.profilesError : null;
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  // 附件会话共源（ui-web/free）：读取代际失效、合并前预算复核、input 复位
  // 由 hook 统一承担——附件不写入草稿。
  const attachmentReadingRef = useRef(false);
  const attachmentReadEpoch = useRef(0);
  const readAttachments = useCallback(async (...args: Parameters<typeof readFreeAttachmentFiles>) => {
    const epoch = ++attachmentReadEpoch.current;
    attachmentReadingRef.current = true;
    try { return await readFreeAttachmentFiles(...args); }
    finally { if (epoch === attachmentReadEpoch.current) attachmentReadingRef.current = false; }
  }, []);
  const attachmentState = useFreeAttachments(readAttachments);
  const guardedAttachments = {
    ...attachmentState,
    addFiles: (files: ArrayLike<File> | null | undefined) => cloudSavingRef.current ? Promise.resolve() : attachmentState.addFiles(files),
    remove: (id: string) => { if (!cloudSavingRef.current) { attachmentReadEpoch.current++; attachmentReadingRef.current = false; attachmentState.remove(id); } },
    clear: () => { if (!cloudSavingRef.current) { attachmentReadEpoch.current++; attachmentReadingRef.current = false; attachmentState.clear(); } },
  };
  const { items: attachments, isReading: isReadingAttachments } = attachmentState;
  const clearAttachments = guardedAttachments.clear;
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState<false | ConfirmRegenerateKind>(false);
  const [deviceType, setDeviceType] = useState<DeviceType>('unknown');
  const regenerateDialog = useRef<HTMLDialogElement>(null);
  const resultSectionRef = useRef<HTMLDivElement | null>(null);
  useResultAutoScroll(resultSectionRef, state.card !== null, { restored: state.resultRestored });
  useEffect(() => {
    const dialog = regenerateDialog.current;
    if (confirmRegenerate && !dialog?.open) dialog?.showModal();
    else if (!confirmRegenerate && dialog?.open) dialog.close();
  }, [confirmRegenerate]);
  const guard = useLeaveGuard(
    () => cloudSavingRef.current || session.isBusy() || session.hasUnsavedDraft(),
    '生成或保存尚未完成，或当前草稿未能保存。请等待、取消生成，或重试保存草稿后再离开。也可以确认清除草稿以放弃当前内容。',
    '窗口关闭保护初始化失败，生成与保存暂不可用。请重新打开页面后重试。',
    () => {
      const current = session.getSnapshot();
      if (cloudSavingRef.current || current.saving || aiStore.isPreparingGeneration()) return false;
      if (current.phase !== 'generating') return !session.hasUnsavedDraft() || window.confirm('当前新内容尚未保存到本机草稿。确认放弃这些未保存更改并离开？原有存档不会被删除。');
      if (!window.confirm('生成尚未完成。确认终止生成并离开？未能保存到本机草稿的内容将丢失，可以先复制或保存。')) return false;
      session.cancel();
      return true;
    },
  );
  // 语言清单与 Web 同一来源（content/languages.json → public 同步副本）。
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/languages.json', { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => { if (!controller.signal.aborted && Array.isArray(data)) setLanguages(data); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  // 终端形态决定「保存方式」推荐项与缺省值（与 Web 同一 UA 判定）。
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setDeviceType(isMobileFormFactor() ? 'mobile' : 'desktop');
  }, []);
  const draft = state.draft;
  const updateDraft = (patch: Partial<FreeDraft>) => {
    if (cloudSavingRef.current) return;
    session.updateDraft({ ...session.getSnapshot().draft, ...patch });
  };
  // 与 Web 共用流式 Schema 白名单；归并与执行位置无关，切换位置不改写 Schema。
  useEffect(() => {
    if (draft.generationMode !== 'stream') return;
    if ((FREE_STREAM_SCHEMA_IDS as readonly string[]).includes(draft.schemaId)) return;
    session.updateDraft({ ...session.getSnapshot().draft, schemaId: 'general' });
  }, [session, draft.generationMode, draft.schemaId]);
  const schemaOptionsForMode = freeSchemaOptionsForMode(draft.generationMode);
  const mode = target.mode;
  const busy = cloudSaving || state.phase === 'generating' || state.saving || aiState.generationActive;
  const showStreamPreview = state.phase === 'generating' && state.activeGenerationMode === 'stream';
  useEffect(() => () => aiStore.cancelPreparingGeneration(), [aiStore]);
  const blockedDraft = state.pendingRestore;
  // hosted 路由编码生成方式；direct 通路通过独立 intent 字段表达生成方式。
  const hostedMode: FreeExecutionMode = draft.generationMode === 'stream' ? 'hosted-stream' : 'hosted-json';
  const executionMode: FreeExecutionMode | null = target.location === 'server' ? hostedMode : mode;
  // 本地 Provider 配置只门禁客户端执行：server 偏好由 hosted System Default 解析、
  // 不消费本地 profile（两个执行位置正交，DESK-ONLINE-001/009）。
  const clientProfilesBlocked =
    target.profile !== null && (profilesLoading || profilesError !== null);
  const recommended = recommendedSaveModes(deviceType === 'mobile');
  const jsonSaveMode = recommended.jsonSaveMode;
  const tokenEstimateText = useMemo(() => {
    const blocks: string[] = [];
    if (draft.prompt.trim()) blocks.push(draft.prompt);
    const attachmentsText = formatReferenceAttachmentsForPrompt(toPromptAttachments(attachments));
    if (attachmentsText.trim()) blocks.push(attachmentsText);
    return blocks.join('\n\n');
  }, [attachments, draft.prompt]);

  const generate = (discardUnsavedResult = false) => {
    // 悬空选择（含服务器侧被目录移除的系统模型）保留诊断值但禁止派发——
    // unavailableReason 与按钮 disabled 必须同口径（D5.1-AIP-r1-r1）。
    if (cloudSavingRef.current || !guard.ready || busy || !executionMode || isReadingAttachments || blockedDraft || target.unavailableReason !== null) return;
    if (target.location === 'client' && !target.providerTarget) return;
    if (!discardUnsavedResult) {
      if (session.hasUnsavedResult()) { setConfirmRegenerate('unsaved'); return; }
      // hosted-json 结果不确定时再次生成 = 可能的第二次调用，必须显式确认（D5.1a-r1）。
      if (state.phase === 'uncertain') { setConfirmRegenerate('uncertain'); return; }
    }
    if (draft.generationMode === 'stream' && !(FREE_STREAM_SCHEMA_IDS as readonly string[]).includes(draft.schemaId)) {
      setActionError('流式生成仅支持通用角色/通用情景卡，请先切换 Schema。');
      return;
    }
    try {
      setActionError(null);
      setActionInfo(null);
      void aiStore.withPreparedGeneration(async (prepared) => { await session.generate(
        { invoke, profileId: prepared.profile?.id ?? '', providerTarget: prepared.providerTarget },
        {
          prompt: draft.prompt,
          schema: draft.schemaId,
          language: draft.selectedLanguage,
          attachments: toPromptAttachments(attachments),
        },
        { mode: prepared.location === 'server' ? hostedMode : prepared.mode!, generationMode: draft.generationMode, modelId: prepared.modelId ?? undefined, overrides: prepared.generationOverrides },
        discardUnsavedResult,
      );
      }).catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'AI 配置准备失败'));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '生成失败。');
    }
  };

  const card = state.card;
  const resultCardType = session.resultCardType();
  const cardKind = state.cardKind;
  const resultJsonName = card ? resolveResultJsonFileName(card, cardKind) : 'data.json';
  const confirmCopy = confirmRegenerate === false ? null : describeRegenerateConfirm(confirmRegenerate);
  return (
    <FreePageLayout
      controls={(
        <FreeFormSections
          schema={
            <FreeSchemaFields
                disabled={busy || blockedDraft}
                schemaId={draft.schemaId}
                options={schemaOptionsForMode}
                onChange={(schemaId) => updateDraft({ schemaId })}
                showFieldGuide={draft.showFieldGuide === true}
                onToggleFieldGuide={() => updateDraft({ showFieldGuide: !draft.showFieldGuide })}
              />}
          prompt={
            <FreePromptField
                disabled={busy || blockedDraft}
                actions={<FreePromptActions canCopy={!!draft.prompt.trim()} disabled={busy} onCopy={() => {
                  void Promise.resolve().then(() => navigator.clipboard.writeText(draft.prompt)).then(() => setActionInfo('已复制提示词到剪贴板')).catch(() => setActionError('复制失败'));
                }} onClear={() => {
                  if (cloudSavingRef.current) return;
                  session.updateDraft({ ...session.getSnapshot().draft, prompt: '' });
                  clearAttachments();
                  setActionError(null);
                  setActionInfo(null);
                }} />}
                value={draft.prompt}
                onChange={(prompt) => updateDraft({ prompt })}
                hint={target.location === 'server'
                  ? `服务器通路请求体（提示词 + 附件 + JSON 包装）上限 ${formatBytes(hostedGenerationBodyMaxBytes(draft.generationMode === 'stream' ? 'generate-free-stream' : 'generate-free'))}，超出会在派发前拦截`
                  : '客户端执行的输入上限由所连模型服务自身决定'}
              />}
          attachments={<FreeAttachmentPanel state={guardedAttachments} disabled={busy || blockedDraft} />}
          mode={<fieldset disabled={busy || blockedDraft}>
            <GenerationModeSwitcher
              value={draft.generationMode}
              onChange={(next) => updateDraft({ generationMode: next })}
              helper={false}
            />
          </fieldset>}
          language={
            <FreeLanguageField
                      disabled={busy || blockedDraft}
                      value={draft.selectedLanguage}
                      languages={languages.length ? languages : [{ code: draft.selectedLanguage, name: draft.selectedLanguage }]}
                      expanded={draft.showLanguageSection === true}
                      onToggle={() => updateDraft({ showLanguageSection: !draft.showLanguageSection })}
                      onChange={(selectedLanguage) => updateDraft({ selectedLanguage })}
                    />}
          provider={<fieldset disabled={busy || blockedDraft} className="flex min-w-0 flex-col gap-4">
            <DesktopAiProviderPanel
                generationMode={draft.generationMode}
                copy={{
                  serverOutput: {
                    stream: 'Markdown 流式输出（仅通用角色/通用情景卡，未签名）',
                    nonStream: '结构化 JSON 输出（无签名）',
                  },
                  emptyProfilesHint: '提示词可以先填写，配置加载后再生成。',
                  serverFootnote:
                    '不使用客户端连接与凭据（由服务器侧系统默认配置解析）。切换执行位置不会丢失已填写的提示词。',
                  payloadNoun: '提示词与附件',
                }}
              />
          </fieldset>}
          actions={<>
            <div className="flex flex-wrap gap-2">
              <button className={generationSubmitClassName} disabled={!guard.ready || busy || !draft.prompt.trim() || !executionMode || isReadingAttachments || target.unavailableReason !== null || (target.location === 'client' && !target.providerTarget) || clientProfilesBlocked || blockedDraft} onClick={() => generate()}>{state.phase === 'generating' ? '正在生成…' : state.phase === 'idle' ? '生成数据卡' : '重新生成'}</button>
              {state.phase === 'generating' && <button className={actionClass} onClick={() => session.cancel()}>取消生成</button>}
                  {aiState.generationActive && aiStore.isPreparingGeneration() && <button className={actionClass} onClick={() => {
                    aiStore.cancelPreparingGeneration();
                    setActionInfo('尚未派发的生成已取消；已保存的 API Key 将保留，系统凭据操作结束后可重试。');
                  }}>取消准备</button>}
            </div>
          </>}
          tokens={<TokenIndicator text={tokenEstimateText} warningText="⚠️ 预计上下文较长，可能更易超时/失败。可尝试精简提示词或减少/拆分附件。" />}
          feedback={<>
            {state.draftError && <div role="alert" className="text-sm text-red-600">{state.draftError}{!session.isDraftBlocked() && <button className={actionClass} disabled={busy} onClick={() => session.retryDraftSave()}>重试保存草稿</button>}</div>}
            {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
            {guard.message && <p role="alert">{guard.message}</p>}
            {profilesLoading && target.location === 'client' && <p role="status">正在读取本地 Provider 配置…</p>}
            {profilesError && <p role="alert">{target.location === 'server' ? '本地 Provider 配置加载失败，仅影响客户端执行。' : profilesError}</p>}
            <dialog ref={regenerateDialog} aria-labelledby="regenerate-title" aria-describedby="regenerate-description" className="m-auto max-w-lg rounded-lg border border-(--app-border) bg-(--app-surface) p-5 text-(--app-text) backdrop:bg-black/40" onCancel={(event) => { event.preventDefault(); if (!session.isBusy()) setConfirmRegenerate(false); }}>
              <h2 id="regenerate-title" className="text-xl font-semibold">{confirmCopy?.title ?? '重新生成？'}</h2>
              <p id="regenerate-description" className="my-3">{confirmCopy?.description}</p>
              {state.saveError && <p role="alert">{state.saveError}</p>}
              <div className="flex flex-wrap gap-2">
                <button autoFocus className={actionClass} disabled={busy} onClick={() => setConfirmRegenerate(false)}>取消</button>
                {confirmRegenerate === 'unsaved' && <button className={generationActionClassNames.primary} disabled={busy} onClick={async () => { if (await session.saveResult()) { setConfirmRegenerate(false); generate(true); } }}>{state.saving ? '正在保存…' : '保存后重新生成'}</button>}
                <button className={actionClass} disabled={busy} onClick={() => { setConfirmRegenerate(false); generate(true); }}>确定重新生成</button>
              </div>
            </dialog>
            {actionError && <p role="alert">{actionError}</p>}
            {actionInfo && <p role="status">{actionInfo}</p>}
            {state.message && <p role={state.phase === 'uncertain' ? 'alert' : 'status'}>{state.message}</p>}
          </>}
          navigation={<div className="mt-6 text-center"><BackHomeLink href="#/" onNavigate={() => void router.navigate({ to: '/' })} /></div>}
        />
      )}
      result={card || state.rawText || state.reasoning ? (
        <>
            {state.reasoning && <AiReasoningPanel reasoning={state.reasoning} />}
            <div ref={resultSectionRef}>
              {card && <section aria-label="生成结果" className="flex flex-col gap-3">
                <p className="text-sm text-(--app-text-muted)">生成结果 · 未签名（自由生成为非原生卡）</p>
                {cardKind === 'magical-girl' && <MagicalGirlCard magicalGirl={card as unknown as MagicalGirlCardData} gradientStyle="linear-gradient(135deg, #9775fa 0%, #b197fc 100%)" />}
                {cardKind === 'canshou' && <CanshouCard canshou={card as unknown as CanshouDetails} />}
                {cardKind === 'general' && <GeneralCharacterCard general={card as unknown as GeneralCharacterCardData} />}
                {cardKind === 'general-scenario' && (
                  <FreeResultPanel title={typeof card.title === 'string' && card.title ? card.title : '通用情景卡'}>
                    <div className="rounded-lg bg-gray-50 p-4 border border-gray-200">
                      <MarkdownBlock content={typeof card.content === 'string' ? card.content : ''} variant="light" mode="article" />
                    </div>
                  </FreeResultPanel>
                )}
                {cardKind === 'scenario' && (
                  <FreeResultPanel title={typeof card.title === 'string' && card.title ? card.title : '结构化情景'}>
                    <FreeJsonResult data={card} />
                  </FreeResultPanel>
                )}
                {resultCardType && <PrivateResultSave data={card} cardType={resultCardType} onBusyChange={onCloudSavingChange} isBlocked={() => session.isBusy() || aiStore.isPreparingGeneration() || attachmentReadingRef.current} disabled={!guard.ready || busy || isReadingAttachments} className={generationActionClassNames.primary} />}
                  <button className={generationActionClassNames.primary} disabled={!guard.ready || busy || state.saveStatus === 'saved' || state.saveStatus === 'already-present'} onClick={() => { if (guard.ready) void session.saveResult(); }}>{state.saving ? '正在保存…' : '保存到本地卡库'}</button>
                {state.saveStatus === 'saved' && <p role="status">已保存到本地卡库。</p>}
                {state.saveStatus === 'already-present' && <p role="status">本地卡库已存在相同内容，原记录保持不变。</p>}
                {state.saveError && <p role="alert">{state.saveError}</p>}
                <FreeResultPanel title="保存数据卡" label="保存原始数据">
                  <div className="mt-3 flex flex-col gap-3">
                    <SaveJsonButton
                      data={card}
                      mode={jsonSaveMode}
                      recommendedMode={recommended.jsonSaveMode}
                      resolveFileName={() => resultJsonName}
                      downloadJson={downloadTextFile}
                    />
                  </div>
                  <FreeResultActions sizeIndicator={(
                  <JsonSizeIndicator
                    data={card}
                    maxBytes={MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES}
                    hintText="按 UTF-8 字节估算，对照本地卡单条记录上限"
                    warningText="⚠️ 接近本地卡单条上限（4 MiB），保存到本地卡库可能失败，请先精简数据。"
                  />
                  )}>
                    {jsonSaveMode === 'text' && <button className={`${actionClass} flex-1`} onClick={() => downloadTextFile(resultJsonName, JSON.stringify(card, null, 2))}>下载 JSON 文件</button>}
                    <button className={`${actionClass} flex-1`} onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(card, null, 2)).then(() => setActionInfo('✅ 数据卡 JSON 已复制到剪贴板')).catch(() => setActionError('复制失败，请手动选择 JSON 内容后复制。')); }}>复制到剪贴板</button>
                  </FreeResultActions>
                </FreeResultPanel>
              </section>}
            </div>
            <GenerationMarkdownPreview active={showStreamPreview} text={state.rawText} />
            {state.rawText && <details open={state.phase !== 'completed' && !showStreamPreview}><summary>原始输出正文</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-3">{state.rawText}</pre></details>}
        </>
      ) : null}
      footer={(
          <ProductFooter
            assetSource={DESKTOP_ASSET_SOURCE}
            onNavigateInternal={(href) => navigateByProductHref(router, href)}
            resolveInternalHref={resolveInternalHrefForHashHistory}
            onNavigateExternal={openFixed}
          />
      )}
    />
  );
}

export function DesktopFree() {
  const [session, setSession] = useState<FreeSession | null>(null);
  useEffect(() => {
    const owner = new FreeSession({
      storage: { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: (key) => window.localStorage.removeItem(key) },
      repository: new IpcLocalCardRepository(invoke),
      initialDraft: createEmptyFreeDraftDocument(),
    });
    owner.restoreDraft(false);
    setSession(owner);
    const onPageHide = () => owner.cancel();
    window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); owner.dispose(); };
  }, []);
  return session ? <FreeForm session={session} /> : <p role="status">正在准备草稿…</p>;
}
