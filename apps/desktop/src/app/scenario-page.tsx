import { generationActionClassNames } from '@mahoshojo/ui-web/generation-actions';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from '@tanstack/react-router';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
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
import { MarkdownBlock } from '@mahoshojo/ui-web/markdown';
import {
  ScenarioPageLayout,
  ScenarioResultSurface,
  ScenarioTitleField,
  ScenarioQuestionFields,
  ScenarioBlankFields,
  ScenarioLanguageField,
  createInitialScenarioAnswers as createInitialAnswers,
  hasAnyScenarioAnswer as hasAnyAnswer,
} from '@mahoshojo/ui-web/scenario';
import { ProductFooter } from '@mahoshojo/ui-web/shell';
import type { HomeAssetSource } from '@mahoshojo/ui-web/home';
import {
  ScenarioSession,
  SCENARIO_DRAFT_DEFAULT_LANGUAGE,
  type ScenarioDraft,
} from '../features/scenario/session';
import type { ScenarioCardKind, ScenarioExecutionMode } from '../features/scenario/generation';
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

const resolveResultJsonFileName = (card: Record<string, unknown>): string => {
  const label = typeof card.title === 'string' && card.title
    ? card.title
    : typeof card.name === 'string' && card.name
      ? card.name
      : '自定义情景';
  return `${card.templateId === '通用情景' ? '通用情景' : '情景'}_${sanitizeFileNamePart(label)}.json`;
};

type ConfirmRegenerateKind = 'unsaved' | 'uncertain';

/** 「重新生成」确认文案——与 `/free`、`/canshou` 同一套语义。 */
const describeRegenerateConfirm = (kind: ConfirmRegenerateKind): { title: string; description: string } => ({
  title: '重新生成？',
  description: kind === 'unsaved'
    ? '当前结果尚未保存到本地卡库。重新生成将替换当前结果；即使新生成失败或取消，也无法恢复。可以先保存当前结果再生成。'
    : '无法确认上次请求是否在服务器执行——它可能已经完成并计费。再次生成会发起新的请求，可能产生重复调用与费用。',
});

function ScenarioForm({ session }: { session: ScenarioSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
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
  const updateDraft = (patch: Partial<ScenarioDraft>) => {
    session.updateDraft({ ...session.getSnapshot().draft, ...patch });
  };
  // 流式情景产物是「通用情景卡」（Markdown），与结构化卡不同型；客户端
  // direct 通路永远结构化（DESK-ONLINE-009）。D5.1-AIP-r1：不再改写草稿
  // 里的流式偏好——`effectiveGenerationMode` 表达「实际生效」方式，
  // 切回服务器后原偏好自动恢复。
  const effectiveGenerationMode =
    target.location === 'client' ? 'non-stream' : draft.generationMode;
  const mode = target.mode;
  const busy = state.phase === 'generating' || state.saving || aiState.generationActive;
  useEffect(() => () => aiStore.cancelPreparingGeneration(), [aiStore]);
  const blockedDraft = state.pendingRestore || session.isDraftBlocked();
  // 「客户端｜服务器」与「流式｜非流式」两个维度共同决定执行模式（DESK-ONLINE-009）：
  // 流式/非流式只影响 hosted 路由选择，direct 通路始终为结构化生成。
  const hostedMode: ScenarioExecutionMode = draft.generationMode === 'stream' ? 'hosted-stream' : 'hosted-json';
  const executionMode: ScenarioExecutionMode | null = target.location === 'server' ? hostedMode : mode;
  // 本地 Provider 配置只门禁客户端执行：server 偏好由 hosted System Default 解析、
  // 不消费本地 profile（两个执行位置正交，DESK-ONLINE-001/009）。
  const clientProfilesBlocked =
    target.profile !== null && (profilesLoading || profilesError !== null);
  const recommended = recommendedSaveModes(deviceType === 'mobile');
  const jsonSaveMode = recommended.jsonSaveMode;
  const tokenEstimateText = useMemo(
    () => [...Object.values(draft.answers), draft.scenarioTitleHint].filter((item) => item.trim()).join('\n\n'),
    [draft.answers, draft.scenarioTitleHint],
  );

  const toggleKeepEmpty = (fieldValue: string) => {
    updateDraft({
      fieldsToKeepEmpty: draft.fieldsToKeepEmpty.includes(fieldValue)
        ? draft.fieldsToKeepEmpty.filter((item) => item !== fieldValue)
        : [...draft.fieldsToKeepEmpty, fieldValue],
    });
  };

  const generate = (discardUnsavedResult = false) => {
    // 悬空选择（含服务器侧被目录移除的系统模型）保留诊断值但禁止派发——
    // unavailableReason 与按钮 disabled 必须同口径（D5.1-AIP-r1-r1）。
    if (!guard.ready || busy || !executionMode || blockedDraft || target.unavailableReason !== null) return;
    if (target.location === 'client' && !target.providerTarget) return;
    if (!discardUnsavedResult) {
      if (session.hasUnsavedResult()) { setConfirmRegenerate('unsaved'); return; }
      // hosted-json 结果不确定时再次生成 = 可能的第二次调用，必须显式确认（D5.1a-r1）。
      if (state.phase === 'uncertain') { setConfirmRegenerate('uncertain'); return; }
    }
    try {
      setActionError(null);
      setActionInfo(null);
      void aiStore.withPreparedGeneration(async (prepared) => { await session.generate(
        { invoke, profileId: prepared.profile?.id ?? '', providerTarget: prepared.providerTarget },
        {
          answers: { ...draft.answers },
          language: draft.selectedLanguage,
          fieldsToKeepEmpty: [...draft.fieldsToKeepEmpty],
          // titleHint 仅流式语义（本地卡兜底 + hosted 请求字段），按生效方式门控。
          titleHint: effectiveGenerationMode === 'stream' ? draft.scenarioTitleHint : '',
        },
        { mode: prepared.location === 'server' ? hostedMode : prepared.mode!, modelId: prepared.modelId ?? undefined, overrides: prepared.generationOverrides },
        discardUnsavedResult,
      );
      }).catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'AI 配置准备失败'));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '生成失败。');
    }
  };

  const card = state.card;
  const cardKind: ScenarioCardKind = state.cardKind;
  const resultJsonName = card ? resolveResultJsonFileName(card) : 'data.json';
  const confirmCopy = confirmRegenerate === false ? null : describeRegenerateConfirm(confirmRegenerate);
  // 签名标签与本地保存消费同一份会话层投影（G2-r1 复审）：签名字段是否
  // 存在、是否本会话 hosted-json 意图的新鲜响应、是否从可编辑草稿恢复，
  // 统一由会话层判定——页面不再各自读签名字段自行推断（details/canshou 同）。
  const resultSignatureLabel = session.resultSignatureKind() === 'official-signed'
    ? '官方签名（服务器生成）'
    : session.resultSignatureKind() === 'signature-unverified'
      ? '含签名字段（本机未验证）'
      : '未签名（非原生卡）';
  return (
    <ScenarioPageLayout
      onNavigate={(href) => navigateByProductHref(router, href)}
      resolveInternalHref={resolveInternalHrefForHashHistory}
      controls={(
        <div className="space-y-6">
            <section aria-label="草稿" className="rounded-lg border border-(--app-border) p-4">
              <p>回答、生成方式与结果自动保存在本机页面草稿中，恢复草稿不会自动重新生成。</p>
              <p className="text-sm text-(--app-text-muted)">草稿不参与本地库整库备份或归档；保存到本地卡库的数据卡参与。草稿上限为序列化后 4 Mi 字符，超出或写入失败时请保留当前页面。</p>
              {state.pendingRestore && <div role="status" className="mt-2 flex flex-wrap items-center gap-2"><span>发现上次草稿，请选择恢复或清除。</span><button className={actionClass} onClick={() => session.restoreDraft()}>恢复草稿</button></div>}
              {state.draftError && <p role="alert">{state.draftError}</p>}
              {!state.pendingRestore && <p role="status">{state.draftSaved ? '当前内容已保存或无待保存变更。' : '当前内容尚未保存到草稿。'}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {state.draftError && !session.isDraftBlocked() && <button className={actionClass} disabled={busy || state.pendingRestore} onClick={() => session.retryDraftSave()}>重试保存草稿</button>}
                <button className={actionClass} disabled={busy} onClick={() => setConfirmClear(true)}>清除草稿</button>
              </div>
              {confirmClear && <div role="group" aria-label="确认清除草稿" className="mt-3 rounded border p-3">
                <p>确认清除本页回答、生成结果和中断正文？已保存的本地卡不受影响。此操作无法撤销。</p>
                <button className={generationActionClassNames.destructive} disabled={busy} onClick={() => { session.discardDraft(); setConfirmClear(false); }}>确认清除</button>
                <button className={actionClass} onClick={() => setConfirmClear(false)}>保留草稿</button>
              </div>}
            </section>
            {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
            {guard.message && <p role="alert">{guard.message}</p>}
            {profilesLoading && target.location === 'client' && <p role="status">正在读取本地 Provider 配置…</p>}
            {profilesError && <p role="alert">{target.location === 'server' ? '本地 Provider 配置加载失败，仅影响客户端执行。' : profilesError}</p>}
            <fieldset disabled={busy || blockedDraft} className="min-w-0">
              <legend className="sr-only">情景要素</legend>
              <div className="space-y-6">
                <ScenarioTitleField value={draft.scenarioTitleHint} onChange={(scenarioTitleHint) => updateDraft({ scenarioTitleHint })} />
                <ScenarioQuestionFields answers={draft.answers} onChange={(label, value) => updateDraft({ answers: { ...draft.answers, [label]: value } })} />
              </div>
              <ScenarioBlankFields expanded={draft.isAdvancedVisible === true} onToggle={() => updateDraft({ isAdvancedVisible: !draft.isAdvancedVisible })} fields={draft.fieldsToKeepEmpty} onChange={toggleKeepEmpty} />
            </fieldset>
            <fieldset disabled={busy || blockedDraft} className="flex min-w-0 flex-col gap-4">
              <legend className="mb-2 font-semibold">生成设置</legend>
              <DesktopAiProviderPanel
                generationMode={draft.generationMode}
                copy={{
                  serverOutput: {
                    stream: 'Markdown 流式输出（通用情景卡，未签名）',
                    nonStream: '结构化 JSON 输出（服务器签名）',
                  },
                  emptyProfilesHint: '回答可以先填写，配置加载后再生成。',
                  serverFootnote:
                    '不使用客户端连接与凭据（由服务器侧系统默认配置解析）。切换执行位置不会丢失已填写的回答。',
                  payloadNoun: '情景回答',
                }}
                controlsSlot={
                  <>
                  <div>
                    <GenerationModeSwitcher
                      // 客户端 Direct 固定走结构化通路：展示生效的「非流式」，
                      // 服务器侧的流式偏好不改写、切回服务器后恢复（D5.1-AIP-r1）。
                      value={effectiveGenerationMode}
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
                  <ScenarioLanguageField
                    value={draft.selectedLanguage}
                    languages={languages.length ? languages : [{ code: draft.selectedLanguage, name: draft.selectedLanguage }]}
                    onChange={(selectedLanguage) => updateDraft({ selectedLanguage })}
                  />
                  </>
                }
              />
            </fieldset>
            <TokenIndicator text={tokenEstimateText} />
            <div className="flex flex-wrap gap-2">
              <button className="generate-button" disabled={!guard.ready || busy || !hasAnyAnswer(draft.answers) || !executionMode || target.unavailableReason !== null || (target.location === 'client' && !target.providerTarget) || clientProfilesBlocked || blockedDraft} onClick={() => generate()}>{state.phase === 'generating' ? '正在生成…' : state.phase === 'idle' ? '生成情景' : '重新生成'}</button>
              {state.phase === 'generating' && <button className={actionClass} onClick={() => session.cancel()}>取消生成</button>}
                  {aiState.generationActive && aiStore.isPreparingGeneration() && <button className={actionClass} onClick={() => {
                    aiStore.cancelPreparingGeneration();
                    setActionInfo('尚未派发的生成已取消；已保存的 API Key 将保留，系统凭据操作结束后可重试。');
                  }}>取消准备</button>}
            </div>
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

        </div>
      )}
      results={card || state.rawText || state.reasoning ? (
        <div className="space-y-6">
            {state.reasoning && <AiReasoningPanel reasoning={state.reasoning} />}
            <div ref={resultSectionRef}>
              {card && <ScenarioResultSurface label="生成结果">
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-(--app-text-muted)">生成结果 · {resultSignatureLabel}</p>
                  {cardKind === 'general-scenario' && (
                    <>
                      <h2 className="text-2xl font-bold text-center mb-4">{typeof card.title === 'string' && card.title ? card.title : '通用情景卡'}</h2>
                      <MarkdownBlock content={typeof card.content === 'string' ? card.content : ''} variant="light" mode="article" />
                    </>
                  )}
                  {cardKind === 'scenario' && (
                    <>
                      <h2 className="text-2xl font-bold text-center mb-4">{typeof card.title === 'string' && card.title ? card.title : '结构化情景'}</h2>
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-(--app-border-strong) bg-(--app-surface-strong) p-4 font-mono text-xs">{JSON.stringify(card, null, 2)}</pre>
                    </>
                  )}
                  <button className={generationActionClassNames.primary} disabled={!guard.ready || busy || state.saveStatus === 'saved' || state.saveStatus === 'already-present'} onClick={() => { if (guard.ready) void session.saveResult(); }}>{state.saving ? '正在保存…' : '保存到本地卡库'}</button>
                  {state.saveStatus === 'saved' && <p role="status">已保存到本地卡库。</p>}
                  {state.saveStatus === 'already-present' && <p role="status">本地卡库已存在相同内容，原记录保持不变。</p>}
                  {state.saveError && <p role="alert">{state.saveError}</p>}
                  <section aria-label="保存原始数据" className="mt-3">
                    <h3 className="text-lg font-medium">保存数据卡</h3>
                    <div className="mt-3 flex flex-col gap-3">
                      <SaveJsonButton
                        data={card}
                        mode={jsonSaveMode}
                        recommendedMode={recommended.jsonSaveMode}
                        resolveFileName={() => resultJsonName}
                        downloadJson={downloadTextFile}
                      />
                      {jsonSaveMode === 'text' && <button className={actionClass} onClick={() => downloadTextFile(resultJsonName, JSON.stringify(card, null, 2))}>下载 JSON 文件</button>}
                      <button className={actionClass} onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(card, null, 2)).then(() => setActionInfo('✅ 数据卡 JSON 已复制到剪贴板')).catch(() => setActionError('复制失败，请手动选择 JSON 内容后复制。')); }}>复制到剪贴板</button>
                    </div>
                    <JsonSizeIndicator
                      data={card}
                      maxBytes={MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES}
                      hintText="按 UTF-8 字节估算，对照本地卡单条记录上限"
                      warningText="⚠️ 接近本地卡单条上限（4 MiB），保存到本地卡库可能失败，请先精简数据。"
                    />
                  </section>
                </div>
              </ScenarioResultSurface>}
            </div>
            {state.rawText && <details open={state.phase !== 'completed'}><summary>原始输出正文</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-3">{state.rawText}</pre></details>}
        </div>
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

export function DesktopScenario() {
  const [session, setSession] = useState<ScenarioSession | null>(null);
  useEffect(() => {
    const owner = new ScenarioSession({
      storage: { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: (key) => window.localStorage.removeItem(key) },
      repository: new IpcLocalCardRepository(invoke),
      initialDraft: {
        answers: createInitialAnswers(),
        fieldsToKeepEmpty: [],
        scenarioTitleHint: '',
        generationMode: 'non-stream',
        selectedLanguage: SCENARIO_DRAFT_DEFAULT_LANGUAGE,
      },
    });
    setSession(owner);
    const onPageHide = () => owner.cancel();
    window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); owner.dispose(); };
  }, []);
  return session ? <ScenarioForm session={session} /> : <p role="status">正在准备草稿…</p>;
}
