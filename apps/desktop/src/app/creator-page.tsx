import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link, useRouter } from '@tanstack/react-router';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { getRandomFlowers } from '@mahoshojo/domain/flowers';
import { exceedsUtf8ByteLimit } from '@mahoshojo/domain/data-card-size';
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
  collectQuestionnaireFlowAnswerItems,
  MAX_QUESTIONNAIRE_IMPORT_BYTES,
  normalizeQuestionnaireDefinition,
  resolveQuestionnaireReferences,
  type QuestionnairePresetEntry,
} from '@mahoshojo/domain/questionnaire-definition';
import {
  buildQuestionnaireAnswerExportText,
  collectQuestionnaireAnswerExportItems,
} from '@mahoshojo/domain/questionnaire-answer-export';
import {
  applyQuestionnaireSelection,
  buildQuestionnaireContextItems,
  buildQuestionnaireSelectionLoreText,
  ensureQuestionnaireSelectionId,
  isQuestionnaireGenerationNativeSignatureAllowed,
  isQuestionnaireSelectionNativeAllowed,
  reconcileQuestionnaireSelectionsForSingleMode,
  remapAnswersToQuestionnaireChange,
  removeQuestionnaireSelection,
  resolveQuestionnaireSelectionNativeAllowedFallback,
  setQuestionnaireSelectionLore,
  type QuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';
import {
  getCreatorTemplateOptionById,
  isCreatorTemplateSupportedInGenerationMode,
  normalizeCreatorTemplateForGenerationMode,
  type CreatorTemplateId,
} from '@mahoshojo/domain/creator/templates';
import {
  createDefaultBuildRuleInputs,
  loadBuildRulePresetIndex,
  tryLoadBuildRulePresetById,
} from '@mahoshojo/domain/creator/build-rules';
import { evaluateBuildRuleState } from '@mahoshojo/domain/creator/build-rule-runtime';
import {
  filterCreatorQuestionnairePresetEntries,
  pickDefaultCreatorQuestionnairePresetEntry,
  reconcileCreatorBuildRuleSelection,
  reconcileQuestionnaireSelectionsForTemplate,
} from '@mahoshojo/domain/creator/selection';
import {
  AiReasoningPanel,
  AnswerReviewList,
  APP_FIELD_GUIDE_THEME,
  APP_SAVE_PREFERENCES_THEME,
  BulkAnswerTools,
  DetailsFieldGuidePanel,
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
  APP_SELECTION_THEME,
  DETAILS_QUESTIONNAIRE_THEME,
  QuestionnaireQuestionPanel,
  QuestionnaireSelectionPanel,
} from '@mahoshojo/ui-web/questionnaire';
import { GeneralCharacterCard, type GeneralCharacterCardData } from '@mahoshojo/ui-web/character-card';
import { MarkdownBlock } from '@mahoshojo/ui-web/markdown';
import {
  BuildRulePanel,
  BuildRulePicker,
  BuildSummaryPanel,
  CREATOR_PAGE_COPY,
  CreatorResultStageContent,
  CreatorStructuredResultCard,
  CreatorWorkbenchPage,
  FreeformBriefPanel,
  TemplateSelector,
  buildCreatorResultOverview,
  subscribeToMediaQueryChange,
  type CreatorWorkbenchSnapshot,
} from '@mahoshojo/ui-web/creator';
import { revokeBlobUrl } from '@mahoshojo/ui-web/client';
import { CardLibraryModal, type BattleSelectionPayload, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { ImagePreviewModal, useEscapeLayer } from '@mahoshojo/ui-web/modal';
import { EncyclopediaLinks } from '@mahoshojo/ui-web/encyclopedia-views';
import { ProductFooter } from '@mahoshojo/ui-web/shell';
import type { HomeAssetSource } from '@mahoshojo/ui-web/home';
import { CREATOR_DRAFT_DEFAULT_RULE_IDS, CreatorSession } from '../features/creator/session';
import type { CreatorExecutionMode } from '../features/creator/generation';
import { parseCreatorQuestionnaireCardSelection, toQuestionnaireSelection } from '../features/creator/questionnaire';
import { QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE } from '../features/questionnaire/session';
import { resolveDesktopAiTarget } from '../features/ai-config/desktop-ai-config';
import { DesktopAiProviderPanel } from '../features/ai-config/desktop-ai-provider-panel';
import { useDesktopAiConfig } from '../features/ai-config/use-desktop-ai-config';
import { useDesktopCloudSession } from '../features/account/use-desktop-cloud-session';
import { useDesktopCardLibraryHost } from '../platform/card-library-host';
import { IpcLocalCardRepository } from '../platform/local-card-bridge';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';
import { useLeaveGuard } from './useLeaveGuard';

/** Desktop 的资源服务根（与 `routes.tsx` 中同名常量同义）。 */
const DESKTOP_ASSET_SOURCE: HomeAssetSource = { baseUrl: '/' };

const actionClass = 'rounded-lg border border-(--app-border) px-4 py-2 disabled:opacity-50';

type DeviceType = 'mobile' | 'desktop' | 'unknown';
type LayoutMode = 'mobile' | 'desktop';

const sanitizeFileNamePart = (value: string): string =>
  value.replace(/[^a-z0-9一-龥]/gi, '_').slice(0, 80) || 'data';

const resolveResultJsonFileName = (
  card: Record<string, unknown>,
  cardKind: 'magical-girl' | 'canshou' | 'general' | 'general-scenario',
): string => {
  const pick = (keys: string[], fallback: string) => {
    for (const key of keys) {
      const value = card[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return fallback;
  };
  switch (cardKind) {
    case 'canshou':
      return `残兽_${sanitizeFileNamePart(pick(['name'], '未命名残兽'))}.json`;
    case 'general':
      return `通用魔法少女角色_${sanitizeFileNamePart(pick(['name'], '未命名角色'))}.json`;
    case 'general-scenario':
      return `通用情景卡_${sanitizeFileNamePart(pick(['title'], '未命名情景'))}.json`;
    default:
      return `魔法少女_${sanitizeFileNamePart(pick(['codename', 'name'], '未命名魔法少女'))}.json`;
  }
};

const createSelectionSuffix = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type ConfirmRegenerateKind = 'unsaved' | 'uncertain';

/**
 * 「重新生成」确认对话框的标题/说明文案。
 * uncertain（hosted 终态无法确认服务器是否已执行）下再次生成 = 可能的第二次
 * 服务器调用与计费，必须显式确认（与 /details 同一语义，D5.1a-r1）。
 */
const describeRegenerateConfirm = (kind: ConfirmRegenerateKind): { title: string; description: string } => ({
  title: '重新生成？',
  description: kind === 'unsaved'
    ? '当前结果尚未保存到本地卡库。重新生成将替换当前结果；即使新生成失败或取消，也无法恢复。可以先保存当前结果再生成。'
    : '无法确认上次请求是否在服务器执行——它可能已经完成并计费。再次生成会发起新的请求，可能产生重复调用与费用。',
});

function CreatorForm({ session }: { session: CreatorSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const router = useRouter();
  const { openFixed } = useExternalLinks();
  const { state: aiState } = useDesktopAiConfig();
  const target = resolveDesktopAiTarget(
    aiState.selection,
    aiState.profiles,
    aiState.generationOverrides,
    aiState.modelsByProfileId,
  );
  const profilesLoading = aiState.profilesState === 'idle' || aiState.profilesState === 'loading';
  const profilesError = aiState.profilesState === 'failed' ? aiState.profilesError : null;
  const cardLibraryHost = useDesktopCardLibraryHost();
  const { store: cloudSessionStore } = useDesktopCloudSession();
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [presetEntries, setPresetEntries] = useState<QuestionnairePresetEntry[]>([]);
  const [presetIndexLoaded, setPresetIndexLoaded] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [questionnaireError, setQuestionnaireError] = useState<string | null>(null);
  const [questionnaireLoading, setQuestionnaireLoading] = useState(true);
  const [selectionReady, setSelectionReady] = useState(false);
  const [provisionalDefault, setProvisionalDefault] = useState<QuestionnaireSelection | null>(null);
  const [reload, setReload] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState<false | ConfirmRegenerateKind>(false);
  const [showIntroduction, setShowIntroduction] = useState(true);
  const [showQuestionnaireSettings, setShowQuestionnaireSettings] = useState(false);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [detailsSelection, setDetailsSelection] = useState<QuestionnaireSelection | null>(null);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [deviceType, setDeviceType] = useState<DeviceType>('unknown');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('desktop');
  const regenerateDialog = useRef<HTMLDialogElement>(null);
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const resultSectionRef = useRef<HTMLDivElement | null>(null);
  const previousTargetsRef = useRef<QuestionnaireAnswerMatchTarget[] | null>(null);
  const previousSignatureRef = useRef<string | null>(null);
  const currentQuestionKeyRef = useRef<string | null>(null);

  // 草稿字段（创作工房协议，见 features/creator/session.ts）。
  const draft = state.draft;
  const template = draft.template;
  const generationMode = draft.generationMode;
  const freeformBrief = draft.freeformBrief;
  const selectedRuleIds = draft.selectedRuleIds ?? [...CREATOR_DRAFT_DEFAULT_RULE_IDS];
  const ruleInputsById = draft.ruleInputsById ?? {};
  const primaryRuleId = draft.primaryRuleId !== undefined
    ? draft.primaryRuleId
    : (CREATOR_DRAFT_DEFAULT_RULE_IDS[0] ?? null);
  const allowMultiple = draft.allowMultipleQuestionnaires === true;
  const updateDraft = useCallback((patch: Partial<typeof draft>) => {
    session.updateDraft({ ...session.getSnapshot().draft, ...patch });
  }, [session]);
  const updateSelections = useCallback((next: QuestionnaireSelection[]) => {
    session.updateDraft({ ...session.getSnapshot().draft, questionnaireSelections: next });
  }, [session]);

  // 构建规则：预设索引 + 当前选择/主规则/输入的运行时求值（与 Web 同一领域口径）。
  const buildRulePresetIndex = useMemo(() => loadBuildRulePresetIndex(), []);
  const primaryBuildRulePreset = useMemo(
    () => (primaryRuleId ? tryLoadBuildRulePresetById(primaryRuleId) : null),
    [primaryRuleId],
  );
  // 失效规则容错（G3-r1）：草稿只校验 ruleId 是字符串，旧版本/手工编辑的草稿
  // 可能引用已移除预设——渲染期先按预设存在性过滤再求值，失效项由模板对账
  // 效应统一剔除并回写草稿（渲染期不改草稿）。
  const evaluableRuleIds = useMemo(
    () => selectedRuleIds.filter((ruleId) => tryLoadBuildRulePresetById(ruleId) !== null),
    [selectedRuleIds],
  );
  const buildRuleRuntimeResults = useMemo(
    () => evaluableRuleIds.map((ruleId) => evaluateBuildRuleState({
      ruleId,
      inputs: ruleInputsById[ruleId] ?? createDefaultBuildRuleInputs(ruleId),
    })),
    [evaluableRuleIds, ruleInputsById],
  );
  const primaryBuildRuleRuntimeResult = useMemo(
    () => buildRuleRuntimeResults.find((rule) => rule.ruleId === primaryRuleId) ?? null,
    [buildRuleRuntimeResults, primaryRuleId],
  );
  const invalidBuildRule = useMemo(
    () => buildRuleRuntimeResults.find((rule) => rule.validationSummary.valid !== true) ?? null,
    [buildRuleRuntimeResults],
  );
  /** hosted 请求体的规则线形（`buildRules` 字段），与 Web `buildRuleRequestPayload` 同构。 */
  const buildRuleRequests = useMemo(
    () => selectedRuleIds.flatMap((ruleId) => {
      const preset = tryLoadBuildRulePresetById(ruleId);
      if (!preset) return [];
      return [{
        ruleId: preset.id,
        version: preset.version,
        inputs: ruleInputsById[ruleId] ?? createDefaultBuildRuleInputs(ruleId),
      }];
    }),
    [selectedRuleIds, ruleInputsById],
  );
  const templateLabel = getCreatorTemplateOptionById(template)?.label ?? template;
  const primaryRuleLabel = primaryRuleId
    ? (tryLoadBuildRulePresetById(primaryRuleId)?.title ?? primaryRuleId)
    : '未启用主规则';
  /** 问卷预设下拉按模板过滤：通用模板收全部，结构化模板只收同 kind（与 Web 同口径）。 */
  const visiblePresetEntries = useMemo(
    () => filterCreatorQuestionnairePresetEntries(template, presetEntries),
    [template, presetEntries],
  );
  const questionnaireFallbackKind = template === 'canshou' ? 'canshou' as const : 'magical-girl' as const;

  // 语言清单与 Web 同一来源。
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/languages.json', { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => { if (!controller.signal.aborted && Array.isArray(data)) setLanguages(data); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setDeviceType(isMobileFormFactor() ? 'mobile' : 'desktop');
  }, []);
  // 工作台布局随视口宽度切换（与 Web `layoutMode` 同一断点口径）。
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const sync = () => setLayoutMode(mediaQuery.matches ? 'mobile' : 'desktop');
    sync();
    return subscribeToMediaQueryChange(mediaQuery, sync);
  }, []);
  // 预设问卷索引：默认问卷注入与「选择预设问卷」下拉共用；失败不影响其余入口。
  useEffect(() => {
    const controller = new AbortController();
    setPresetError(null);
    void fetch('/questionnaires/presets/index.json', { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('加载预设问卷索引失败'))))
      .then((data) => {
        if (controller.signal.aborted) return;
        setPresetEntries(Array.isArray(data?.presets) ? (data.presets as QuestionnairePresetEntry[]) : []);
        setPresetIndexLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPresetEntries([]);
          setPresetIndexLoaded(true);
          setPresetError('预设问卷索引加载失败，预设下拉暂不可用；上传/卡库/粘贴入口不受影响。');
        }
      });
    return () => controller.abort();
  }, [reload]);

  const draftSelections = draft.questionnaireSelections;
  const selections: readonly QuestionnaireSelection[] = draftSelections ?? [];

  // 模板默认问卷：selectionReady 前按当前模板挑默认预设加载（只作预览，不落草稿——
  // 待恢复期间严禁写入，与 /details 内置预览同一门禁）。
  useEffect(() => {
    if (selectionReady) {
      setQuestionnaireLoading(false);
      setQuestionnaireError(null);
      return;
    }
    if (presetEntries.length === 0) {
      // 索引已落定但无可用预设（加载失败或空目录）：不再空转「加载中」，
      // 放行到空流程态——上传/卡库/粘贴与自由说明+规则仍可生成。
      if (presetIndexLoaded) {
        setSelectionReady(true);
        setQuestionnaireLoading(false);
      }
      return;
    }
    const preset = pickDefaultCreatorQuestionnairePresetEntry(template, presetEntries);
    if (!preset) {
      setSelectionReady(true);
      setQuestionnaireLoading(false);
      return;
    }
    const controller = new AbortController();
    setQuestionnaireLoading(true);
    setQuestionnaireError(null);
    void fetch(preset.path, { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('加载默认问卷失败'))))
      .then((data: unknown) => {
        if (controller.signal.aborted) return;
        const normalized = normalizeQuestionnaireDefinition(data, {
          fallbackId: preset.id,
          fallbackKind: preset.kind,
          fallbackTitle: preset.title,
          nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback('preset', data),
        });
        if (!normalized) throw new Error('默认问卷解析失败');
        const used = new Set<string>();
        setProvisionalDefault(ensureQuestionnaireSelectionId(
          { source: 'preset', questionnaire: normalized, selectionId: `builtin:${preset.id}` },
          used,
          createSelectionSuffix,
        ));
      })
      .catch(() => {
        if (!controller.signal.aborted) setQuestionnaireError('默认问卷加载失败，请重试。');
      })
      .finally(() => { if (!controller.signal.aborted) setQuestionnaireLoading(false); });
    return () => controller.abort();
  }, [reload, template, presetEntries, presetIndexLoaded, selectionReady]);

  // 落盘条件：无待恢复草稿 + 尚无选择集——默认选择才写进草稿。
  // 用户主动清空选择集后不自动回填（selectionReady 闩锁与 Web 一致）。
  useEffect(() => {
    if (selectionReady || state.pendingRestore || selections.length > 0 || !provisionalDefault) return;
    updateSelections([provisionalDefault]);
    setSelectionReady(true);
  }, [selectionReady, state.pendingRestore, selections.length, provisionalDefault, updateSelections]);

  // 切到残兽模板：以残兽默认问卷替换答题问卷，纯设定选择保留为 lore 叠加
  // （与 Web `reconcileQuestionnaireSelectionsForTemplate` 同源语义）。
  useEffect(() => {
    if (template !== 'canshou' || !selectionReady || presetEntries.length === 0) return;
    const currentAnswerable = selections.find((selection) => selection.questionnaire.questions.length > 0);
    if (currentAnswerable?.questionnaire.kind === 'canshou') return;
    const preset = pickDefaultCreatorQuestionnairePresetEntry('canshou', presetEntries);
    if (!preset) return;
    const controller = new AbortController();
    void fetch(preset.path, { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('加载残兽默认问卷失败'))))
      .then((data: unknown) => {
        if (controller.signal.aborted) return;
        const normalized = normalizeQuestionnaireDefinition(data, {
          fallbackId: preset.id,
          fallbackKind: preset.kind,
          fallbackTitle: preset.title,
          nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback('preset', data),
        });
        if (!normalized) return;
        const used = new Set<string>();
        const replacement = ensureQuestionnaireSelectionId(
          { source: 'preset', questionnaire: normalized, selectionId: `builtin:${preset.id}` },
          used,
          createSelectionSuffix,
        );
        updateSelections(reconcileQuestionnaireSelectionsForTemplate({
          template: 'canshou',
          selections: [...selections],
          replacementSelection: replacement,
        }));
        setQuestionIndex(0);
      })
      .catch(() => {
        if (!controller.signal.aborted) setQuestionnaireError('残兽默认问卷加载失败，请重试。');
      });
    return () => controller.abort();
  }, [template, selectionReady, presetEntries, selections, updateSelections]);

  // 模板切换时的规则选择对账：剔除不支持当前模板的规则、主规则失效回退
  // 首个兼容项（与 Web `reconcileCreatorBuildRuleSelection` 同一实现）。
  useEffect(() => {
    const next = reconcileCreatorBuildRuleSelection({ template, selectedRuleIds, primaryRuleId });
    const sameSelection = next.selectedRuleIds.length === selectedRuleIds.length
      && next.selectedRuleIds.every((id, index) => id === selectedRuleIds[index]);
    if (sameSelection && next.primaryRuleId === primaryRuleId) return;
    updateDraft({ selectedRuleIds: next.selectedRuleIds, primaryRuleId: next.primaryRuleId });
  }, [template, selectedRuleIds, primaryRuleId, updateDraft]);

  // direct 通路恒为结构化 JSON：执行位置切到客户端时归一为非流式（与 /free 同一效应）。
  // 客户端 direct 通路永远结构化（DESK-ONLINE-009）。D5.1-AIP-r1：不再改写
  // 草稿里的流式偏好——`effectiveGenerationMode` 表达「实际生效」方式，
  // 切回服务器后原偏好自动恢复；模板不随位置归一，hosted 兼容性在提交时检查。
  const effectiveGenerationMode: GenerationMode =
    target.location === 'client' ? 'non-stream' : generationMode;

  // 单选口径：关掉多选时仅保留 1 份可作答问卷（纯设定卡可叠加）。
  useEffect(() => {
    if (allowMultiple) return;
    const next = reconcileQuestionnaireSelectionsForSingleMode(selections);
    if (!next) return;
    updateSelections([...next]);
    setQuestionIndex(0);
  }, [allowMultiple, selections, updateSelections]);

  // 展示口径：草稿选择集优先，加载中/待恢复期间以模板默认预览。
  const effectiveSelections = useMemo<readonly QuestionnaireSelection[]>(
    () => (draftSelections?.length ? draftSelections : (provisionalDefault ? [provisionalDefault] : [])),
    [draftSelections, provisionalDefault],
  );

  // 问卷流程：多问卷展平 → 引用解析 → 条件流求值（与 /details、Web Creator 同一实现路径）。
  const flowItems = useMemo(
    () => resolveQuestionnaireReferences(buildQuestionnaireContextItems(effectiveSelections)),
    [effectiveSelections],
  );
  const answersByKey = draft.answers;
  const flow = useMemo(
    () => buildQuestionnaireFlow(flowItems, answersByKey).flow,
    [flowItems, answersByKey],
  );
  const flowIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    flow.forEach((item, index) => map.set(item.key, index));
    return map;
  }, [flow]);
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
  // 问卷集合变化后的答案重映射：旧 key 失配的回答按元数据匹配到新 key（与 Web 同效应）。
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
  // 题目流变化时尽量锚定当前题 key（跳题/选项引用会让 index 位移）。
  useEffect(() => {
    if (flow.length === 0) {
      currentQuestionKeyRef.current = null;
      if (questionIndex !== 0) setQuestionIndex(0);
      return;
    }
    const previousKey = currentQuestionKeyRef.current;
    const mapped = previousKey ? flowIndexByKey.get(previousKey) : undefined;
    const nextIndex = typeof mapped === 'number' ? mapped : Math.min(questionIndex, flow.length - 1);
    if (nextIndex !== questionIndex) setQuestionIndex(nextIndex);
    currentQuestionKeyRef.current = flow[nextIndex]?.key ?? null;
  }, [flow, flowIndexByKey, questionIndex]);

  useResultAutoScroll(resultSectionRef, Boolean(state.card), { restored: state.resultRestored });

  const selected = target.profile;
  const mode = target.mode;
  const busy = state.phase === 'generating' || state.saving;
  const blockedDraft = state.pendingRestore || session.isDraftBlocked();
  const hostedMode: CreatorExecutionMode = generationMode === 'stream' ? 'hosted-stream' : 'hosted-json';
  const executionMode: CreatorExecutionMode | null = target.location === 'server' ? hostedMode : mode;
  // 本地 Provider 配置只门禁客户端执行：server 偏好由 hosted System Default 解析。
  const clientProfilesBlocked = target.location === 'client' && (profilesLoading || profilesError !== null);
  const recommendedImageMode = recommendedSaveModes(deviceType === 'mobile').imageSaveMode;
  const recommendedJsonMode = recommendedSaveModes(deviceType === 'mobile').jsonSaveMode;
  const imageSaveMode = draft.imageSaveMode ?? recommendedImageMode;
  const jsonSaveMode = draft.jsonSaveMode ?? recommendedJsonMode;
  const showDetails = draft.showDetails === true;
  const imageSaveButtonLabel = imageSaveMode === 'download' ? '💾 一键保存长图' : '📱 打开长按保存弹窗';
  const handleSaveImage = (imageUrl: string) => {
    setSavedImageUrl(imageUrl);
    setShowImageModal(true);
  };
  useEffect(() => () => revokeBlobUrl(savedImageUrl), [savedImageUrl]);

  const currentIndex = Math.min(questionIndex, Math.max(0, flow.length - 1));
  const flowItem = flow[currentIndex];
  const question = flowItem?.question;
  const answer = flowItem ? answersByKey[flowItem.key] ?? '' : '';
  const questionHasOptions = (question?.options?.length ?? 0) > 0;
  const showTextInput = question?.allowCustom !== false || !questionHasOptions;
  const updateAnswer = (value: string) => {
    if (!flowItem) return;
    updateDraft({ answers: { ...answersByKey, [flowItem.key]: value } });
  };
  // `nativeAllowed` 是签名资格而非可用性：非原生问卷照常生成，只是不获官方签名。
  const isNativeSignatureEligible = isQuestionnaireSelectionNativeAllowed(effectiveSelections);
  const hasOverLimitAnswer = hasOverLimitQuestionnaireAnswers(flow, answersByKey);
  const questionnaireLoreText = useMemo(
    () => buildQuestionnaireSelectionLoreText(effectiveSelections),
    [effectiveSelections],
  );
  const hasLoreOnly = effectiveSelections.length > 0 && flow.length === 0
    && effectiveSelections.some((selection) => Boolean(selection.questionnaire.loreMarkdown?.trim()));

  // 预设加载竞态防护（G3-r1-r1，与 Web 同口径）：按用户操作意图而非
  // 单纯按网络请求次序处理——
  // - 单选替换 latest-wins：新的预设请求作废上一个未决请求；
  // - 多选追加保留意图：并发的预设请求各自生效、追加到最新选择集；
  // - 清除/恢复草稿、模板切换、以及单选下改选其它来源问卷，都让发起时
  //   语境失效（世代推进+中止），迟到的响应不得再写入选择集。
  const presetLoadGenerationRef = useRef(0);
  const presetLoadControllersRef = useRef<Set<AbortController>>(new Set());
  const presetLoadEpochRef = useRef(0);
  const invalidatePresetLoads = () => {
    presetLoadEpochRef.current += 1;
    presetLoadControllersRef.current.forEach((controller) => controller.abort());
    presetLoadControllersRef.current.clear();
  };
  const applySelection = (selection: QuestionnaireSelection, options?: { presetRequest?: boolean }) => {
    // 提交前读会话最新快照：异步回调不得用旧渲染闭包中的 selections
    // 覆盖较新的选择集（G3-r1-r1）。
    const draftNow = session.getSnapshot().draft;
    const multi = draftNow.allowMultipleQuestionnaires === true;
    if (!options?.presetRequest && !multi) invalidatePresetLoads();
    updateSelections(applyQuestionnaireSelection(draftNow.questionnaireSelections ?? [], selection, {
      allowMultiple: multi,
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
  const handleToggleBuildRule = (ruleId: string) => {
    const nextIds = selectedRuleIds.includes(ruleId)
      ? selectedRuleIds.filter((id) => id !== ruleId)
      : [...selectedRuleIds, ruleId];
    updateDraft({
      selectedRuleIds: nextIds,
      // 主规则被摘除时回退到剩余选中项第一个（对账效应兜底重复此口径）。
      primaryRuleId: primaryRuleId && nextIds.includes(primaryRuleId) ? primaryRuleId : (nextIds[0] ?? null),
    });
  };
  const handleBuildRuleInputsChange = (ruleId: string, nextInputs: Record<string, unknown>) => {
    updateDraft({ ruleInputsById: { ...ruleInputsById, [ruleId]: nextInputs } });
  };

  const openPicker = () => {
    setPickerError(null);
    void cloudSessionStore.refresh();
    setPickerOpen(true);
  };
  const handleSelectQuestionnaireCard = (payload: BattleSelectionPayload, context: CardLibrarySelectionContext) => {
    const parsed = parseCreatorQuestionnaireCardSelection(questionnaireFallbackKind, payload, context);
    if ('error' in parsed) {
      setPickerError(parsed.error);
      return;
    }
    applySelection(toQuestionnaireSelection(parsed.source, parsed.questionnaire));
    setPickerError(null);
    setPickerOpen(false);
  };
  // 预设手动加载按模式分流：单选下发新请求即作废旧请求（latest-wins）；
  // 多选下各请求互不取消，完成时各自追加。失效判定=中止信号 ∪ 世代
  // （清除/恢复草稿/切模板推进）∪ 单选下已有更新的预设请求 ∪ 模板已切换。
  const handleAddPreset = async (presetId: string) => {
    const preset = presetEntries.find((item) => item.id === presetId);
    if (!preset) return;
    const draftAtRequest = session.getSnapshot().draft;
    if (draftAtRequest.allowMultipleQuestionnaires !== true) {
      presetLoadControllersRef.current.forEach((controller) => controller.abort());
      presetLoadControllersRef.current.clear();
    }
    const epochAtRequest = presetLoadEpochRef.current;
    const generation = ++presetLoadGenerationRef.current;
    const controller = new AbortController();
    presetLoadControllersRef.current.add(controller);
    const templateAtRequest = draftAtRequest.template;
    const isStale = () => {
      const draftNow = session.getSnapshot().draft;
      return controller.signal.aborted
        || presetLoadEpochRef.current !== epochAtRequest
        || (draftNow.allowMultipleQuestionnaires !== true && generation !== presetLoadGenerationRef.current)
        || draftNow.template !== templateAtRequest;
    };
    try {
      const response = await fetch(preset.path, { signal: controller.signal, credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error('加载预设问卷失败');
      const data: unknown = await response.json();
      if (isStale()) return;
      const normalized = normalizeQuestionnaireDefinition(data, {
        fallbackId: preset.id,
        fallbackKind: preset.kind,
        fallbackTitle: preset.title,
        nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback('preset', data),
      });
      if (!normalized) throw new Error('预设问卷解析失败');
      const used = new Set<string>();
      applySelection(
        ensureQuestionnaireSelectionId({ source: 'preset', questionnaire: normalized }, used, createSelectionSuffix),
        { presetRequest: true },
      );
    } catch (error) {
      if (isStale()) return;
      setPresetError(error instanceof Error ? error.message : '加载预设问卷失败');
    } finally {
      presetLoadControllersRef.current.delete(controller);
    }
  };
  const normalizeUpload = (parsed: unknown, fallbackTitle: string) => {
    const normalized = normalizeQuestionnaireDefinition(parsed, {
      fallbackKind: questionnaireFallbackKind,
      fallbackId:
        parsed && typeof parsed === 'object' && typeof (parsed as { id?: unknown }).id === 'string'
          ? (parsed as { id: string }).id
          : `${questionnaireFallbackKind}-upload`,
      fallbackTitle,
      nativeAllowed: false,
    });
    if (!normalized) return null;
    // 上传件没有服务器身份可验证，nativeAllowed 恒 false（即使文件声明 true）。
    normalized.nativeAllowed = false;
    return normalized;
  };
  const handleUploadQuestionnaire = async (file: File) => {
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

  /** hosted 提交时模板×生成模式的支持矩阵；'scenario' 模板当前不接任何通路。
   * 兼容性属于「内容问题」：不按它禁用提交键，点击后如实给出原因（Web 同口径）。 */
  const hostedModeSupported = isCreatorTemplateSupportedInGenerationMode(generationMode, template);
  const canGenerateNow = !busy
    && !blockedDraft
    && !questionnaireLoading
    && guard.ready
    && executionMode !== null
    && !clientProfilesBlocked
    && !(target.location === 'client' && !selected);

  const generate = (discardUnsavedResult = false) => {
    if (!canGenerateNow) return;
    if (!discardUnsavedResult) {
      if (session.hasUnsavedResult()) { setConfirmRegenerate('unsaved'); return; }
      if (state.phase === 'uncertain') { setConfirmRegenerate('uncertain'); return; }
    }
    try {
      const answers = collectQuestionnaireFlowAnswerItems(flow, answersByKey);
      if (answers.length === 0 && buildRuleRuntimeResults.length === 0 && !freeformBrief.trim()) {
        setActionError('请至少填写一题，或补充自由说明，或提供规则车卡后再生成。');
        return;
      }
      if (invalidBuildRule) {
        setActionError('当前规则车卡存在未解决的配点或必填项问题，请先修正后再生成。');
        return;
      }
      if (template === 'scenario') {
        setActionError('「情景（结构化）」模板暂未接入生成通路，请选择其他创作模板。');
        return;
      }
      if (target.location === 'server' && !hostedModeSupported) {
        setActionError(generationMode === 'stream'
          ? '当前仅支持【通用角色卡（Markdown）】与【通用情景卡（Markdown）】使用流式创作。'
          : '当前非流式创作仅支持【魔法少女（结构化）】与【残兽（结构化）】模板。');
        return;
      }
      setActionError(null);
      setActionInfo(null);
      // 结果快照（与 Web `creatorResultSnapshot` 同义）：结果阶段的侧栏投影按
      // 「发起这次生成时」的模板/规则/题目数展示，而不是按当前编辑态。
      resultSnapshotRef.current = {
        generationMode: effectiveGenerationMode,
        template,
        templateLabel,
        primaryRuleLabel,
        questionCount: flow.length,
        nativeAllowed: isQuestionnaireGenerationNativeSignatureAllowed(effectiveSelections, hasOverLimitAnswer),
        overLimitCount: flow.filter((item) => isAnswerOverLimit(answersByKey[item.key] ?? '', item.question.maxLength)).length,
        streamFallbackLabel: template === 'general-scenario'
          ? freeformBrief.trim() || answers[0]?.answer || ''
          : answers[0]?.answer || freeformBrief.trim(),
      };
      void session.generate(
        { invoke, profileId: selected?.id ?? '' },
        {
          template,
          freeformBrief: freeformBrief.trim(),
          answers,
          language: draft.language,
          loreText: questionnaireLoreText,
          questionnaires: effectiveSelections.map((selection) => ({
            questionnaireId: selection.questionnaire.id,
            title: selection.questionnaire.title,
          })),
          buildRules: buildRuleRuntimeResults,
          buildRuleRequests,
          primaryRuleId,
          streamFallbackLabel: template === 'general-scenario'
            ? freeformBrief.trim() || answers[0]?.answer || ''
            : answers[0]?.answer || freeformBrief.trim(),
          hosted: {
            selections: [...effectiveSelections],
            allowNativeSignature: isQuestionnaireGenerationNativeSignatureAllowed(
              effectiveSelections,
              hasOverLimitAnswer,
            ),
          },
        },
        { mode: executionMode, modelId: target.modelId ?? undefined, flowers: getRandomFlowers(), overrides: target.generationOverrides },
        discardUnsavedResult,
      );
    } catch (error) { setActionError(error instanceof Error ? error.message : '创作请求无法生成。'); }
  };

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
  const applyImportedAnswers = (next: Record<string, string>) => {
    updateDraft({ answers: next });
    setActionError(null);
  };
  const buildAnswerExportText = () => buildQuestionnaireAnswerExportText({
    title: '创作问卷答案备份',
    items: collectQuestionnaireAnswerExportItems(visibleQuestionTargets, answersByKey),
    total: flow.length,
    questionnaireLabel: effectiveSelections.map((selection) => selection.questionnaire.title).join(' + '),
  });

  const resolvedResultPayload = state.card;
  const resultSignatureLabel = session.resultSignatureKind() === 'official-signed'
    ? '官方签名'
    : session.resultSignatureKind() === 'signature-unverified'
      ? '含签名字段（本机未验证）'
      : '未签名';
  const confirmCopy = confirmRegenerate === false ? null : describeRegenerateConfirm(confirmRegenerate);

  // 结果快照：供工作台侧栏「阶段/进度」投影——结果存在时以发起生成时的快照为准
  // （与 Web `creatorResultSnapshot`/`resolveCreatorWorkbenchDisplayState` 同义）。
  // 草稿恢复出的结果没有对应快照，`buildCreatorResultOverview` 对 null 快照有兜底文案。
  // 快照归属本次生成意图（G3-r1）：重新生成先把旧结果卡置空再派发，不能因为
  // card 变 null 就连带清掉刚记录的新快照；只在生成未产出结果或结果被
  // 显式清除（清草稿/无卡恢复等相位回到非生成态且无卡）时清理。
  const resultSnapshotRef = useRef<CreatorWorkbenchSnapshot | null>(null);
  useEffect(() => {
    if (!state.card && state.phase !== 'generating') resultSnapshotRef.current = null;
  }, [state.card, state.phase]);
  // 原生性文案按实际签名通路投影（G3-r1）：官方签名仅 hosted-json 新鲜
  // 响应可记；direct/hosted-stream 本来就不走签名，如实说「不支持签名」
  // 而非「签名失败」；恢复草稿中混入的签名字段经会话投影记「本机未验证」。
  const resultOverview = useMemo(() => buildCreatorResultOverview({
    isSubmitting: state.phase === 'generating',
    snapshot: resultSnapshotRef.current,
    result: resolvedResultPayload,
    signature: {
      capable: session.executionMode() === 'hosted-json',
      kind: session.resultSignatureKind(),
    },
  }), [busy, state.phase, state.resultRestored, resolvedResultPayload]);

  // —— 工作台装配（与 Web `renderWorkbenchPage` 同一组区段） ——

  const creatorConfigurationPanel = (
    <>
      <TemplateSelector
        value={template}
        disabled={busy || blockedDraft}
        onChange={(next: CreatorTemplateId) => {
          if (next !== session.getSnapshot().draft.template) invalidatePresetLoads();
          updateDraft({ template: next });
        }}
      />
      <FreeformBriefPanel
        value={freeformBrief}
        onChange={(next) => updateDraft({ freeformBrief: next })}
        disabled={busy || blockedDraft}
      />
    </>
  );

  const creatorBuildRulesPanel = (
    <div className="space-y-4">
      <BuildRulePicker
        presets={buildRulePresetIndex}
        selectedRuleIds={[...selectedRuleIds]}
        primaryRuleId={primaryRuleId}
        onToggleRule={handleToggleBuildRule}
        onSelectPrimaryRule={(ruleId) => updateDraft({ primaryRuleId: ruleId })}
        disabled={busy || blockedDraft}
      />
      {primaryBuildRulePreset ? (
        <BuildRulePanel
          preset={primaryBuildRulePreset}
          inputs={ruleInputsById[primaryBuildRulePreset.id] ?? createDefaultBuildRuleInputs(primaryBuildRulePreset.id)}
          runtimeResult={primaryBuildRuleRuntimeResult}
          onChange={(nextInputs) => handleBuildRuleInputsChange(primaryBuildRulePreset.id, nextInputs)}
          disabled={busy || blockedDraft}
        />
      ) : null}
      {primaryBuildRuleRuntimeResult ? (
        <BuildSummaryPanel runtimeResult={primaryBuildRuleRuntimeResult} />
      ) : null}
    </div>
  );

  const advancedSidebarPanel = (
    <fieldset disabled={busy || blockedDraft || questionnaireLoading || !guard.ready} className="flex min-w-0 flex-col gap-4">
      <legend className="mb-2 font-semibold">高级生成</legend>
      <DesktopAiProviderPanel
        generationMode={generationMode}
        copy={{
          serverOutput: {
            stream: 'Markdown 流式输出（未签名）',
            nonStream: '结构化 JSON 输出（问卷原生许可时可获官方签名）',
          },
          emptyProfilesHint: '问卷可以先填写，配置加载后再生成。',
          serverFootnote:
            '不使用客户端连接与凭据（由服务器侧系统默认配置解析）。切换执行位置不会丢失已填写的创作输入。',
          payloadNoun: '已填写的创作输入',
        }}
        controlsSlot={
          <>
            <GenerationModeSwitcher
              // 客户端 Direct 固定走结构化通路：展示生效的「非流式」，
              // 服务器侧的流式偏好不改写、切回服务器后恢复（D5.1-AIP-r1）。
              value={effectiveGenerationMode}
              disabled={target.location === 'client'}
              helper={false}
              onChange={(next: GenerationMode) => {
                const normalizedTemplate = normalizeCreatorTemplateForGenerationMode(next, template);
                if (normalizedTemplate !== session.getSnapshot().draft.template) invalidatePresetLoads();
                updateDraft({
                  generationMode: next,
                  template: normalizedTemplate,
                });
              }}
            />
            {target.location === 'client' && (
              <p className="text-xs text-(--app-text-subtle)">
                客户端执行为结构化 JSON 直出；你的服务器生成方式偏好保留，切回服务器后恢复。
              </p>
            )}
          </>
        }
      />
      <label className="flex flex-col gap-1">生成语言
        <select aria-label="生成语言" className="w-full rounded border border-(--app-border) bg-(--app-surface) px-3 py-2 text-(--app-text)" value={draft.language} onChange={(event) => updateDraft({ language: event.target.value })}>
          {(languages.length ? languages : [{ code: draft.language, name: draft.language }]).map((lang) => (
            <option key={lang.code} value={lang.code}>{lang.name}</option>
          ))}
        </select>
      </label>
    </fieldset>
  );

  const questionnaireTopPanel = (
    <>
      <QuestionnaireSelectionPanel
        theme={APP_SELECTION_THEME}
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
        presets={visiblePresetEntries}
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
      {flow.length > 0 && <QuestionNavigator
        theme="app"
        items={flow.map((item) => ({ id: item.key, label: item.question.question }))}
        currentIndex={currentIndex}
        onNavigate={setQuestionIndex}
        isAnswered={(index) => Boolean(answersByKey[flow[index]!.key]?.trim())}
      />}
      {!blockedDraft && flow.length > 0 && <BulkAnswerTools
        variant="app"
        targets={allQuestionTargets}
        indexFallbackTargets={visibleQuestionTargets}
        answersByKey={answersByKey}
        onApplyAnswers={applyImportedAnswers}
        onInfo={setActionInfo}
        onError={(message) => setActionError(`⚠️ ${message}`)}
        disabled={busy}
      />}
      {!blockedDraft && flow.length > 0 && <AnswerReviewList
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
        filenameBase="创作工房_答案备份"
        hasContent={visibleQuestionTargets.some((item) => Boolean(answersByKey[item.key]?.trim()))}
        buildContent={buildAnswerExportText}
        disabled={busy}
      />
    </>
  );

  const questionnaireEditorMainContent = (
    <>
      {flowItem && question && <QuestionnaireQuestionPanel
        theme={DETAILS_QUESTIONNAIRE_THEME}
        progressLabel={`问题 ${currentIndex + 1} / ${flow.length}`}
        progressPercent={Math.round(((currentIndex + 1) / flow.length) * 100)}
        questionText={question.question}
        questionnaireTitle={flowItem.questionnaireTitle}
        noticeText="请基于您构想的虚拟角色身份回答，并确保内容符合公序良俗，请勿使用任何真实信息。"
        helperText={question.helperText}
        isRequired={question.required === true}
        skipText="本题可跳过，不作答将不会记录"
        quickOptions={question.allowCustom !== false ? ['还没想好', '不想回答'] : []}
        onQuickOption={updateAnswer}
        options={question.options}
        optionsHintText={question.allowCustom !== false
          ? '推荐选项（点击填写，也可继续补充文本）'
          : '推荐选项（本题仅可从选项中选择）'}
        onOptionSelect={updateAnswer}
        suggestions={showTextInput ? question.suggestions : undefined}
        onSuggestionSelect={updateAnswer}
        showTextInput={showTextInput}
        answer={answer}
        onAnswerChange={updateAnswer}
        placeholder={question.placeholder ?? '请输入您的答案（建议控制在适中长度）'}
        answerLength={answer.trim().length}
        showLimitLabel
        limitLabel={`建议不超过 ${getAnswerLimitInfo(question.maxLength).limit ?? 500} 字，不限制生成`}
        isOverLimit={isAnswerOverLimit(answer, question.maxLength)}
        overLimitText="回答超过建议长度，仍可生成但不具备原生性。"
        prevLabel="上一题"
        nextButtonContent="下一题"
        onPrev={() => setQuestionIndex((index) => Math.max(0, index - 1))}
        onNext={() => {
          if (question.required === true && !answer.trim()) {
            setActionError('本题为必答，请填写后再继续。');
            return;
          }
          setActionError(null);
          setQuestionIndex((index) => Math.min(flow.length - 1, index + 1));
        }}
        disablePrev={currentIndex === 0}
        disableNext={currentIndex >= flow.length - 1}
        prevButtonClass={actionClass}
        nextButtonClass={actionClass}
      />}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className={actionClass} disabled={!canGenerateNow} onClick={() => generate()}>
          {state.phase === 'generating' ? '正在生成…' : state.phase === 'idle' ? '生成数据卡' : '重新生成'}
        </button>
        {state.phase === 'generating' && <button className={actionClass} onClick={() => session.cancel()}>取消生成</button>}
      </div>
      {isNativeSignatureEligible && hasOverLimitAnswer && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          ⚠️ 已有答案超过字数上限（原生统一上限 {QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS} 字），继续提交将导致生成内容丧失原生性。
        </div>
      )}
      <div className="text-center mt-4">
        <button
          onClick={() => void router.navigate({ to: '/' })}
          className="footer-link"
        >
          返回首页
        </button>
      </div>
    </>
  );

  const creatorResultContent = (
    <div ref={resultSectionRef} className="flex flex-col gap-3">
      {resolvedResultPayload && <h2 className="text-xl font-semibold">
        {state.cardKind === 'general-scenario'
          ? (typeof resolvedResultPayload.title === 'string' && resolvedResultPayload.title ? resolvedResultPayload.title : '未命名情景')
          : state.cardKind === 'canshou'
            ? (typeof resolvedResultPayload.name === 'string' && resolvedResultPayload.name ? resolvedResultPayload.name : '未命名残兽')
            : (typeof resolvedResultPayload.name === 'string' && resolvedResultPayload.name ? resolvedResultPayload.name : typeof resolvedResultPayload.codename === 'string' && resolvedResultPayload.codename ? resolvedResultPayload.codename : '未命名角色')}
        {' · '}{resultSignatureLabel}
      </h2>}
      {state.cardKind === 'general' && resolvedResultPayload && (
        <GeneralCharacterCard
          general={resolvedResultPayload as unknown as GeneralCharacterCardData}
          onSaveImage={handleSaveImage}
          imageSaveMode={imageSaveMode}
          saveButtonLabel={imageSaveButtonLabel}
        />
      )}
      {state.cardKind === 'general-scenario' && resolvedResultPayload && (
        <div className="rounded-2xl border border-(--app-border) bg-(--app-surface) p-4">
          <h3 className="text-lg font-semibold">{typeof resolvedResultPayload.title === 'string' ? resolvedResultPayload.title : '未命名情景'}</h3>
          <div className="mt-3">
            <MarkdownBlock content={typeof resolvedResultPayload.content === 'string' ? resolvedResultPayload.content : ''} />
          </div>
        </div>
      )}
      {(state.cardKind === 'magical-girl' || state.cardKind === 'canshou') && resolvedResultPayload && (
        <CreatorStructuredResultCard
          template={state.cardKind}
          result={resolvedResultPayload}
          onSaveImage={handleSaveImage}
          imageSaveMode={imageSaveMode}
          saveButtonLabel={imageSaveButtonLabel}
        />
      )}
      {resolvedResultPayload && <>
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
          footerNote="提示：偏好设置已保存在本机草稿中，下次打开仍会保留；切换不会丢失生成结果。"
        />
        <DetailsFieldGuidePanel
          theme={APP_FIELD_GUIDE_THEME}
          expanded={showDetails}
          onToggle={() => updateDraft({ showDetails: !showDetails })}
        />
        <section aria-label="保存原始数据" className="rounded-lg border border-(--app-border) p-4">
          <h3 className="text-lg font-medium">保存设定文件</h3>
          <div className="mt-3 flex flex-col gap-3">
            <SaveJsonButton
              data={resolvedResultPayload}
              mode={jsonSaveMode}
              recommendedMode={recommendedJsonMode}
              resolveFileName={(data) => resolveResultJsonFileName(data as Record<string, unknown>, state.cardKind ?? 'magical-girl')}
            />
            <button className={actionClass} onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(resolvedResultPayload, null, 2)).then(() => setActionInfo('✅ 数据卡 JSON 已复制到剪贴板')).catch(() => setActionError('复制失败，请手动选择 JSON 内容后复制。')); }}>复制到剪贴板</button>
          </div>
          <JsonSizeIndicator
            data={resolvedResultPayload}
            maxBytes={MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES}
            hintText="按 UTF-8 字节估算，对照本地卡单条记录上限"
            warningText="⚠️ 接近本地卡单条上限（4 MiB），保存到本地卡库可能失败，请先精简数据。"
          />
        </section>
        <section aria-label="继续创作" className="rounded-lg border border-(--app-border) p-4">
          <p className="text-sm text-(--app-text-muted)">保存好你的设定文件了吗？可以继续修改问卷与规则后重新生成，或前往本地卡库查看已保存的数据卡。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={actionClass} disabled={!canGenerateNow} onClick={() => generate()}>重新生成</button>
            <Link to="/local-library" className={actionClass}>前往本地卡库</Link>
          </div>
        </section>
      </>}
    </div>
  );

  const renderWorkbenchPage = ({
    sidebarStage,
    mainStage,
    mainTitle,
    mainContent,
    overviewStageLabel,
    progressLabel,
    nativeHint,
    configuration = creatorConfigurationPanel,
    buildRules = creatorBuildRulesPanel,
    advanced = advancedSidebarPanel,
    mainTopContent = questionnaireTopPanel,
    showFooter = false,
  }: {
    sidebarStage: 'intro' | 'questionnaire' | 'result';
    mainStage: 'status' | 'intro' | 'questionnaire' | 'result';
    mainTitle?: string;
    mainContent: React.ReactNode;
    overviewStageLabel: string;
    progressLabel: string;
    nativeHint: string;
    configuration?: React.ReactNode;
    buildRules?: React.ReactNode;
    advanced?: React.ReactNode;
    mainTopContent?: React.ReactNode;
    showFooter?: boolean;
  }) => (
    <CreatorWorkbenchPage
      layoutMode={layoutMode}
      sidebarResetKey={sidebarStage}
      sidebarStage={sidebarStage}
      mainStage={mainStage}
      overviewStageLabel={overviewStageLabel}
      progressLabel={progressLabel}
      templateLabel={templateLabel}
      primaryRuleLabel={primaryRuleLabel}
      nativeHint={nativeHint}
      configuration={configuration}
      buildRules={buildRules}
      advanced={advanced}
      mainTopContent={mainTopContent}
      mainTitle={mainTitle}
      mainContent={(
        <>
          {/* 草稿状态/门禁提示——Desktop 私有区段，Web 各页散在 storage draft 实现。 */}
          <section aria-label="草稿" className="mb-4 rounded-lg border border-(--app-border) bg-(--app-surface-70) p-3 text-sm">
            {state.pendingRestore && <div role="status" className="flex flex-wrap items-center gap-2"><span>发现上次草稿，请选择恢复或清除。</span><button className={actionClass} onClick={() => {
              previousTargetsRef.current = null;
              previousSignatureRef.current = null;
              invalidatePresetLoads();
              session.restoreDraft(); setShowIntroduction(false); setSelectionReady(true);
            }}>恢复草稿</button></div>}
            {state.draftError && <p role="alert">{state.draftError}</p>}
            {!state.pendingRestore && !state.draftError && <p role="status">{state.draftSaved ? '当前内容已保存或无待保存变更。' : '当前内容尚未保存到草稿。'}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {state.draftError && !session.isDraftBlocked() && <button className={actionClass} disabled={busy || state.pendingRestore} onClick={() => session.retryDraftSave()}>重试保存草稿</button>}
              <button className={actionClass} disabled={busy} onClick={() => setConfirmClear(true)}>清除草稿</button>
            </div>
            {confirmClear && <div role="group" aria-label="确认清除草稿" className="mt-3 rounded border p-3">
              <p>确认清除本页回答、创作输入、生成结果和中断正文？已保存的本地卡不受影响。此操作无法撤销。</p>
              <button className={actionClass} disabled={busy} onClick={() => {
                previousTargetsRef.current = null;
                previousSignatureRef.current = null;
                invalidatePresetLoads();
                session.discardDraft(); setConfirmClear(false); setQuestionIndex(0); setShowIntroduction(true); setSelectionReady(false); setProvisionalDefault(null);
              }}>确认清除</button>
              <button className={actionClass} onClick={() => setConfirmClear(false)}>保留草稿</button>
            </div>}
          </section>
          {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
          {guard.message && <p role="alert">{guard.message}</p>}
          {profilesLoading && target.location === 'client' && <p role="status">正在读取本地 Provider 配置…</p>}
          {profilesError && <p role="alert">{target.location === 'server' ? '本地 Provider 配置加载失败，仅影响客户端执行。' : profilesError}</p>}
          {actionError && <p role="alert">{actionError}</p>}
          {actionInfo && <p role="status">{actionInfo}</p>}
          {state.message && <p role={state.phase === 'uncertain' ? 'alert' : 'status'}>{state.message}</p>}
          {state.reasoning && <AiReasoningPanel reasoning={state.reasoning} />}
          {mainContent}
          {state.rawText && <details open={state.phase !== 'completed'} className="mt-4"><summary>原始输出正文</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-3">{state.rawText}</pre></details>}
        </>
      )}
      showFooter={showFooter}
      footer={(
        <ProductFooter
          textWhite
          assetSource={DESKTOP_ASSET_SOURCE}
          onNavigateInternal={(href) => navigateByProductHref(router, href)}
          resolveInternalHref={resolveInternalHrefForHashHistory}
          onNavigateExternal={openFixed}
        />
      )}
      overlayContent={(
        <>
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
          <dialog ref={detailsDialog} aria-labelledby="selection-details-title" className="m-auto max-w-2xl rounded-lg border border-(--app-border) bg-(--app-surface) p-5 text-(--app-text) backdrop:bg-black/40" onCancel={() => setDetailsSelection(null)}>
            <h2 id="selection-details-title" className="text-xl font-semibold">
              {detailsSelection?.questionnaire.title ?? '问卷详情'}
            </h2>
            {detailsSelection && (
              <>
                <p className="mt-2 text-sm text-(--app-text-muted)">
                  来源：{detailsSelection.selectionId?.startsWith('cache:') ? '公开库缓存快照（可能与线上最新版本不同）' : detailsSelection.source === 'preset' ? '预设' : detailsSelection.source === 'upload' ? '本地上传/本地库' : '云端数据卡'}
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
          <ImagePreviewModal
            isOpen={showImageModal}
            imageUrl={savedImageUrl}
            onClose={() => setShowImageModal(false)}
          />
          <CardLibraryModal
            host={cardLibraryHost}
            isOpen={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onSelectCard={handleSelectQuestionnaireCard}
            selectedType="questionnaire"
            allowedTypes={['questionnaire']}
            titleOverride="选择问卷数据卡"
            externalError={pickerError}
            initialTab="local"
            allowDeckImport={false}
          />
        </>
      )}
    />
  );

  if (!selectionReady || questionnaireLoading) {
    return renderWorkbenchPage({
      sidebarStage: 'intro',
      mainStage: 'status',
      mainContent: (
        <div className="space-y-3 text-center">
          <div className="text-center text-lg">{questionnaireError ?? presetError ?? (state.pendingRestore ? '草稿待处理，请先选择恢复或清除。' : '加载中...')}</div>
          {(questionnaireError || presetError) && <button className={actionClass} onClick={() => { setReload((value) => value + 1); }}>重新加载</button>}
        </div>
      ),
      overviewStageLabel: '初始化中',
      progressLabel: '正在加载创作工房',
      nativeHint: '加载完成后显示原生性提示',
    });
  }

  if (flow.length === 0) {
    return renderWorkbenchPage({
      sidebarStage: 'questionnaire',
      mainStage: 'status',
      mainContent: (
        <div className="space-y-4 text-center">
          <div className="error-message">
            {hasLoreOnly
              ? '当前所选问卷仅包含设定（无题目），请在「问卷设置」中再添加一份有题目的问卷。'
              : '当前没有可作答的题目。'}
          </div>
          <div className="text-xs text-(--app-text-subtle)">
            {hasLoreOnly
              ? '关闭「允许同时回答多份问卷」时，也可以叠加纯设定卡；但你仍需要至少一份有题目的问卷用于作答。仅有自由说明或规则车卡时也可以直接生成。'
              : '可以在「问卷设置」中添加问卷；仅有自由补充说明或规则车卡时也可以直接生成。'}
          </div>
          {hasLoreOnly && (
            <div className="flex flex-col items-center justify-center gap-2">
              <button
                type="button"
                className={actionClass}
                onClick={() => {
                  updateSelections([]);
                  setSelectionReady(false);
                  setProvisionalDefault(null);
                  setReload((value) => value + 1);
                }}
              >
                恢复默认问卷
              </button>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button className={actionClass} disabled={!canGenerateNow} onClick={() => generate()}>
              {state.phase === 'generating' ? '正在生成…' : '直接生成'}
            </button>
            {state.phase === 'generating' && <button className={actionClass} onClick={() => session.cancel()}>取消生成</button>}
          </div>
        </div>
      ),
      overviewStageLabel: '问卷不可用',
      progressLabel: '暂无可作答题目',
      nativeHint: hasLoreOnly ? '请补充至少一份有题目的问卷' : '可用自由说明或规则车卡直接生成',
    });
  }

  if (showIntroduction && !state.pendingRestore) {
    return renderWorkbenchPage({
      sidebarStage: 'intro',
      mainStage: 'intro',
      mainTitle: CREATOR_PAGE_COPY.headTitle,
      mainContent: (
        <div className="text-center">
          <div className="mb-6 leading-relaxed" style={{ lineHeight: '1.5', marginTop: '3rem', marginBottom: '4rem' }}>
            <p className="text-2xl font-semibold text-slate-900">{CREATOR_PAGE_COPY.heroTitle}</p>
            <p className="mt-4 text-base text-slate-600">{CREATOR_PAGE_COPY.heroBody}</p>
          </div>
          <div className="mb-6 rounded-r-lg border-l-4 border-yellow-500 bg-yellow-100 p-3 text-left text-sm text-yellow-800">
            <p className="font-bold">{CREATOR_PAGE_COPY.noticeTitle}</p>
            <p className="mt-1">{CREATOR_PAGE_COPY.noticeBody}</p>
          </div>
          {/* 百科入口与 Web `/creator` 介绍页同构（差距收口）。 */}
          <EncyclopediaLinks
            items={[
              { slug: 'creator', text: '百科：创作工房使用说明' },
              { slug: 'character-generator', text: '百科：角色生成入口说明' },
              { slug: 'archive', text: '百科：档案馆（角色管理）' },
            ]}
            onNavigate={(href) => navigateByProductHref(router, href)}
            resolveInternalHref={resolveInternalHrefForHashHistory}
          />
          <div className="mt-6 flex flex-col justify-center gap-4 sm:flex-row">
            <button onClick={() => setShowIntroduction(false)} className="generate-button text-lg flex-1">
              开始回答问卷
            </button>
          </div>
          <div className="text-center" style={{ marginTop: '2rem' }}>
            <button onClick={() => void router.navigate({ to: '/' })} className="footer-link">
              返回首页
            </button>
          </div>
        </div>
      ),
      overviewStageLabel: '准备中',
      progressLabel: '尚未开始答题',
      nativeHint: '开始答题后显示原生性与限制提示',
      showFooter: true,
    });
  }

  if (!state.card) {
    return renderWorkbenchPage({
      sidebarStage: 'questionnaire',
      mainStage: 'questionnaire',
      mainTitle: flowItem?.questionnaireTitle || `问题 ${currentIndex + 1} / ${flow.length}`,
      mainContent: questionnaireEditorMainContent,
      overviewStageLabel: '答题中',
      progressLabel: `问题 ${currentIndex + 1} / ${flow.length}`,
      nativeHint: !isNativeSignatureEligible
        ? '当前问卷未获得原生许可'
        : hasOverLimitAnswer
          ? '已有答案超过字数上限'
          : '当前仍具备原生性',
      showFooter: true,
    });
  }

  return renderWorkbenchPage({
    sidebarStage: 'result',
    mainStage: 'result',
    mainContent: (
      <CreatorResultStageContent
        questionnaireEditor={flow.length > 0 ? questionnaireEditorMainContent : undefined}
        resultContent={creatorResultContent}
      />
    ),
    overviewStageLabel: resultOverview.stageLabel,
    progressLabel: resultOverview.progressLabel,
    nativeHint: resultOverview.nativeHint,
    showFooter: true,
  });
}

export function DesktopCreator() {
  const [session, setSession] = useState<CreatorSession | null>(null);
  useEffect(() => {
    const owner = new CreatorSession({
      storage: {
        getItem: (key) => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value),
        removeItem: (key) => window.localStorage.removeItem(key),
      },
      repository: new IpcLocalCardRepository(invoke),
      initialDraft: {
        answers: {},
        language: QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE,
        template: 'general',
        generationMode: 'stream',
        freeformBrief: '',
        selectedRuleIds: [...CREATOR_DRAFT_DEFAULT_RULE_IDS],
        primaryRuleId: CREATOR_DRAFT_DEFAULT_RULE_IDS[0] ?? null,
      },
    });
    setSession(owner);
    const onPageHide = () => owner.cancel();
    window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); owner.dispose(); };
  }, []);
  return session ? <CreatorForm session={session} /> : <p role="status">正在准备创作工房…</p>;
}
