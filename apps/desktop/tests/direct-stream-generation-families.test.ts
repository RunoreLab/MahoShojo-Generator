import { describe, expect, it, vi } from 'vitest';
import { buildMagicalGirlDetailsStreamPrompt } from '@mahoshojo/ai-core/magical-girl-details-generation';
import { buildCanshouStreamPrompt } from '@mahoshojo/ai-core/canshou-generation';
import { buildFreeStreamPrompt, type FreeSchemaId } from '@mahoshojo/ai-core/free-generation';
import { buildScenarioStreamPrompt } from '@mahoshojo/ai-core/scenario-generation';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { AiExecutionRequestSchema, type AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import { CANSHOU_LORE } from '@mahoshojo/domain/canshou-lore';
import { buildCreatorPromptText } from '@mahoshojo/domain/creator/prompt';
import { buildCreatorPromptInput } from '@mahoshojo/domain/creator/server';
import { buildCreatorStreamPrompt } from '@mahoshojo/domain/creator/stream-prompt';
import type { CreatorRequestInput } from '@mahoshojo/domain/creator/types';
import { compactQuestionnaireAnswerItems, formatQuestionnaireAnswers } from '@mahoshojo/domain/questionnaire';
import { executeDetailsGeneration } from '../src/features/details/generation';
import { executeCanshouGeneration } from '../src/features/canshou/generation';
import { executeFreeGeneration, type FreeGenerationInput } from '../src/features/free/generation';
import { executeCreatorGeneration, type CreatorGenerationInput } from '../src/features/creator/generation';
import { executeScenarioGeneration } from '../src/features/scenario/generation';
import type { DesktopGenerationOutcome } from '../src/features/generation/executor';
import type { DesktopAiExecutionOptions } from '../src/platform/desktop-ai-execution';
import { STREAM_DIRECT_AI_COMMAND } from '../src/platform/direct-ai-bridge';

const markdown = '# 雨后档案\n\n名字：青禾\n代号：青铃\n标题：雨后车站\n\n## 正文\n守护雾中同行者';
const flowers = '风铃草：温柔的爱';
const questionnaireInput = {
  answers: [{
    question: '你的信念？', answer: '守护同行者', questionId: 'q-1',
    questionnaireId: 'custom-q', questionnaireTitle: '旅途问卷',
  }],
  language: '日本語',
  loreText: '【旅途问卷】\n城镇在黄昏时会被迷雾包围。',
};
const freeInput: FreeGenerationInput = {
  schema: 'general', prompt: '写一位雾中引路人', language: 'English',
  attachments: [{ name: '设定.txt', type: 'text/plain', size: 128, content: '渡口每日只开放一小时。', truncated: true }],
};
const scenarioInput = {
  answers: { 时间: ' 黄昏 ', 地点: '渡口', 角色: '' }, language: '繁體中文',
  fieldsToKeepEmpty: ['预设NPC', '发展方向'], titleHint: ' 雾港之约 ',
};
const creatorInput: CreatorGenerationInput = {
  ...questionnaireInput,
  template: 'general', freeformBrief: '请保留温柔的叙述语气。',
  questionnaires: [{ questionnaireId: 'custom-q', title: '旅途问卷' }],
  buildRules: [{
    ruleId: 'arena-trpg-lite', version: '1.0.0',
    blockResults: { archetype: '守护者' }, derived: { hp: 10 },
    validationSummary: { valid: true, issues: [], missingRequiredBlockKeys: [] },
  }],
  buildRuleRequests: [{ ruleId: 'arena-trpg-lite', version: '1.0.0', inputs: { archetype: '守护者' } }],
  primaryRuleId: 'arena-trpg-lite', streamFallbackLabel: '旅行者',
};

type Mode = 'direct-local' | 'direct-remote';
const createIntent = (mode: Mode) => ({ requestId: `stream-${mode}`, mode, generationMode: 'stream' as const, flowers });
type StreamCase = {
  name: string;
  run(options: DesktopAiExecutionOptions, mode: Mode, onPartialText: (text: string) => void): Promise<DesktopGenerationOutcome>;
  prompt: string;
  temperature: number;
  cardKind: 'general' | 'general-scenario';
  metadata?: Record<string, unknown>;
  promptFacts: string[];
};

const creatorCase = (template: 'general' | 'general-scenario'): StreamCase => {
  // 当前角色规则不支持情景模板；情景用同样的问卷/补充说明而不混入角色配点。
  const input = template === 'general'
    ? creatorInput
    : { ...creatorInput, template, buildRules: [], buildRuleRequests: [], primaryRuleId: null };
  const requestInput: CreatorRequestInput = {
    template, freeformBrief: input.freeformBrief, questionnaires: input.questionnaires,
    questionnaireAnswers: compactQuestionnaireAnswerItems(input.answers),
    buildRules: input.buildRules, primaryRuleId: input.primaryRuleId,
  };
  return {
    name: `creator/${template}`,
    run: (options, mode, onPartialText) => executeCreatorGeneration(options, input, createIntent(mode), new AbortController().signal, onPartialText),
    prompt: buildCreatorStreamPrompt({
      template, language: input.language,
      creatorPromptText: buildCreatorPromptText(buildCreatorPromptInput(requestInput)),
      questionnaireAnswerText: formatQuestionnaireAnswers(input.answers), loreText: input.loreText,
    }),
    temperature: 0.75, cardKind: template,
    metadata: {
      userAnswers: compactQuestionnaireAnswerItems(input.answers),
      creationInputs: { template, freeformBrief: input.freeformBrief, buildRules: input.buildRules, primaryRuleId: input.primaryRuleId },
      ...(template === 'general' ? { buildState: { primaryRuleId: input.primaryRuleId, rules: input.buildRules } } : {}),
    },
    promptFacts: ['日本語', '守护同行者', '城镇在黄昏时会被迷雾包围', '温柔的叙述语气', ...(template === 'general' ? ['主规则事实'] : [])],
  };
};

const cases: StreamCase[] = [
  {
    name: 'details',
    run: (options, mode, onPartialText) => executeDetailsGeneration(options, questionnaireInput, createIntent(mode), new AbortController().signal, onPartialText),
    prompt: buildMagicalGirlDetailsStreamPrompt({ ...questionnaireInput, questionnaireLore: questionnaireInput.loreText, flowers }),
    temperature: 0.75, cardKind: 'general',
    metadata: { userAnswers: compactQuestionnaireAnswerItems(questionnaireInput.answers) },
    promptFacts: ['日本語', '守护同行者', '城镇在黄昏时会被迷雾包围', flowers],
  },
  {
    name: 'canshou',
    run: (options, mode, onPartialText) => executeCanshouGeneration(options, questionnaireInput, createIntent(mode), new AbortController().signal, onPartialText),
    prompt: buildCanshouStreamPrompt({ ...questionnaireInput, questionnairesLore: questionnaireInput.loreText, canshouLore: CANSHOU_LORE }),
    temperature: 0.8, cardKind: 'general',
    metadata: { userAnswers: compactQuestionnaireAnswerItems(questionnaireInput.answers) },
    promptFacts: ['日本語', '守护同行者', '城镇在黄昏时会被迷雾包围', CANSHOU_LORE],
  },
  ...(['general', 'general-scenario'] as const).map((schema): StreamCase => ({
    name: `free/${schema}`,
    run: (options, mode, onPartialText) => executeFreeGeneration(options, { ...freeInput, schema }, createIntent(mode), new AbortController().signal, onPartialText),
    prompt: buildFreeStreamPrompt({ ...freeInput, schema }),
    temperature: 0.75, cardKind: schema,
    promptFacts: ['English', freeInput.prompt, '设定.txt', '已截断', freeInput.attachments[0]!.content],
  })),
  creatorCase('general'),
  creatorCase('general-scenario'),
  {
    name: 'scenario',
    run: (options, mode, onPartialText) => executeScenarioGeneration(options, scenarioInput, createIntent(mode), new AbortController().signal, onPartialText),
    prompt: buildScenarioStreamPrompt(scenarioInput),
    temperature: 0.75, cardKind: 'general-scenario',
    promptFacts: ['繁體中文', '黄昏', '渡口', '强制留空指令', '预设NPC', '发展方向', '雾港之约'],
  },
];

const harness = () => {
  let request: AiExecutionRequest | undefined;
  let emit: ((event: AiStreamEvent) => void) | undefined;
  let release: (() => void) | undefined;
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    expect(command).toBe(STREAM_DIRECT_AI_COMMAND);
    request = AiExecutionRequestSchema.parse(args!.request);
    emit = (args!.onEvent as { onmessage(event: AiStreamEvent): void }).onmessage;
    emit({ ...identity(), type: 'started', sequence: 0 });
    await new Promise<void>((resolve) => { release = resolve; });
  });
  const identity = () => ({ requestId: request!.requestId, contractVersion: 1 as const, mode: request!.mode });
  return {
    options: { invoke, profileId: 'saved-profile', createChannel: () => ({}) },
    invoke,
    get request() { return request!; },
    delta: (text: string) => emit!({ ...identity(), type: 'text-delta', sequence: 1, delta: text }),
    finish: () => {
      emit!({
        ...identity(), type: 'result', sequence: 2,
        result: { ...identity(), status: 'completed', output: { text: markdown }, finishReason: 'stop' },
      });
      release!();
    },
  };
};

describe.each(['direct-local', 'direct-remote'] as const)('Desktop %s Markdown generation families', (mode) => {
  it.each(cases)('$name 逐字复用 Web stream prompt，增量正文落成同源无签名卡', async (testCase) => {
    const native = harness();
    const onPartialText = vi.fn();
    const pending = testCase.run(native.options, mode, onPartialText);
    expect(native.request.messages).toEqual([{ role: 'user', content: testCase.prompt }]);
    expect(native.request.temperature).toBe(testCase.temperature);
    expect(native.request.responseFormat).toBe('text');
    expect(testCase.prompt).toContain('必须直接输出 Markdown 正文');
    for (const fact of testCase.promptFacts) expect(testCase.prompt).toContain(fact);
    native.delta('# 雨后档案');
    await vi.waitFor(() => expect(onPartialText).toHaveBeenCalledWith('# 雨后档案'));
    native.finish();
    const outcome = await pending;
    expect(outcome).toMatchObject({ status: 'completed', mode, rawText: markdown, cardKind: testCase.cardKind });
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.card).toEqual({
      ...(testCase.cardKind === 'general'
        ? { templateId: '通用角色', name: '青禾', codename: '青铃' }
        : { templateId: '通用情景', title: '雨后车站' }),
      content: markdown,
      ...testCase.metadata,
    });
    expect(outcome.card).not.toHaveProperty('signature');
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('stream template guards', () => {
  it.each(['direct-local', 'direct-remote', 'hosted-stream'] as const)('%s 拒绝 Free 结构化及未知 schema，不回退 Markdown', async (mode) => {
    for (const schema of ['magical-girl', 'canshou', 'scenario', 'custom'] as FreeSchemaId[]) {
      const native = harness();
      await expect(executeFreeGeneration(
        native.options, { ...freeInput, schema },
        { requestId: 'unsupported-free', mode, generationMode: 'stream' }, new AbortController().signal,
      )).rejects.toThrow(/流式生成仅支持|不支持的数据卡结构/);
      expect(native.invoke).not.toHaveBeenCalled();
    }
  });

  it.each(['direct-local', 'direct-remote', 'hosted-stream'] as const)('%s 拒绝 Creator 结构化模板，不回退通用角色', async (mode) => {
    for (const template of ['magical-girl', 'canshou', 'scenario'] as const) {
      const native = harness();
      await expect(executeCreatorGeneration(
        native.options, { ...creatorInput, template },
        { requestId: 'unsupported-creator', mode, generationMode: 'stream', flowers }, new AbortController().signal,
      )).rejects.toThrow(/流式生成仅支持|暂未接入/);
      expect(native.invoke).not.toHaveBeenCalled();
    }
  });
});
