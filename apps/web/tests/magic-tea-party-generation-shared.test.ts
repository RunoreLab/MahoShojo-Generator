import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@mahoshojo/ai-core/magic-tea-party';
import type { MagicTeaPartyMessage, MagicTeaPartyRole } from '@mahoshojo/domain/magic-tea-party/types';
import * as webBudget from '@/lib/magic-tea-party/budget';
import * as webHistory from '@/lib/magic-tea-party/history';
import * as webJsonl from '@/lib/magic-tea-party/jsonl';
import * as webLimits from '@/lib/magic-tea-party/message-limits';
import * as webNotice from '@/lib/magic-tea-party/notice';
import * as webPresets from '@/lib/magic-tea-party/presets';
import * as webPrompts from '@/lib/magic-tea-party/prompts';
import * as webPreview from '@/lib/magic-tea-party/stream-preview';
import * as webInstruction from '@/lib/magic-tea-party/system-instruction';
import * as webMappers from '@/lib/magic-tea-party/update-draft-mappers';
import { filterAndFormatHistory, formatCurrentStateForPrompt, formatUserAnswersForPrompt } from '@/lib/arena/logic';
import { appRouteHandler as streamHandler } from '@/app/api/magic-tea-party/generate-stream/handler';
import { appRouteHandler as choicesHandler } from '@/app/api/magic-tea-party/generate-choices/handler';
import { appRouteHandler as summarizeHandler } from '@/app/api/magic-tea-party/summarize/handler';
import { appRouteHandler as updatesHandler } from '@/app/api/magic-tea-party/generate-updates/handler';

const transport = vi.hoisted(() => ({ stream: vi.fn(), structured: vi.fn(), safety: vi.fn(), activity: vi.fn() }));

// 只隔离供应商/网络/安全审核副作用；Prompt、限额、预设及解析均使用真实共享实现。
vi.mock('@/lib/stream/raw-ai', () => ({ generateWithStreamAI: transport.stream, LoadBalanceStrategy: { CUSTOM: 'custom' } }));
vi.mock('@/lib/ai', () => ({ generateWithAI: transport.structured, LoadBalanceStrategy: { CUSTOM: 'custom' } }));
vi.mock('@/lib/content-safety/server', () => ({ enforceTextSafety: transport.safety }));
vi.mock('@/lib/user-activity/record', () => ({ recordUserActivityFromRequest: transport.activity }));
vi.mock('@/lib/ai/constants', () => ({
  AI_PROVIDER_CATALOG: [{ id: 'test-provider', name: 'Test', type: 'openai', baseUrl: 'https://provider.example.test/v1' }],
  resolveAIProviderModel: () => ({ modelId: 'test-model' }),
}));
vi.mock('@/lib/ai/availability', () => ({ buildChannelContextFromResolved: () => undefined }));

beforeEach(() => {
  transport.stream.mockReset().mockImplementation(async () => ({ response: new Response('合成模型输出'), finishReasonPromise: Promise.resolve('stop') }));
  transport.structured.mockReset().mockResolvedValue({ updates: [{ roleId: 'r1', characterName: '巡夜人', currentStateSummary: '已换上干衣' }] });
  transport.safety.mockReset().mockResolvedValue(null);
  transport.activity.mockReset();
});

const messages: MagicTeaPartyMessage[] = [
  { id: 'u1', sessionId: 'tea', role: 'user', content: '我推开门。', createdAt: 0 },
  { id: 'a1', sessionId: 'tea', role: 'assistant', content: '巡夜人递来热茶。', createdAt: 1 },
];
const role: MagicTeaPartyRole = { id: 'r1', name: '巡夜人', template: 'general', source: 'local', card: { templateId: '通用角色', name: '巡夜人', content: '守望街区的人。' } };
const customProvider = { providerId: 'test-provider', modelId: 'test-model', apiKey: 'synthetic-test-key' };
const settings = { language: 'zh-CN' as const, userDisplayName: '旅人', choiceCount: 4, outputFormat: 'jsonl' as const, enableChoices: true };

const post = (handler: typeof streamHandler, body: unknown) => handler(new Request('https://example.test/api/magic-tea-party', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}) as Parameters<typeof streamHandler>[0]);

describe('魔法茶会 Web 兼容路径回用共享实现', () => {
  it('所有旧路径导出与共享公共 API 为同一引用', () => {
    const legacy = { ...webBudget, ...webHistory, ...webJsonl, ...webLimits, ...webNotice, ...webPresets, ...webPrompts, ...webPreview, ...webInstruction, ...webMappers };
    expect([...Object.keys(legacy), 'projectMagicTeaPartySummaryInput', 'matchesMagicTeaPartySummaryInput', 'createMagicTeaPartyAutoSummaryScan', 'appendMagicTeaPartyAutoSummaryMessage', 'planMagicTeaPartyAutoSummary', 'resolveMagicTeaPartyAutoSummaryBudget', 'projectMagicTeaPartyAutoSummaryInput'].sort()).toEqual(Object.keys(shared).sort());
    for (const name of Object.keys(legacy) as Array<keyof typeof legacy>) expect(legacy[name]).toBe(shared[name]);
  });

  it('各预设只携带模式差异，非空角色格式化继续共源', () => {
    for (const [id, marker] of [['arena-classic', '战术'], ['arena-kizuna', '羁绊'], ['arena-daily', '温暖']] as const) {
      expect(shared.getMagicTeaPartyPreset(id)?.systemPrompt).toContain(marker);
      expect(shared.getMagicTeaPartyPreset(id)?.systemPrompt).not.toContain('【内容边界】');
    }
    const currentState = { summary: '湿透的斗篷', fields: [] };
    const history = { entries: [{ id: 1, title: '旧桥重逢', participants: ['旅人'], winner: '不适用', impact: '开始信任', metadata: {} }] };
    const answers = [{ question: '为何守望？', answer: '为了朋友。', questionnaireTitle: '来历' }];
    const prompt = shared.buildRoleProfileText({ ...role, card: { ...role.card, current_state: currentState, arena_history: history, userAnswers: answers } }, { readArenaHistory: true, readCurrentState: true, otherParticipantNames: ['旅人'] });
    expect(prompt).toContain(formatCurrentStateForPrompt(currentState).trim());
    expect(prompt).toContain(filterAndFormatHistory(role.name, history as Parameters<typeof filterAndFormatHistory>[1], ['旅人'], false, 3).trim());
    expect(prompt).toContain(formatUserAnswersForPrompt(answers, []).trim());
    expect(prompt).toContain('旧桥重逢');
    expect(prompt).toContain('A: 为了朋友。');
  });

  it('真实 generate-stream handler 将共享限额后的完整 Prompt 交给模型端口', async () => {
    const longMessages = [{ ...messages[0], content: `${'雨'.repeat(10_000)}尾声` }, messages[1]];
    const detailedRole = {
      ...role,
      card: {
        ...role.card,
        current_state: { summary: '湿透的斗篷' },
        arena_history: { entries: [{ id: 1, title: '旧桥重逢', participants: ['旅人'], winner: '不适用', impact: '开始信任', metadata: {} }] },
      },
    };
    const scenario = { id: 's1', title: '雨夜茶馆', source: 'local' as const, card: { templateId: '通用情景', title: '雨夜茶馆', content: '风铃下的茶馆还亮着灯。' } };
    const auxScenarios = [{ ...scenario, id: 's2', title: '闭店前' }];
    const detailedSettings = { ...settings, presetId: 'arena-daily', contextWindowTokens: 8192, readArenaHistory: true, readCurrentState: true };
    const output = [
      '{"type":"narration","text":"灯火摇曳。"}',
      '{"type":"choices","items":["坐下","离开"]}',
      '{"type":"notice","level":"warning","message":"茶水很烫"}',
      '{"type":"summary","text":"来访者已入座"}',
      '{"type":"updates","drafts":[{"characterName":"巡夜人","currentStateSummary":"递来热茶"}]}',
    ].join('\n');
    transport.stream.mockResolvedValueOnce({ response: new Response(output) });
    const body = { sessionId: 'tea', messages: longMessages, roles: [detailedRole], scenario, auxScenarios, settings: detailedSettings, customProvider };
    const response = await post(streamHandler, body);
    expect(response.status).toBe(200);
    const returned = await response.text();
    expect(returned).toBe(output);
    expect(transport.stream).toHaveBeenCalledOnce();
    const preset = shared.getMagicTeaPartyPreset(detailedSettings.presetId)!;
    const expected = shared.buildMagicTeaPartyMainPromptMessages({
      session: { playerRoleId: null, settings: { ...detailedSettings, providerId: customProvider.providerId, modelId: customProvider.modelId } },
      roles: [detailedRole], scenario, auxScenarios,
      worldbookText: shared.buildWorldbookText(preset.worldbook), stylePrompt: preset.systemPrompt,
      messages: shared.applyMagicTeaPartyMessageLimits(longMessages, 8000).messages,
    });
    expect(transport.stream.mock.calls[0][0]).toEqual({ ...expected, temperature: 0.75 });
    expect(expected.prompt).toContain('已省略中段');
    expect(expected.prompt).toContain('尾声');
    for (const text of ['雨夜茶馆', '闭店前', '旧桥重逢', '湿透的斗篷', '【世界书】', 'assistant: 巡夜人递来热茶。']) expect(expected.prompt).toContain(text);
    expect(transport.safety.mock.calls[0][0].text).toBe(`${expected.systemPrompt}\n\n${expected.prompt}`);
    expect(expected.systemPrompt).not.toContain(scenario.card.content);
    expect(expected.systemPrompt).not.toContain(detailedRole.card.content);
    expect(expected.systemPrompt).not.toContain(messages[0].content);
    const parsed = webJsonl.parseMagicTeaPartyJsonl(returned);
    expect(parsed.segments[0]).toEqual({ type: 'narration', text: '灯火摇曳。' });
    expect(parsed.choices).toEqual([{ id: 'c1', text: '坐下' }, { id: 'c2', text: '离开' }]);
    expect(parsed.notices[0]).toMatchObject({ message: '茶水很烫' });
    expect(parsed.summary?.text).toBe('来访者已入座');
    expect(parsed.updates).toEqual([{ characterName: '巡夜人', currentStateSummary: '递来热茶' }]);
  });

  it('真实 generate-choices handler 继续消费共享阶段规则', async () => {
    const response = await post(choicesHandler, { sessionId: 'tea', messages, roles: [role], settings, customProvider });
    expect(response.status).toBe(200);
    const expected = shared.buildMagicTeaPartyChoicesPromptMessages({
      session: { playerRoleId: null, settings: { ...settings, providerId: customProvider.providerId, modelId: customProvider.modelId } },
      roles: [role], messages, choiceCount: 4,
    });
    expect(transport.stream.mock.calls[0][0]).toEqual({ ...expected, temperature: 0.5 });
    expect(expected.systemPrompt).toContain('【阶段规则：选项】');
    expect(expected.prompt).toContain('旅人: 我推开门。');
  });

  it.each(['summary', 'title'] as const)('真实 summarize handler 保留 %s 模式的共享 Prompt', async (mode) => {
    const response = await post(summarizeHandler, { sessionId: 'tea', messages, mode, language: 'zh-CN', userDisplayName: '旅人', customProvider });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ [mode]: '合成模型输出', ...(mode === 'summary' ? {
      summaryInput: { messageIds: ['u1', 'a1'], contentLengths: [5, 8] },
    } : {}) });
    expect(transport.stream.mock.calls[0][0]).toEqual({ ...shared.buildMagicTeaPartySummarizePromptMessages({ messages, mode, language: 'zh-CN', userDisplayName: '旅人' }), temperature: mode === 'title' ? 0.2 : 0.3 });
  });

  it.each([8192, 32768, 128_000])('真实 summary handler 在 %s 档保留两层裁剪后的消息顺序和边界', async (contextWindowTokens) => {
    const input = [
      { id: 'user', role: 'user', content: `${'甲'.repeat(39_998)}尾声`, meta: { unknown: 'discard' } },
      { id: 'assistant', role: 'assistant', content: '乙'.repeat(13_000) },
      { id: 'system', role: 'system', content: '丙'.repeat(5_000) },
      { id: 'short', role: 'user', content: '  短句  ' },
      { id: 'empty', role: 'assistant', content: ' \n ' },
    ];
    const bodies = contextWindowTokens === 8192 ? [
      `${'甲'.repeat(5566)}\n\n…（本条消息过长，已省略中段 32048 字）…\n\n${'甲'.repeat(2384)}尾声`,
      `${'乙'.repeat(5566)}\n\n…（本条消息过长，已省略中段 5048 字）…\n\n${'乙'.repeat(2386)}`,
      `${'丙'.repeat(4000)}...[已截断]`,
      '短句',
    ] : [`${'甲'.repeat(8000)}...[已截断]`, `${'乙'.repeat(12_000)}...[已截断]`, `${'丙'.repeat(4000)}...[已截断]`, '短句'];
    const expectedHistory = `【对话记录】\n旅人: ${bodies[0]}\nassistant: ${bodies[1]}\nsystem: ${bodies[2]}\n旅人: ${bodies[3]}`;
    const response = await post(summarizeHandler, { sessionId: 'tea', messages: input, contextWindowTokens, userDisplayName: '  旅人  ', customProvider });
    expect(response.status).toBe(200);
    expect(transport.stream).toHaveBeenCalledOnce();
    const sent = transport.stream.mock.calls[0][0];
    expect(sent.temperature).toBe(0.3);
    expect(sent.prompt.endsWith(expectedHistory)).toBe(true);
    expect(await response.json()).toEqual({ summary: '合成模型输出', summaryInput: {
      messageIds: ['user', 'assistant', 'system', 'short'], contentLengths: bodies.map((body) => body.length),
    } });
  });

  it('summary 入站原文字数超过 800k 时仍拒绝，不能用裁后长度绕过', async () => {
    const response = await post(summarizeHandler, { sessionId: 'tea', messages: [{ id: 'huge', role: 'user', content: '字'.repeat(800_001) }], contextWindowTokens: 8192, customProvider });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ meta: { totalChars: 800_001, limit: 800_000 } });
    expect(transport.stream).not.toHaveBeenCalled();
    expect(transport.safety).not.toHaveBeenCalled();
  });

  it('空白输出不会返回成功摘要或输入核验信息', async () => {
    transport.stream.mockResolvedValueOnce({ response: new Response(' \n '), finishReasonPromise: Promise.resolve('stop') });
    const response = await post(summarizeHandler, { sessionId: 'tea', messages, customProvider });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: '生成失败', message: '模型返回空内容' });
    expect(transport.stream).toHaveBeenCalledOnce();
  });

  it.each(['length', 'unknown', undefined])('summary rejects non-normal finish %s despite nonempty text', async (reason) => {
    transport.stream.mockResolvedValueOnce({ response: new Response('不可提交'), finishReasonPromise: Promise.resolve(reason) });
    const response = await post(summarizeHandler, { sessionId: 'tea', messages, customProvider });
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty('summary');
    expect(transport.stream).toHaveBeenCalledOnce();
    expect(transport.stream.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
    expect(transport.stream.mock.calls[0][1].providerOverride.retryCount).toBe(1);
  });

  it('summary abort and rejected SDK completion cannot publish successful text', async () => {
    const controller = new AbortController();
    transport.stream.mockImplementationOnce(async (_input, options) => {
      expect(options.abortSignal.aborted).toBe(false);
      controller.abort();
      return { response: new Response('迟到正文'), finishReasonPromise: Promise.reject(new Error('cancelled')) };
    });
    const response = await summarizeHandler(new Request('https://example.test/api/magic-tea-party', {
      method: 'POST', body: JSON.stringify({ sessionId: 'tea', messages, customProvider }), signal: controller.signal,
    }) as Parameters<typeof summarizeHandler>[0]);
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty('summary');
  });

  it('真实 generate-updates handler 启用分层消息并保留共享输出与写入权限', async () => {
    const response = await post(updatesHandler, { sessionId: 'tea', messages, roles: [role], settings: { ...settings, writeCurrentState: true }, customProvider });
    expect(response.status).toBe(200);
    const [input, options] = transport.structured.mock.calls[0];
    const expected = shared.buildMagicTeaPartyUpdatePromptMessages(input);
    expect(options.promptMessageMode).toBe('system-user');
    expect(options.systemPrompt).toBe(expected.systemPrompt);
    expect(options.promptBuilder(input)).toBe(expected.prompt);
    expect(expected.systemPrompt).not.toContain('守望街区的人。');
    expect(expected.systemPrompt).not.toContain('我推开门。');
    expect(transport.safety.mock.calls[0][0].text).toBe(shared.buildMagicTeaPartyUpdatePrompt(input));
    expect(options.promptBuilder(input)).toContain('巡夜人');
    expect(options.promptBuilder(input)).toContain('旅人: 我推开门。');
    expect(await response.json()).toMatchObject({ drafts: [{ roleId: 'r1', characterName: '巡夜人', currentStateSummary: '已换上干衣' }] });
  });
});
