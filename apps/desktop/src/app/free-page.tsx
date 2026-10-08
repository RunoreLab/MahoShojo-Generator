import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from '@tanstack/react-router';
import {
  formatReferenceAttachmentsForPrompt,
  FREE_GENERATION_ATTACHMENT_LIMITS,
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
  FREE_PROMPT_PLACEHOLDER,
  FREE_SCHEMA_OPTIONS,
  buildFreeFieldGuide,
  formatBytes,
  freeSchemaOptionsForMode,
  readFreeAttachmentFiles,
  toPromptAttachments,
  useFreeAttachments,
} from '@mahoshojo/ui-web/free';
import { MarkdownBlock } from '@mahoshojo/ui-web/markdown';
import { ProductFooter } from '@mahoshojo/ui-web/shell';
import type { HomeAssetSource } from '@mahoshojo/ui-web/home';
import { FreeSession, FREE_DRAFT_DEFAULT_LANGUAGE, type FreeDraft } from '../features/free/session';
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

const actionClass = 'rounded-lg border border-(--app-border) px-4 py-2 disabled:opacity-50';

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
  const router = useRouter();
  const { openFixed } = useExternalLinks();
  // AI 连接与执行位置与设置页共用同一份 overlay/profiles 状态（D5.0b）。
  const { state: aiState } = useDesktopAiConfig();
  const target = resolveDesktopAiTarget(
    aiState.selection,
    aiState.profiles,
    aiState.generationOverrides,
    aiState.modelsByProfileId,
  );
  const profilesLoading = aiState.profilesState === 'idle' || aiState.profilesState === 'loading';
  const profilesError = aiState.profilesState === 'failed' ? aiState.profilesError : null;
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  // 附件会话共源（ui-web/free）：读取代际失效、合并前预算复核、input 复位
  // 由 hook 统一承担——附件不写入草稿。
  const {
    items: attachments,
    isReading: isReadingAttachments,
    error: attachmentError,
    inputRef: attachmentInputRef,
    totalChars: totalAttachmentChars,
    addFiles: addAttachmentFiles,
    remove: removeAttachment,
    clear: clearAttachments,
  } = useFreeAttachments(readFreeAttachmentFiles);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState<false | ConfirmRegenerateKind>(false);
  const [deviceType, setDeviceType] = useState<DeviceType>('unknown');
  const regenerateDialog = useRef<HTMLDialogElement>(null);
  const resultSectionRef = useRef<HTMLDivElement | null>(null);
  useResultAutoScroll(resultSectionRef, state.card !== null);
  useEffect(() => {
    const dialog = regenerateDialog.current;
    if (confirmRegenerate && !dialog?.open) dialog?.showModal();
    else if (!confirmRegenerate && dialog?.open) dialog.close();
  }, [confirmRegenerate]);
  const guard = useLeaveGuard(
    () => session.isBusy() || (!session.getSnapshot().draftSaved && !session.getSnapshot().pendingRestore && !session.isDraftBlocked()),
    '生成或保存尚未完成，或当前草稿未能保存。请等待、取消生成，或重试保存草稿后再离开。也可以确认清除草稿以放弃当前内容。',
    '窗口关闭保护初始化失败，生成与保存暂不可用。请重新打开页面后重试。',
    () => {
      const current = session.getSnapshot();
      if (current.saving || current.phase !== 'generating') return false;
      if (!window.confirm('生成尚未完成。确认终止生成并离开？已收到的正文将保留在本机草稿中。')) return false;
      session.cancel();
      return session.getSnapshot().draftSaved;
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
    session.updateDraft({ ...session.getSnapshot().draft, ...patch });
  };
  // 流式产物只经 hosted 通路（Markdown 通用卡）；客户端 direct 通路永远
  // 结构化（DESK-ONLINE-009），切到客户端时回写非流式（与 /scenario 同一口径）。
  useEffect(() => {
    if (target.location !== 'client' || draft.generationMode !== 'stream') return;
    session.updateDraft({ ...session.getSnapshot().draft, generationMode: 'non-stream' });
  }, [session, target.location, draft.generationMode]);
  // 流式模式下只允许通用卡：必要时自动切换 schema（与 Web 同一效果，但作用于草稿字段）。
  // 该归并只在服务器通路成立——客户端已在上一条 effect 回写非流式，
  // 切换执行位置不得顺带改写用户已选的结构化 Schema（G2-r1 复审）。
  useEffect(() => {
    if (target.location !== 'server' || draft.generationMode !== 'stream') return;
    if ((FREE_STREAM_SCHEMA_IDS as readonly string[]).includes(draft.schemaId)) return;
    session.updateDraft({ ...session.getSnapshot().draft, schemaId: 'general' });
  }, [session, target.location, draft.generationMode, draft.schemaId]);
  const schemaOptionsForMode = freeSchemaOptionsForMode(draft.generationMode);
  const fieldGuideText = useMemo(() => buildFreeFieldGuide(draft.schemaId), [draft.schemaId]);
  const selected = target.profile;
  const mode = target.mode;
  const busy = state.phase === 'generating' || state.saving;
  const blockedDraft = state.pendingRestore || session.isDraftBlocked();
  // 「客户端｜服务器」与「流式｜非流式」两个维度共同决定执行模式（DESK-ONLINE-009）：
  // 流式/非流式只影响 hosted 路由选择，direct 通路始终为结构化生成。
  const hostedMode: FreeExecutionMode = draft.generationMode === 'stream' ? 'hosted-stream' : 'hosted-json';
  const executionMode: FreeExecutionMode | null = target.location === 'server' ? hostedMode : mode;
  // 本地 Provider 配置只门禁客户端执行：server 偏好由 hosted System Default 解析、
  // 不消费本地 profile（两个执行位置正交，DESK-ONLINE-001/009）。
  const clientProfilesBlocked =
    target.location === 'client' && (profilesLoading || profilesError !== null);
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
    if (!guard.ready || busy || !executionMode || isReadingAttachments || blockedDraft) return;
    if (target.location === 'client' && !selected) return;
    if (!discardUnsavedResult) {
      if (session.hasUnsavedResult()) { setConfirmRegenerate('unsaved'); return; }
      // hosted-json 结果不确定时再次生成 = 可能的第二次调用，必须显式确认（D5.1a-r1）。
      if (state.phase === 'uncertain') { setConfirmRegenerate('uncertain'); return; }
    }
    try {
      setActionError(null);
      setActionInfo(null);
      void session.generate(
        { invoke, profileId: selected?.id ?? '' },
        {
          prompt: draft.prompt,
          schema: draft.schemaId,
          language: draft.selectedLanguage,
          attachments: toPromptAttachments(attachments),
        },
        { mode: executionMode, modelId: target.modelId ?? undefined, overrides: target.generationOverrides },
        discardUnsavedResult,
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '生成失败。');
    }
  };

  const card = state.card;
  const cardKind = state.cardKind;
  const resultJsonName = card ? resolveResultJsonFileName(card, cardKind) : 'data.json';
  const confirmCopy = confirmRegenerate === false ? null : describeRegenerateConfirm(confirmRegenerate);
  return (
    <div>
      <section data-testid="page-free" className="magic-background-white">
        <div className="container">
          <div className="card flex flex-col gap-5">
            <header>
              <h1 className="text-2xl font-semibold">自由生成</h1>
              <p className="mt-2 text-sm text-(--app-text-muted)">
                自由输入任意提示词，选择 Schema 后生成数据卡（角色 / 情景）。自由生成产物将被视为非原生卡（不生成签名）。
              </p>
            </header>
            <section aria-label="草稿" className="rounded-lg border border-(--app-border) p-4">
              <p>提示词、schema、生成方式与结果自动保存在本机页面草稿中，恢复草稿不会自动重新生成。</p>
              <p className="text-sm text-(--app-text-muted)">草稿不参与本地库整库备份或归档；保存到本地卡库的数据卡参与。附件不写入草稿。草稿上限为序列化后 4 Mi 字符，超出或写入失败时请保留当前页面。</p>
              {state.pendingRestore && <div role="status" className="mt-2 flex flex-wrap items-center gap-2"><span>发现上次草稿，请选择恢复或清除。</span><button className={actionClass} onClick={() => session.restoreDraft()}>恢复草稿</button></div>}
              {state.draftError && <p role="alert">{state.draftError}</p>}
              {!state.pendingRestore && <p role="status">{state.draftSaved ? '当前内容已保存或无待保存变更。' : '当前内容尚未保存到草稿。'}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {state.draftError && !session.isDraftBlocked() && <button className={actionClass} disabled={busy || state.pendingRestore} onClick={() => session.retryDraftSave()}>重试保存草稿</button>}
                <button className={actionClass} disabled={busy} onClick={() => setConfirmClear(true)}>清除草稿</button>
              </div>
              {confirmClear && <div role="group" aria-label="确认清除草稿" className="mt-3 rounded border p-3">
                <p>确认清除本页提示词、生成结果和中断正文？已保存的本地卡不受影响。此操作无法撤销。</p>
                <button className={actionClass} disabled={busy} onClick={() => { session.discardDraft(); clearAttachments(); setConfirmClear(false); }}>确认清除</button>
                <button className={actionClass} onClick={() => setConfirmClear(false)}>保留草稿</button>
              </div>}
            </section>
            {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
            {guard.message && <p role="alert">{guard.message}</p>}
            {profilesLoading && target.location === 'client' && <p role="status">正在读取本地 Provider 配置…</p>}
            {profilesError && <p role="alert">{target.location === 'server' ? '本地 Provider 配置加载失败，仅影响客户端执行。' : profilesError}</p>}
            <fieldset disabled={busy || blockedDraft} className="flex min-w-0 flex-col gap-4">
              <legend className="mb-2 font-semibold">生成设置</legend>
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
                controlsSlot={
                  <>
                    <div>
                      <GenerationModeSwitcher
                        // 客户端 Direct 固定走结构化通路：展示生效的「非流式」，
                        // 服务器侧的流式偏好不改写、切回服务器后恢复（D5.1-AIP-r1）。
                        value={target.location === 'client' ? 'non-stream' : draft.generationMode}
                        disabled={target.location === 'client'}
                        onChange={(next) => updateDraft({ generationMode: next })}
                        helper={false}
                      />
                      {target.location === 'client' && (
                        <p className="mt-1 text-sm text-(--app-text-muted)">
                          客户端执行为结构化（非流式）直出；你的服务器生成方式偏好保留，切回服务器后恢复。
                        </p>
                      )}
                    </div>
                    <label className="flex flex-col gap-1">选择 Schema
                      <select
                        aria-label="选择 Schema"
                        className="w-full rounded border border-(--app-border) bg-(--app-surface) px-3 py-2 text-(--app-text)"
                        value={draft.schemaId}
                        onChange={(event) => updateDraft({ schemaId: event.target.value as FreeSchemaId })}
                      >
                        {schemaOptionsForMode.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                      <span className="text-sm text-(--app-text-muted)">
                        {FREE_SCHEMA_OPTIONS.find((item) => item.id === draft.schemaId)?.description}
                      </span>
                    </label>
                    <div className="rounded-lg border border-(--app-border) p-3">
                      <button
                        type="button"
                        onClick={() => updateDraft({ showFieldGuide: !draft.showFieldGuide })}
                        className="flex w-full items-center justify-between text-left font-medium text-(--app-text)"
                      >
                        <span>Schema 字段说明（系统提示词）</span>
                        <span className="ml-2">{draft.showFieldGuide ? '▼' : '▶'}</span>
                      </button>
                      {draft.showFieldGuide && (
                        <div className="mt-3 rounded-lg border border-(--app-border) bg-(--app-surface) p-3 text-xs whitespace-pre-wrap">
                          {fieldGuideText}
                        </div>
                      )}
                    </div>
                  </>
                }
              />
              <div className="flex flex-col gap-1">
                <button type="button" className="flex items-center justify-between text-left font-medium" onClick={() => updateDraft({ showLanguageSection: !draft.showLanguageSection })}>
                  <span>生成语言</span><span className="ml-2">{draft.showLanguageSection ? '▼' : '▶'}</span>
                </button>
                {draft.showLanguageSection && (
                  <select aria-label="生成语言" className="w-full rounded border border-(--app-border) bg-(--app-surface) px-3 py-2 text-(--app-text)" value={draft.selectedLanguage} onChange={(event) => updateDraft({ selectedLanguage: event.target.value })}>
                    {(languages.length ? languages : [{ code: draft.selectedLanguage, name: draft.selectedLanguage }]).map((lang) => (
                      <option key={lang.code} value={lang.code}>{lang.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <label className="flex flex-col gap-1">提示词
                <textarea
                  aria-label="提示词"
                  value={draft.prompt}
                  onChange={(event) => updateDraft({ prompt: event.target.value })}
                  placeholder={FREE_PROMPT_PLACEHOLDER}
                  className="min-h-40 w-full resize-y rounded border border-(--app-border) bg-(--app-surface) px-3 py-2 text-(--app-text)"
                  rows={10}
                />
                <span className="text-xs text-(--app-text-muted)">
                  字符数：{draft.prompt.length}
                  {target.location === 'server'
                    ? `；服务器通路请求体（提示词 + 附件 + JSON 包装）上限 ${formatBytes(hostedGenerationBodyMaxBytes(draft.generationMode === 'stream' ? 'generate-free-stream' : 'generate-free'))}，超出会在派发前拦截`
                    : '；客户端执行的输入上限由所连模型服务自身决定'}
                </span>
              </label>
              <section aria-label="参考附件" className="flex flex-col gap-2 rounded-lg border border-(--app-border) p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">参考附件（可选）</span>
                  <span className="text-xs text-(--app-text-muted)">
                    {attachments.length} 个 · {totalAttachmentChars.toLocaleString()} 字符
                  </span>
                </div>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => void addAttachmentFiles(event.target.files)}
                />
                <div className="flex flex-wrap gap-2">
                  <button className={actionClass} disabled={isReadingAttachments} onClick={() => attachmentInputRef.current?.click()}>
                    {isReadingAttachments ? '正在读取附件…' : '添加附件'}
                  </button>
                  {attachments.length > 0 && <button className={actionClass} onClick={clearAttachments}>清空附件</button>}
                </div>
                <p className="text-xs text-(--app-text-muted)">
                  仅文本内容会随提示词发送；单文件 {formatBytes(FREE_GENERATION_ATTACHMENT_LIMITS.maxBytesPerFile)} / 全部 {formatBytes(FREE_GENERATION_ATTACHMENT_LIMITS.maxBytesTotal)} 上限，超长部分截断后标记「已截断」。
                </p>
                {attachmentError && <p role="alert">{attachmentError}</p>}
                {attachments.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {attachments.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-2 rounded border border-(--app-border) px-2 py-1 text-sm">
                        <span className="min-w-0 truncate">{item.name}{item.truncated ? '（已截断）' : ''} · {formatBytes(item.includedBytes)}</span>
                        <button className="text-(--app-accent-strong)" onClick={() => removeAttachment(item.id)}>移除</button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </fieldset>
            <TokenIndicator text={tokenEstimateText} />
            <div className="flex flex-wrap gap-2">
              <button className={actionClass} disabled={!guard.ready || busy || !draft.prompt.trim() || !executionMode || isReadingAttachments || (target.location === 'client' && !selected) || clientProfilesBlocked || blockedDraft} onClick={() => generate()}>{state.phase === 'generating' ? '正在生成…' : state.phase === 'idle' ? '生成数据卡' : '重新生成'}</button>
              {state.phase === 'generating' && <button className={actionClass} onClick={() => session.cancel()}>取消生成</button>}
            </div>
            <dialog ref={regenerateDialog} aria-labelledby="regenerate-title" aria-describedby="regenerate-description" className="m-auto max-w-lg rounded-lg border border-(--app-border) bg-(--app-surface) p-5 text-(--app-text) backdrop:bg-black/40" onCancel={(event) => { event.preventDefault(); if (!session.isBusy()) setConfirmRegenerate(false); }}>
              <h2 id="regenerate-title" className="text-xl font-semibold">{confirmCopy?.title ?? '重新生成？'}</h2>
              <p id="regenerate-description" className="my-3">{confirmCopy?.description}</p>
              {state.saveError && <p role="alert">{state.saveError}</p>}
              <div className="flex flex-wrap gap-2">
                <button autoFocus className={actionClass} disabled={busy} onClick={() => setConfirmRegenerate(false)}>取消</button>
                {confirmRegenerate === 'unsaved' && <button className={actionClass} disabled={busy} onClick={async () => { if (await session.saveResult()) { setConfirmRegenerate(false); generate(true); } }}>{state.saving ? '正在保存…' : '保存后重新生成'}</button>}
                <button className={actionClass} disabled={busy} onClick={() => { setConfirmRegenerate(false); generate(true); }}>确定重新生成</button>
              </div>
            </dialog>
            {actionError && <p role="alert">{actionError}</p>}
            {actionInfo && <p role="status">{actionInfo}</p>}
            {state.message && <p role={state.phase === 'uncertain' ? 'alert' : 'status'}>{state.message}</p>}
            {state.reasoning && <AiReasoningPanel reasoning={state.reasoning} />}
            <div ref={resultSectionRef}>
              {card && <section aria-label="生成结果" className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold">生成结果 · 未签名（自由生成为非原生卡）</h2>
                {cardKind === 'magical-girl' && <MagicalGirlCard magicalGirl={card as unknown as MagicalGirlCardData} gradientStyle="linear-gradient(135deg, #9775fa 0%, #b197fc 100%)" />}
                {cardKind === 'canshou' && <CanshouCard canshou={card as unknown as CanshouDetails} />}
                {cardKind === 'general' && <GeneralCharacterCard general={card as unknown as GeneralCharacterCardData} />}
                {cardKind === 'general-scenario' && (
                  <div className="rounded-lg border border-(--app-border) p-4">
                    <h3 className="text-xl font-semibold text-center">{typeof card.title === 'string' && card.title ? card.title : '通用情景卡'}</h3>
                    <div className="mt-3 rounded-lg bg-(--app-surface) p-4">
                      <MarkdownBlock content={typeof card.content === 'string' ? card.content : ''} variant="light" mode="article" />
                    </div>
                  </div>
                )}
                {cardKind === 'scenario' && (
                  <div className="rounded-lg border border-(--app-border) p-4">
                    <h3 className="text-xl font-semibold text-center">{typeof card.title === 'string' && card.title ? card.title : '结构化情景'}</h3>
                    <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-3 font-mono text-xs">{JSON.stringify(card, null, 2)}</pre>
                  </div>
                )}
                <button className={actionClass} disabled={!guard.ready || busy || state.saveStatus === 'saved' || state.saveStatus === 'already-present'} onClick={() => { if (guard.ready) void session.saveResult(); }}>{state.saving ? '正在保存…' : '保存到本地卡库'}</button>
                {state.saveStatus === 'saved' && <p role="status">已保存到本地卡库。</p>}
                {state.saveStatus === 'already-present' && <p role="status">本地卡库已存在相同内容，原记录保持不变。</p>}
                {state.saveError && <p role="alert">{state.saveError}</p>}
                <section aria-label="保存原始数据" className="rounded-lg border border-(--app-border) p-4">
                  <h3 className="text-lg font-medium">保存数据卡</h3>
                  <div className="mt-3 flex flex-col gap-3">
                    <SaveJsonButton
                      data={card}
                      mode={jsonSaveMode}
                      recommendedMode={recommended.jsonSaveMode}
                      resolveFileName={() => resultJsonName}
                    />
                    <button className={actionClass} onClick={() => downloadTextFile(resultJsonName, JSON.stringify(card, null, 2))}>下载 JSON 文件</button>
                    <button className={actionClass} onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(card, null, 2)).then(() => setActionInfo('✅ 数据卡 JSON 已复制到剪贴板')).catch(() => setActionError('复制失败，请手动选择 JSON 内容后复制。')); }}>复制到剪贴板</button>
                  </div>
                  <JsonSizeIndicator
                    data={card}
                    maxBytes={MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES}
                    hintText="按 UTF-8 字节估算，对照本地卡单条记录上限"
                    warningText="⚠️ 接近本地卡单条上限（4 MiB），保存到本地卡库可能失败，请先精简数据。"
                  />
                </section>
              </section>}
            </div>
            {state.rawText && <details open={state.phase !== 'completed'}><summary>原始输出正文</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-3">{state.rawText}</pre></details>}
          </div>
          <ProductFooter
            assetSource={DESKTOP_ASSET_SOURCE}
            onNavigateInternal={(href) => navigateByProductHref(router, href)}
            resolveInternalHref={resolveInternalHrefForHashHistory}
            onNavigateExternal={openFixed}
          />
        </div>
      </section>
    </div>
  );
}

export function DesktopFree() {
  const [session, setSession] = useState<FreeSession | null>(null);
  useEffect(() => {
    const owner = new FreeSession({
      storage: { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: (key) => window.localStorage.removeItem(key) },
      repository: new IpcLocalCardRepository(invoke),
      initialDraft: { schemaId: 'general', generationMode: 'non-stream', prompt: '', selectedLanguage: FREE_DRAFT_DEFAULT_LANGUAGE },
    });
    setSession(owner);
    const onPageHide = () => owner.cancel();
    window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); owner.dispose(); };
  }, []);
  return session ? <FreeForm session={session} /> : <p role="status">正在准备草稿…</p>;
}
