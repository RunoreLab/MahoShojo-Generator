import { DesktopHostedGenerateRequestSchema, DesktopHostedTavernBodySchema, DesktopTavernStreamErrorSchema } from '@mahoshojo/contracts/desktop-cloud';
import { parseDataCardByTemplate } from '@mahoshojo/domain/data-card-schemas';
import type { JsonValue } from '@mahoshojo/contracts/json-value';
import {
  buildTavernStreamPrompt, TAVERN_STREAM_TEMPERATURE,
  createTavernMagicalGirlGenerationConfig, createTavernCanshouGenerationConfig,
  projectTavernMagicalGirlResult, projectTavernCanshouResult,
  createTavernGeneralGenerationConfig, createTavernGeneralScenarioGenerationConfig, createTavernScenarioGenerationConfig,
  projectTavernGeneralResult, projectTavernGeneralScenarioResult, projectTavernScenarioResult,
} from '@mahoshojo/ai-core/tavern-generation';
import {
  applyTavernPlaceholderReplacement, buildTavernAiAttachment, normalizeTavernCard,
  projectTavernStreamMarkdown, resolveTavernCharReplacement, validateTavernRaw, type TavernPlaceholderPreference,
} from '@mahoshojo/domain/tavern-card';
import { buildHostedProviderConfig, hostedBodyOversizeMessage, type DesktopGenerationOutcome, executeDirectGeneration, executeDesktopHostedJsonGeneration, GenerationTransportError, type DesktopDirectGenerationFamily, type DesktopHostedJsonGenerationFamily, type DesktopHostedJsonExecutionOptions, type DesktopGenerationIntent } from '../generation/executor';

import { looksLikeTrivialEmptyOutput } from '@mahoshojo/ai-core/stream-events';
import { strictCheck } from '@mahoshojo/domain/sensitive-word-filter';
import { applyShieldWordsStrict } from '@mahoshojo/domain/shield-word-filter';
import { parseTavernCompletionDone, type TavernCompletionDone } from '@mahoshojo/contracts/tavern-completion';
import { cancelHostedAi, DesktopTavernStreamError, streamHostedAi, type HostedAiChannel } from '../../platform/cloud-bridge';
import type { AIReasoningEnvelope } from '@mahoshojo/contracts/ai-reasoning';

import { getRandomFlowers } from '@mahoshojo/domain/flowers';
import { CANSHOU_LORE } from '@mahoshojo/domain/canshou-lore';
import magicalQuestionnaire from '../../../../../content/questionnaires/presets/magical-girl-default.json';
import canshouQuestionnaire from '../../../../../content/questionnaires/presets/canshou-default.json';

export type TavernAiTemplate = 'general' | 'general-scenario' | 'scenario' | 'magical-girl' | 'canshou';
export function createDesktopTavernGenerationConfig(template: TavernAiTemplate) {
  switch (template) {
    case 'magical-girl': return createTavernMagicalGirlGenerationConfig({ questionnaire: magicalQuestionnaire, getRandomFlowers });
    case 'canshou': return createTavernCanshouGenerationConfig({ questionnaire: canshouQuestionnaire, lore: CANSHOU_LORE });
    case 'scenario': return createTavernScenarioGenerationConfig();
    case 'general-scenario': return createTavernGeneralScenarioGenerationConfig();
    default: return createTavernGeneralGenerationConfig();
  }
}

function projectFreshCard(template: TavernAiTemplate, value: unknown) {
  switch (template) {
    case 'magical-girl': return projectTavernMagicalGirlResult(createDesktopTavernGenerationConfig('magical-girl').schema.parse(value), magicalQuestionnaire);
    case 'canshou': return projectTavernCanshouResult(createDesktopTavernGenerationConfig('canshou').schema.parse(value), canshouQuestionnaire);
    case 'scenario': return projectTavernScenarioResult(createTavernScenarioGenerationConfig().schema.parse(value));
    case 'general-scenario': return projectTavernGeneralScenarioResult(createTavernGeneralScenarioGenerationConfig().schema.parse(value));
    default: return projectTavernGeneralResult(createTavernGeneralGenerationConfig().schema.parse(value));
  }
}
export type TavernGenerationIntent = Omit<DesktopGenerationIntent, 'mode' | 'generationMode'> & (
  | { mode: 'direct-local' | 'direct-remote'; generationMode: 'stream' | 'non-stream' }
  | { mode: 'hosted-json'; generationMode: 'non-stream' }
  | { mode: 'hosted-stream'; generationMode: 'stream' }
);
export interface TavernGenerationInput {
  raw: unknown;
  template: TavernAiTemplate;
  language: string;
  preference: TavernPlaceholderPreference;
}

export function prepareTavernGenerationInput(input: TavernGenerationInput) {
  if (!['general', 'general-scenario', 'scenario', 'magical-girl', 'canshou'].includes(input.template)) throw new Error('不支持的酒馆转换模板。');
  if (typeof input.language !== 'string' || !input.language.trim() || input.language.length > 32) throw new Error('生成语言无效。');
  const raw = validateTavernRaw(input.raw);
  const p = input.preference;
  if (!p || typeof p.enabled !== 'boolean' || typeof p.userReplacement !== 'string' || typeof p.customCharReplacement !== 'string' || !['auto', 'custom'].includes(p.charReplacementMode)) throw new Error('占位符设置无效。');
  const source = normalizeTavernCard({ keyword: 'json', chunkType: 'tEXt', parseMethod: 'json', parsed: raw }).normalized;
  const normalized = applyTavernPlaceholderReplacement(source, { enabled: p.enabled, userReplacement: p.userReplacement, charReplacement: resolveTavernCharReplacement(source.name, p) });
  const { attachment, warnings } = buildTavernAiAttachment(normalized);
  return { raw, warnings, promptInput: { language: input.language, sourceName: normalized.name, attachments: [attachment] } };
}

export function validateTavernGeneratedCard(kind: TavernAiTemplate, value: unknown) {
  // Restore full app data without rerunning model-answer normalization. Only scenario lacks
  // top-level signature fields in its domain schema; these old authority claims are discarded.
  const candidate = kind === 'scenario' && value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'signature' && key !== 'isPreset')) : value;
  const projected = parseDataCardByTemplate(kind, candidate);
  delete projected.signature; delete projected.isPreset;
  if (kind === 'scenario' && 'metadata' in projected && projected.metadata) {
    // Domain parsing must precede cleanup: malformed metadata must never be repaired by spread.
    delete (projected.metadata as { signature?: string }).signature;
  }
  const archive = projected._tavern;
  const raw = archive && typeof archive === 'object' && !Array.isArray(archive) && 'raw' in archive ? archive.raw : undefined;
  return { ...projected, _tavern: { ...(archive && typeof archive === 'object' && !Array.isArray(archive) ? archive : {}), raw: validateTavernRaw(raw) } };
}

const FAMILY: DesktopDirectGenerationFamily<TavernGenerationInput, TavernGenerationIntent, TavernAiTemplate> = {
  validateInput: prepareTavernGenerationInput,
  createDirectConfig: (_intent, input) => {
    const config = createDesktopTavernGenerationConfig(input.template);
    return { ...config, promptBuilder: (frozen) => config.promptBuilder(prepareTavernGenerationInput(frozen).promptInput) };
  },
  createDirectStreamConfig: () => ({
    systemPrompt: '',
    temperature: TAVERN_STREAM_TEMPERATURE,
    promptBuilder: input => buildTavernStreamPrompt(
      { ...prepareTavernGenerationInput(input).promptInput, template: input.template },
      { getRandomFlowers, lore: CANSHOU_LORE },
    ),
  }),
  buildStreamCard: (markdown, input) => {
    const sourceName = prepareTavernGenerationInput(input).promptInput.sourceName;
    const { card } = projectTavernStreamMarkdown({ template: input.template, markdown, sourceName });
    const cardKind = card.templateId === '通用情景' ? 'general-scenario' : 'general';
    return { card: validateTavernGeneratedCard(cardKind, { ...card, _tavern: { raw: input.raw } }), cardKind };
  },
  buildStructuredCard: (value, input) => ({
    card: validateTavernGeneratedCard(input.template, { ...projectFreshCard(input.template, value), _tavern: { raw: input.raw } }),
    cardKind: input.template,
  }),
  createError: (rawText, cause) => new GenerationTransportError(rawText, cause),
  cardNoun: '酒馆转换卡',
};

export function buildTavernHostedBody(input: TavernGenerationInput): Record<string, JsonValue> {
  const prepared = prepareTavernGenerationInput(input).promptInput;
  const body = { template: input.template, language: prepared.language, sourceName: prepared.sourceName,
    attachments: prepared.attachments.map(attachment => ({ ...attachment })) };
  if (!DesktopHostedTavernBodySchema.safeParse(body).success) throw new Error('酒馆服务器输入超出限制：名称最多 4096 字符，附件正文单件及合计最多 1 MiB。请精简后重试。');
  return body;
}

const HOSTED_FAMILY: DesktopHostedJsonGenerationFamily<TavernGenerationInput, TavernGenerationIntent, TavernAiTemplate> = {
  validateInput: prepareTavernGenerationInput,
  jsonRouteId: 'tavern-convert',
  buildHostedBody: buildTavernHostedBody,
  normalizeHostedJsonCard: FAMILY.buildStructuredCard,
  cardNoun: FAMILY.cardNoun,
};

export const executeTavernGeneration = (options: DesktopHostedJsonExecutionOptions, input: TavernGenerationInput, intent: TavernGenerationIntent, signal: AbortSignal, onPartialText?: (text: string) => void) =>
  intent.mode === 'hosted-json'
    ? executeDesktopHostedJsonGeneration(HOSTED_FAMILY, options, input, intent, signal)
    : intent.mode === 'hosted-stream'
      ? executeTavernHostedStreamGeneration(options, input, intent, signal, onPartialText)
      : executeDirectGeneration(FAMILY, options, input, { ...intent, mode: intent.mode }, signal, onPartialText);

const UNCERTAIN_MESSAGE = '无法确认这次转换是否在服务器执行——请求可能已发送。不会自动重试；再次转换可能产生重复调用与费用。';

/** Tavern 的完成门禁独立于通用 Hosted done：原文检查先于 shield，invoke settle 先于接纳。 */
async function executeTavernHostedStreamGeneration(
  options: DesktopHostedJsonExecutionOptions, input: TavernGenerationInput,
  intent: TavernGenerationIntent, signal: AbortSignal, onPartialText?: (text: string) => void,
): Promise<DesktopGenerationOutcome<TavernAiTemplate>> {
  const mode = 'hosted-stream' as const;
  const cancelled = (): DesktopGenerationOutcome<TavernAiTemplate> => ({ status: 'cancelled', mode, rawText: '', reason: 'aborted' });
  if (signal.aborted) return cancelled();
  let snapshot: TavernGenerationInput;
  let request: ReturnType<typeof DesktopHostedGenerateRequestSchema.parse>;
  try {
    if (intent.generationMode !== 'stream' || options.providerTarget?.kind === 'custom' || options.providerTarget?.kind === 'chatgpt-plan') throw new Error('当前执行模式或供应商不支持酒馆服务器流式通道。');
    snapshot = JSON.parse(JSON.stringify(input)) as TavernGenerationInput;
    const body = buildTavernHostedBody(snapshot);
    const oversize = hostedBodyOversizeMessage(body, 'tavern-convert-stream');
    if (oversize) throw new Error(oversize);
    // schema.parse 同时冻结配置，后续异步 readiness 不再读取调用方的可变输入。
    request = DesktopHostedGenerateRequestSchema.parse({ requestId: intent.requestId, routeId: 'tavern-convert-stream', body, ...buildHostedProviderConfig(options.providerTarget, intent) });
    await strictCheck('');
    applyShieldWordsStrict('');
  } catch (cause) {
    if (signal.aborted) return cancelled();
    return { status: 'failed', mode, rawText: '', code: 'invalid-request', message: cause instanceof Error ? cause.message : '本地生成预检失败。' };
  }
  if (signal.aborted) return cancelled();

  let markdown = '';
  let reasoningText = '';
  let reasoningDone: 'done' | 'unavailable' | null = null;
  const acc: { done: TavernCompletionDone | null; error: ReturnType<typeof DesktopTavernStreamErrorSchema.parse> | null } = { done: null, error: null };
  let mayHaveDispatched = true;
  let retryAfterSeconds: number | undefined;
  let sawNonterminal = false;
  let abortedBeforeEvent = false;
  let supplementedCancel = false;
  const cancel = () => { void cancelHostedAi(options.invoke, request.requestId).catch(() => undefined); };
  const onAbort = () => {
    abortedBeforeEvent = !sawNonterminal;
    cancel();
  };
  const uncertain = (): DesktopGenerationOutcome<TavernAiTemplate> => ({ status: 'uncertain', mode, rawText: markdown, message: UNCERTAIN_MESSAGE });
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    try {
      await streamHostedAi(options.invoke, request, event => {
        if (event.event !== 'done' && event.event !== 'error') {
          sawNonterminal = true;
          // 同步 invoke 不证明 Native 已登记。早取消后首次非终态事件最多补发一次，
          // 不等待首个 cancel 回执，避免其与事件并发时漏取消；仍等原 invoke settle。
          if (abortedBeforeEvent && !supplementedCancel) { supplementedCancel = true; cancel(); }
        }
        const data = event.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        if (event.event === 'markdown' && typeof data.chunk === 'string') {
          markdown += data.chunk;
          onPartialText?.(markdown);
        } else if (event.event === 'reasoning' && typeof data.chunk === 'string') {
          reasoningText += data.chunk;
        } else if (event.event === 'reasoning_done') {
          reasoningDone = data.status === 'unavailable' ? 'unavailable' : 'done';
        } else if (event.event === 'done') {
          acc.done = parseTavernCompletionDone(data);
        } else if (event.event === 'error') {
          acc.error = DesktopTavernStreamErrorSchema.parse(data);
          if (acc.error.code === 'rate-limited') retryAfterSeconds = acc.error.retryAfterSeconds;
        }
      }, { createChannel: options.createChannel as (() => HostedAiChannel) | undefined });
    } catch (cause) {
      // 仅桥提供的阶段证据可证明零派发；同名 error 事件或任意未知异常均不可以。
      if (cause instanceof DesktopTavernStreamError && cause.phase === 'pre-dispatch') {
        mayHaveDispatched = false;
        if (signal.aborted || cause.code === 'cancelled-before-dispatch') return cancelled();
        return { status: 'failed', mode, rawText: markdown, code: cause.code, message: cause.message };
      }
      return uncertain();
    }
    if (signal.aborted) return uncertain();
    if (acc.error) {
      return acc.error.code === 'rate-limited' || acc.error.code === 'server-rejected'
        ? { status: 'failed', mode, rawText: markdown, code: acc.error.code, message: acc.error.error, retryAfterSeconds }
        : uncertain();
    }
    if (!acc.done) return uncertain();
    if (acc.done.tavernCompletion.finishReason !== 'stop' || looksLikeTrivialEmptyOutput(markdown)) {
      return { status: 'invalid-output', mode, rawText: markdown, message: '生成未正常完成或正文为空，已保留收到的正文。' };
    }
    try {
      if ((await strictCheck(markdown)).hasSensitiveWords) throw new Error('生成正文未通过本地敏感词检查，不能保存为完成卡。');
      if (signal.aborted) return uncertain();
      const filtered = applyShieldWordsStrict(markdown).filteredText;
      if (looksLikeTrivialEmptyOutput(filtered)) throw new Error('处理后的生成正文为空，不能保存为完成卡。');
      const projection = FAMILY.buildStreamCard!(filtered, snapshot);
      const reasoning: AIReasoningEnvelope | null = reasoningDone === null && !reasoningText ? null : { status: reasoningDone ?? 'thinking', source: 'sdk', text: reasoningText || null };
      return { status: 'completed', mode, rawText: markdown, ...projection, reasoning };
    } catch (cause) {
      if (signal.aborted) return uncertain();
      return { status: 'invalid-output', mode, rawText: markdown, message: cause instanceof Error ? cause.message : '生成正文未通过本地检查或卡片校验。' };
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (mayHaveDispatched) {
      try { options.onHostedDispatchSettled?.(retryAfterSeconds); } catch { /* 冷却通知不能改写结果。 */ }
    }
  }
}
