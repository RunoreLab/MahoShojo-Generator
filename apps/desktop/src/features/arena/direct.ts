import {
  assembleArenaGenerationPrompt,
  buildArenaGenerationInputSnapshot,
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
} from '@mahoshojo/ai-core/arena-generation';
import { buildStructuredJsonInstructionFromZodSchema, parseStructuredJsonWithSchema } from '@mahoshojo/ai-core/structured-json';
import { collectAiStreamResult, looksLikeTrivialEmptyOutput, type AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import { findAiProviderPreset } from '@mahoshojo/ai-core/provider-catalog';
import { ARENA_CANONICAL_RESOURCE_LIMITS } from '@mahoshojo/contracts/arena-capabilities';
import { AiExecutionRequestSchema, validateArenaAiInputJson, type AiExecutionResult, type AiExecutionUsage } from '@mahoshojo/contracts/ai-execution';
import { WebPackageRefSchema, type WebPackageRef } from '@mahoshojo/contracts/web-package';
import type { BattleReportRenderSnapshotV1 } from '@mahoshojo/contracts';
import { buildWebPackagePromptProjection, buildWebPackagePromptFromProjection, createWebPackageOverlayFromBase, type ResolvedWebPackage } from '@mahoshojo/web-package';
import { ProviderTargetSchema } from '@mahoshojo/contracts/provider-target';
import type { AdjudicationResult } from '@mahoshojo/domain/arena-types';
import type { NarrativeHistoryAppendInput } from '@mahoshojo/domain/narrative-history-operations';
import { describeDesktopPresetModelSupport } from '../ai-config/desktop-ai-config';
import { createDesktopAiExecutionPort, type DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';

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
  /** Local read-only source; resolved bytes are verified and frozen before dispatch. */
  resolveWebPackage?: (ref: WebPackageRef) => Promise<ResolvedWebPackage>;
}
export interface ArenaDirectPartial {
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
      metaStatus: 'absent' | 'valid';
      renderSnapshot?: BattleReportRenderSnapshotV1;
      /** Candidate only. A later host writer must verify this original scopeKey. */
      historyCandidate?: NarrativeHistoryAppendInput & { scopeKey: string; requestId: string } }
  | { status: 'cancelled'; reason: 'aborted' }
  | { status: 'failed' | 'invalid-output'; code: string; message: string }
);

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const unchangedText = (value: string): string => value;

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
  const frozen = clone({ input, intent, context: { ...context, resolveWebPackage: undefined } });
  const { intent: task, context: host } = frozen;
  const target = options.providerTarget === undefined ? undefined : ProviderTargetSchema.parse(options.providerTarget);
  const executionOptions = { ...options, providerTarget: target };
  let rawText = '';
  let reasoning = '';
  let usage: AiExecutionUsage | undefined;
  let terminal: AiExecutionResult | null = null;
  const partial = (): ArenaDirectPartial => ({ rawText, markdown: splitStreamMeta(rawText).markdown, reasoning, usage });
  const common = (): CommonOutcome => ({ ...partial(), requestId: task.requestId, scopeKey: host.scopeKey, mode: task.mode, terminal });
  const cancelled = (): ArenaDirectOutcome => ({ ...common(), status: 'cancelled', reason: 'aborted' });
  const failed = (code: string, message: string, invalid = false): ArenaDirectOutcome => ({ ...common(), status: invalid ? 'invalid-output' : 'failed', code, message });
  if (signal.aborted) return cancelled();
  if (!['direct-local', 'direct-remote'].includes(task.mode)
    || !['stream', 'non-stream'].includes(task.generationMode)
    || !['markdown', 'web'].includes(frozen.input.reportFormat)
    || frozen.input.arenaFreeRankingEnabled
    || !host.scopeKey.trim()
    || host.adjudicationResults.length > ARENA_CANONICAL_RESOURCE_LIMITS.maxAdjudicationEvents) {
    return failed('invalid-request', '本片仅支持非排位单人 Arena 的 Markdown 或 Web 输出。');
  }
  if (target?.kind === 'system') return failed('unsupported-model', '系统默认配置需要服务器执行。');
  if (target?.kind === 'preset') {
    const preset = findAiProviderPreset(target.providerId);
    if (!preset || !describeDesktopPresetModelSupport(preset, task.modelId).supported) {
      return failed('unsupported-model', '所选预设模型不支持当前客户端协议。');
    }
  }
  const streaming = task.generationMode === 'stream';
  const web = frozen.input.reportFormat === 'web';
  let packageBase: ResolvedWebPackage | undefined;
  let packageContext: Parameters<typeof assembleArenaGenerationPrompt>[0]['packageContext'];
  if (web && frozen.input.webPackageRef) {
    try {
      if (!resolveWebPackage) throw new Error('missing package source');
      const ref = WebPackageRefSchema.parse(frozen.input.webPackageRef);
      packageBase = await resolveWebPackage(ref);
      if (signal.aborted) return cancelled();
      if (packageBase.ref.id !== ref.id || packageBase.ref.version !== ref.version || packageBase.ref.digest !== ref.digest) throw new Error('package mismatch');
      const projection = buildWebPackagePromptProjection(packageBase);
      if (frozen.input.webPackagePromptProjection && JSON.stringify(frozen.input.webPackagePromptProjection) !== JSON.stringify(projection)) throw new Error('projection mismatch');
      packageContext = { ref, projection, prompt: buildWebPackagePromptFromProjection(projection) };
    } catch {
      if (signal.aborted) return cancelled();
      return failed('invalid-package', 'Web 包的精确版本或提示投影不可用，请重新选择或导入。');
    }
  }
  if (signal.aborted) return cancelled();
  const payload = { ...buildArenaGenerationInputSnapshot(frozen.input), adjudicationResults: host.adjudicationResults,
    ...(packageContext ? { webPackagePromptProjection: packageContext.projection } : {}) };
  // The original business JSON is resource evidence. Formatted messages may expand;
  // native does not certify equivalence or apply a false 12 MiB whole-IPC cap.
  const arenaInputJson = JSON.stringify(payload);
  if (!validateArenaAiInputJson(arenaInputJson)) return failed('invalid-request', 'Arena 输入未通过资源校验。');
  const reportOptions = {
    enableImpacts: payload.writeArenaHistory || payload.writeCurrentState,
    enableImpactText: payload.writeArenaHistory,
    enableCurrentState: payload.writeCurrentState,
  };
  const schema = buildArenaStructuredReportSchema(reportOptions);
  const prompt = assembleArenaGenerationPrompt({
    payload: { ...payload, userGuidance: streaming ? payload.userGuidance.trim() : payload.userGuidance.trim().slice(0, 200) },
    outputContract: web ? packageContext ? 'web-package-target' : 'web-document' : streaming ? 'stream-markdown' : 'structured-report',
    ...(packageContext ? { packageContext } : {}),
    reporterInfo: host.reporterInfo,
    adjudicationResults: host.adjudicationResults,
  });
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
  const source = async function* (): AsyncGenerator<AiStreamEvent> {
    for await (const event of port.stream(request, signal)) {
      yield event;
      // Only retain events after the common collector accepted identity, order,
      // single terminal and the fixed byte policy. A rejected event is never resumed.
      if (event.type === 'text-delta') rawText += event.delta;
      if (event.type === 'reasoning-delta') reasoning += event.delta;
      if (event.type === 'usage') usage = event.usage;
      if (onPartial && event.type !== 'result' && !signal.aborted) onPartial(partial());
    }
  };
  try {
    terminal = await collectAiStreamResult(request, source());
  } catch {
    if (signal.aborted) return cancelled();
    return failed('invalid-response', '生成连接或流协议失败，已保留收到的正文。');
  }
  if (signal.aborted) return cancelled();
  if (terminal.status === 'cancelled') return cancelled();
  if (terminal.status === 'failed') return failed(terminal.error.code, '生成失败，已保留收到的正文。');
  // A terminal cannot replace the accepted body with an unrelated full result.
  if (terminal.output.text !== rawText || (terminal.output.reasoning !== undefined && terminal.output.reasoning !== reasoning)) {
    return failed('invalid-response', '终态与已接收内容不一致，已保留收到的正文。');
  }
  // The final full text is separately validated by the same content budget.
  rawText = terminal.output.text ?? rawText;
  reasoning = terminal.output.reasoning ?? reasoning;
  usage = terminal.usage ?? usage;
  if (terminal.finishReason !== 'stop') return failed('incomplete-output', '生成未正常结束，原文已保留。', true);
  let report: ArenaBattleReport;
  let impacts: ArenaBattleAiImpact[] = [];
  let markdown: string;
  let metaStatus: 'absent' | 'valid' = 'absent';
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
      const meta = parsedMeta.success ? parsedMeta.data : null;
      metaStatus = meta ? 'valid' : 'absent';
      impacts = normalizeBattleAiImpacts(meta?.impacts, unchangedText);
      renderSnapshot = { version: 1, reportFormat: 'web' };
      if (packageContext && packageBase) {
        const base = packageBase;
        const qualified = await qualifyArenaWebPackageOutput({ ref: packageContext.ref, projection: packageContext.projection,
          content: markdown, meta: event?.type === 'meta' ? event.data.meta : null,
          createOverlay: (content, limits) => createWebPackageOverlayFromBase(base, content, limits) });
        if (signal.aborted) return cancelled();
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
      const extracted = latestMeta ? await extractStreamUpdateMeta(latestMeta.rawComment) : null;
      if (signal.aborted) return cancelled();
      if (latestMeta && !extracted) return failed('invalid-output', '最新战报元数据无法解析，原文已保留。', true);
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
  report.mode = frozen.input.battleMode;
  report.adjudicationResults = host.adjudicationResults;
  report.reportFormat = web ? 'web' : 'markdown';
  report.aiModel = terminal.resolvedModelId ?? task.modelId;
  if (frozen.input.battleMode === 'scenario' && frozen.input.scenarioDisplayName) report.scenario = frozen.input.scenarioDisplayName;
  return {
    ...common(), status: 'completed', markdown, report, impacts, metaStatus, ...(renderSnapshot ? { renderSnapshot } : {}),
    ...(frozen.input.settings.writeNarrativeHistory ? { historyCandidate: {
      scopeKey: host.scopeKey, requestId: request.requestId, generationId: request.requestId, title: report.headline || (web ? 'Web 战报' : ''), content: markdown,
    } } : {}),
  };
};
