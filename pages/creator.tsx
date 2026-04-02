import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

import CanshouCard from '@/components/CanshouCard';
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
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { AI_META_REQUEST_HEADER, AI_META_REQUEST_VALUE, readJsonWithAiMeta } from '@/lib/client/read-json-with-ai-meta';
import { resolveApiErrorMessage, readJsonOrTextFromResponse } from '@/lib/client/apiError';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { authStorage } from '@/lib/auth';
import { evaluateBuildRuleState, type BuildRuleRuntimeResult } from '@/lib/creator/build-rule-runtime';
import { loadBuildRulePresetById, loadBuildRulePresetIndex } from '@/lib/creator/build-rules';
import { isCreatorStreamTemplate, type CreatorTemplateId } from '@/lib/creator/templates';
import { readTextAndReasoningStreamFromResponse } from '@/lib/stream/read-text-and-reasoning-stream';
import {
  buildGeneralCharacterCardFromMarkdown,
  buildGeneralScenarioCardFromMarkdown,
} from '@/lib/stream/markdown-card';

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

  useEffect(() => {
    if (!isCreatorStreamTemplate(template) && generationMode === 'stream') {
      setGenerationMode('non-stream');
    }
  }, [generationMode, template]);

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
        questionnaires: [],
        questionnaireAnswers: [],
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
  const missingPresetIds = useMemo(
    () => extractMissingBuildRulePresetIds(displayedResult, presetLookup),
    [displayedResult, presetLookup]
  );

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
                    第一阶段先保留明确入口与文案边界。这里后续会接入 `/details` 现有问卷选择与答案编辑逻辑，
                    目前先让规则与自由文本闭环工作，不把问卷状态硬塞进新的大页面。
                  </p>
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
                    disabled={
                      submitting ||
                      (!freeformBrief.trim() && buildRules.length === 0)
                    }
                    className="generate-button"
                  >
                    {submitting ? '生成中…' : '开始创作'}
                  </button>
                  <p className="text-xs text-gray-500">
                    当前请求会调用 `/api/creator/generate`
                    {generationMode === 'stream' ? '-stream' : ''}
                    ，并把已选规则的 runtime 结果注入后端。
                  </p>
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
              </div>
            </section>
          </div>
        </div>
        <Footer />
      </main>
    </>
  );
}
