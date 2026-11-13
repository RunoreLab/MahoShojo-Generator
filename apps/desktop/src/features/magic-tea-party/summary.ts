import {
  buildMagicTeaPartyHistory, buildMagicTeaPartySummarizePromptMessages, clipMagicTeaPartyMessageContent, estimateMagicTeaPartyTokens, projectMagicTeaPartySummaryInput,
  resolveMagicTeaPartyMessageCharLimit, resolveMagicTeaPartyTokenBudget, selectMagicTeaPartyHistoryPositions,
  createMagicTeaPartyAutoSummaryScan, appendMagicTeaPartyAutoSummaryMessage, planMagicTeaPartyAutoSummary,
  resolveMagicTeaPartyAutoSummaryBudget, projectMagicTeaPartyAutoSummaryInput,
} from '@mahoshojo/ai-core/magic-tea-party';
import { AiExecutionRequestSchema, type AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { MagicTeaPartyHistoryMessage, MagicTeaPartySession } from '@mahoshojo/domain/magic-tea-party/types';
import type { ResolvedDesktopAiTarget } from '../ai-config/desktop-ai-config';
import type { TeaNativePort } from '../../platform/magic-tea-party-native';
import { assertTeaCurrent, isTeaScalarText, readTeaMessagePages, teaMessageView, teaSessionView, type TeaRecord } from './direct';

export type TeaSummaryPreparation = {
  request: AiExecutionRequest;
  summaryMeta: Omit<NonNullable<MagicTeaPartySession['summaryMeta']>, 'updatedAt'>;
  autoSummaryThroughMessageId?: string;
};

/** Read a fixed revision twice: bounded descriptors, then only the chosen source text. */
export async function prepareTeaSummaryRequest(port: TeaNativePort, record: TeaRecord, target: ResolvedDesktopAiTarget,
  requestId: string, current: () => boolean): Promise<TeaSummaryPreparation> {
  return (await prepareSummary(port, record, target, requestId, current))!;
}

export async function prepareTeaAutoSummaryRequest(port: TeaNativePort, record: TeaRecord, target: ResolvedDesktopAiTarget,
  requestId: string, current: () => boolean, consecutiveDroppedTurns: number): Promise<TeaSummaryPreparation | null> {
  return prepareSummary(port, record, target, requestId, current, consecutiveDroppedTurns);
}

async function prepareSummary(port: TeaNativePort, record: TeaRecord, target: ResolvedDesktopAiTarget,
  requestId: string, current: () => boolean, consecutiveDroppedTurns?: number): Promise<TeaSummaryPreparation | null> {
  if (target.location !== 'client' || !target.mode || !target.modelId || !target.providerTarget || target.unavailableReason) {
    throw new Error('文本茶会需要选择可用的客户端 Direct 连接和模型');
  }
  const { settings } = teaSessionView(record.session);
  const providerId = target.providerTarget.kind === 'preset' ? target.providerTarget.providerId : settings.providerId;
  const budget = resolveMagicTeaPartyTokenBudget(settings, providerId);
  if (budget.maxContextMessages > 10_000) throw new Error('此桌面会话的上下文条数超过 10000，请调整设置后重试；原设置已保留');
  const automatic = consecutiveDroppedTurns !== undefined;
  const autoBudget = automatic ? resolveMagicTeaPartyAutoSummaryBudget({ settings, providerId,
    previousSummary: typeof record.session.summary === 'string' ? record.session.summary : undefined,
    maxOutputTokens: target.generationOverrides?.maxOutputTokens }) : null;
  const maxMessages = autoBudget?.maxMessages ?? Math.max(1, budget.maxContextMessages);
  const label = settings.userDisplayName?.trim() || '{{user}}';
  const descriptors: Array<{ ordinal: number; tokens: number }> = [];
  let sourceMessageCount = 0;
  let fromMessageId: string | undefined;
  let toMessageId: string | undefined;
  let scan = createMagicTeaPartyAutoSummaryScan();
  const session = teaSessionView(record.session);
  for await (const page of readTeaMessagePages(port, record, current)) for (const row of page.rows) {
    const history = buildMagicTeaPartyHistory([teaMessageView(row.message)], { includeEmptyContent: false })[0];
    if (!history) continue;
    sourceMessageCount += 1;
    fromMessageId ??= history.id;
    toMessageId = history.id;
    if (automatic) scan = appendMagicTeaPartyAutoSummaryMessage(scan, history, { providerId, userDisplayName: label,
      summaryThroughMessageId: session.summaryMeta?.toMessageId,
      lastAttemptedThroughMessageId: session.autoSummaryState?.lastAttemptedThroughMessageId });
    descriptors.push({ ordinal: row.ordinal, tokens: estimateMagicTeaPartyTokens(`${history.role === 'user' ? label : history.role}: ${history.content}`, providerId) });
    if (descriptors.length > maxMessages) descriptors.shift();
  }
  const plan = automatic ? planMagicTeaPartyAutoSummary({ settings, providerId, scan, consecutiveDroppedTurns }) : null;
  if (automatic && !plan) return null;
  if (!descriptors.length) throw new Error('还没有可用于摘要的对话。');
  const selected = new Set(selectMagicTeaPartyHistoryPositions(descriptors.length, index => descriptors[index]!.tokens,
    { maxMessages, tokenBudget: autoBudget?.historyBudgetTokens ?? budget.historyBudgetTokens, minKeep: 2 }).map(index => descriptors[index]!.ordinal));
  if (selected.size > 200) throw new Error('本次请求超过 200 条上下文，请调低上下文条数后重试；原设置已保留');
  const messages: MagicTeaPartyHistoryMessage[] = [];
  const contextClippedMessageIds: string[] = [];
  const limit = resolveMagicTeaPartyMessageCharLimit(budget.contextWindowTokens);
  for await (const page of readTeaMessagePages(port, record, current)) for (const row of page.rows) {
    if (!selected.has(row.ordinal)) continue;
    const clipped = clipMagicTeaPartyMessageContent(row.message.content, limit);
    if (clipped.clipped) contextClippedMessageIds.push(row.message.id);
    messages.push({ id: row.message.id, role: row.message.role, content: clipped.text });
  }
  const projectionParams = { messages, contextWindowTokens: budget.contextWindowTokens,
    language: settings.language, userDisplayName: settings.userDisplayName, sourceMessageCount, contextClippedMessageIds };
  const projection = autoBudget ? projectMagicTeaPartyAutoSummaryInput({ ...projectionParams, seedContent: autoBudget.seedContent })
    : projectMagicTeaPartySummaryInput(projectionParams);
  // The equivalent Web request submits the context-clipped projection, not the whole local archive.
  if (projection.requestMessages.reduce((sum, item) => sum + item.content.length, 0) > 800_000) throw new Error('本次裁剪后的上下文超过 800000 字符，请减少上下文后重试');
  assertTeaCurrent(current);
  const promptMessages = buildMagicTeaPartySummarizePromptMessages({
    messages: projection.requestMessages, language: settings.language, userDisplayName: settings.userDisplayName,
  });
  if (!isTeaScalarText(promptMessages.systemPrompt) || !isTeaScalarText(promptMessages.prompt)) throw new Error('请求含不完整的 Unicode 字符，请修正来源后重试；原正文已保留');
  const request = AiExecutionRequestSchema.parse({ requestId, contractVersion: 1, mode: target.mode, modelId: target.modelId,
    messages: [{ role: 'system', content: promptMessages.systemPrompt }, { role: 'user', content: promptMessages.prompt }], temperature: target.generationOverrides?.temperature ?? 0.3,
    ...(autoBudget ? { maxOutputTokens: autoBudget.maxOutputTokens }
      : target.generationOverrides?.maxOutputTokens === undefined ? {} : { maxOutputTokens: target.generationOverrides.maxOutputTokens }), responseFormat: 'text' });
  return { request, summaryMeta: { fromMessageId, toMessageId, coverage: projection.coverage },
    ...(plan ? { autoSummaryThroughMessageId: plan.throughMessageId } : {}) };
}

/** Manual edits keep unrelated extensions and the legacy auto-summary watermark, not generated coverage. */
export const editedTeaSummary = (session: TeaRecord['session'], text: string, now: number): Pick<MagicTeaPartySession, 'summary' | 'summarySections' | 'summaryMeta'> => {
  const oldMeta = session.summaryMeta && typeof session.summaryMeta === 'object' && !Array.isArray(session.summaryMeta)
    ? session.summaryMeta as Record<string, unknown> : {};
  const { coverage: _coverage, tokenCount: _tokenCount, ...extensions } = oldMeta;
  if (!text.trim()) {
    const { fromMessageId: _from, toMessageId: _to, updatedAt: _updatedAt, ...unrelated } = extensions;
    return { summary: undefined, summarySections: undefined,
      summaryMeta: Object.keys(unrelated).length ? { ...unrelated, updatedAt: now } : undefined };
  }
  return { summary: text, summarySections: session.summarySections, summaryMeta: { ...extensions, updatedAt: now } };
};
