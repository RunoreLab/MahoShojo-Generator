import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link, useRouter } from '@tanstack/react-router';
import { getModelGenerationCapabilities } from '@mahoshojo/ai-core/generation-settings';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { generateRandomCanshou } from '@mahoshojo/domain/random-character';
import {
  buildQuestionnaireAnswerLookup,
  getAnswerLimitInfo,
  hasOverLimitQuestionnaireAnswers,
  isAnswerOverLimit,
  QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS,
  type QuestionnaireAnswerMatchTarget,
} from '@mahoshojo/domain/questionnaire';
import {
  buildQuestionnaireFlow,
  MAX_QUESTIONNAIRE_IMPORT_BYTES,
  normalizeQuestionnaireDefinition,
  resolveQuestionnaireReferences,
  type QuestionnairePresetEntry,
} from '@mahoshojo/domain/questionnaire-definition';
import { exceedsUtf8ByteLimit } from '@mahoshojo/domain/data-card-size';
import {
  buildQuestionnaireAnswerExportText,
  collectQuestionnaireAnswerExportItems,
} from '@mahoshojo/domain/questionnaire-answer-export';
import {
  applyQuestionnaireSelection,
  buildQuestionnaireContextItems,
  buildQuestionnaireSelectionLoreText,
  isQuestionnaireGenerationNativeSignatureAllowed,
  isQuestionnaireSelectionNativeAllowed,
  reconcileQuestionnaireSelectionsForSingleMode,
  remapAnswersToQuestionnaireChange,
  removeQuestionnaireSelection,
  setQuestionnaireSelectionLore,
  type QuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';
import { AiExecutionLocationField, AdvancedGenerationSettings } from '@mahoshojo/ui-web/ai-provider';
import {
  AiReasoningPanel,
  AnswerReviewList,
  APP_SAVE_PREFERENCES_THEME,
  CANSHOU_LORE_PANEL_APP_THEME,
  BulkAnswerTools,
  CanshouLorePanel,
  DetailsIntroSection,
  DetailsSavePreferencesPanel,
  GenerationModeSwitcher,
  JsonSizeIndicator,
  QuestionnaireAnswerExportPanel,
  QuestionNavigator,
  isMobileFormFactor,
  recommendedSaveModes,
  SaveJsonButton,
  useResultAutoScroll,
  type GenerationMode,
} from '@mahoshojo/ui-web/details-controls';
import {
  CANSHOU_QUESTIONNAIRE_THEME,
  CANSHOU_SELECTION_THEME,
  QuestionnaireQuestionPanel,
  QuestionnaireSelectionPanel,
} from '@mahoshojo/ui-web/questionnaire';
import { CanshouCard, GeneralCharacterCard, type CanshouDetails, type GeneralCharacterCardData } from '@mahoshojo/ui-web/character-card';
import { ThemeImage } from '@mahoshojo/ui-web/media';
import { revokeBlobUrl } from '@mahoshojo/ui-web/client';
import { CardLibraryModal, type BattleSelectionPayload, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { useEscapeLayer } from '@mahoshojo/ui-web/modal';
import { ProductFooter } from '@mahoshojo/ui-web/shell';
import type { HomeAssetSource } from '@mahoshojo/ui-web/home';
import { CanshouSession } from '../features/canshou/session';
import { QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE } from '../features/questionnaire/session';
import type { CanshouExecutionMode } from '../features/canshou/generation';
import {
  buildCanshouAnswers,
  builtinQuestionnaireSource,
  loadDefaultCanshouQuestionnaire,
  parseCanshouQuestionnaireSelection,
  toQuestionnaireSelection,
  type CanshouQuestionnaire,
} from '../features/canshou/questionnaire';
import { resolveDesktopAiTarget } from '../features/ai-config/desktop-ai-config';
import { useDesktopAiConfig } from '../features/ai-config/use-desktop-ai-config';
import { useDesktopCloudSession } from '../features/account/use-desktop-cloud-session';
import { useDesktopCardLibraryHost } from '../platform/card-library-host';
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

const resolveResultJsonFileName = (card: Record<string, unknown>, cardKind: 'canshou' | 'general'): string => {
  const rawName = typeof card.name === 'string' && card.name ? card.name : '未命名残兽';
  return cardKind === 'general'
    ? `通用残兽角色_${sanitizeFileNamePart(rawName)}.json`
    : `残兽_${sanitizeFileNamePart(rawName)}.json`;
};

const createSelectionSuffix = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type PendingRegenerateAction = 'generate' | 'quick-random';
type ConfirmRegenerateKind = 'unsaved' | 'uncertain';

/**
 * 「重新生成」确认对话框的标题/说明文案——与 `/details` 同一套语义。
 *
 * uncertain（hosted 终态无法确认服务器是否已执行）下两个挂起动作的语义不同：
 * generate 确实可能产生第二次服务器调用与计费，必须如实告警；quick-random 是
 * 纯本机生成、不发起模型请求，需要确认的理由只是「覆盖尚未确认的结果」。
 */
export const describeRegenerateConfirm = (
  action: PendingRegenerateAction,
  kind: ConfirmRegenerateKind,
): { title: string; description: string } => ({
  title: action === 'quick-random' ? '重新随机生成？' : '重新生成？',
  description: kind === 'unsaved'
    ? '当前结果尚未保存到本地卡库。重新生成将替换当前结果；即使新生成失败或取消，也无法恢复。可以先保存当前结果再生成。'
    : action === 'quick-random'
      ? '上次生成的服务器执行结果尚未确认，残留正文仍保留在本机草稿中。快速随机生成完全在本机进行，不发起模型请求也不产生费用；确定后会覆盖这份尚未确认的内容，且无法恢复。'
      : '无法确认上次请求是否在服务器执行——它可能已经完成并计费。再次生成会发起新的请求，可能产生重复调用与费用。',
});

function CanshouForm({ session }: { session: CanshouSession }) {
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
  const cardLibraryHost = useDesktopCardLibraryHost();
  // 登录只决定是否附带会话/活动身份；System Default 公开路由对匿名放行（DESK-ONLINE-009）。
  const { store: cloudSessionStore } = useDesktopCloudSession();
  const [generationMode, setGenerationMode] = useState<GenerationMode>('non-stream');
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [presetEntries, setPresetEntries] = useState<QuestionnairePresetEntry[]>([]);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [questionnaireError, setQuestionnaireError] = useState<string | null>(null);
  const [questionnaireLoading, setQuestionnaireLoading] = useState(true);
  const [selectionReady, setSelectionReady] = useState(false);
  const [provisionalBuiltin, setProvisionalBuiltin] = useState<QuestionnaireSelection | null>(null);
  const [reload, setReload] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState<false | ConfirmRegenerateKind>(false);
  const pendingActionRef = useRef<PendingRegenerateAction>('generate');
  const [showIntroduction, setShowIntroduction] = useState(true);
  const [showQuestionnaireSettings, setShowQuestionnaireSettings] = useState(false);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [detailsSelection, setDetailsSelection] = useState<QuestionnaireSelection | null>(null);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [deviceType, setDeviceType] = useState<DeviceType>('unknown');
  const regenerateDialog = useRef<HTMLDialogElement>(null);
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const resultSectionRef = useRef<HTMLDivElement | null>(null);
  const previousTargetsRef = useRef<QuestionnaireAnswerMatchTarget[] | null>(null);
  const previousSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const dialog = regenerateDialog.current;
    if (confirmRegenerate && !dialog?.open) dialog?.showModal();
    else if (!confirmRegenerate && dialog?.open) dialog.close();
  }, [confirmRegenerate]);
  useEffect(() => {
    const dialog = detailsDialog.current;
    if (detailsSelection && !dialog?.open) dialog?.showModal();
    else if (!detailsSelection && dialog?.open) dialog.close();
  }, [detailsSelection]);
  // Escape 层级登记（DESK-PARITY-007）：原生 <dialog> 的 UA cancel 与共享栈
  // 收同一语义——一次按键只关最上面一层，不穿透到壳上的菜单兜底；两处
  // setState 幂等，重复收口无害。
  useEscapeLayer({
    active: confirmRegenerate !== false,
    trapsFocus: true,
    onEscape: () => {
      if (!session.isBusy()) setConfirmRegenerate(false);
      return true;
    },
  });
  useEscapeLayer({
    active: detailsSelection !== null,
    trapsFocus: true,
    onEscape: () => {
      setDetailsSelection(null);
      return true;
    },
  });
  useEscapeLayer({
    active: showImageModal && savedImageUrl !== null,
    onEscape: () => {
      setShowImageModal(false);
      return true;
    },
  });
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
  // 预设问卷索引：只服务「选择预设问卷」下拉；失败不影响内置问卷与本地功能。
  useEffect(() => {
    const controller = new AbortController();
    setPresetError(null);
    void fetch('/questionnaires/presets/index.json', { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('加载预设问卷索引失败'))))
      .then((data) => {
        if (controller.signal.aborted) return;
        const list = Array.isArray(data?.presets) ? (data.presets as QuestionnairePresetEntry[]) : [];
        setPresetEntries(list.filter((item) => item.kind === 'canshou'));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPresetEntries([]);
          setPresetError('预设问卷索引加载失败，预设下拉暂不可用；内置问卷与本地功能不受影响。');
        }
      });
    return () => controller.abort();
  }, [reload]);
  // 草稿里的问卷选择集：随 answers/language 一起持久化与恢复（D5.1-P2，
  // 与 Web `questionnaireSelections`/`allowMultipleQuestionnaires` 草稿口径一致）。
  const draftSelections = state.draft.questionnaireSelections;
  const selections: readonly QuestionnaireSelection[] = draftSelections ?? [];
  const allowMultiple = state.draft.allowMultipleQuestionnaires === true;
  const updateDraft = (patch: Partial<typeof state.draft>) => {
    session.updateDraft({ ...session.getSnapshot().draft, ...patch });
  };
  const updateSelections = useCallback((next: QuestionnaireSelection[]) => {
    session.updateDraft({ ...session.getSnapshot().draft, questionnaireSelections: next });
  }, [session]);
  // 默认内置问卷：进入页面就加载（含待恢复期间——预览用，不写草稿）；
  // 待恢复期间严禁把默认选择写进草稿，否则会在用户点「恢复/清除」前覆盖 pending 数据。
  useEffect(() => {
    // 选择集一旦落定（草稿恢复/用户挑选/自动注入），内置问卷的加载结果就不再是
    // 决策依据：清掉此前遗留的加载错误，否则它会一直把生成按钮挡在门外（P2-r1）。
    if (selectionReady) {
      setQuestionnaireLoading(false);
      setQuestionnaireError(null);
      return;
    }
    const controller = new AbortController();
    setQuestionnaireLoading(true);
    setQuestionnaireError(null);
    void loadDefaultCanshouQuestionnaire(controller.signal).then((questionnaire) => {
      if (controller.signal.aborted) return;
      setProvisionalBuiltin(toQuestionnaireSelection(builtinQuestionnaireSource(questionnaire), questionnaire));
    }).catch(() => {
      if (!controller.signal.aborted) setQuestionnaireError('内置问卷加载失败，请重试。');
    }).finally(() => { if (!controller.signal.aborted) setQuestionnaireLoading(false); });
    return () => controller.abort();
  }, [reload, selectionReady]);
  // 落盘条件：无待恢复草稿 + 尚无选择集——此时默认内置选择才写进草稿。
  // 用户主动清空选择集后不自动回填（`selectionReady` 闩锁与 Web 一致）。
  useEffect(() => {
    if (selectionReady || state.pendingRestore || selections.length > 0 || !provisionalBuiltin) return;
    updateSelections([provisionalBuiltin]);
    setSelectionReady(true);
  }, [selectionReady, state.pendingRestore, selections.length, provisionalBuiltin, updateSelections]);
  // 展示口径：草稿选择集优先，加载中/待恢复期间以默认内置预览。
  const effectiveSelections = useMemo<readonly QuestionnaireSelection[]>(
    () => (draftSelections?.length ? draftSelections : (provisionalBuiltin ? [provisionalBuiltin] : [])),
    [draftSelections, provisionalBuiltin],
  );
  // 首份问卷的描述展示在页首 logo 下方（与 Web `/canshou` 同一位置）。
  const primaryQuestionnaire = effectiveSelections[0]?.questionnaire;
  const selected = target.profile;
  const mode = target.mode;
  const busy = state.phase === 'generating' || state.saving;
  const blockedDraft = state.pendingRestore || session.isDraftBlocked();
  // 问卷流程与 Web 同一套领域语义：多问卷经 `buildQuestionnaireContextItems`
  // 展平（key 按选中实例 selectionId 隔离），optionsFrom/suggestionsFrom 先解析，
  // displayIf/jump 随当前回答求值——与 Web `/canshou` 同一实现路径（D5.1-G1）。
  const flowItems = useMemo(
    () => resolveQuestionnaireReferences(buildQuestionnaireContextItems(effectiveSelections)),
    [effectiveSelections],
  );
  const answersByKey = state.draft.answers;
  const flow = useMemo(
    () => buildQuestionnaireFlow(flowItems, answersByKey).flow,
    [flowItems, answersByKey],
  );
  // 全题目目标（含条件隐藏题）：批量解析与卡导入的元数据解析以全集为准；
  // 无元数据条目按可见流序回落——与 Web `/canshou` 同一口径。
  const allQuestionTargets = useMemo<QuestionnaireAnswerMatchTarget[]>(
    () => flowItems.map((item, index) => ({
      key: item.key,
      index,
      question: item.question.question,
      questionId: item.question.id,
      questionnaireId: item.questionnaireId,
      questionnaireTitle: item.questionnaireTitle,
    })),
    [flowItems],
  );
  const visibleQuestionTargets = useMemo<QuestionnaireAnswerMatchTarget[]>(
    () => flow.map((item, index) => ({
      key: item.key,
      index,
      question: item.question.question,
      questionId: item.question.id,
      questionnaireId: item.questionnaireId,
      questionnaireTitle: item.questionnaireTitle,
    })),
    [flow],
  );
  const questionAnswerLookup = useMemo(
    () => buildQuestionnaireAnswerLookup(allQuestionTargets),
    [allQuestionTargets],
  );
  const questionTargetSignature = useMemo(
    () => allQuestionTargets.map((item) => `${item.key}::${item.questionId ?? ''}::${item.question}`).join('\n'),
    [allQuestionTargets],
  );
  // 问卷集合变化后的答案重映射：旧 key 失配的回答按元数据匹配到新 key，
  // 无法匹配的不进入新集合——与 Web `/canshou` 同一 effect 语义。
  useEffect(() => {
    const previousTargets = previousTargetsRef.current;
    const previousSignature = previousSignatureRef.current;
    previousTargetsRef.current = allQuestionTargets;
    previousSignatureRef.current = questionTargetSignature;
    if (!previousTargets || previousSignature === null || previousSignature === questionTargetSignature) return;
    const remapped = remapAnswersToQuestionnaireChange({
      previousTargets,
      answersByKey: session.getSnapshot().draft.answers,
      lookup: questionAnswerLookup,
    });
    session.updateDraft({ ...session.getSnapshot().draft, answers: remapped });
  }, [allQuestionTargets, questionAnswerLookup, questionTargetSignature, session]);
  // 生成完成（含快速随机）：仅当结果整体仍在视口下方时自动滚动定位一次
  //（语义见共享 useResultAutoScroll）。
  useResultAutoScroll(resultSectionRef, Boolean(state.card));
  const applyImportedAnswers = (next: Record<string, string>) => {
    updateDraft({ answers: next });
    setActionError(null);
  };
  const buildAnswerExportText = () => buildQuestionnaireAnswerExportText({
    title: '残兽问卷答案备份',
    items: collectQuestionnaireAnswerExportItems(visibleQuestionTargets, answersByKey),
    total: flow.length,
    questionnaireLabel: effectiveSelections.map((selection) => selection.questionnaire.title).join(' + '),
  });
  const currentIndex = Math.min(questionIndex, Math.max(0, flow.length - 1));
  const flowItem = flow[currentIndex];
  const question = flowItem?.question;
  const answer = flowItem ? answersByKey[flowItem.key] ?? '' : '';
  // 与 Web CanshouPage 同一口径：封闭题（allowCustom:false）没有任何可点选
  // 选项时回退为文本输入；灵感提示只在文本输入可用时出现——点击 suggestion
  // 即写入自由文本，封闭题展示它会产生提交时必遭拒绝的答案（D5.1a-r2）。
  const questionHasOptions = (question?.options?.length ?? 0) > 0;
  const showTextInput = question?.allowCustom !== false || !questionHasOptions;
  const updateAnswer = (value: string) => {
    if (!flowItem) return;
    updateDraft({ answers: { ...answersByKey, [flowItem.key]: value } });
  };
  const applySelection = (selection: QuestionnaireSelection) => {
    updateSelections(applyQuestionnaireSelection(selections, selection, {
      allowMultiple,
      createSuffix: createSelectionSuffix,
    }));
    setSelectionReady(true);
    setPasteError(null);
    setPasteText('');
    setShowPasteImport(false);
    setShowIntroduction(false);
    setShowQuestionnaireSettings(false);
    setActionError(null);
  };
  const handleRemoveSelection = (selectionId: string) => {
    setSelectionReady(true);
    updateSelections(removeQuestionnaireSelection(selections, selectionId));
  };
  const handleToggleSelectionLore = (selectionId: string, enabled: boolean) => {
    updateSelections(setQuestionnaireSelectionLore(selections, selectionId, enabled));
  };
  const handleAllowMultipleChange = (next: boolean) => {
    setSelectionReady(true);
    const nextSelections = next
      ? [...selections]
      : (reconcileQuestionnaireSelectionsForSingleMode(selections) ?? [...selections]);
    updateDraft({ allowMultipleQuestionnaires: next, questionnaireSelections: nextSelections });
  };
  // `nativeAllowed` 是签名资格而非可用性：非原生问卷照常生成，只是不获官方签名。
  const isNativeSignatureEligible = isQuestionnaireSelectionNativeAllowed(effectiveSelections);
  const hasOverLimitAnswer = hasOverLimitQuestionnaireAnswers(flow, answersByKey);
  // 「客户端｜服务器」与「流式｜非流式」两个维度共同决定执行模式（DESK-ONLINE-009）。
  const hostedMode: CanshouExecutionMode = generationMode === 'stream' ? 'hosted-stream' : 'hosted-json';
  const executionMode: CanshouExecutionMode | null = target.location === 'server' ? hostedMode : mode;
  // 本地 Provider 配置只门禁客户端执行：server 偏好由 hosted System Default 解析、
  // 不消费本地 profile——Profile bridge 故障不得把服务器生成一起封死
  //（两个执行位置正交，DESK-ONLINE-001/009）。
  const clientProfilesBlocked =
    target.location === 'client' && (profilesLoading || profilesError !== null);
  const generate = (discardUnsavedResult = false) => {
    // `questionnaireError` 不进门禁：它只描述内置问卷加载失败，而当前生效的可能是
    // 用户自备的选择集——选择集存在且流程非空就足以生成（与 Web 同口径，P2-r1）。
    if (!guard.ready || busy || !executionMode || effectiveSelections.length === 0 || flow.length === 0 || questionnaireLoading || clientProfilesBlocked || state.pendingRestore || session.isDraftBlocked()) return;
    if (target.location === 'client' && !selected) return;
    if (!discardUnsavedResult) {
      if (session.hasUnsavedResult()) { pendingActionRef.current = 'generate'; setConfirmRegenerate('unsaved'); return; }
      // hosted-json 结果不确定时再次生成 = 可能的第二次调用，必须显式确认（D5.1a-r1）。
      if (state.phase === 'uncertain') { pendingActionRef.current = 'generate'; setConfirmRegenerate('uncertain'); return; }
    }
    try {
      const answers = buildCanshouAnswers(flow, session.getSnapshot().draft.answers);
      setActionError(null);
      setActionInfo(null);
      void session.generate(
        { invoke, profileId: selected?.id ?? '' },
        {
          answers,
          language: session.getSnapshot().draft.language,
          loreText: buildQuestionnaireSelectionLoreText(effectiveSelections),
          hosted: {
            selections: [...effectiveSelections],
            allowNativeSignature: isQuestionnaireGenerationNativeSignatureAllowed(
              effectiveSelections,
              hasOverLimitAnswer,
            ),
          },
        },
        { mode: executionMode, modelId: selected?.modelId, overrides: target.generationOverrides },
        discardUnsavedResult,
      );
    } catch (error) { setActionError(error instanceof Error ? error.message : '问卷无法生成。'); }
  };

  /** 快速随机：纯本机产出（不经模型），结果走与生成完成相同的相位与保存通路。 */
  const runQuickRandom = useCallback(() => {
    try {
      const data = generateRandomCanshou();
      session.applyLocalResult(data, 'canshou', true);
      setShowIntroduction(false);
      setActionError(null);
    } catch (error) {
      console.error('随机生成失败: ', error);
      setActionError('随机生成失败，请稍后再试。');
    }
  }, [session]);

  const handleQuickRandom = () => {
    if (!guard.ready || busy || state.pendingRestore || session.isDraftBlocked()) return;
    if (session.hasUnsavedResult()) {
      pendingActionRef.current = 'quick-random';
      setConfirmRegenerate('unsaved');
      return;
    }
    if (state.phase === 'uncertain') {
      pendingActionRef.current = 'quick-random';
      setConfirmRegenerate('uncertain');
      return;
    }
    runQuickRandom();
  };

  /** 确认对话框「确定/保存后继续」：generate 与 quick-random 共用同一确认语义。 */
  const runPendingAction = (discardUnsavedResult: boolean) => {
    if (pendingActionRef.current === 'quick-random') {
      runQuickRandom();
      return;
    }
    generate(discardUnsavedResult);
  };

  /** 打开问卷选择器：一次主动使用 → 顺手探测会话（DESK-ONLINE-013），失败只影响云端页签。 */
  const openPicker = () => {
    setPickerError(null);
    void cloudSessionStore.refresh();
    setPickerOpen(true);
  };

  const handleSelectQuestionnaireCard = (payload: BattleSelectionPayload, context: CardLibrarySelectionContext) => {
    const parsed = parseCanshouQuestionnaireSelection(payload, context);
    if ('error' in parsed) {
      setPickerError(parsed.error);
      return;
    }
    // 追加/切换问卷不清空已填回答：key 失配的旧回答由答案重映射按元数据
    // 匹配到新 key，无法匹配的不再保留（与 Web 同一口径）。
    applySelection(toQuestionnaireSelection(parsed.source, parsed.questionnaire));
    setPickerError(null);
    setPickerOpen(false);
  };

  const handleAddPreset = async (presetId: string) => {
    const preset = presetEntries.find((item) => item.id === presetId);
    if (!preset) return;
    try {
      const response = await fetch(preset.path, { credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error('加载预设问卷失败');
      const data: unknown = await response.json();
      const normalized = normalizeQuestionnaireDefinition(data, {
        fallbackId: preset.id,
        fallbackKind: preset.kind,
        fallbackTitle: preset.title,
        nativeAllowed: true,
      });
      if (!normalized) throw new Error('预设问卷解析失败');
      applySelection({ source: 'preset', questionnaire: normalized });
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : '加载预设问卷失败');
    }
  };

  const normalizeUpload = (parsed: unknown, fallbackTitle: string): CanshouQuestionnaire | null => {
    const normalized = normalizeQuestionnaireDefinition(parsed, {
      fallbackKind: 'canshou',
      fallbackId:
        parsed && typeof parsed === 'object' && typeof (parsed as { id?: unknown }).id === 'string'
          ? (parsed as { id: string }).id
          : 'canshou-upload',
      fallbackTitle,
      nativeAllowed: false,
    });
    if (!normalized) return null;
    // 上传件没有服务器身份可验证，nativeAllowed 恒 false（即使文件声明 true）。
    normalized.nativeAllowed = false;
    return normalized;
  };

  const handleUploadQuestionnaire = async (file: File) => {
    // `File.size` 不读内容即可拿到字节数：parse 前预算先行拦截超大输入（bounded-input）。
    if (file.size > MAX_QUESTIONNAIRE_IMPORT_BYTES) {
      setActionError(`问卷文件超过大小上限（${MAX_QUESTIONNAIRE_IMPORT_BYTES / 1024 / 1024} MiB）。`);
      return;
    }
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const fallbackTitle =
        parsed && typeof parsed === 'object' && typeof (parsed as { title?: unknown }).title === 'string'
          ? (parsed as { title: string }).title
          : file.name.replace(/\.[^.]+$/, '');
      const normalized = normalizeUpload(parsed, fallbackTitle);
      if (!normalized) throw new Error('问卷文件解析失败');
      applySelection({ source: 'upload', questionnaire: normalized });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '问卷文件解析失败');
    }
  };

  const handlePasteQuestionnaireImport = () => {
    if (!pasteText.trim()) {
      setPasteError('请先粘贴问卷 JSON');
      return;
    }
    // 粘贴路径没有 File.size 可用：逐码点计 UTF-8 字节、超限即停的同一预算。
    if (exceedsUtf8ByteLimit(pasteText, MAX_QUESTIONNAIRE_IMPORT_BYTES)) {
      setPasteError(`问卷 JSON 超过大小上限（${MAX_QUESTIONNAIRE_IMPORT_BYTES / 1024 / 1024} MiB）。`);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(pasteText);
      const fallbackTitle =
        parsed && typeof parsed === 'object' && typeof (parsed as { title?: unknown }).title === 'string'
          ? (parsed as { title: string }).title
          : '未命名问卷';
      const normalized = normalizeUpload(parsed, fallbackTitle);
      if (!normalized) throw new Error('问卷 JSON 无法识别，请检查格式');
      applySelection({ source: 'upload', questionnaire: normalized });
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : '问卷 JSON 解析失败');
    }
  };

  const targetCapabilities = selected
    ? getModelGenerationCapabilities(selected.id, selected.modelId)
    : undefined;
  const recommendedImageMode = recommendedSaveModes(deviceType === 'mobile').imageSaveMode;
  const recommendedJsonMode = recommendedSaveModes(deviceType === 'mobile').jsonSaveMode;
  const imageSaveMode = state.draft.imageSaveMode ?? recommendedImageMode;
  const jsonSaveMode = state.draft.jsonSaveMode ?? recommendedJsonMode;
  const showDetails = state.draft.showDetails === true;
  const imageSaveButtonLabel = imageSaveMode === 'download'
    ? '💾 一键保存长图'
    : '📱 打开长按保存弹窗';
  const handleSaveImage = (imageUrl: string) => {
    setSavedImageUrl(imageUrl);
    setShowImageModal(true);
  };
  // 截图产物的 blob URL 在被新图替换或页面卸载时回收——过早回收会让弹窗预览断图。
  useEffect(() => () => revokeBlobUrl(savedImageUrl), [savedImageUrl]);
  const resolvedResultPayload = state.card;
  const hasLoreOnly = effectiveSelections.length > 0 && flowItems.length === 0
    && effectiveSelections.some((selection) => Boolean(selection.questionnaire.loreMarkdown?.trim()));
  const confirmCopy = confirmRegenerate === false
    ? null
    : describeRegenerateConfirm(pendingActionRef.current, confirmRegenerate);
  return (
    <div>
      <section data-testid="page-canshou" className="magic-background-dark">
        <div className="container">
          <div className="card flex flex-col gap-5">
            <header>
              {/* 残兽品牌 logo：桌面恒暗色界面，ThemeImage 在本端总是命中 darkSrc。 */}
              <div className="text-center mb-4">
                <ThemeImage lightSrc="/beast-logo.svg" darkSrc="/beast-logo-white.svg" className="w-full px-8" alt="残兽调查" />
                {primaryQuestionnaire?.description && (
                  <p className="mt-2 text-sm text-(--app-text-muted)">{primaryQuestionnaire.description}</p>
                )}
              </div>
              <h1 className="text-2xl font-semibold">残兽问卷生成</h1>
              <p className="mt-2 text-sm text-(--app-text-muted)">填写问卷后，可选择客户端连接或项目服务器生成残兽档案；签名状态以实际生成结果为准。问卷可以是内置预设，也可以从本地库或云端数据卡选择。</p>
            </header>
            <section aria-label="草稿" className="rounded-lg border border-(--app-border) p-4">
              <p>问卷、结果与中断正文自动保存在本机页面草稿中，恢复草稿不会自动重新生成。</p>
              <p className="text-sm text-(--app-text-muted)">草稿不参与本地库整库备份或归档；保存到本地卡库的角色卡参与。草稿上限为序列化后 4 Mi 字符，超出或写入失败时请保留当前页面。</p>
              {state.pendingRestore && <div role="status" className="mt-2 flex flex-wrap items-center gap-2"><span>发现上次草稿，请选择恢复或清除。</span><button className={actionClass} onClick={() => {
                // 恢复的选择集取代待恢复期的内置预览：重置答案重映射基线，让恢复后的
                // 题目集成为首个观测基线——否则 effect 会拿预览的 targets 去「映射掉」
                // 刚恢复的回答并立即落盘为空（不可逆丢失，P2-r1）。
                previousTargetsRef.current = null;
                previousSignatureRef.current = null;
                session.restoreDraft(); setShowIntroduction(false); setSelectionReady(true);
              }}>恢复草稿</button></div>}
              {state.draftError && <p role="alert">{state.draftError}</p>}
              {!state.pendingRestore && <p role="status">{state.draftSaved ? '当前内容已保存或无待保存变更。' : '当前内容尚未保存到草稿。'}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {state.draftError && !session.isDraftBlocked() && <button className={actionClass} disabled={busy || state.pendingRestore} onClick={() => session.retryDraftSave()}>重试保存草稿</button>}
                <button className={actionClass} disabled={busy} onClick={() => setConfirmClear(true)}>清除草稿</button>
              </div>
              {confirmClear && <div role="group" aria-label="确认清除草稿" className="mt-3 rounded border p-3">
                <p>确认清除本页回答、生成结果和中断正文？已保存的本地卡不受影响。此操作无法撤销。</p>
                <button className={actionClass} disabled={busy} onClick={() => {
                  // 同「恢复草稿」：清空后重新注入的默认选择不应拿旧基线做重映射。
                  previousTargetsRef.current = null;
                  previousSignatureRef.current = null;
                  session.discardDraft(); setConfirmClear(false); setQuestionIndex(0); setShowIntroduction(true); setSelectionReady(false);
                }}>确认清除</button>
                <button className={actionClass} onClick={() => setConfirmClear(false)}>保留草稿</button>
              </div>}
            </section>
            {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
            {guard.message && <p role="alert">{guard.message}</p>}
            {questionnaireLoading && <p role="status">正在读取内置问卷…</p>}
            {questionnaireError && <p role="alert">{questionnaireError}</p>}
            {/* 本地 Provider 状态只与客户端执行相关：服务器模式照常可生成，加载中提示收窄、
                失败提示改为如实说明影响范围，避免被读成「服务器生成也被封死」（D5.1-P2-r4）。 */}
            {profilesLoading && target.location === 'client' && <p role="status">正在读取本地 Provider 配置…</p>}
            {profilesError && <p role="alert">{target.location === 'server' ? '本地 Provider 配置加载失败，仅影响客户端执行。' : profilesError}</p>}
            <button className={`${actionClass} self-start`} disabled={busy} onClick={() => { setReload((value) => value + 1); void aiStore.refreshProfiles(); }}>重新加载问卷与配置</button>
            {showIntroduction && !state.pendingRestore ? (
              <section aria-label="介绍" className="rounded-lg border border-(--app-border) p-4">
                <DetailsIntroSection
                  description={null}
                  startLabel="开始调查"
                  onStart={() => setShowIntroduction(false)}
                  onQuickRandom={handleQuickRandom}
                  quickRandomBusy={busy}
                  quickRandomStyle={{ background: 'linear-gradient(to right, #7e22ce, #a855f7)' }}
                  encyclopediaItems={[{ slug: 'character-generator', text: '百科：角色生成（/name、/details、/canshou）' }]}
                  onNavigateEntry={(href) => { void router.navigate({ to: href }); }}
                  encyclopediaLinkClassName="text-(--app-accent-strong) hover:underline"
                  encyclopediaLabelClassName="text-(--app-text-muted)"
                  resolveInternalHref={resolveInternalHrefForHashHistory}
                  backHome={(
                    <button type="button" className="footer-link" onClick={() => void router.navigate({ to: '/' })}>
                      返回首页
                    </button>
                  )}
                />
              </section>
            ) : (
              <>
                <section aria-label="问卷来源" className="rounded-lg border border-(--app-border) p-4">
                  <QuestionnaireSelectionPanel
                    theme={CANSHOU_SELECTION_THEME}
                    expanded={showQuestionnaireSettings}
                    onToggleExpanded={() => setShowQuestionnaireSettings(!showQuestionnaireSettings)}
                    allowMultiple={allowMultiple}
                    onAllowMultipleChange={handleAllowMultipleChange}
                    selections={effectiveSelections}
                    shouldDisableRemove={effectiveSelections.length <= 1}
                    onRemoveSelection={handleRemoveSelection}
                    onToggleLore={handleToggleSelectionLore}
                    onShowDetails={setDetailsSelection}
                    nativeAllowed={isNativeSignatureEligible}
                    hasOverLimitAnswer={hasOverLimitAnswer}
                    nativeMaxAnswerChars={QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS}
                    presets={presetEntries}
                    onSelectPreset={(presetId) => void handleAddPreset(presetId)}
                    onUploadFile={(file) => void handleUploadQuestionnaire(file)}
                    onOpenPicker={openPicker}
                    pickerLabel="从问卷数据卡选择"
                    description="你可以选择预设、上传或从本地库/云端数据卡挑选。多问卷只影响题目顺序；设定（Lore）可单独启用/禁用。"
                    pasteExpanded={showPasteImport}
                    onTogglePasteExpanded={() => {
                      setPasteError(null);
                      setShowPasteImport((prev) => !prev);
                    }}
                    pasteText={pasteText}
                    onPasteTextChange={setPasteText}
                    onApplyPaste={handlePasteQuestionnaireImport}
                    onClearPaste={() => {
                      setPasteText('');
                      setPasteError(null);
                    }}
                    pasteError={pasteError}
                    error={presetError}
                    disabled={busy || blockedDraft}
                  />
                  {hasLoreOnly && (
                    <p role="status" className="mt-2 text-sm text-(--app-text-muted)">
                      当前所选问卷仅包含设定（无题目），请在「问卷设置」中再添加一份有题目的问卷。
                    </p>
                  )}
                </section>
                <fieldset disabled={busy || blockedDraft || questionnaireLoading || !guard.ready} className="flex min-w-0 flex-col gap-4">
                  <legend className="mb-2 font-semibold">生成设置</legend>
                  <AiExecutionLocationField
                    value={target.location}
                    client={{ enabled: true }}
                    server={{ enabled: true }}
                    onChange={(location) => aiStore.selectExecutionLocation(location)}
                  />
                  <GenerationModeSwitcher value={generationMode} onChange={setGenerationMode} />
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
                  {target.location === 'client' && !profilesLoading && !aiState.profiles.length && !profilesError && <p>请先在<Link to="/settings" className="underline">设置</Link>中保存 Provider。问卷可以先填写，配置加载后再生成。</p>}
                  {target.location === 'server' && <div className="rounded border border-(--app-border) p-3">
                    <p>服务器 · 云端：由项目服务在服务器侧生成，{generationMode === 'stream' ? 'Markdown 流式输出（未签名）' : '结构化 JSON 输出（问卷原生许可时可获官方签名）'}。</p>
                    <p>不使用客户端连接与高级模型参数（由服务器侧 System Default 解析）。切换执行位置不会丢失已填写的问卷回答。</p>
                  </div>}
                  {target.location === 'client' && target.unavailableReason && <p role="status">{target.unavailableReason}</p>}
                  {target.location === 'client' && selected && mode && <div className="rounded border border-(--app-border) p-3">
                    <p>{mode === 'direct-local' ? '客户端 · 本机：发送到本机模型服务' : '客户端 · 远端：发送到你指定的外部模型服务'}</p>
                    <p className="break-all">接收方：{selected.baseUrl}</p>
                    <p>模型：{selected.modelId}。点击生成会发送已填写的问卷回答；结果不带官方签名。</p>
                  </div>}
                  {/* 高级参数只随 direct 通路下发（hosted 在服务器侧解析）：仅客户端执行时展示，
                      未实现 adapter 的连接同样不显示无实际发送效果的控件。 */}
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
                  <label className="flex flex-col gap-1">输出语言
                    <select aria-label="输出语言" className="w-full rounded border border-(--app-border) bg-(--app-surface) px-3 py-2 text-(--app-text)" value={state.draft.language} onChange={(event) => updateDraft({ language: event.target.value })}>
                      {/* languages.json 未加载完成前先呈现当前值，避免选择态回空。 */}
                      {(languages.length ? languages : [{ code: state.draft.language, name: state.draft.language }]).map((lang) => (
                        <option key={lang.code} value={lang.code}>{lang.name}</option>
                      ))}
                    </select>
                  </label>
                  {flow.length > 0 && <QuestionNavigator
                    theme="app"
                    items={flow.map((item) => ({ id: item.key, label: item.question.question }))}
                    currentIndex={currentIndex}
                    onNavigate={setQuestionIndex}
                    isAnswered={(index) => Boolean(answersByKey[flow[index]!.key]?.trim())}
                  />}
                  {flowItem && question && <QuestionnaireQuestionPanel
                    theme={CANSHOU_QUESTIONNAIRE_THEME} progressLabel={`第 ${currentIndex + 1} / ${flow.length} 题`} progressPercent={(currentIndex + 1) / flow.length * 100}
                    questionText={question.question} questionnaireTitle={flowItem.questionnaireTitle} noticeText="至少回答一题即可生成，其他题目可以跳过。" helperText={question.helperText}
                    isRequired={question.required === true} skipText={question.required === true ? '本题为必答' : '可跳过本题'} options={question.options} optionsHintText="点击选项填写回答" onOptionSelect={updateAnswer} suggestions={showTextInput ? question.suggestions : undefined} onSuggestionSelect={updateAnswer}
                    showTextInput={showTextInput} answer={answer} onAnswerChange={updateAnswer} placeholder={question.placeholder} answerLength={answer.trim().length}
                    showLimitLabel limitLabel={`建议不超过 ${getAnswerLimitInfo(question.maxLength).limit ?? 500} 字，不限制生成`} isOverLimit={isAnswerOverLimit(answer, question.maxLength)} overLimitText="回答超过建议长度，仍可生成未签名残兽档案。"
                    prevLabel="上一题" nextButtonContent="下一题" onPrev={() => setQuestionIndex((index) => Math.max(0, index - 1))}
                    onNext={() => {
                      if (question.required === true && !answer.trim()) {
                        setActionError('本题为必答，请填写后再继续。');
                        return;
                      }
                      setActionError(null);
                      setQuestionIndex((index) => Math.min(flow.length - 1, index + 1));
                    }}
                    disablePrev={currentIndex === 0} disableNext={currentIndex >= flow.length - 1} prevButtonClass={actionClass} nextButtonClass={actionClass}
                  />}
                </fieldset>
                {/* 批量填充/卡导入/答案概览/备份导出——与 Web `/canshou` 同一套共享区段。 */}
                {!blockedDraft && <BulkAnswerTools
                  variant="app"
                  targets={allQuestionTargets}
                  indexFallbackTargets={visibleQuestionTargets}
                  answersByKey={answersByKey}
                  onApplyAnswers={applyImportedAnswers}
                  onInfo={setActionInfo}
                  onError={(message) => setActionError(`⚠️ ${message}`)}
                  disabled={busy}
                />}
                {!blockedDraft && <AnswerReviewList
                  variant="app"
                  items={visibleQuestionTargets.map((item) => ({
                    key: item.key,
                    index: item.index,
                    question: item.question,
                    questionnaireTitle: item.questionnaireTitle,
                    answer: answersByKey[item.key] ?? '',
                  }))}
                  onEdit={setQuestionIndex}
                />}
                <QuestionnaireAnswerExportPanel
                  variant="app"
                  title="生成前备份问卷答案"
                  filenameBase="残兽问卷_答案备份"
                  hasContent={visibleQuestionTargets.some((item) => Boolean(answersByKey[item.key]?.trim()))}
                  buildContent={buildAnswerExportText}
                  disabled={busy}
                />
                <div className="flex flex-wrap gap-2">
                  <button className={actionClass} disabled={!guard.ready || busy || questionnaireLoading || clientProfilesBlocked || effectiveSelections.length === 0 || flow.length === 0 || !executionMode || (target.location === 'client' && !selected) || blockedDraft} onClick={() => generate()}>{state.phase === 'generating' ? '正在生成…' : state.phase === 'idle' ? '发送问卷并生成' : '重新生成'}</button>
                  {state.phase === 'generating' && <button className={actionClass} onClick={() => session.cancel()}>取消生成</button>}
                </div>
              </>
            )}
            <dialog ref={regenerateDialog} aria-labelledby="regenerate-title" aria-describedby="regenerate-description" className="m-auto max-w-lg rounded-lg border border-(--app-border) bg-(--app-surface) p-5 text-(--app-text) backdrop:bg-black/40" onCancel={(event) => { event.preventDefault(); if (!session.isBusy()) setConfirmRegenerate(false); }}>
              <h2 id="regenerate-title" className="text-xl font-semibold">{confirmCopy?.title ?? '重新生成？'}</h2>
              <p id="regenerate-description" className="my-3">{confirmCopy?.description}</p>
              {state.saveError && <p role="alert">{state.saveError}</p>}
              <div className="flex flex-wrap gap-2">
                <button autoFocus className={actionClass} disabled={busy} onClick={() => setConfirmRegenerate(false)}>取消</button>
                {confirmRegenerate === 'unsaved' && <button className={actionClass} disabled={busy} onClick={async () => { if (await session.saveResult()) { setConfirmRegenerate(false); runPendingAction(true); } }}>{state.saving ? '正在保存…' : '保存后重新生成'}</button>}
                <button className={actionClass} disabled={busy} onClick={() => { setConfirmRegenerate(false); runPendingAction(true); }}>确定重新生成</button>
              </div>
            </dialog>
            <dialog ref={detailsDialog} aria-labelledby="selection-details-title" className="m-auto max-w-2xl rounded-lg border border-(--app-border) bg-(--app-surface) p-5 text-(--app-text) backdrop:bg-black/40" onCancel={() => setDetailsSelection(null)}>
              <h2 id="selection-details-title" className="text-xl font-semibold">
                {detailsSelection?.questionnaire.title ?? '问卷详情'}
              </h2>
              {detailsSelection && (
                <>
                  <p className="mt-2 text-sm text-(--app-text-muted)">
                    来源：{detailsSelection.source === 'preset' ? '预设' : detailsSelection.source === 'upload' ? '本地上传/本地库' : '云端数据卡'}
                    {detailsSelection.dataCardAuthor ? ` · 作者：${detailsSelection.dataCardAuthor}` : ''}
                    {detailsSelection.questionnaire.nativeAllowed ? ' · 原生许可' : ' · 非原生'}
                    {` · 题目 ${detailsSelection.questionnaire.questions.length} 道`}
                    {detailsSelection.questionnaire.loreMarkdown?.trim() ? ' · 含设定' : ''}
                  </p>
                  {detailsSelection.questionnaire.description?.trim() && (
                    <p className="mt-2 text-sm">{detailsSelection.questionnaire.description}</p>
                  )}
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-xs">{JSON.stringify(detailsSelection.questionnaire, null, 2)}</pre>
                </>
              )}
              <div className="mt-4 flex justify-end">
                <button autoFocus className={actionClass} onClick={() => setDetailsSelection(null)}>关闭</button>
              </div>
            </dialog>
            {actionError && <p role="alert">{actionError}</p>}
            {actionInfo && <p role="status">{actionInfo}</p>}
            {state.message && <p role={state.phase === 'uncertain' ? 'alert' : 'status'}>{state.message}</p>}
            {state.reasoning && <AiReasoningPanel reasoning={state.reasoning} />}
            <div ref={resultSectionRef}>
              {state.card && <section aria-label="生成结果" className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold">
                  {typeof state.card.name === 'string' && state.card.name ? state.card.name : '未命名残兽'}
                  {' · '}{typeof state.card.signature === 'string' && state.card.signature
                    ? (state.resultRestored ? '含签名字段（本机未验证）' : '官方签名')
                    : '未签名'}
                </h2>
                {state.cardKind === 'general'
                  ? <GeneralCharacterCard
                      general={state.card as GeneralCharacterCardData}
                      onSaveImage={handleSaveImage}
                      imageSaveMode={imageSaveMode}
                      saveButtonLabel={imageSaveButtonLabel}
                    />
                  : <CanshouCard
                      canshou={state.card as unknown as CanshouDetails}
                      onSaveImage={handleSaveImage}
                      imageSaveMode={imageSaveMode}
                      saveButtonLabel={imageSaveButtonLabel}
                    />}
                <button className={actionClass} disabled={!guard.ready || busy || state.saveStatus === 'saved' || state.saveStatus === 'already-present'} onClick={() => { if (guard.ready) void session.saveResult(); }}>{state.saving ? '正在保存…' : '保存到本地卡库'}</button>
                {state.saveStatus === 'saved' && <p role="status">已保存到本地卡库。</p>}
                {state.saveStatus === 'already-present' && <p role="status">本地卡库已存在相同内容，原记录保持不变。</p>}
                {state.saveError && <p role="alert">{state.saveError}</p>}
                <DetailsSavePreferencesPanel
                  theme={APP_SAVE_PREFERENCES_THEME}
                  imageSaveMode={imageSaveMode}
                  onImageSaveModeChange={(next) => updateDraft({ imageSaveMode: next })}
                  recommendedImageMode={recommendedImageMode}
                  jsonSaveMode={jsonSaveMode}
                  onJsonSaveModeChange={(next) => updateDraft({ jsonSaveMode: next })}
                  recommendedJsonMode={recommendedJsonMode}
                  imageGroupTitle="残兽档案图保存方式"
                  jsonGroupTitle="残兽档案文件保存方式"
                  footerNote="提示：偏好设置已保存在本机草稿中，下次打开仍会保留；切换不会丢失生成结果。"
                />
                <CanshouLorePanel
                  theme={CANSHOU_LORE_PANEL_APP_THEME}
                  open={showDetails}
                  onOpenChange={(open) => updateDraft({ showDetails: open })}
                />
                {/* 保存原始数据——与 Web `/canshou` 同一共享控件（下载 JSON / 复制文本）。 */}
                {resolvedResultPayload && <section aria-label="保存原始数据" className="rounded-lg border border-(--app-border) p-4">
                  <h3 className="text-lg font-medium">保存残兽档案</h3>
                  <div className="mt-3 flex flex-col gap-3">
                    {state.cardKind === 'general' ? (
                      <>
                        <button className={actionClass} onClick={() => downloadTextFile(resolveResultJsonFileName(resolvedResultPayload as Record<string, unknown>, 'general'), JSON.stringify(resolvedResultPayload, null, 2))}>下载通用角色卡</button>
                        <button className={actionClass} onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(resolvedResultPayload, null, 2)).then(() => setActionInfo('✅ 通用角色卡 JSON 已复制到剪贴板')).catch(() => setActionError('复制失败，请手动选择 JSON 内容后复制。')); }}>复制到剪贴板</button>
                      </>
                    ) : (
                      <SaveJsonButton
                        data={resolvedResultPayload}
                        mode={jsonSaveMode}
                        recommendedMode={recommendedJsonMode}
                        resolveFileName={(data) => resolveResultJsonFileName(data as Record<string, unknown>, 'canshou')}
                      />
                    )}
                  </div>
                  <JsonSizeIndicator
                    data={resolvedResultPayload}
                    maxBytes={MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES}
                    hintText="按 UTF-8 字节估算，对照本地卡单条记录上限"
                    warningText="⚠️ 接近本地卡单条上限（4 MiB），保存到本地卡库可能失败，请先精简数据。"
                  />
                </section>}
              </section>}
            </div>
            {state.rawText && <details open={state.phase !== 'completed'}><summary>原始输出正文</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-3">{state.rawText}</pre></details>}
          </div>
          {/* 页脚与 Web /canshou 同一共享组件；站外链接走受控外链确认。 */}
          <ProductFooter
            textWhite
            assetSource={DESKTOP_ASSET_SOURCE}
            onNavigateInternal={(href) => navigateByProductHref(router, href)}
            resolveInternalHref={resolveInternalHrefForHashHistory}
            onNavigateExternal={openFixed}
          />
        </div>
        {/* 长按保存弹窗：与 Web `/canshou` 同一交互——图片预览 + 手动保存提示。 */}
        {showImageModal && savedImageUrl && (
          <div className="fixed inset-0 flex items-center justify-center" style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', paddingLeft: '2rem', paddingRight: '2rem', zIndex: 1000 }}>
            <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative">
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur flex justify-end p-2">
                <button
                  onClick={() => setShowImageModal(false)}
                  aria-label="关闭"
                  className="text-gray-500 hover:text-gray-700 text-3xl leading-none"
                >
                  ×
                </button>
              </div>
              <div className="px-4 pb-4">
                <p className="text-center text-sm text-gray-600" style={{ marginTop: '0.5rem' }}>
                  💫 长按图片保存到相册
                </p>
                <div className="items-center flex flex-col" style={{ padding: '0.5rem' }}>
                  <img
                    src={savedImageUrl}
                    alt="残兽档案"
                    className="w-1/2 h-auto rounded-lg mx-auto"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        <CardLibraryModal
          host={cardLibraryHost}
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelectCard={handleSelectQuestionnaireCard}
          selectedType="questionnaire"
          allowedTypes={['questionnaire']}
          titleOverride="选择问卷数据卡"
          externalError={pickerError}
          // 本地页签离线可用且不要求登录，作为默认落点；云端页签失败只影响自身。
          initialTab="local"
          allowDeckImport={false}
        />
      </section>
    </div>
  );
}

export function DesktopCanshou() {
  const [session, setSession] = useState<CanshouSession | null>(null);
  useEffect(() => {
    const owner = new CanshouSession({
      storage: { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: (key) => window.localStorage.removeItem(key) },
      repository: new IpcLocalCardRepository(invoke), initialDraft: { answers: {}, language: QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE },
    });
    setSession(owner);
    const onPageHide = () => owner.cancel();
    window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); owner.dispose(); };
  }, []);
  return session ? <CanshouForm session={session} /> : <p role="status">正在准备问卷草稿…</p>;
}
