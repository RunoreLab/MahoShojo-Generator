import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from '@tanstack/react-router';
import { getModelGenerationCapabilities } from '@mahoshojo/ai-core/generation-settings';
import {
  formatReferenceAttachmentsForPrompt,
  FREE_GENERATION_ATTACHMENT_LIMITS,
} from '@mahoshojo/ai-core/reference-attachments';
import { FREE_STREAM_SCHEMA_IDS, type FreeSchemaId } from '@mahoshojo/ai-core/free-generation';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { hostedGenerationBodyMaxBytes } from '@mahoshojo/contracts/desktop-cloud';
import { AiExecutionLocationField, AdvancedGenerationSettings } from '@mahoshojo/ui-web/ai-provider';
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
import { MarkdownBlock } from '@mahoshojo/ui-web/markdown';
import { ProductFooter } from '@mahoshojo/ui-web/shell';
import type { HomeAssetSource } from '@mahoshojo/ui-web/home';
import { FreeSession, FREE_DRAFT_DEFAULT_LANGUAGE, type FreeDraft } from '../features/free/session';
import {
  acceptAttachmentsWithinBudget,
  readFreeAttachmentFiles,
  toPromptAttachments,
  type FreeAttachmentState,
} from '../features/free/attachments';
import type { FreeExecutionMode } from '../features/free/generation';
import { resolveDesktopAiTarget } from '../features/ai-config/desktop-ai-config';
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

const SCHEMA_OPTIONS: ReadonlyArray<{ id: FreeSchemaId; label: string; description: string; kind: 'character' | 'scenario' }> = [
  { id: 'magical-girl', label: '魔法少女（结构化）', description: '完整字段结构，适合后续升华/竞技场联动；自由生成产物为非原生。', kind: 'character' },
  { id: 'canshou', label: '残兽（结构化）', description: '完整字段结构，适合后续升华/竞技场联动；自由生成产物为非原生。', kind: 'character' },
  { id: 'general', label: '通用角色卡（Markdown）', description: '只有 name/content，适合自由发挥与长线维护。', kind: 'character' },
  { id: 'scenario', label: '情景（结构化）', description: 'elements 结构化字段，适合与竞技场/进阶玩法联动。', kind: 'scenario' },
  { id: 'general-scenario', label: '通用情景卡（Markdown）', description: '只有 title/content，适合自由发挥与长线维护。', kind: 'scenario' },
];

/** UI 用字段速览——与 Web `FreePage.buildFieldGuideForUi` 同一文案。 */
const buildFieldGuideForUi = (schemaId: FreeSchemaId): string => {
  switch (schemaId) {
    case 'magical-girl':
      return [
        '魔法少女（结构化）字段速览：',
        '- codename：代号（建议花名/称号）',
        '- appearance：外观（outfit/accessories/colorScheme/overallLook，可选）',
        '- magicConstruct：魔装（name/form/basicAbilities/description，可选）',
        '- wonderlandRule：奇境规则（name/description/tendency/activation，可选）',
        '- blooming：繁开（name/evolvedAbilities/evolvedForm/evolvedOutfit/powerLevel，可选）',
        '- analysis：分析（personalityAnalysis/abilityReasoning/coreTraits/predictionBasis/background，可选）',
        '注意：自由生成不会生成 signature，因此会被视为非原生卡。',
      ].join('\n');
    case 'canshou':
      return [
        '残兽（结构化）字段速览：',
        '- name：名称',
        '- appearance/materialAndSkin/featuresAndAppendages/coreConcept/coreEmotion/evolutionStage/attackMethod/specialAbility/origin/birthEnvironment/researcherNotes（均可选）',
        '注意：自由生成不会生成 signature，因此会被视为非原生卡。',
      ].join('\n');
    case 'scenario':
      return [
        '情景（结构化）字段速览：',
        '- title：标题（必需）',
        '- scenario_type/description（可选）',
        '- elements：必需',
        '  - scene.time/place/features（可选）',
        '  - roles：可选数组，每项包含 name/description（可选）',
        '  - events/atmosphere/development（可选）',
        '注意：自由生成不会生成 signature，因此会被视为非原生卡。',
      ].join('\n');
    case 'general':
      return [
        '通用角色卡字段速览：',
        '- templateId：固定为 通用角色',
        '- name：角色名',
        '- content：正文（建议 Markdown）',
      ].join('\n');
    case 'general-scenario':
      return [
        '通用情景卡字段速览：',
        '- templateId：固定为 通用情景',
        '- title：情景名',
        '- content：正文（建议 Markdown）',
      ].join('\n');
    default:
      return '';
  }
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
};

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
  const { state: aiState, store: aiStore } = useDesktopAiConfig();
  const target = resolveDesktopAiTarget(
    aiState.selection,
    aiState.profiles,
    aiState.generationOverrides,
  );
  const profilesLoading = aiState.profilesState === 'idle' || aiState.profilesState === 'loading';
  const profilesError = aiState.profilesState === 'failed' ? aiState.profilesError : null;
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [attachments, setAttachments] = useState<FreeAttachmentState[]>([]);
  const [isReadingAttachments, setIsReadingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  // 附件读取代际与最新清单镜像：清空/移除/丢弃草稿/离开页面都会失效在途
  // 读取——迟到结果不得重新加回用户已显式放弃的内容；合并前再按真实余量
  // 复核总量预算（读取按开始时快照计费，G2-r1）。
  const attachmentReadEpoch = useRef(0);
  const attachmentsRef = useRef<FreeAttachmentState[]>([]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => () => { attachmentReadEpoch.current += 1; }, []);
  const invalidateAttachmentReads = () => {
    attachmentReadEpoch.current += 1;
    setIsReadingAttachments(false);
  };
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
  const schemaOptionsForMode = draft.generationMode === 'stream'
    ? SCHEMA_OPTIONS.filter((item) => (FREE_STREAM_SCHEMA_IDS as readonly string[]).includes(item.id))
    : SCHEMA_OPTIONS;
  const fieldGuideText = useMemo(() => buildFieldGuideForUi(draft.schemaId), [draft.schemaId]);
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
  const targetCapabilities = selected
    ? getModelGenerationCapabilities(selected.id, selected.modelId)
    : undefined;
  const recommended = recommendedSaveModes(deviceType === 'mobile');
  const jsonSaveMode = recommended.jsonSaveMode;
  const totalAttachmentChars = useMemo(
    () => attachments.reduce((sum, item) => sum + item.content.length, 0),
    [attachments],
  );
  const tokenEstimateText = useMemo(() => {
    const blocks: string[] = [];
    if (draft.prompt.trim()) blocks.push(draft.prompt);
    const attachmentsText = formatReferenceAttachmentsForPrompt(toPromptAttachments(attachments));
    if (attachmentsText.trim()) blocks.push(attachmentsText);
    return blocks.join('\n\n');
  }, [attachments, draft.prompt]);

  const handleAddAttachments = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const epoch = attachmentReadEpoch.current;
    setIsReadingAttachments(true);
    setAttachmentError(null);
    try {
      const { added, skipped } = await readFreeAttachmentFiles(files, attachmentsRef.current);
      // 读取期间清单被用户改动过（清空/移除/丢弃草稿/离开页面）：
      // 迟到结果一律丢弃，不得重新加回用户已显式放弃的内容。
      if (attachmentReadEpoch.current !== epoch) return;
      // 合并前复核总量预算：读取按开始时的快照计费，此间余量可能已变。
      const { dropped } = acceptAttachmentsWithinBudget(attachmentsRef.current, added);
      if (skipped + dropped > 0) {
        setAttachmentError(`⚠️ 附件总量超过限制：已忽略 ${skipped + dropped} 个文件（总上限 ${formatBytes(FREE_GENERATION_ATTACHMENT_LIMITS.maxBytesTotal)} / ${FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsTotal.toLocaleString()} 字符）。`);
      }
      if (added.length > 0) {
        setAttachments((prev) => {
          const { accepted } = acceptAttachmentsWithinBudget(prev, added);
          return accepted.length > 0 ? [...prev, ...accepted] : prev;
        });
      }
    } catch (error) {
      if (attachmentReadEpoch.current !== epoch) return;
      setAttachmentError(`⚠️ 附件读取失败：${error instanceof Error ? error.message : '读取失败'}`);
    } finally {
      if (attachmentReadEpoch.current === epoch) setIsReadingAttachments(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  };

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
        { mode: executionMode, modelId: selected?.modelId, overrides: target.generationOverrides },
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
                <button className={actionClass} disabled={busy} onClick={() => { session.discardDraft(); invalidateAttachmentReads(); setAttachments([]); setAttachmentError(null); setConfirmClear(false); }}>确认清除</button>
                <button className={actionClass} onClick={() => setConfirmClear(false)}>保留草稿</button>
              </div>}
            </section>
            {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
            {guard.message && <p role="alert">{guard.message}</p>}
            {profilesLoading && target.location === 'client' && <p role="status">正在读取本地 Provider 配置…</p>}
            {profilesError && <p role="alert">{target.location === 'server' ? '本地 Provider 配置加载失败，仅影响客户端执行。' : profilesError}</p>}
            <fieldset disabled={busy || blockedDraft} className="flex min-w-0 flex-col gap-4">
              <legend className="mb-2 font-semibold">生成设置</legend>
              <AiExecutionLocationField
                value={target.location}
                client={{ enabled: true }}
                server={{ enabled: true }}
                onChange={(location) => aiStore.selectExecutionLocation(location)}
              />
              <div>
                <GenerationModeSwitcher
                  value={draft.generationMode}
                  disabled={target.location === 'client'}
                  onChange={(next) => updateDraft({ generationMode: next })}
                />
                {target.location === 'client' && (
                  <p className="mt-1 text-sm text-(--app-text-muted)">
                    客户端执行仅支持结构化（非流式）生成；流式通用卡需经服务器通路。
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
                  {SCHEMA_OPTIONS.find((item) => item.id === draft.schemaId)?.description}
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
              <label className="flex flex-col gap-1">AI 连接
                <select
                  aria-label="AI 连接"
                  className="w-full rounded border border-(--app-border) bg-(--app-surface) px-3 py-2 text-(--app-text)"
                  value={aiState.selection.clientConnectionId ?? ''}
                  disabled={aiState.overlayState !== 'ready'}
                  onChange={(event) => {
                    // 生成入口选连接=立即用它执行：两个维度一起显式落定。
                    if (event.target.value) {
                      aiStore.selectClientConnection(event.target.value);
                      aiStore.selectExecutionLocation('client');
                    }
                  }}
                >
                  {aiState.selection.clientConnectionId === null && <option value="">未选择连接</option>}
                  {aiState.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.modelId}</option>)}
                </select>
              </label>
              {target.location === 'client' && !profilesLoading && !aiState.profiles.length && !profilesError && <p>请先在设置中保存 Provider。提示词可以先填写，配置加载后再生成。</p>}
              {target.location === 'server' && <div className="rounded border border-(--app-border) p-3">
                <p>服务器 · 云端：由项目服务在服务器侧生成，{draft.generationMode === 'stream' ? 'Markdown 流式输出（仅通用角色/通用情景卡，未签名）' : '结构化 JSON 输出（无签名）'}。</p>
                <p>不使用客户端连接与高级模型参数（由服务器侧 System Default 解析）。切换执行位置不会丢失已填写的提示词。</p>
              </div>}
              {target.location === 'client' && target.unavailableReason && <p role="status">{target.unavailableReason}</p>}
              {target.location === 'client' && selected && mode && <div className="rounded border border-(--app-border) p-3">
                <p>{mode === 'direct-local' ? '客户端 · 本机：发送到本机模型服务' : '客户端 · 远端：发送到你指定的外部模型服务'}</p>
                <p className="break-all">接收方：{selected.baseUrl}</p>
                <p>模型：{selected.modelId}。点击生成会发送提示词与附件；结果不带官方签名。</p>
              </div>}
              {/* 高级参数只随 direct 通路下发（hosted 在服务器侧解析）：仅客户端执行时展示。 */}
              {target.location === 'client' && selected && mode && <AdvancedGenerationSettings
                value={target.generationOverrides}
                onChange={(next) => aiStore.setGenerationOverrides(selected.id, selected.modelId, next)}
                temperatureSupported={targetCapabilities ? targetCapabilities.temperature.support !== 'unsupported' : true}
                temperatureMax={targetCapabilities?.temperature.max}
                maxOutputTokensMax={targetCapabilities?.maxOutputTokens.max}
                thinkingSupport={targetCapabilities?.thinking.support ?? 'unknown'}
                thinkingEfforts={targetCapabilities?.thinking.efforts}
                canDisableThinking={targetCapabilities
                  ? targetCapabilities.thinking.support === 'supported' && targetCapabilities.thinking.canDisable !== false
                  : true}
              />}
              <div className="flex flex-col gap-1">
                <button type="button" className="flex items-center justify-between text-left font-medium" onClick={() => updateDraft({ showLanguageSection: !draft.showLanguageSection })}>
                  <span>输出语言</span><span className="ml-2">{draft.showLanguageSection ? '▼' : '▶'}</span>
                </button>
                {draft.showLanguageSection && (
                  <select aria-label="输出语言" className="w-full rounded border border-(--app-border) bg-(--app-surface) px-3 py-2 text-(--app-text)" value={draft.selectedLanguage} onChange={(event) => updateDraft({ selectedLanguage: event.target.value })}>
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
                  placeholder="在这里写你的完整提示词：你想要的风格、设定、限制、字段填充偏好等都由你决定。"
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
                  onChange={(event) => void handleAddAttachments(event.target.files)}
                />
                <div className="flex flex-wrap gap-2">
                  <button className={actionClass} disabled={isReadingAttachments} onClick={() => attachmentInputRef.current?.click()}>
                    {isReadingAttachments ? '正在读取附件…' : '添加附件'}
                  </button>
                  {attachments.length > 0 && <button className={actionClass} onClick={() => { invalidateAttachmentReads(); setAttachments([]); setAttachmentError(null); if (attachmentInputRef.current) attachmentInputRef.current.value = ''; }}>清空附件</button>}
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
                        <button className="text-(--app-accent-strong)" onClick={() => { invalidateAttachmentReads(); setAttachments((prev) => prev.filter((entry) => entry.id !== item.id)); }}>移除</button>
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
