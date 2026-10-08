import { describe, expect, it, vi } from 'vitest';
import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { HostedGenerationEvent } from '@mahoshojo/contracts/desktop-cloud';
import type { BuildRuleRuntimeResult } from '@mahoshojo/domain/creator/types';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import {
  executeCreatorGeneration,
  type CreatorGenerationInput,
} from '../src/features/creator/generation';
import { STREAM_DIRECT_AI_COMMAND } from '../src/platform/direct-ai-bridge';
import { HOSTED_AI_REQUEST_COMMAND, STREAM_HOSTED_AI_COMMAND } from '../src/platform/cloud-bridge';

const selection: QuestionnaireSelection = {
  source: 'preset',
  questionnaire: {
    id: 'mg-q',
    kind: 'magical-girl',
    title: '默认问卷',
    nativeAllowed: true,
    questions: [{ id: 'q1', question: '你的信念？' }],
  },
};

const answers = [
  { question: '你的信念？', answer: '守护', questionId: 'q1', questionnaireId: 'mg-q' },
];

const validRule: BuildRuleRuntimeResult = {
  ruleId: 'arena-trpg-lite',
  version: '1.0.0',
  blockResults: { archetype: '守护者' },
  derived: { hp: 10 },
  validationSummary: { valid: true, issues: [], missingRequiredBlockKeys: [] },
};

const baseInput: CreatorGenerationInput = {
  template: 'magical-girl',
  freeformBrief: '',
  answers,
  language: '简体中文',
  loreText: '',
  questionnaires: [{ questionnaireId: 'mg-q', title: '默认问卷' }],
  buildRules: [],
  buildRuleRequests: [],
  primaryRuleId: null,
  hosted: { selections: [selection], allowNativeSignature: false },
};

const magicalGirlCard = {
  codename: '焰汐',
  appearance: { outfit: '红裙', accessories: '焰环', colorScheme: '红', overallLook: '明亮' },
  magicConstruct: { name: '焰杖', form: '杖', basicAbilities: ['点火'], description: '召焰' },
  wonderlandRule: { name: '焰间', description: '燃而不烫', tendency: '守护', activation: '握杖' },
  blooming: { name: '焰华', evolvedAbilities: ['燎原'], evolvedForm: '焰翼', evolvedOutfit: '礼裙', powerLevel: '中花' },
  analysis: {
    personalityAnalysis: '外向',
    abilityReasoning: '控火',
    coreTraits: ['勇'],
    predictionBasis: '提示词',
    background: { belief: '守护', bonds: '同伴' },
  },
};

const directHarness = (text: string) => {
  let sent: AiExecutionRequest | undefined;
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command !== STREAM_DIRECT_AI_COMMAND) throw new Error(`unexpected command: ${command}`);
    sent = args!.request as AiExecutionRequest;
    const channel = args!.onEvent as { onmessage: (event: AiStreamEvent) => void };
    const identity = { requestId: sent.requestId, contractVersion: 1 as const, mode: sent.mode };
    channel.onmessage({ type: 'started', ...identity, sequence: 0 });
    const result: AiExecutionResult = { ...identity, status: 'completed', output: { text }, finishReason: 'stop' };
    channel.onmessage({ type: 'result', ...identity, sequence: 1, result });
  });
  return { invoke, options: { invoke, profileId: 'p', createChannel: () => ({}) }, get request() { return sent; } };
};

describe('Desktop Creator direct generation', () => {
  it('direct 通路：magical-girl 结构化卡注入 creationInputs 元数据并携带 flowers', async () => {
    const native = directHarness(JSON.stringify(magicalGirlCard));
    const outcome = await executeCreatorGeneration(
      native.options, baseInput, { requestId: 'c-1', mode: 'direct-local', flowers: '玫瑰/爱情' },
      new AbortController().signal,
    );
    const prompt = native.request!.messages[1]!.content;
    expect(prompt).toContain('玫瑰/爱情');
    expect(prompt).toContain('守护');
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('magical-girl');
    expect(outcome.card).toMatchObject(magicalGirlCard);
    expect(outcome.card.templateId).toBe('魔法少女/心之花/魔法少女（问卷生成）');
    // 与 hosted dataToSign 同口径：creationInputs 恒在，无规则时无 buildState。
    expect(outcome.card.creationInputs).toMatchObject({ template: 'magical-girl' });
    expect(outcome.card).not.toHaveProperty('buildState');
    expect(outcome.card).not.toHaveProperty('signature');
  });

  it('direct 通路：general 模板走 {name,content} schema，产出通用角色卡', async () => {
    const native = directHarness(JSON.stringify({ name: '雾行者', content: '# 雾行者\n\n正文' }));
    const outcome = await executeCreatorGeneration(
      native.options,
      { ...baseInput, template: 'general', freeformBrief: '写个雾中行者' },
      { requestId: 'c-2', mode: 'direct-remote', flowers: '' },
      new AbortController().signal,
    );
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('general');
    expect(outcome.card).toMatchObject({
      templateId: '通用角色', name: '雾行者', content: '# 雾行者\n\n正文',
    });
    expect(outcome.card.creationInputs).toMatchObject({ template: 'general', freeformBrief: '写个雾中行者' });
  });

  it('dispatch 前校验：无答案/说明/规则时拒绝且不发起请求', async () => {
    const native = directHarness('{}');
    await expect(executeCreatorGeneration(
      native.options,
      { ...baseInput, answers: [], questionnaires: [], freeformBrief: '' },
      { requestId: 'c-x', mode: 'direct-local', flowers: '' },
      new AbortController().signal,
    )).rejects.toThrow('请至少填写一题');
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('规则车卡进 prompt：创作约束小节含规则事实', async () => {
    const native = directHarness(JSON.stringify(magicalGirlCard));
    const outcome = await executeCreatorGeneration(
      native.options,
      {
        ...baseInput,
        buildRules: [validRule],
        buildRuleRequests: [{ ruleId: 'arena-trpg-lite', version: '1.0.0', inputs: { archetype: '守护者' } }],
        primaryRuleId: 'arena-trpg-lite',
      },
      { requestId: 'c-3', mode: 'direct-local', flowers: 'x' },
      new AbortController().signal,
    );
    // 规则经共源投影进 prompt：渲染规则事实块（主规则小节），而非 ruleId 字面量。
    expect(native.request!.messages[1]!.content).toContain('主规则');
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.card.buildState).toMatchObject({ primaryRuleId: 'arena-trpg-lite' });
    expect((outcome.card.buildState as { rules: unknown[] }).rules).toHaveLength(1);
  });
});

describe('Desktop Creator hosted generation', () => {
  it('hosted-json 走 generate-creator，请求体键序与 Web 提交段一致', async () => {
    let request: { routeId: string; body: Record<string, unknown> } | undefined;
    const data = { ...magicalGirlCard, templateId: '魔法少女/心之花/魔法少女（问卷生成）', signature: 'sig-1', creationInputs: { template: 'magical-girl' } };
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== HOSTED_AI_REQUEST_COMMAND) throw new Error(`unexpected command: ${command}`);
      request = args!.request as typeof request;
      return { status: 200, body: { data, aiMeta: null } };
    });
    const outcome = await executeCreatorGeneration(
      { invoke, profileId: '' },
      { ...baseInput, buildRules: [validRule], buildRuleRequests: [{ ruleId: 'arena-trpg-lite', inputs: {} }], primaryRuleId: 'arena-trpg-lite' },
      { requestId: 'h-1', mode: 'hosted-json', flowers: '' },
      new AbortController().signal,
    );
    expect(request!.routeId).toBe('generate-creator');
    // 与 Web 提交段逐键对拍：固定键序（primaryRuleId 恒显式携带）。
    expect(Object.keys(request!.body)).toEqual([
      'template', 'freeformBrief', 'answers', 'questionnaireSelections', 'questionnaires',
      'allowNativeSignature', 'language', 'buildRules', 'primaryRuleId',
    ]);
    expect(request!.body).toMatchObject({
      template: 'magical-girl', allowNativeSignature: false, language: '简体中文',
      primaryRuleId: 'arena-trpg-lite',
    });
    expect(request!.body).not.toHaveProperty('customProvider');
    expect(outcome).toMatchObject({ status: 'completed', cardKind: 'magical-girl' });
    if (outcome.status === 'completed') expect(outcome.card.signature).toBe('sig-1');
  });

  it('hosted-stream 走 generate-creator-stream，Markdown → 通用情景卡并回带元数据', async () => {
    let request: { routeId: string; body: Record<string, unknown> } | undefined;
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== STREAM_HOSTED_AI_COMMAND) throw new Error(`unexpected command: ${command}`);
      request = args!.request as typeof request;
      const channel = args!.onEvent as { onmessage: (event: HostedGenerationEvent) => void };
      channel.onmessage({ event: 'markdown', data: { chunk: '# 雾都异闻\n\n正文' } });
      channel.onmessage({ event: 'done', data: { ok: true } });
      return {};
    });
    const outcome = await executeCreatorGeneration(
      { invoke, profileId: '', createChannel: () => ({}) },
      { ...baseInput, template: 'general-scenario', streamFallbackLabel: '雾都' },
      { requestId: 'hs-1', mode: 'hosted-stream', flowers: '' },
      new AbortController().signal,
    );
    expect(request!.routeId).toBe('generate-creator-stream');
    expect(request!.body).toMatchObject({ template: 'general-scenario', primaryRuleId: null });
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('expected completed');
    expect(outcome.cardKind).toBe('general-scenario');
    expect(outcome.card).toMatchObject({ templateId: '通用情景', title: '雾都异闻' });
    expect(outcome.card.creationInputs).toMatchObject({ template: 'general-scenario' });
    expect(outcome.card).not.toHaveProperty('signature');
  });

  it('hosted-json 收到流式模板响应（模板错配）如实判 invalid-output', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { data: { name: 'x', content: 'y' } } }));
    const outcome = await executeCreatorGeneration(
      { invoke, profileId: '' },
      { ...baseInput, template: 'general' },
      { requestId: 'h-2', mode: 'hosted-json', flowers: '' },
      new AbortController().signal,
    );
    expect(outcome).toMatchObject({ status: 'invalid-output', mode: 'hosted-json' });
  });

  it('hosted-json 数据未过 schema 校验投影为 invalid-output 并保留响应原文', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { data: { bogus: true }, aiMeta: null } }));
    const outcome = await executeCreatorGeneration(
      { invoke, profileId: '' }, baseInput,
      { requestId: 'h-3', mode: 'hosted-json', flowers: '' },
      new AbortController().signal,
    );
    expect(outcome).toMatchObject({ status: 'invalid-output', message: '服务器返回的数据卡未通过校验。' });
    if (outcome.status === 'invalid-output') expect(outcome.rawText).toContain('bogus');
  });
});
