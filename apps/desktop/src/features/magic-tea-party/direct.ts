import {
  appendMagicTeaPartySystemInstruction, buildMagicTeaPartyHistory, buildMagicTeaPartyMainPrompt, buildMagicTeaPartyChoicesPrompt,
  buildMagicTeaPartyMainPromptMessages, buildMagicTeaPartyChoicesPromptMessages,
  buildWorldbookText, clipMagicTeaPartyMessageContent,
  estimateMagicTeaPartyTokens, getMagicTeaPartyPreset, projectMagicTeaPartyChoices,
  resolveMagicTeaPartyMessageCharLimit, resolveMagicTeaPartyTokenBudget, selectMagicTeaPartyHistoryPositions,
} from '@mahoshojo/ai-core/magic-tea-party';
import { AiStreamProtocolError, collectAiStreamResult, type AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { pickMagicTeaPartyRequestSettings } from '@mahoshojo/domain/magic-tea-party/import-plan';
import type { MagicTeaPartyHistoryMessage, MagicTeaPartyMessage, MagicTeaPartySession, MagicTeaPartyPreferences } from '@mahoshojo/domain/magic-tea-party/types';
import type { TeaReadResponse, TeaMessageDocument, TeaSessionDocument } from '@mahoshojo/contracts/desktop-magic-tea-party';
import { AiExecutionRequestSchema, type AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { AIReasoningEnvelope } from '@mahoshojo/contracts/ai-reasoning';
import type { TeaNativePort } from '../../platform/magic-tea-party-native';
import { createDesktopAiExecutionPort, type DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import { desktopChannelDeliveryFailure } from '../../platform/direct-ai-bridge';
import type { ResolvedDesktopAiTarget } from '../ai-config/desktop-ai-config';

export const isTeaScalarText = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};
export type TeaRecord = NonNullable<Extract<TeaReadResponse['result'], { action: 'session' }>['record']>;
export const TEA_PREFERENCES: MagicTeaPartyPreferences = {
  outputFormat: 'jsonl', outputPlan: { choices: 'auto', summary: 'off', updates: 'off' }, enableChoices: true,
  choiceCount: 4, language: 'zh-CN', userDisplayName: '旅人', enableSummary: false, updateApplyMode: 'draft',
  readArenaHistory: true, readArenaHistoryLimit: 3, isArenaHistoryUnlimited: false, readCurrentState: true,
  writeArenaHistory: false, writeCurrentState: false, tachieCacheMaxPerSession: 0, tachieCacheMaxGlobal: 0,
  tachieCacheMaxBytes: 0, presetCharacterPanelCollapsed: false, presetScenarioPanelCollapsed: false,
  sessionRetentionDays: 0, maxSessions: 0,
};

/** Typed request projection only. The original session document remains untouched. */
export const desktopTeaSettings = (raw: unknown): MagicTeaPartySession['settings'] => {
  const value = pickMagicTeaPartyRequestSettings(raw);
  const result: MagicTeaPartySession['settings'] = {
    providerId: typeof value.providerId === 'string' ? value.providerId : '',
    modelId: typeof value.modelId === 'string' ? value.modelId : '',
    outputFormat: value.outputFormat === 'markdown' ? 'markdown' : 'jsonl',
    language: value.language === 'ja-JP' || value.language === 'en-US' ? value.language : 'zh-CN',
    userDisplayName: typeof value.userDisplayName === 'string' ? value.userDisplayName : '旅人',
    enableChoices: typeof value.enableChoices === 'boolean' ? value.enableChoices : true,
    choiceCount: typeof value.choiceCount === 'number' && Number.isFinite(value.choiceCount) ? value.choiceCount : 4,
    readArenaHistory: typeof value.readArenaHistory === 'boolean' ? value.readArenaHistory : true,
    readCurrentState: typeof value.readCurrentState === 'boolean' ? value.readCurrentState : true,
    readArenaHistoryLimit: typeof value.readArenaHistoryLimit === 'number' ? value.readArenaHistoryLimit : 3,
    isArenaHistoryUnlimited: value.isArenaHistoryUnlimited === true,
    autoSummaryEnabled: value.autoSummaryEnabled === true,
    enableSummary: false, writeArenaHistory: false, writeCurrentState: false, updateApplyMode: 'draft',
    outputPlan: { choices: value.outputPlan?.choices === 'off' ? 'off' : value.outputPlan?.choices === 'on' ? 'on' : 'auto', summary: 'off', updates: 'off' },
  };
  for (const key of ['temperature', 'maxContextMessages', 'contextWindowTokens', 'responseReserveTokens', 'summaryTriggerRatio', 'summaryMaxTokens', 'summaryMinGapMessages'] as const) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) result[key] = value[key];
  }
  for (const key of ['presetId', 'worldbookPresetId'] as const) if (typeof value[key] === 'string') result[key] = value[key];
  return result;
};
export const teaSessionView = (session: TeaSessionDocument): MagicTeaPartySession => ({
  ...session, settings: desktopTeaSettings(session.settings),
} as MagicTeaPartySession);
export const teaMessageView = (message: TeaMessageDocument): MagicTeaPartyMessage => message as MagicTeaPartyMessage;
export const assertTeaCurrent = (current: () => boolean) => {
  if (!current()) throw new Error('茶会操作已失效，请在当前会话重新操作');
};
export async function* readTeaMessagePages(port: TeaNativePort, record: TeaRecord, current: () => boolean, catalogRevision: number | null = null) {
  let cursor: Extract<TeaReadResponse['result'], { action: 'messages' }>['nextCursor'] = null;
  do {
    assertTeaCurrent(current);
    const response = await port.read({ version: 1, request: { action: 'messages', sessionId: record.session.id, instance: record.instance,
      expectedRevision: record.revision, cursor, expectedCatalogRevision: catalogRevision, limit: 100 } });
    assertTeaCurrent(current);
    if (response.result.action !== 'messages') throw new Error('茶会消息回执不匹配');
    yield response.result;
    cursor = response.result.nextCursor;
  } while (cursor);
}

export async function prepareTeaDirectRequest(port: TeaNativePort, record: TeaRecord, target: ResolvedDesktopAiTarget,
  input: MagicTeaPartyMessage | null, requestId: string, current: () => boolean, kind: 'chat' | 'choices' = 'chat',
  onHistorySelection?: (_droppedRatio: number) => void): Promise<AiExecutionRequest> {
  if (target.location !== 'client' || !target.mode || !target.modelId || !target.providerTarget || target.unavailableReason) {
    throw new Error('文本茶会需要选择可用的客户端 Direct 连接和模型');
  }
  const session = teaSessionView(record.session);
  const settings = session.settings;
  const providerId = target.providerTarget.kind === 'preset' ? target.providerTarget.providerId : settings.providerId;
  const budget = resolveMagicTeaPartyTokenBudget(settings, providerId);
  if (budget.maxContextMessages > 10_000) throw new Error('此桌面会话的上下文条数超过 10000，请调整设置后重试；原设置已保留');
  const maxMessages = Math.max(1, budget.maxContextMessages);
  const preset = getMagicTeaPartyPreset(settings.presetId ?? null);
  const base = { session, roles: session.roles, scenario: session.scenario, auxScenarios: session.auxScenarios,
    worldbookText: preset ? buildWorldbookText(preset.worldbook) : '', stylePrompt: preset?.systemPrompt ?? '', requestChoices: false };
  const buildPrompt = (messages: MagicTeaPartyMessage[]) => kind === 'choices'
    ? buildMagicTeaPartyChoicesPrompt({ ...base, messages, updates: 'off' })
    : buildMagicTeaPartyMainPrompt({ ...base, messages });
  const available = Math.max(0, budget.historyBudgetTokens - estimateMagicTeaPartyTokens(buildPrompt([]), providerId));
  const label = settings.userDisplayName?.trim() || '{{user}}';
  const descriptors: Array<{ ordinal: number; tokens: number }> = [];
  let sourceMessageCount = 0;
  const describe = (message: MagicTeaPartyMessage, ordinal: number) => {
    const history = buildMagicTeaPartyHistory([message], { includeEmptyContent: false })[0];
    if (!history) return;
    sourceMessageCount += 1;
    descriptors.push({ ordinal, tokens: estimateMagicTeaPartyTokens(`${history.role === 'user' ? label : history.role}: ${history.content}`, providerId) });
    if (descriptors.length > maxMessages) descriptors.shift();
  };
  for await (const page of readTeaMessagePages(port, record, current)) for (const row of page.rows) describe(teaMessageView(row.message), row.ordinal);
  if (input) describe(input, -1);
  const selected = new Set(selectMagicTeaPartyHistoryPositions(descriptors.length, index => descriptors[index]!.tokens,
    { maxMessages, tokenBudget: available, minKeep: 2 }).map(index => descriptors[index]!.ordinal));
  onHistorySelection?.(sourceMessageCount ? (sourceMessageCount - selected.size) / sourceMessageCount : 0);
  const limit = resolveMagicTeaPartyMessageCharLimit(budget.contextWindowTokens);
  let history: MagicTeaPartyHistoryMessage[] = [];
  const accept = (message: MagicTeaPartyMessage, ordinal: number) => {
    if (selected.has(ordinal)) history.push({ id: message.id, role: message.role, content: clipMagicTeaPartyMessageContent(message.content, limit).text });
  };
  for await (const page of readTeaMessagePages(port, record, current)) for (const row of page.rows) accept(teaMessageView(row.message), row.ordinal);
  if (input) accept(input, -1);
  else if (kind === 'chat') history = appendMagicTeaPartySystemInstruction(history, descriptors.length ? 'continue' : 'opening', requestId);
  if (history.length > 200) throw new Error('本次请求超过 200 条上下文，请调低上下文条数后重试；原设置已保留');
  if (history.reduce((sum, item) => sum + item.content.length, 0) > 800_000) throw new Error('本次裁剪后的上下文超过 800000 字符，请减少上下文后重试');
  assertTeaCurrent(current);
  const promptInput = { ...base, messages: history.map(message => ({ ...message, sessionId: record.session.id, createdAt: 0 })) };
  const prompt = kind === 'choices'
    ? buildMagicTeaPartyChoicesPromptMessages({ ...promptInput, updates: 'off' })
    : buildMagicTeaPartyMainPromptMessages(promptInput);
  // Existing isolated code units are rejected, never normalized or replaced.
  if (!isTeaScalarText(prompt.systemPrompt) || !isTeaScalarText(prompt.prompt)) throw new Error('请求含不完整的 Unicode 字符，请修正来源后重试；原正文已保留');
  return AiExecutionRequestSchema.parse({ requestId, contractVersion: 1, mode: target.mode, modelId: target.modelId,
    messages: [{ role: 'system', content: prompt.systemPrompt }, { role: 'user', content: prompt.prompt }], temperature: target.generationOverrides?.temperature ?? settings.temperature ?? 0.7,
    ...(target.generationOverrides?.maxOutputTokens === undefined ? {} : { maxOutputTokens: target.generationOverrides.maxOutputTokens }), responseFormat: 'text' });
}

export type TeaDirectOutcome = { completion: 'provider' | 'stopped' | 'failed'; rawText: string; reasoning: string; message?: string };
export const teaReasoningMeta = (text: string, phase: 'streaming' | TeaDirectOutcome['completion']): { aiReasoning?: AIReasoningEnvelope } => text ? {
  aiReasoning: { status: phase === 'streaming' ? 'thinking' : phase === 'provider' ? 'done' : 'error', source: 'provider', text },
} : {};
export async function executeTeaDirect(options: DesktopAiExecutionOptions, request: AiExecutionRequest, signal: AbortSignal,
  onAccepted: (_text: string, _reasoning: string) => void): Promise<TeaDirectOutcome> {
  let rawText = ''; let reasoning = '';
  let deliveryFailure: ReturnType<typeof desktopChannelDeliveryFailure>;
  const port = createDesktopAiExecutionPort(options);
  const source = async function* (): AsyncGenerator<AiStreamEvent> {
    try {
      for await (const event of port.stream(request, signal)) {
        yield event;
        if (signal.aborted) return;
        if (event.type === 'text-delta') rawText += event.delta;
        if (event.type === 'reasoning-delta') reasoning += event.delta;
        onAccepted(rawText, reasoning);
      }
    } catch (cause) { deliveryFailure = desktopChannelDeliveryFailure(cause); throw cause; }
  };
  try {
    const result = await collectAiStreamResult(request, source());
    if (signal.aborted || result.status === 'cancelled') return { completion: 'stopped', rawText, reasoning };
    if (result.status !== 'completed' || result.finishReason !== 'stop') return { completion: 'failed', rawText, reasoning, message: '模型未正常完成，已保留收到的正文' };
    return { completion: 'provider', rawText: result.output.text ?? rawText, reasoning: result.output.reasoning ?? reasoning };
  } catch (cause) {
    return { completion: signal.aborted ? 'stopped' : 'failed', rawText, reasoning,
      message: deliveryFailure && cause instanceof AiStreamProtocolError && cause.code === 'source-failed'
        ? deliveryFailure.message : '生成连接或输出预算未通过，已保留收到的正文' };
  }
}
export const teaTerminalMessage = (placeholder: TeaMessageDocument, outcome: TeaDirectOutcome, format: 'jsonl' | 'markdown', kind: 'chat' | 'choices' | 'summary' = 'chat'): TeaMessageDocument => {
  if (kind === 'summary') {
    const content = outcome.rawText.trim();
    const valid = outcome.completion === 'provider' && Boolean(content) && isTeaScalarText(content);
    const error = valid ? null : { code: outcome.completion === 'provider' ? 'invalid_summary' : outcome.completion,
      message: outcome.completion === 'stopped' ? '已主动停止，旧摘要未变，收到的原文已保留'
        : outcome.completion === 'failed' ? outcome.message ?? '摘要生成未正常完成，旧摘要未变' : '模型返回空摘要或无效字符，旧摘要未变' };
    return { ...placeholder, status: valid ? 'done' : 'error', content,
      meta: { kind: 'summary', completion: outcome.completion, rawOutput: outcome.rawText, ...teaReasoningMeta(outcome.reasoning, outcome.completion) },
      ...(error ? { error } : {}) };
  }
  const projection = format === 'jsonl' ? projectMagicTeaPartyChoices({ rawText: outcome.rawText,
    completion: outcome.completion === 'provider' ? 'completed' : outcome.completion }) : null;
  const error = outcome.completion === 'provider' ? (kind === 'choices' ? projection?.error : undefined)
    : { code: outcome.completion, message: outcome.completion === 'stopped' ? '已主动停止，保存的是已接收前缀' : outcome.message ?? '生成未正常完成' };
  return { ...placeholder, status: kind === 'choices' && projection ? projection.status : outcome.completion === 'provider' ? 'done' : 'error',
    content: projection ? projection.content : outcome.rawText,
    ...(projection ? { segments: projection.segments, choices: projection.choices } : {}),
    meta: { kind: kind === 'choices' ? 'choices' : 'reply', outputFormat: format, completion: outcome.completion,
      choicesValid: Boolean(projection?.lastChoices), ...(projection?.notices.length ? { notices: projection.notices } : {}),
      rawOutput: outcome.rawText, ...teaReasoningMeta(outcome.reasoning, outcome.completion) },
    ...(error ? { error } : {}) };
};
