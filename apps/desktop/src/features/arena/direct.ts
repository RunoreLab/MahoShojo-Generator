import type { ArenaReportPresentationSnapshot } from './report-presentation';
import { normalizeUsage } from '@mahoshojo/ai-core/token-usage';
import {
  assembleArenaGenerationPrompt,
  buildArenaGenerationInputSnapshot,
  buildArenaStoryGenerationInputSnapshot,
  buildArenaStructuredReportSchema,
  createArenaStreamProjector,
  qualifyArenaWebPackageOutput,
  StreamUpdateMetaSchema,
  extractStreamUpdateMeta,
  extractTitleFromBattleMarkdown,
  normalizeBattleAiImpacts,
  splitStreamMeta,
  toBattleReportMarkdown,
  type ArenaBattleAiImpact,
  type ArenaBattleReport,
  type ArenaGenerationInputSnapshot,
  type ArenaMetadataStatus,
} from '@mahoshojo/ai-core/arena-generation';
import { buildStructuredJsonInstructionFromZodSchema, parseStructuredJsonWithSchema, StructuredJsonParseError } from '@mahoshojo/ai-core/structured-json';
import { RepairNormalizeError } from '@mahoshojo/ai-core/repair-pipeline';
import { AiStreamProtocolError, collectAiStreamResult, looksLikeTrivialEmptyOutput, type AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { NarrativeDraftCompletion } from '@mahoshojo/domain/narrative-drafts';
import { findAiProviderPreset } from '@mahoshojo/ai-core/provider-catalog';
import { ARENA_CANONICAL_RESOURCE_LIMITS } from '@mahoshojo/contracts/arena-capabilities';
import { AiExecutionRequestSchema, validateArenaAiInputJson, type AiExecutionFinishReason, type AiExecutionResult, type AiExecutionUsage } from '@mahoshojo/contracts/ai-execution';
import { WebPackageRefSchema, type WebPackageRef } from '@mahoshojo/contracts/web-package';
import type { BattleReportRenderSnapshotV1 } from '@mahoshojo/contracts';
import { buildWebPackagePromptProjection, buildWebPackagePromptFromProjection, createWebPackageOverlayFromBase, type ResolvedWebPackage } from '@mahoshojo/web-package';
import { ProviderTargetSchema } from '@mahoshojo/contracts/provider-target';
import type { AdjudicationResult } from '@mahoshojo/domain/arena-types';
import type { BattleStoryArenaRequestInput } from '@mahoshojo/domain/arena-battle-story-request';
import { countBattleStoryCommitJsonBytes } from '@mahoshojo/domain/arena-story-commit';
import type { NarrativeHistoryAppendInput } from '@mahoshojo/domain/narrative-history-operations';
import { describeDesktopPresetModelSupport } from '../ai-config/desktop-ai-config';
import { createDesktopAiExecutionPort, type DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import { parseArenaFailureDiagnostic, type ArenaFailureDiagnostic, type ArenaFailureStage } from './failure-diagnostic';
import { DesktopAiError } from '../../platform/direct-ai-bridge';

/** B1 is a protocol adapter, not a card family, Hosted route, history writer or UI. */
export type ArenaDirectInput = ArenaGenerationInputSnapshot;
export interface ArenaDirectIntent {
  requestId: string;
  mode: 'direct-local' | 'direct-remote';
  generationMode: 'stream' | 'non-stream';
  modelId: string;
  temperature?: number;
  maxOutputTokens?: number;
}
export interface ArenaDirectHostContext {
  /** Opaque local ownership epoch. Never transmitted to the provider or used as authority. */
  scopeKey: string;
  reporterInfo: { name: string; publication: string };
  /** Already resolved by the host; this adapter never rolls dice or signs updates. */
  adjudicationResults: AdjudicationResult[];
  /** Host-owned chapter semantics, never a string copied from the ordinary Arena draft. */
  story?: BattleStoryArenaRequestInput;
  /** Local read-only source; resolved bytes are verified and frozen before dispatch. */
  resolveWebPackage?: (ref: WebPackageRef) => Promise<ResolvedWebPackage>;
}
export interface ArenaDirectPartial {
  presentation?: ArenaReportPresentationSnapshot | null;
  rawText: string;
  markdown: string;
  reasoning: string;
  usage?: AiExecutionUsage;
}
type CommonOutcome = ArenaDirectPartial & {
  requestId: string;
  scopeKey: string;
  mode: ArenaDirectIntent['mode'];
  terminal: AiExecutionResult | null;
};
export type ArenaDirectOutcome = CommonOutcome & (
  | { status: 'completed'; report: ArenaBattleReport; impacts: ArenaBattleAiImpact[];
      metaStatus: ArenaMetadataStatus;
      renderSnapshot?: BattleReportRenderSnapshotV1;
      /** Candidate only. A later host writer must verify this original scopeKey. */
      historyCandidate?: NarrativeHistoryAppendInput & { scopeKey: string; requestId: string } }
  | { status: 'cancelled'; reason: 'aborted' }
  | { status: 'failed' | 'invalid-output'; code: string; message: string; failureDiagnostic?: ArenaFailureDiagnostic; draftCompletion?: NarrativeDraftCompletion }
);

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const unchangedText = (value: string): string => value;
const isOrdinaryMetadataFailure = (candidate: string): boolean => {
  try { parseStructuredJsonWithSchema(candidate, StreamUpdateMetaSchema); return true; }
  catch (diagnostic) { return diagnostic instanceof StructuredJsonParseError && diagnostic.code === 'invalid-output'; }
};

// Native and provider messages may contain private upstream values. Keep only
// recognized codes, and render local explanations rather than those messages.
const directFailureMessages = {
  'native-invoke-rejected': '本机原生调用被拒绝，尚无具体分类，请完整退出并确认界面与桌面程序来自同一版本。',
  'ipc-receipt-invalid': '桌面界面与原生程序的流式交付协议不匹配，请完全退出并更新桌面程序后再试。',
  'ipc-delivery-timeout': '桌面程序未能交付全部生成数据，请保留当前内容并重新打开程序。',
  'ipc-delivery-invalid': '桌面程序的生成数据交付不符合协议，请保留当前内容并更新程序。',
  'profile-not-found': '所选客户端连接已不存在，请重新选择连接。',
  'profile-rejected': '所选客户端连接配置无效，请检查服务地址和模型。',
  'missing-secret': '客户端连接缺少凭据，请重新配置 API Key。',
  'unsupported-request': '请求参数不受客户端支持，请检查模型名称和生成参数。',
  'upstream-unavailable': '无法连接供应商或供应商暂不可用，请检查服务地址和网络。',
  'upstream-rejected': '供应商拒绝了请求，请检查 API Key、模型权限和生成参数。',
  'stream-protocol': '供应商返回的流式响应不符合客户端协议。',
  cancelled: '客户端执行已中止。',
  failed: '客户端执行发生内部错误。',
  'invalid-request': '生成请求参数无效，请检查模型名称和生成参数。',
  'unsupported-model': '所选模型不支持当前生成方式。',
  'authentication-failed': '供应商凭据不可用，请检查或重新配置 API Key。',
  'permission-denied': '供应商拒绝了请求，请检查 API Key、模型权限和生成参数。',
  'rate-limited': '供应商已限流，请稍后重试。',
  timeout: '生成连接已超时。',
  'service-unavailable': '无法连接供应商或供应商暂不可用，请检查服务地址和网络。',
  'content-filtered': '供应商未通过内容审核，请调整输入。',
  'invalid-response': '供应商未返回可用的生成响应。',
  'output-too-large': '生成达到输出限制，请检查输出 token 上限或缩短输入。',
  'internal-error': '生成执行发生内部错误，暂时无法确定具体原因。',
} as const;
type DirectFailureCode = keyof typeof directFailureMessages;
const knownDirectFailureCode = (code: string): DirectFailureCode | undefined =>
  Object.prototype.hasOwnProperty.call(directFailureMessages, code) ? code as DirectFailureCode : undefined;
const directFailureMessage = (code: DirectFailureCode): string => `${directFailureMessages[code]}（${code}）已保留收到的正文。`;

// These are validated canonical classifications, never arbitrary provider text.
const incompleteOutputMessages: Record<Exclude<AiExecutionFinishReason, 'stop'>, string> = {
  length: '生成达到模型或请求的输出 Token 上限，内容可能不完整。原文已保留；可检查最大输出 Token 设置，或缩小生成范围后手动重新生成。这是长度限制，不是桌面端按固定时长中断。',
  'content-filter': '供应商的内容过滤机制中止了生成，原文已保留。请检查请求内容，必要时联系供应商。',
  'tool-calls': '模型以工具调用结束，但当前战报流程无法执行这类工具调用，内容尚未确认完整。原文已保留；请检查模型与接口是否支持直接输出正文。',
  other: '接口未提供可确认的正常结束原因，无法判断内容是否完整，也不能据此认定为超时。原文已保留；请复制错误摘要并检查供应商接口兼容性。',
};

/** One explicit request, one native execution; no provider retries or persistence. */
export const executeArenaDirect = async (
  options: DesktopAiExecutionOptions,
  input: ArenaDirectInput,
  intent: ArenaDirectIntent,
  context: ArenaDirectHostContext,
  signal: AbortSignal,
  onPartial?: (partial: ArenaDirectPartial) => void,
): Promise<ArenaDirectOutcome> => {
  // Snapshot before the first await. Mutating selection, model, roster or account
  // while a request is running cannot redirect its result into a new scope.
  const resolveWebPackage = context.resolveWebPackage;
  // Do not duplicate input + seed + checkpoint in a giant clone. Project only the
  // actual business graph, budget it, then freeze that graph once below.
  const story = context.story;
  const frozen = clone({ intent, context: {
    scopeKey: context.scopeKey, reporterInfo: context.reporterInfo,
  } });
  const { intent: task } = frozen;
  const host = { ...frozen.context, adjudicationResults: context.adjudicationResults };
  const target = options.providerTarget === undefined ? undefined : ProviderTargetSchema.parse(options.providerTarget);
  const executionOptions = { ...options, providerTarget: target };
  let rawText = '';
  let reasoning = '';
  let usage: AiExecutionUsage | undefined;
  let presentation: ArenaReportPresentationSnapshot | undefined;
  let terminal: AiExecutionResult | null = null;
  const partial = (): ArenaDirectPartial => ({ rawText, markdown: splitStreamMeta(rawText).markdown, reasoning, usage, ...(presentation ? { presentation: { ...presentation, aiUsage: normalizeUsage(usage) } } : {}) });
  const common = (): CommonOutcome => ({ ...partial(), requestId: task.requestId, scopeKey: host.scopeKey, mode: task.mode, terminal });
  const cancelled = (): ArenaDirectOutcome => ({ ...common(), status: 'cancelled', reason: 'aborted' });
  let failureStage: ArenaFailureStage = 'request';
  const failed = (code: string, message: string, invalid = false, draftCompletion?: NarrativeDraftCompletion): ArenaDirectOutcome => ({
    ...common(), status: invalid ? 'invalid-output' : 'failed', code, message,
    failureDiagnostic: parseArenaFailureDiagnostic({ source: 'client', stage: failureStage, code,
      ...(failureStage !== 'request' ? { terminalStatus: terminal?.status ?? 'unconfirmed', outputChars: rawText.length } : {}),
      ...(terminal?.status === 'completed' ? { finishReason: terminal.finishReason } : {}),
    })!,
    ...(draftCompletion && task.generationMode === 'stream' && input.reportFormat === 'markdown' && !story ? { draftCompletion } : {}),
  });
  if (signal.aborted) return cancelled();
  if (!['direct-local', 'direct-remote'].includes(task.mode)
    || !['stream', 'non-stream'].includes(task.generationMode)
    || !story && (!['markdown', 'web'].includes(input.reportFormat) || input.arenaFreeRankingEnabled)
    || story && (!['start', 'continue', 'branch'].includes(story.action) || task.generationMode !== 'stream')
    || !host.scopeKey.trim()
    || !Array.isArray(host.adjudicationResults) || host.adjudicationResults.length > ARENA_CANONICAL_RESOURCE_LIMITS.maxAdjudicationEvents) {
    return failed('invalid-request', '客户端生成仅支持非排位单人 Arena 的 Markdown 或 Web 输出。');
  }
  let payload: (ReturnType<typeof buildArenaGenerationInputSnapshot> | ReturnType<typeof buildArenaStoryGenerationInputSnapshot>) & { adjudicationResults: AdjudicationResult[] };
  try {
    const projected = {
      ...(story ? buildArenaStoryGenerationInputSnapshot(story) : buildArenaGenerationInputSnapshot(input)),
      adjudicationResults: host.adjudicationResults,
    };
    // Counts the exact JSON UTF-8 bytes without materializing a large serialized
    // checkpoint. Internal story guidance shares the same 12 MiB business budget.
    countBattleStoryCommitJsonBytes(projected, ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes);
    payload = clone(projected);
    host.adjudicationResults = payload.adjudicationResults;
  } catch {
    return failed('invalid-request', 'Arena 输入或连续故事上下文未通过资源校验。');
  }
  if (target?.kind === 'system') return failed('unsupported-model', '系统默认配置需要服务器执行。');
  if (target?.kind === 'preset') {
    const preset = findAiProviderPreset(target.providerId);
    if (!preset || !describeDesktopPresetModelSupport(preset, task.modelId).supported) {
      return failed('unsupported-model', '所选预设模型不支持当前客户端协议。');
    }
  }
  const streaming = task.generationMode === 'stream';
  const web = payload.reportFormat === 'web';
  let packageBase: ResolvedWebPackage | undefined;
  let packageContext: Parameters<typeof assembleArenaGenerationPrompt>[0]['packageContext'];
  if (web && payload.webPackageRef) {
    try {
      if (!resolveWebPackage) throw new Error('missing package source');
      const ref = WebPackageRefSchema.parse(payload.webPackageRef);
      packageBase = await resolveWebPackage(ref);
      if (signal.aborted) return cancelled();
      if (packageBase.ref.id !== ref.id || packageBase.ref.version !== ref.version || packageBase.ref.digest !== ref.digest) throw new Error('package mismatch');
      const projection = buildWebPackagePromptProjection(packageBase);
      if (payload.webPackagePromptProjection && JSON.stringify(payload.webPackagePromptProjection) !== JSON.stringify(projection)) throw new Error('projection mismatch');
      packageContext = { ref, projection, prompt: buildWebPackagePromptFromProjection(projection) };
    } catch {
      if (signal.aborted) return cancelled();
      return failed('invalid-package', 'Web 包的精确版本或提示投影不可用，请重新选择或导入。');
    }
  }
  if (signal.aborted) return cancelled();
  if (packageContext && payload.reportFormat === 'web') payload = { ...payload, webPackagePromptProjection: packageContext.projection };
  // The original business JSON is resource evidence. Formatted messages may expand;
  // native does not certify equivalence or apply a false 12 MiB whole-IPC cap.
  let arenaInputJson: string;
  try {
    countBattleStoryCommitJsonBytes(payload, ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes);
    arenaInputJson = JSON.stringify(payload);
  } catch {
    return failed('invalid-request', 'Arena 输入未通过资源校验。');
  }
  if (!validateArenaAiInputJson(arenaInputJson)) return failed('invalid-request', 'Arena 输入未通过资源校验。');
  const reportOptions = {
    enableImpacts: payload.writeArenaHistory || payload.writeCurrentState,
    enableImpactText: payload.writeArenaHistory,
    enableCurrentState: payload.writeCurrentState,
  };
  const schema = buildArenaStructuredReportSchema(reportOptions);
  const prompt = assembleArenaGenerationPrompt({
    payload: { ...payload, userGuidance: streaming ? (payload.userGuidance ?? '').trim() : (payload.userGuidance ?? '').trim().slice(0, 200) },
    outputContract: web ? packageContext ? 'web-package-target' : 'web-document' : streaming ? 'stream-markdown' : 'structured-report',
    ...(packageContext ? { packageContext } : {}),
    reporterInfo: host.reporterInfo,
    adjudicationResults: host.adjudicationResults,
  });
  presentation = {
    version: 1, mode: payload.mode, scenarioName: payload.mode === 'scenario' && typeof prompt.metadata.scenarioTitle === 'string' ? prompt.metadata.scenarioTitle : undefined,
    reporterInfo: host.reporterInfo, aiModel: task.modelId,
    userGuidance: typeof prompt.metadata.userGuidance === 'string' ? prompt.metadata.userGuidance : undefined,
    characterGuidances: prompt.metadata.characterGuidances as ArenaBattleReport['characterGuidances'],
    adjudicationResults: host.adjudicationResults,
    ...(payload.readNarrativeHistory ? { narrativeHistoryReadCount: 'narrativeHistory' in payload && Array.isArray(payload.narrativeHistory) ? payload.narrativeHistory.length : 0 } : {}),
  };
  const parsedRequest = AiExecutionRequestSchema.safeParse({
    requestId: task.requestId, contractVersion: 1, mode: task.mode, requestKind: 'arena', arenaInputJson,
    modelId: task.modelId,
    messages: [
      ...(prompt.systemPrompt ? [{ role: 'system', content: prompt.systemPrompt }] : !streaming && !web ? [{ role: 'system', content: buildStructuredJsonInstructionFromZodSchema(schema) }] : []),
      { role: 'user', content: prompt.prompt },
    ],
    ...(task.temperature === undefined ? {} : { temperature: task.temperature }),
    ...(task.maxOutputTokens === undefined ? {} : { maxOutputTokens: task.maxOutputTokens }),
    responseFormat: 'text',
  });
  if (!parsedRequest.success) return failed('invalid-request', 'Arena 输入或请求参数未通过资源校验。');
  const request = parsedRequest.data;
  task.requestId = request.requestId;
  const port = createDesktopAiExecutionPort(executionOptions);
  failureStage = 'native-stream';
  let sourceFailureCode: DirectFailureCode | undefined;
  const source = async function* (): AsyncGenerator<AiStreamEvent> {
    try {
      for await (const event of port.stream(request, signal)) {
        yield event;
        // Only retain events after the common collector accepted identity, order,
        // single terminal and the fixed byte policy. A rejected event is never resumed.
        if (event.type === 'text-delta') rawText += event.delta;
        if (event.type === 'reasoning-delta') reasoning += event.delta;
        if (event.type === 'usage') usage = { ...usage, ...event.usage };
        if (onPartial && event.type !== 'result' && !signal.aborted) onPartial(partial());
      }
    } catch (cause) {
      // The shared collector deliberately hides source exceptions. Preserve the
      // closed diagnostic code before it becomes source-failed, never its message.
      if (cause instanceof DesktopAiError) sourceFailureCode = knownDirectFailureCode(cause.code);
      throw cause;
    }
  };
  try {
    terminal = await collectAiStreamResult(request, source());
  } catch (cause) {
    if (signal.aborted) return cancelled();
    if (cause instanceof AiStreamProtocolError && cause.code === 'source-failed' && sourceFailureCode) {
      return failed(sourceFailureCode, directFailureMessage(sourceFailureCode));
    }
    const missingTerminal = cause instanceof AiStreamProtocolError && cause.code === 'missing-terminal';
    return failed('invalid-response', missingTerminal
      ? '生成连接已结束，但未收到可验证的完整终态，无法确认内容是否完整。已保留收到的正文；请检查网络或供应商接口，并复制错误摘要排查。'
      : '生成连接或流协议失败，已保留收到的正文。', false,
      missingTerminal ? { kind: 'missing-terminal' } : undefined);
  }
  if (signal.aborted) return cancelled();
  if (terminal.status === 'cancelled') return cancelled();
  if (terminal.status === 'failed') return failed(terminal.error.code, directFailureMessage(terminal.error.code));
  failureStage = 'output';
  // A terminal cannot replace the accepted body with an unrelated full result.
  if (terminal.output.text !== rawText || (terminal.output.reasoning !== undefined && terminal.output.reasoning !== reasoning)) {
    return failed('invalid-response', '终态与已接收内容不一致，已保留收到的正文。');
  }
  // The final full text is separately validated by the same content budget.
  rawText = terminal.output.text ?? rawText;
  reasoning = terminal.output.reasoning ?? reasoning;
  usage = terminal.usage ? { ...usage, ...terminal.usage } : usage;
  if (presentation) presentation = { ...presentation, aiModel: terminal.resolvedModelId ?? task.modelId };
  if (terminal.finishReason !== 'stop') return failed('incomplete-output', incompleteOutputMessages[terminal.finishReason], true,
    terminal.finishReason === 'length' ? { kind: 'trusted-length' } : undefined);
  let report: ArenaBattleReport;
  let impacts: ArenaBattleAiImpact[] = [];
  let markdown: string;
  let metaStatus: ArenaMetadataStatus = 'absent';
  let renderSnapshot: BattleReportRenderSnapshotV1 | undefined;
  try {
    if (web) {
      const projector = createArenaStreamProjector({ expectsMeta: true, strictTrailer: Boolean(packageContext) });
      const chunks = projector.push(rawText); chunks.push(...projector.finish().markdown);
      // The shared projector governs the package trailer; the ordinary splitter only guards free-Web diagnostics.
      markdown = packageContext ? chunks.join('') : splitStreamMeta(chunks.join('')).markdown;
      if (!markdown.trim()) return failed('empty-output', '未收到有效 Web 目标正文。', true);
      const event = projector.result().metaEvent;
      const parsedMeta = StreamUpdateMetaSchema.safeParse(event?.type === 'meta' ? event.data.meta : null);
      let meta = parsedMeta.success ? parsedMeta.data : null;
      metaStatus = meta ? 'valid' : 'absent';
      impacts = normalizeBattleAiImpacts(meta?.impacts, unchangedText);
      renderSnapshot = { version: 1, reportFormat: 'web' };
      if (packageContext && packageBase) {
        const base = packageBase;
        const qualified = await qualifyArenaWebPackageOutput({ ref: packageContext.ref, projection: packageContext.projection,
          content: markdown, meta: event?.type === 'meta' ? event.data.meta : null, finishReason: terminal.finishReason, controlTail: projector.result().rawTail,
          createOverlay: (content, limits) => createWebPackageOverlayFromBase(base, content, limits) });
        if (signal.aborted) return cancelled();
        metaStatus = qualified.metaStatus;
        if (metaStatus === 'absent') { meta = null; impacts = []; }
        markdown = qualified.overlay.generatedContent;
        renderSnapshot.webPackage = qualified.artifact;
      }
      report = { headline: meta?.report?.headline ?? '', reporterInfo: host.reporterInfo,
        article: { body: markdown, analysis: '' }, officialReport: { winner: meta?.report?.winner ?? '', conclusion: '' },
        ...(renderSnapshot.webPackage ? { webPackage: renderSnapshot.webPackage } : {}) };
    } else if (streaming) {
      const split = splitStreamMeta(rawText);
      markdown = split.markdown;
      if (looksLikeTrivialEmptyOutput(markdown)) return failed('empty-output', '未收到有效战报正文。', true);
      // Latest source block wins, even if it is unclosed. Never repair an older
      // closed block as a fallback when the newest update is invalid.
      const latestMeta = split.updateMetaBlocks.at(-1);
      let extracted: Awaited<ReturnType<typeof extractStreamUpdateMeta>>;
      try { extracted = latestMeta ? await extractStreamUpdateMeta(latestMeta.rawComment) : null; }
      catch (cause) {
        if (signal.aborted) return cancelled();
        // Classification only: never substitutes for the legacy parser or changes completion.
        const metadataFailure = cause instanceof RepairNormalizeError && latestMeta
          && isOrdinaryMetadataFailure(latestMeta.jsonCandidate);
        return failed('invalid-output', '战报输出未通过本地校验，原文已保留。', true,
          metadataFailure ? { kind: 'trusted-stop-metadata-invalid' } : undefined);
      }
      if (signal.aborted) return cancelled();
      if (latestMeta && !extracted) return failed('invalid-output', '最新战报元数据无法解析，原文已保留。', true,
        isOrdinaryMetadataFailure(latestMeta.jsonCandidate) ? { kind: 'trusted-stop-metadata-invalid' } : undefined);
      metaStatus = extracted ? 'valid' : 'absent';
      impacts = normalizeBattleAiImpacts(extracted?.meta.impacts, unchangedText);
      report = {
        headline: extracted?.meta.report?.headline || extractTitleFromBattleMarkdown(markdown),
        reporterInfo: host.reporterInfo,
        article: { body: markdown, analysis: '' },
        officialReport: { winner: extracted?.meta.report?.winner || '', conclusion: '' },
      };
    } else {
      const parsed = parseStructuredJsonWithSchema(rawText, schema, {
        taskName: 'Arena 结构化战报', limits: { maxInputChars: ARENA_CANONICAL_RESOURCE_LIMITS.outputContentBytes },
      }).data;
      // Keep the parsed AI report and impacts separate from any server updates.
      report = {
        headline: parsed.headline as string,
        reporterInfo: host.reporterInfo,
        article: parsed.article as ArenaBattleReport['article'],
        officialReport: parsed.officialReport as ArenaBattleReport['officialReport'],
      };
      impacts = normalizeBattleAiImpacts(parsed.impacts, unchangedText);
      markdown = toBattleReportMarkdown(report);
      if (!report.article.body.trim()) return failed('empty-output', '未收到有效战报正文。', true);
    }
  } catch {
    if (signal.aborted) return cancelled();
    return failed('invalid-output', '战报输出未通过本地校验，原文已保留。', true);
  }
  // Metadata repair is local but asynchronous. Cancellation still wins before
  // handing back any completion/history candidate.
  if (signal.aborted) return cancelled();
  report.mode = payload.mode;
  report.adjudicationResults = host.adjudicationResults;
  report.reportFormat = web ? 'web' : 'markdown';
  report.aiModel = terminal.resolvedModelId ?? task.modelId;
  report.aiUsage = normalizeUsage(usage) ?? undefined;
  report.aiReasoning = reasoning ? { status: 'done', source: 'provider', text: reasoning } : null;
  report.userGuidance = typeof prompt.metadata.userGuidance === 'string' ? prompt.metadata.userGuidance : undefined;
  report.characterGuidances = prompt.metadata.characterGuidances as ArenaBattleReport['characterGuidances'];
  if (payload.readNarrativeHistory) report.narrativeHistoryReadCount = 'narrativeHistory' in payload && Array.isArray(payload.narrativeHistory) ? payload.narrativeHistory.length : 0;
  if (presentation.scenarioName) report.scenario = presentation.scenarioName;
  return {
    ...common(), status: 'completed', markdown, report, impacts, metaStatus, ...(renderSnapshot ? { renderSnapshot } : {}),
    ...(payload.writeNarrativeHistory ? { historyCandidate: {
      scopeKey: host.scopeKey, requestId: request.requestId, generationId: request.requestId, title: report.headline || (web ? 'Web 战报' : ''), content: markdown,
    } } : {}),
  };
};
