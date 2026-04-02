import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

import CanshouCard from '@/components/CanshouCard';
import QuestionNavigator from '@/components/QuestionNavigator';
import { BuildRulePanel } from '@/components/creator/BuildRulePanel';
import { BuildRulePicker } from '@/components/creator/BuildRulePicker';
import { BuildSummaryPanel } from '@/components/creator/BuildSummaryPanel';
import { FreeformBriefPanel } from '@/components/creator/FreeformBriefPanel';
import {
  TemplateSelector,
  type CreatorTemplateOption,
} from '@/components/creator/TemplateSelector';
import { ErrorMessage } from '@/components/ErrorMessage';
import Footer from '@/components/Footer';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import GeneralScenarioCard from '@/components/GeneralScenarioCard';
import MagicalGirlCard from '@/components/MagicalGirlCard';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import {
  DETAILS_QUESTIONNAIRE_THEME,
  QuestionnaireQuestionPanel,
} from '@/components/questionnaire/QuestionnaireQuestionPanel';
import { JsonSizeIndicator } from '@/components/shared/JsonSizeIndicator';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { AI_META_REQUEST_HEADER, AI_META_REQUEST_VALUE, readJsonWithAiMeta } from '@/lib/client/read-json-with-ai-meta';
import { resolveApiErrorMessage, readJsonOrTextFromResponse } from '@/lib/client/apiError';
import { downloadBlob } from '@/lib/client/blobUrl';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { authStorage } from '@/lib/auth';
import { getCreatorClientValidationMessage } from '@/lib/creator/client-validation';
import { evaluateBuildRuleState, type BuildRuleRuntimeResult } from '@/lib/creator/build-rule-runtime';
import { loadBuildRulePresetById, loadBuildRulePresetIndex } from '@/lib/creator/build-rules';
import {
  CREATOR_DRAFT_STORAGE_KEY,
  buildCreatorDraftPayload,
  parseCreatorDraftPayload,
} from '@/lib/creator/draft';
import {
  buildCreatorQuestionnaireAnswerItems,
  buildCreatorQuestionnaireItems,
  buildCreatorQuestionnaireRequestData,
  createCreatorQuestionnaireSelectionFromParsed,
  removeCreatorQuestionnaireAnswersForSelection,
  type CreatorQuestionnaireSelection,
} from '@/lib/creator/questionnaires';
import { isCreatorStreamTemplate, type CreatorTemplateId } from '@/lib/creator/templates';
import { readTextAndReasoningStreamFromResponse } from '@/lib/stream/read-text-and-reasoning-stream';
import {
  buildGeneralCharacterCardFromMarkdown,
  buildGeneralScenarioCardFromMarkdown,
} from '@/lib/stream/markdown-card';
import {
  buildQuestionnaireFlow,
  resolveQuestionnaireReferences,
  type QuestionnairePresetEntry,
} from '@/lib/questionnaires';

const TEMPLATE_OPTIONS: readonly CreatorTemplateOption[] = [
  {
    id: 'magical-girl',
    label: '魔法少女（结构化）',
    description: '完整字段结构，适合后续升华、竞技场和车卡规则联动。',
  },
  {
    id: 'canshou',
    label: '残兽（结构化）',
    description: '结构化怪物卡，适合直接承载概念、情绪与战斗手段。',
  },
  {
    id: 'general',
    label: '通用角色卡（Markdown）',
    description: '适合自由展开正文，也支持第一阶段流式生成。',
    streamable: true,
  },
  {
    id: 'scenario',
    label: '情景（结构化）',
    description: '保留 elements 结构，适合后续与竞技场或故事模式联动。',
  },
  {
    id: 'general-scenario',
    label: '通用情景卡（Markdown）',
    description: '用长文本写情景，适合气氛、事件与发展方向的自由创作。',
    streamable: true,
  },
] as const;

const DEFAULT_RULE_INPUTS: Record<string, Record<string, unknown>> = {
  'arena-trpg-lite': {
    powerLevel: 'seed',
    coreAttributes: {
      STR: 10,
      CON: 10,
      AGI: 10,
      MAG: 10,
      WILL: 10,
      PER: 10,
      CHM: 10,
    },
    specialties: [],
  },
};

const MAGICAL_GIRL_GRADIENT =
  'linear-gradient(135deg, #ff8fb8 0%, #ffb5a7 35%, #7c4dff 100%)';

const readRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getCreatorResultKind = (
  template: CreatorTemplateId
): 'character' | 'scenario' =>
  template === 'scenario' || template === 'general-scenario'
    ? 'scenario'
    : 'character';

const sanitizeDownloadSegment = (value: string, fallback: string): string => {
  const sanitized = value
    .replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

  return sanitized || fallback;
};

const getCreatorResultDownloadFileName = (
  template: CreatorTemplateId,
  data: Record<string, unknown>
): string => {
  const kind = getCreatorResultKind(template);
  const rawName =
    kind === 'scenario'
      ? (typeof data.title === 'string' ? data.title : '')
      : typeof data.codename === 'string'
        ? data.codename
        : (typeof data.name === 'string' ? data.name : '');
  const safeName = sanitizeDownloadSegment(
    rawName,
    kind === 'scenario' ? '自定义情景' : '自定义角色'
  );

  return `${kind === 'scenario' ? '数据卡_情景' : '数据卡_角色'}_${safeName}.json`;
};

export const extractMissingBuildRulePresetIds = (
  value: unknown,
  presetLookup: Record<string, { id: string }>
): string[] => {
  const record = readRecord(value);
  const buildState = readRecord(record.buildState);
  const rules = Array.isArray(buildState.rules) ? buildState.rules : [];

  return rules
    .map((rule) => readRecord(rule).ruleId)
    .filter(
      (ruleId): ruleId is string =>
        typeof ruleId === 'string' && ruleId.trim().length > 0
    )
    .filter((ruleId, index, allRuleIds) => allRuleIds.indexOf(ruleId) === index)
    .filter((ruleId) => !presetLookup[ruleId]);
};

const structuredScenarioPreview = (data: Record<string, unknown>) => (
  <div className="result-card" style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #0f172a 100%)' }}>
    <div className="result-content">
      <div className="result-item">
        <div className="result-label">情景标题</div>
        <div className="result-value text-2xl font-bold text-white">
          {typeof data.title === 'string' && data.title.trim()
            ? data.title
            : '未命名情景'}
        </div>
      </div>
      <div className="result-item">
        <div className="result-label">结构化结果</div>
        <pre className="result-value overflow-x-auto whitespace-pre-wrap text-xs text-white/90">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  </div>
);

const getDefaultRuleInput = (ruleId: string): Record<string, unknown> =>
  DEFAULT_RULE_INPUTS[ruleId]
    ? JSON.parse(JSON.stringify(DEFAULT_RULE_INPUTS[ruleId])) as Record<string, unknown>
    : {};

export default function CreatorPage(props: {
  initialResultForTest?: Record<string, unknown> | null;
}) {
  const [template, setTemplate] = useState<CreatorTemplateId>('general');
  const [generationMode, setGenerationMode] =
    useState<GenerationMode>('non-stream');
  const [freeformBrief, setFreeformBrief] = useState('');
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [primaryRuleId, setPrimaryRuleId] = useState<string | null>(null);
  const [ruleInputs, setRuleInputs] = useState<Record<string, Record<string, unknown>>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resultData, setResultData] = useState<Record<string, unknown> | null>(
    props.initialResultForTest ?? null
  );
  const [streamedResult, setStreamedResult] =
    useState<Record<string, unknown> | null>(null);
  const [streamingMarkdown, setStreamingMarkdown] = useState('');
  const [draftRestoreReady, setDraftRestoreReady] = useState(false);
  const [questionnairePresetEntries, setQuestionnairePresetEntries] = useState<
    QuestionnairePresetEntry[]
  >([]);
  const [questionnairePresetIndexReady, setQuestionnairePresetIndexReady] =
    useState(false);
  const [selectedQuestionnaires, setSelectedQuestionnaires] = useState<
    CreatorQuestionnaireSelection[]
  >([]);
  const [questionnaireAnswersByKey, setQuestionnaireAnswersByKey] = useState<
    Record<string, string>
  >({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentQuestionAnswer, setCurrentQuestionAnswer] = useState('');
  const [questionnaireLoadError, setQuestionnaireLoadError] = useState<string | null>(
    null
  );
  const [showPasteQuestionnaireImport, setShowPasteQuestionnaireImport] =
    useState(false);
  const [pasteQuestionnaireText, setPasteQuestionnaireText] = useState('');
  const [pasteQuestionnaireError, setPasteQuestionnaireError] = useState<string | null>(
    null
  );
  const [pendingQuestionnaireDraft, setPendingQuestionnaireDraft] = useState<{
    questionnaireSelections?: Array<Record<string, unknown>>;
    presetIds: string[];
    answersByKey: Record<string, string>;
    currentQuestionIndex: number;
  } | null>(null);

  const presetIndex = useMemo(() => loadBuildRulePresetIndex(), []);
  const presets = useMemo(
    () => presetIndex.map((entry) => loadBuildRulePresetById(entry.id)),
    [presetIndex]
  );
  const presetLookup = useMemo(
    () =>
      presets.reduce<Record<string, (typeof presets)[number]>>((acc, preset) => {
        acc[preset.id] = preset;
        return acc;
      }, {}),
    [presets]
  );
  const selectedPresets = useMemo(
    () =>
      selectedRuleIds
        .map((ruleId) => presetLookup[ruleId])
        .filter(Boolean),
    [presetLookup, selectedRuleIds]
  );
  const buildRules = useMemo<BuildRuleRuntimeResult[]>(
    () =>
      selectedPresets.map((preset) =>
        evaluateBuildRuleState({
          ruleId: preset.id,
          inputs: ruleInputs[preset.id] ?? getDefaultRuleInput(preset.id),
        })
      ),
    [ruleInputs, selectedPresets]
  );
  const questionnaireItems = useMemo(
    () => buildCreatorQuestionnaireItems(selectedQuestionnaires),
    [selectedQuestionnaires]
  );
  const resolvedQuestionnaireItems = useMemo(
    () => resolveQuestionnaireReferences(questionnaireItems),
    [questionnaireItems]
  );
  const { flow: mergedQuestions } = useMemo(
    () =>
      buildQuestionnaireFlow(resolvedQuestionnaireItems, questionnaireAnswersByKey),
    [questionnaireAnswersByKey, resolvedQuestionnaireItems]
  );
  const questionnaireAnswerItems = useMemo(
    () =>
      buildCreatorQuestionnaireAnswerItems(
        mergedQuestions,
        questionnaireAnswersByKey
      ),
    [mergedQuestions, questionnaireAnswersByKey]
  );
  const questionnaireRequestData = useMemo(
    () =>
      buildCreatorQuestionnaireRequestData(
        selectedQuestionnaires,
        questionnaireAnswerItems
      ),
    [questionnaireAnswerItems, selectedQuestionnaires]
  );

  const loadQuestionnaireSelectionFromPreset = useCallback(async (
    presetEntry: QuestionnairePresetEntry
  ): Promise<CreatorQuestionnaireSelection> => {
    const response = await fetch(presetEntry.path);
    if (!response.ok) {
      throw new Error('加载预设问卷失败');
    }

    const data = await response.json();
    return createCreatorQuestionnaireSelectionFromParsed({
      source: 'preset',
      parsed: data,
      fallbackId: presetEntry.id,
      fallbackKind: presetEntry.kind,
      fallbackTitle: presetEntry.title,
      nativeAllowed: true,
      presetId: presetEntry.id,
    });
  }, []);

  const createQuestionnaireSelectionSuffix = useCallback(() => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  const appendQuestionnaireSelection = useCallback(
    (selection: CreatorQuestionnaireSelection) => {
      setSelectedQuestionnaires((current) => {
        if (
          selection.presetId &&
          current.some((item) => item.presetId === selection.presetId)
        ) {
          return current;
        }

        const usedSelectionIds = new Set<string>();
        current.forEach((item) => {
          const existingId = item.selectionId.trim() || item.questionnaire.id;
          if (existingId) {
            usedSelectionIds.add(existingId);
          }
        });

        const baseId = selection.questionnaire.id || 'creator-questionnaire';
        let nextSelectionId = selection.selectionId.trim() || baseId;
        if (usedSelectionIds.has(nextSelectionId)) {
          nextSelectionId = `${baseId}::${createQuestionnaireSelectionSuffix()}`;
        }

        return [...current, { ...selection, selectionId: nextSelectionId }];
      });

      setQuestionnaireLoadError(null);
      setPasteQuestionnaireError(null);
      setPasteQuestionnaireText('');
      setShowPasteQuestionnaireImport(false);
      setError(null);
    },
    [createQuestionnaireSelectionSuffix]
  );

  useEffect(() => {
    if (!isCreatorStreamTemplate(template) && generationMode === 'stream') {
      setGenerationMode('non-stream');
    }
  }, [generationMode, template]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;

    void fetch('/questionnaires/presets/index.json')
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.presets)
          ? (data.presets as QuestionnairePresetEntry[])
          : [];
        setQuestionnairePresetEntries(list);
        setQuestionnairePresetIndexReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setQuestionnaireLoadError('加载问卷预设列表失败');
        setQuestionnairePresetIndexReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const savedDraft = window.localStorage.getItem(CREATOR_DRAFT_STORAGE_KEY);
      if (!savedDraft) {
        setDraftRestoreReady(true);
        return;
      }

      const parsedDraft = parseCreatorDraftPayload(savedDraft);
      if (!parsedDraft) {
        setDraftRestoreReady(true);
        return;
      }

      const nextSelectedRuleIds = parsedDraft.selectedRuleIds.filter(
        (ruleId) => Boolean(presetLookup[ruleId])
      );
      const nextPrimaryRuleId =
        parsedDraft.primaryRuleId &&
        nextSelectedRuleIds.includes(parsedDraft.primaryRuleId)
          ? parsedDraft.primaryRuleId
          : null;

      setTemplate(parsedDraft.template);
      setGenerationMode(parsedDraft.generationMode);
      setFreeformBrief(parsedDraft.freeformBrief);
      setSelectedRuleIds(nextSelectedRuleIds);
      setPrimaryRuleId(nextPrimaryRuleId);
      setRuleInputs(parsedDraft.ruleInputs);
      const nextPendingQuestionnaireDraft =
        (parsedDraft.questionnaireSelections?.length ?? 0) > 0 ||
        (parsedDraft.questionnairePresetIds?.length ?? 0) > 0
          ? {
          questionnaireSelections: parsedDraft.questionnaireSelections ?? [],
          presetIds: parsedDraft.questionnairePresetIds ?? [],
          answersByKey: parsedDraft.questionnaireAnswersByKey ?? {},
          currentQuestionIndex: parsedDraft.currentQuestionIndex ?? 0,
        }
          : null;

      setPendingQuestionnaireDraft(nextPendingQuestionnaireDraft);
      if (!nextPendingQuestionnaireDraft) {
        setDraftRestoreReady(true);
      }
    } catch {
      // localStorage 可能不可用或内容损坏，忽略
      setDraftRestoreReady(true);
    }
  }, [presetLookup]);

  useEffect(() => {
    if (!pendingQuestionnaireDraft || !questionnairePresetIndexReady) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const nextSelections: CreatorQuestionnaireSelection[] = [];
        for (const rawSelection of pendingQuestionnaireDraft.questionnaireSelections ?? []) {
          const source =
            rawSelection.source === 'upload' || rawSelection.source === 'preset'
              ? rawSelection.source
              : 'preset';
          const rawQuestionnaire = readRecord(rawSelection.questionnaire);
          nextSelections.push(
            createCreatorQuestionnaireSelectionFromParsed({
              source,
              parsed: rawSelection.questionnaire,
              fallbackKind: 'magical-girl',
              fallbackId:
                typeof rawQuestionnaire.id === 'string'
                  ? rawQuestionnaire.id
                  : 'creator-questionnaire',
              fallbackTitle:
                typeof rawQuestionnaire.title === 'string'
                  ? rawQuestionnaire.title
                  : '未命名问卷',
              nativeAllowed:
                source === 'preset'
                  ? typeof rawQuestionnaire.nativeAllowed === 'boolean'
                    ? Boolean(rawQuestionnaire.nativeAllowed)
                    : true
                  : false,
              presetId:
                typeof rawSelection.presetId === 'string'
                  ? rawSelection.presetId
                  : null,
              selectionId:
                typeof rawSelection.selectionId === 'string'
                  ? rawSelection.selectionId
                  : null,
            })
          );
        }
        for (const presetId of pendingQuestionnaireDraft.presetIds) {
          if (nextSelections.some((selection) => selection.presetId === presetId)) {
            continue;
          }
          const presetEntry = questionnairePresetEntries.find(
            (entry) => entry.id === presetId
          );
          if (!presetEntry) {
            continue;
          }
          nextSelections.push(
            await loadQuestionnaireSelectionFromPreset(presetEntry)
          );
        }

        if (cancelled) return;
        setSelectedQuestionnaires(nextSelections);
        setQuestionnaireAnswersByKey(pendingQuestionnaireDraft.answersByKey);
        setCurrentQuestionIndex(pendingQuestionnaireDraft.currentQuestionIndex);
      } catch {
        if (cancelled) return;
        setQuestionnaireLoadError('恢复问卷草稿失败');
      } finally {
        if (cancelled) return;
        setPendingQuestionnaireDraft(null);
        setDraftRestoreReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    loadQuestionnaireSelectionFromPreset,
    pendingQuestionnaireDraft,
    questionnairePresetEntries,
    questionnairePresetIndexReady,
  ]);

  useEffect(() => {
    if (!draftRestoreReady || typeof window === 'undefined') {
      return;
    }

    try {
      const payload = buildCreatorDraftPayload({
        template,
        generationMode,
        freeformBrief,
        selectedRuleIds,
        primaryRuleId,
        ruleInputs,
        questionnaireSelections: selectedQuestionnaires.map((selection) => ({
          source: selection.source,
          presetId: selection.presetId,
          selectionId: selection.selectionId,
          questionnaire: selection.questionnaire,
        })),
        questionnairePresetIds: selectedQuestionnaires.map(
          (selection) => selection.presetId
        ).filter((presetId): presetId is string => typeof presetId === 'string'),
        questionnaireAnswersByKey,
        currentQuestionIndex,
      });
      window.localStorage.setItem(
        CREATOR_DRAFT_STORAGE_KEY,
        JSON.stringify(payload)
      );
    } catch {
      // localStorage 可能不可用，忽略
    }
  }, [
    draftRestoreReady,
    freeformBrief,
    generationMode,
    currentQuestionIndex,
    primaryRuleId,
    questionnaireAnswersByKey,
    ruleInputs,
    selectedRuleIds,
    selectedQuestionnaires,
    template,
  ]);

  useEffect(() => {
    if (mergedQuestions.length === 0) {
      if (currentQuestionIndex !== 0) {
        setCurrentQuestionIndex(0);
      }
      if (currentQuestionAnswer !== '') {
        setCurrentQuestionAnswer('');
      }
      return;
    }

    if (currentQuestionIndex >= mergedQuestions.length) {
      setCurrentQuestionIndex(mergedQuestions.length - 1);
      return;
    }

    const currentKey = mergedQuestions[currentQuestionIndex]?.key;
    const nextAnswer = currentKey ? questionnaireAnswersByKey[currentKey] ?? '' : '';
    if (nextAnswer !== currentQuestionAnswer) {
      setCurrentQuestionAnswer(nextAnswer);
    }
  }, [
    currentQuestionAnswer,
    currentQuestionIndex,
    mergedQuestions,
    questionnaireAnswersByKey,
  ]);

  const handleAddQuestionnairePreset = async (presetId: string) => {
    const presetEntry = questionnairePresetEntries.find((entry) => entry.id === presetId);
    if (!presetEntry) {
      return;
    }

    if (selectedQuestionnaires.some((selection) => selection.presetId === presetId)) {
      return;
    }

    try {
      setQuestionnaireLoadError(null);
      const selection = await loadQuestionnaireSelectionFromPreset(presetEntry);
      appendQuestionnaireSelection(selection);
    } catch (caughtError) {
      setQuestionnaireLoadError(
        caughtError instanceof Error ? caughtError.message : '加载预设问卷失败'
      );
    }
  };

  const handleUploadQuestionnaire = async (file: File | null) => {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const selection = createCreatorQuestionnaireSelectionFromParsed({
        source: 'upload',
        parsed,
        fallbackKind: 'magical-girl',
        fallbackId:
          typeof parsed?.id === 'string'
            ? parsed.id
            : 'creator-questionnaire-upload',
        fallbackTitle:
          typeof parsed?.title === 'string'
            ? parsed.title
            : file.name.replace(/\.[^.]+$/, ''),
        nativeAllowed: false,
      });
      appendQuestionnaireSelection(selection);
    } catch (caughtError) {
      setQuestionnaireLoadError(
        caughtError instanceof Error ? caughtError.message : '问卷文件解析失败'
      );
    }
  };

  const handlePasteQuestionnaireImport = () => {
    if (!pasteQuestionnaireText.trim()) {
      setPasteQuestionnaireError('请先粘贴问卷 JSON');
      return;
    }

    try {
      const parsed = JSON.parse(pasteQuestionnaireText);
      const selection = createCreatorQuestionnaireSelectionFromParsed({
        source: 'upload',
        parsed,
        fallbackKind: 'magical-girl',
        fallbackId:
          typeof parsed?.id === 'string'
            ? parsed.id
            : 'creator-questionnaire-paste',
        fallbackTitle:
          typeof parsed?.title === 'string' ? parsed.title : '未命名问卷',
        nativeAllowed: false,
      });
      appendQuestionnaireSelection(selection);
    } catch (caughtError) {
      setPasteQuestionnaireError(
        caughtError instanceof Error ? caughtError.message : '问卷 JSON 解析失败'
      );
    }
  };

  const handleRemoveQuestionnaire = (selectionId: string) => {
    const selection = selectedQuestionnaires.find(
      (item) => item.selectionId === selectionId
    );

    setSelectedQuestionnaires((current) =>
      current.filter((selection) => selection.selectionId !== selectionId)
    );
    if (selection) {
      setQuestionnaireAnswersByKey((current) =>
        removeCreatorQuestionnaireAnswersForSelection(current, selection)
      );
    }
    setError(null);
  };

  const commitCurrentQuestionnaireAnswer = (override?: string) => {
    const item = mergedQuestions[currentQuestionIndex];
    if (!item) {
      return questionnaireAnswersByKey;
    }

    const rawValue = override ?? currentQuestionAnswer;
    const nextAnswers = { ...questionnaireAnswersByKey };
    if (rawValue.trim()) {
      nextAnswers[item.key] = rawValue;
    } else {
      delete nextAnswers[item.key];
    }
    return nextAnswers;
  };

  const handleQuestionnaireAnswerChange = (value: string) => {
    setCurrentQuestionAnswer(value);
    setError(null);

    const item = mergedQuestions[currentQuestionIndex];
    if (!item) {
      return;
    }

    setQuestionnaireAnswersByKey((current) => {
      const nextAnswers = { ...current };
      if (value.trim()) {
        nextAnswers[item.key] = value;
      } else {
        delete nextAnswers[item.key];
      }
      return nextAnswers;
    });
  };

  const handleQuestionnaireNext = () => {
    const item = mergedQuestions[currentQuestionIndex];
    if (!item) {
      return;
    }

    if (item.question.required === true && currentQuestionAnswer.trim().length === 0) {
      setError('请先完成当前问卷问题，再继续创作。');
      return;
    }

    const nextAnswers = commitCurrentQuestionnaireAnswer();
    setQuestionnaireAnswersByKey(nextAnswers);
    setError(null);

    if (currentQuestionIndex < mergedQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const handleQuestionnairePrev = () => {
    if (currentQuestionIndex === 0) {
      return;
    }

    const nextAnswers = commitCurrentQuestionnaireAnswer();
    setQuestionnaireAnswersByKey(nextAnswers);
    setCurrentQuestionIndex(currentQuestionIndex - 1);
    setError(null);
  };

  const handleQuestionnaireQuickOption = (value: string) => {
    setCurrentQuestionAnswer(value);
    const nextAnswers = commitCurrentQuestionnaireAnswer(value);
    setQuestionnaireAnswersByKey(nextAnswers);
    setError(null);

    if (currentQuestionIndex < mergedQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const handleNavigateQuestionnaire = (index: number) => {
    if (index < 0 || index >= mergedQuestions.length || index === currentQuestionIndex) {
      return;
    }

    const nextAnswers = commitCurrentQuestionnaireAnswer();
    setQuestionnaireAnswersByKey(nextAnswers);
    setCurrentQuestionIndex(index);
    setError(null);
  };

  useEffect(() => {
    const compatibleRuleIds = selectedRuleIds.filter((ruleId) => {
      const preset = presetLookup[ruleId];
      return preset?.supportedTemplates.includes(template);
    });

    if (compatibleRuleIds.length !== selectedRuleIds.length) {
      setSelectedRuleIds(compatibleRuleIds);
    }

    if (primaryRuleId && !compatibleRuleIds.includes(primaryRuleId)) {
      const nextPrimary =
        compatibleRuleIds.find((ruleId) => presetLookup[ruleId]?.mainRuleEligible) ??
        null;
      setPrimaryRuleId(nextPrimary);
    }
  }, [presetLookup, primaryRuleId, selectedRuleIds, template]);

  useEffect(() => {
    if (selectedRuleIds.length === 0) {
      if (primaryRuleId !== null) {
        setPrimaryRuleId(null);
      }
      return;
    }

    if (
      primaryRuleId &&
      selectedRuleIds.includes(primaryRuleId) &&
      presetLookup[primaryRuleId]?.mainRuleEligible
    ) {
      return;
    }

    const nextPrimary =
      selectedRuleIds.find((ruleId) => presetLookup[ruleId]?.mainRuleEligible) ?? null;
    if (nextPrimary !== primaryRuleId) {
      setPrimaryRuleId(nextPrimary);
    }
  }, [presetLookup, primaryRuleId, selectedRuleIds]);

  const handleToggleRule = (ruleId: string, nextSelected: boolean) => {
    setSelectedRuleIds((current) => {
      if (nextSelected) {
        if (current.includes(ruleId)) {
          return current;
        }
        return [...current, ruleId];
      }
      return current.filter((currentRuleId) => currentRuleId !== ruleId);
    });

    if (nextSelected) {
      setRuleInputs((current) => {
        if (current[ruleId]) {
          return current;
        }
        return {
          ...current,
          [ruleId]: getDefaultRuleInput(ruleId),
        };
      });
    } else if (primaryRuleId === ruleId) {
      setPrimaryRuleId(null);
    }
  };

  const handleRuleInputChange = (
    ruleId: string,
    nextValue: Record<string, unknown>
  ) => {
    setRuleInputs((current) => ({
      ...current,
      [ruleId]: nextValue,
    }));
  };

  const handleGenerate = async () => {
    if (clientValidationMessage) {
      setError(clientValidationMessage);
      return;
    }

    setSubmitting(true);
    setError(null);
    setResultData(null);
    setStreamedResult(null);
    setStreamingMarkdown('');

    try {
      const activityHeaders = await authStorage.getActivityHeaders();
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...activityHeaders,
      };

      const requestBody = {
        template,
        freeformBrief,
        questionnaires: questionnaireRequestData.questionnaires,
        questionnaireAnswers: questionnaireRequestData.questionnaireAnswers,
        buildRules,
        ...(buildRules.length > 0 ? { primaryRuleId } : {}),
      };

      if (generationMode === 'stream' && isCreatorStreamTemplate(template)) {
        requestHeaders.Accept = 'text/event-stream';
        const response = await fetch('/api/creator/generate-stream?format=sse', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const { payload } = await readJsonOrTextFromResponse(response);
          const serverMessage = resolveApiErrorMessage({
            payload,
            fallback: '创作生成失败',
          });
          throw new Error(
            formatHttpErrorMessage({
              serverMessage,
              status: response.status,
              fallback: '创作生成失败',
            })
          );
        }

        const { text } = await readTextAndReasoningStreamFromResponse(response, {
          label: '创作生成（流式）',
          onText: (nextText) => setStreamingMarkdown(nextText),
        });

        if (template === 'general') {
          const { card } = buildGeneralCharacterCardFromMarkdown({
            markdown: text,
            defaultName: '角色',
          });
          setStreamedResult(card as unknown as Record<string, unknown>);
        } else {
          const { card } = buildGeneralScenarioCardFromMarkdown({
            markdown: text,
            defaultTitle: '情景',
          });
          setStreamedResult(card as unknown as Record<string, unknown>);
        }

        return;
      }

      requestHeaders[AI_META_REQUEST_HEADER] = AI_META_REQUEST_VALUE;
      const response = await fetch('/api/creator/generate', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const { payload } = await readJsonOrTextFromResponse(response);
        const serverMessage = resolveApiErrorMessage({
          payload,
          fallback: '创作生成失败',
        });
        throw new Error(
          formatHttpErrorMessage({
            serverMessage,
            status: response.status,
            fallback: '创作生成失败',
          })
        );
      }

      const { data } = await readJsonWithAiMeta<Record<string, unknown>>(response);
      setResultData(data);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : '发生未知错误';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const liveStreamPreview = useMemo(() => {
    if (!streamingMarkdown.trim() || !isCreatorStreamTemplate(template)) {
      return null;
    }

    if (template === 'general') {
      const { card } = buildGeneralCharacterCardFromMarkdown({
        markdown: streamingMarkdown,
        defaultName: '角色',
      });
      return card as unknown as Record<string, unknown>;
    }

    const { card } = buildGeneralScenarioCardFromMarkdown({
      markdown: streamingMarkdown,
      defaultTitle: '情景',
    });
    return card as unknown as Record<string, unknown>;
  }, [streamingMarkdown, template]);

  const displayedResult = generationMode === 'stream'
    ? streamedResult ?? liveStreamPreview
    : resultData;
  const resultActionData = generationMode === 'stream' ? streamedResult : resultData;
  const clientValidationMessage = useMemo(
    () =>
      getCreatorClientValidationMessage({
        template,
        freeformBrief,
        questionnaires: questionnaireRequestData.questionnaires,
        questionnaireAnswers: questionnaireRequestData.questionnaireAnswers,
        buildRules,
        primaryRuleId,
      }),
    [
      buildRules,
      freeformBrief,
      primaryRuleId,
      questionnaireRequestData.questionnaireAnswers,
      questionnaireRequestData.questionnaires,
      template,
    ]
  );
  const missingPresetIds = useMemo(
    () => extractMissingBuildRulePresetIds(displayedResult, presetLookup),
    [displayedResult, presetLookup]
  );
  const currentQuestionItem = mergedQuestions[currentQuestionIndex] ?? null;
  const currentQuestion = currentQuestionItem?.question ?? null;
  const currentQuestionnaireTitle = currentQuestionItem?.questionnaireTitle ?? '';
  const hasQuestionOptions = (currentQuestion?.options?.length ?? 0) > 0;
  const allowCustomQuestionInput = currentQuestion?.allowCustom !== false;
  const showQuestionTextInput = allowCustomQuestionInput || !hasQuestionOptions;
  const questionnaireNavigatorItems = mergedQuestions.map((item) => ({
    id: item.key,
    label: item.questionnaireTitle
      ? `${item.question.question} · ${item.questionnaireTitle}`
      : item.question.question,
  }));
  const questionnaireProgressPercent =
    mergedQuestions.length > 0
      ? Math.round(((currentQuestionIndex + 1) / mergedQuestions.length) * 100)
      : 0;
  const questionnaireQuickOptions = allowCustomQuestionInput
    ? ['还没想好', '不想回答']
    : [];
  const questionnaireSuggestions = showQuestionTextInput
    ? currentQuestion?.suggestions?.filter(Boolean) ?? []
    : [];
  const questionnaireOptionsHintText = allowCustomQuestionInput
    ? '推荐选项（点击后会填入答案，也可继续补充文本）'
    : '本题仅可从选项中选择';
  const questionnaireNextButtonLabel =
    mergedQuestions.length === 0
      ? '问卷未就绪'
      : currentQuestionIndex === mergedQuestions.length - 1
        ? '完成当前问卷'
        : currentQuestion?.required === true || currentQuestionAnswer.trim()
          ? '下一题'
          : '跳过并继续';

  const handleDownloadResult = (data: Record<string, unknown>) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    downloadBlob(blob, getCreatorResultDownloadFileName(template, data));
  };

  const handleCopyResult = async (data: Record<string, unknown>) => {
    const label = getCreatorResultKind(template) === 'scenario' ? '情景卡' : '角色卡';

    try {
      if (!navigator.clipboard) {
        throw new Error('clipboard-not-available');
      }

      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      alert(`✅ 已复制${label} JSON 到剪贴板`);
    } catch {
      alert('⚠️ 复制失败，请手动选择 JSON 内容后复制。');
    }
  };

  const renderResult = () => {
    if (!displayedResult) {
      return (
        <div className="rounded-3xl border border-dashed border-gray-300 bg-white/70 p-6 text-sm text-gray-500">
          结果会显示在这里。当前页已经会调用 creator API；问卷串联与已有数据卡编辑回填放到下一步继续接。
        </div>
      );
    }

    if (template === 'general') {
      return (
        <GeneralCharacterCard
          general={displayedResult as unknown as { name: string; content: string }}
          isStreaming={generationMode === 'stream' && submitting}
        />
      );
    }

    if (template === 'general-scenario') {
      return (
        <GeneralScenarioCard
          scenario={displayedResult as unknown as { title: string; content: string }}
          isStreaming={generationMode === 'stream' && submitting}
        />
      );
    }

    if (template === 'magical-girl') {
      return (
        <MagicalGirlCard
          magicalGirl={displayedResult as unknown as Parameters<typeof MagicalGirlCard>[0]['magicalGirl']}
          gradientStyle={MAGICAL_GIRL_GRADIENT}
        />
      );
    }

    if (template === 'canshou') {
      return (
        <CanshouCard
          canshou={displayedResult as unknown as Parameters<typeof CanshouCard>[0]['canshou']}
        />
      );
    }

    return structuredScenarioPreview(displayedResult);
  };

  return (
    <>
      <Head>
        <title>创作生成页 | MahoShojo Generator</title>
      </Head>

      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,207,232,0.35),_transparent_32%),linear-gradient(180deg,_#fff7fb_0%,_#f8fafc_45%,_#eef2ff_100%)]">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="space-y-6">
              <div className="rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
                <p className="text-sm font-medium uppercase tracking-[0.3em] text-pink-500">
                  Creator
                </p>
                <h1 className="mt-3 text-4xl font-semibold tracking-tight text-gray-900">
                  创作生成页
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-gray-600">
                  用输出模板、问卷、车卡规则和自由文本一起驱动生成。第一阶段先打通 prompt 编排与规则固定事实，
                  问卷深度串联与已有数据卡回填继续按计划向下推进。
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  <Link href="/free" className="rounded-full border border-gray-200 bg-white px-3 py-1.5 hover:border-pink-300">
                    返回自由生成
                  </Link>
                  <Link href="/details" className="rounded-full border border-gray-200 bg-white px-3 py-1.5 hover:border-pink-300">
                    参考问卷生成页
                  </Link>
                </div>
              </div>

              <div className="rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
                <TemplateSelector
                  options={TEMPLATE_OPTIONS}
                  value={template}
                  onChange={setTemplate}
                />

                <div className="mt-6">
                  <GenerationModeSwitcher
                    label="生成方式"
                    value={generationMode}
                    disabled={!isCreatorStreamTemplate(template)}
                    onChange={setGenerationMode}
                  />
                </div>

                <div className="mt-6 rounded-3xl border border-gray-200 bg-white p-5">
                  <label className="input-label">问卷输入</label>
                  <p className="text-sm leading-7 text-gray-600">
                    这里复用 `/details` 的问卷定义、跳题与题目渲染能力，当前支持预设问卷、
                    上传问卷 JSON 与粘贴导入 JSON；云端问卷库与 Lore 开关仍按后续计划推进。
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <select
                      className="input-field text-sm"
                      defaultValue=""
                      onChange={(event) => {
                        if (!event.target.value) {
                          return;
                        }
                        void handleAddQuestionnairePreset(event.target.value);
                        event.currentTarget.value = '';
                      }}
                    >
                      <option value="" disabled>
                        选择预设问卷
                      </option>
                      {questionnairePresetEntries.map((presetEntry) => (
                        <option key={presetEntry.id} value={presetEntry.id}>
                          {presetEntry.title}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-medium text-pink-700 hover:border-pink-300 hover:bg-pink-100">
                      上传问卷 JSON
                      <input
                        type="file"
                        accept="application/json"
                        onChange={(event) => {
                          void handleUploadQuestionnaire(
                            event.target.files?.[0] ?? null
                          );
                          event.currentTarget.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setPasteQuestionnaireError(null);
                        setShowPasteQuestionnaireImport((current) => !current);
                      }}
                      className="rounded-lg border border-pink-200 bg-pink-50 px-3 py-1 text-xs text-pink-700 hover:border-pink-300 hover:bg-pink-100"
                    >
                      {showPasteQuestionnaireImport
                        ? '收起粘贴导入'
                        : '粘贴导入 JSON'}
                    </button>
                    <span className="text-xs text-gray-500">
                      已选 {selectedQuestionnaires.length} 份问卷，已填写{' '}
                      {questionnaireAnswerItems.length} 条答案。
                    </span>
                  </div>

                  {showPasteQuestionnaireImport ? (
                    <div className="mt-4 rounded-2xl border border-pink-100 bg-pink-50/40 p-4 text-xs text-gray-600">
                      <label className="text-xs text-gray-500">
                        粘贴问卷 JSON
                      </label>
                      <textarea
                        value={pasteQuestionnaireText}
                        onChange={(event) =>
                          setPasteQuestionnaireText(event.target.value)
                        }
                        placeholder="在此粘贴问卷 JSON"
                        className="input-field mt-2 h-28"
                        rows={6}
                      />
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={handlePasteQuestionnaireImport}
                          className="rounded-lg border border-pink-200 bg-white px-3 py-1 text-xs text-pink-700 hover:border-pink-300"
                        >
                          解析并载入
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPasteQuestionnaireText('');
                            setPasteQuestionnaireError(null);
                          }}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          清空
                        </button>
                      </div>
                      {pasteQuestionnaireError ? (
                        <p className="mt-2 text-rose-500">
                          {pasteQuestionnaireError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {questionnaireLoadError ? (
                    <div className="mt-4">
                      <ErrorMessage message={questionnaireLoadError} />
                    </div>
                  ) : null}

                  {selectedQuestionnaires.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      {selectedQuestionnaires.map((selection) => (
                        <div
                          key={selection.selectionId}
                          className="flex items-center justify-between rounded-2xl border border-pink-100 bg-pink-50/60 px-4 py-3"
                        >
                          <div>
                            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-pink-700">
                              <span>{selection.questionnaire.title}</span>
                              <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-pink-500">
                                {selection.source === 'preset' ? '预设' : '导入'}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500">
                              题目数：{selection.questionnaire.questions.length}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveQuestionnaire(selection.selectionId)}
                            className="text-xs text-rose-500 hover:underline"
                          >
                            移除
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {selectedQuestionnaires.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 p-4 text-sm text-gray-500">
                      你可以在这里追加预设问卷，或直接上传 / 粘贴问卷 JSON，让创作页同时吸收背景、人格、世界观和事件线索。
                    </div>
                  ) : mergedQuestions.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 p-4 text-sm text-gray-500">
                      当前选中的问卷没有可作答题目，或所有题目都被条件隐藏了。
                    </div>
                  ) : (
                    <div className="mt-5 space-y-4">
                      {mergedQuestions.length > 1 ? (
                        <QuestionNavigator
                          items={questionnaireNavigatorItems}
                          currentIndex={currentQuestionIndex}
                          onNavigate={handleNavigateQuestionnaire}
                          isAnswered={(index) => {
                            const key = mergedQuestions[index]?.key;
                            return Boolean(
                              key &&
                                questionnaireAnswersByKey[key] &&
                                questionnaireAnswersByKey[key].trim().length > 0
                            );
                          }}
                        />
                      ) : null}

                      <QuestionnaireQuestionPanel
                        theme={DETAILS_QUESTIONNAIRE_THEME}
                        progressLabel={`问题 ${currentQuestionIndex + 1} / ${mergedQuestions.length}`}
                        progressPercent={questionnaireProgressPercent}
                        questionText={currentQuestion?.question ?? '未加载题目'}
                        questionnaireTitle={currentQuestionnaireTitle}
                        noticeText="问卷答案会在提交时整理为 creator 输入摘要，与自由文本和车卡规则一起参与生成。"
                        helperText={currentQuestion?.helperText}
                        isRequired={currentQuestion?.required === true}
                        skipText="本题可跳过，不作答则不会进入 creator 的问卷摘要。"
                        quickOptions={questionnaireQuickOptions}
                        onQuickOption={handleQuestionnaireQuickOption}
                        options={currentQuestion?.options}
                        optionsHintText={questionnaireOptionsHintText}
                        onOptionSelect={handleQuestionnaireQuickOption}
                        suggestions={questionnaireSuggestions}
                        onSuggestionSelect={handleQuestionnaireAnswerChange}
                        showTextInput={showQuestionTextInput}
                        answer={currentQuestionAnswer}
                        onAnswerChange={handleQuestionnaireAnswerChange}
                        placeholder={currentQuestion?.placeholder ?? '请输入问卷答案'}
                        answerLength={currentQuestionAnswer.trim().length}
                        prevLabel="返回上题"
                        nextButtonContent={questionnaireNextButtonLabel}
                        onPrev={handleQuestionnairePrev}
                        onNext={handleQuestionnaireNext}
                        disablePrev={currentQuestionIndex === 0}
                        disableNext={currentQuestion?.required === true && currentQuestionAnswer.trim().length === 0}
                        prevButtonClass="generate-button w-1/4"
                        nextButtonClass="generate-button"
                      />
                    </div>
                  )}
                </div>

                <div className="mt-6">
                  <FreeformBriefPanel
                    value={freeformBrief}
                    onChange={setFreeformBrief}
                  />
                </div>

                <div className="mt-6">
                  <BuildRulePicker
                    template={template}
                    presets={presets}
                    selectedRuleIds={selectedRuleIds}
                    primaryRuleId={primaryRuleId}
                    onToggleRule={handleToggleRule}
                    onSelectPrimary={setPrimaryRuleId}
                  />
                </div>

                {selectedPresets.length > 0 ? (
                  <div className="mt-6 space-y-6">
                    {selectedPresets.map((preset) => {
                      const runtimeResult =
                        buildRules.find((rule) => rule.ruleId === preset.id) ?? null;
                      return (
                        <BuildRulePanel
                          key={preset.id}
                          preset={preset}
                          value={ruleInputs[preset.id] ?? getDefaultRuleInput(preset.id)}
                          runtimeResult={runtimeResult}
                          onChange={(nextValue) =>
                            handleRuleInputChange(preset.id, nextValue)
                          }
                        />
                      );
                    })}
                  </div>
                ) : null}

                <div className="mt-6">
                  <BuildSummaryPanel
                    template={template}
                    primaryRuleId={primaryRuleId}
                    presetLookup={presetLookup}
                    buildRules={buildRules}
                  />
                </div>

                {error ? (
                  <div className="mt-6">
                    <ErrorMessage message={error} />
                  </div>
                ) : null}

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={submitting || clientValidationMessage !== null}
                    className="generate-button"
                  >
                    {submitting ? '生成中…' : '开始创作'}
                  </button>
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">
                      当前请求会调用 `/api/creator/generate`
                      {generationMode === 'stream' ? '-stream' : ''}
                      ，并把已选规则的 runtime 结果交给后端重算与兜底校验。
                    </p>
                    {clientValidationMessage ? (
                      <p className="text-xs text-amber-700">
                        当前不可提交：{clientValidationMessage}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-6">
              <div className="rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-500">
                      Preview
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-gray-900">
                      结果预览
                    </h2>
                  </div>
                  {generationMode === 'stream' && streamingMarkdown ? (
                    <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs text-cyan-700">
                      正在流式更新
                    </span>
                  ) : null}
                </div>
                {missingPresetIds.length > 0 ? (
                  <div className="mt-5">
                    <ErrorMessage message="原预设缺失，当前仅可只读查看既有规则结果。" />
                  </div>
                ) : null}
                <div className="mt-5">{renderResult()}</div>
                {resultActionData && missingPresetIds.length === 0 ? (
                  <div className="mt-6 rounded-3xl border border-gray-200 bg-white p-5">
                    <div className="text-center">
                      <h3 className="text-lg font-medium text-gray-900">
                        后续操作
                      </h3>
                      <div className="mt-4 flex flex-col justify-center gap-3 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => handleDownloadResult(resultActionData)}
                          className="generate-button flex-1"
                        >
                          下载 JSON
                        </button>
                        <SaveToCloudButton
                          data={resultActionData}
                          cardType={getCreatorResultKind(template)}
                          buttonText="保存到云端"
                          className="generate-button flex-1"
                          style={{
                            backgroundColor: '#22c55e',
                            backgroundImage:
                              'linear-gradient(to right, #22c55e, #16a34a)',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void handleCopyResult(resultActionData)}
                          className="generate-button flex-1"
                          style={{
                            backgroundColor: '#3b82f6',
                            backgroundImage:
                              'linear-gradient(to right, #3b82f6, #2563eb)',
                          }}
                        >
                          复制到剪贴板
                        </button>
                      </div>
                      <JsonSizeIndicator
                        data={resultActionData}
                        warningText="⚠️ 接近云端 300KB 上限，保存/替换可能失败，请先精简数据。"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
        <Footer />
      </main>
    </>
  );
}
