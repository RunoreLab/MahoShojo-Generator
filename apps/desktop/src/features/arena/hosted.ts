import { ARENA_COMPANION_PROTOCOL_VERSION, ArenaCompanionEnvelopeSchema, type ArenaCompanionEnvelope } from '@mahoshojo/contracts/arena-companion';
import { DesktopArenaHostedJsonCreateRequestSchema } from '@mahoshojo/contracts/desktop-arena-hosted-json';
import { runArenaHostedJson } from './hosted-json';
import { validateHostedOutput, sameHostedPackageRef as sameRef } from './hosted-output';
import { DesktopArenaHostedAnyRecoveryPointerSchema as DesktopArenaHostedRecoveryPointerSchema, type DesktopArenaHostedAnyRecoveryPointer as DesktopArenaHostedRecoveryPointer } from '@mahoshojo/contracts/desktop-arena-hosted-json';
import { createStreamReadWithTimeout, buildStreamSoftTimeoutMessage, DEFAULT_STREAM_READ_IDLE_TIMEOUT_MS, DEFAULT_STREAM_READ_TOTAL_TIMEOUT_MS } from '@mahoshojo/ai-core/stream-timeout';
import {
  buildArenaGenerationInputSnapshot, extractTitleFromBattleMarkdown, StreamUpdateMetaSchema,
  parseArenaStructuredReportJson, type ArenaBattleReport, type ArenaGenerationInputSnapshot,
} from '@mahoshojo/ai-core/arena-generation';
import {
  DESKTOP_ARENA_HOSTED_LIMITS, DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION,
  DesktopArenaHostedCreateRequestSchema, DesktopArenaHostedHeaderMetaSchema, DesktopArenaHostedSseEventSchema, DesktopArenaHostedTelemetrySchema,
  parseDesktopArenaHostedSseBlock,
  type DesktopArenaHostedActor,
  type DesktopArenaHostedControlRequest,
  type DesktopArenaHostedSseEvent,
  type DesktopArenaHostedStreamRequest,
} from '@mahoshojo/contracts/desktop-arena-hosted';
import type { DesktopHostedPresetConfig, DesktopHostedSystemConfig } from '@mahoshojo/contracts/desktop-cloud';
import type { AiExecutionUsage } from '@mahoshojo/contracts/ai-execution';
import type { BattleReportRenderSnapshotV1 } from '@mahoshojo/contracts';
import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import {
  buildWebPackagePromptProjection, isBuiltinWebPackageRef,
  type ResolvedWebPackage,
} from '@mahoshojo/web-package';
import {
  openArenaGenerationStreamClient, type ArenaGenerationConnectionState, type PersistedArenaGeneration,
} from '@mahoshojo/hosted-api/arena-generation/client';
import {
  ArenaHostedBridgeError, controlArenaHosted, openArenaHostedStream, type ArenaHostedChannel, type ArenaHostedHandshake,
} from '../../platform/arena-hosted-bridge';
import type { InvokeFn } from '../../platform/cloud-bridge';
import type { DesktopArenaHostedRecovery } from './hosted-recovery';

export const ARENA_HOSTED_USER_STOP = 'arena-user-stop';
export const ARENA_HOSTED_DETACH = 'arena-detach';
const endpoint = '/api/arena/generate-stream';
const encoder = new TextEncoder();

export interface ArenaHostedDetails {
  connectionState: ArenaGenerationConnectionState;
  serverStatus: string | null;
  telemetry: Extract<DesktopArenaHostedSseEvent, { event: 'telemetry' }>['data'] | null;
  metadataState: ArenaHostedHandshake['metadataState'];
  headerMeta: ArenaHostedHandshake['headerMeta'] | null;
  recoveryCredentialState: ArenaHostedHandshake['recoveryCredentialState'];
  metaEvent: Extract<DesktopArenaHostedSseEvent, { event: 'meta' | 'meta_error' }> | null;
  terminal: Extract<DesktopArenaHostedSseEvent, { event: 'done' | 'error' }> | null;
  outputValidation: 'pending' | 'valid' | 'missing-base' | 'invalid';
  validationMessage: string | null;
  restored: boolean;
  softTimeoutWarning?: string | null;
  delivery?: 'stream' | 'non-stream';
  companion?: ArenaCompanionEnvelope | null;
  companionState?: 'complete' | 'recovered-model-only' | 'unavailable';
}
/** Draft data is public output only; parse it again without restoring execution authority. */
export const parseArenaHostedDetails = (value: unknown): ArenaHostedDetails | null => {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Hosted output');
  const v = value as Record<string, unknown>;
  const strings = (key: string, allowed: readonly string[]) => typeof v[key] === 'string' && allowed.includes(v[key] as string);
  if (!strings('connectionState', ['connecting', 'generating', 'recovering_initial', 'reconnecting', 'resuming', 'cancelling', 'completed', 'failed', 'cancelled', 'cancel_unconfirmed', 'producer_lost', 'interrupted', 'unknown'])
    || !strings('metadataState', ['available', 'missing', 'invalid', 'oversized'])
    || !strings('recoveryCredentialState', ['stored', 'memory-only'])
    || !strings('outputValidation', ['pending', 'valid', 'missing-base', 'invalid'])
    || !(v.serverStatus === null || typeof v.serverStatus === 'string')
    || !(v.validationMessage === null || typeof v.validationMessage === 'string') || typeof v.restored !== 'boolean') throw new Error('Hosted output');
  if (v.delivery !== undefined && v.delivery !== 'stream' && v.delivery !== 'non-stream') throw new Error('Hosted delivery');
  if (v.companionState !== undefined && (typeof v.companionState !== 'string' || !['complete', 'recovered-model-only', 'unavailable'].includes(v.companionState))) throw new Error('Hosted companion state');
  const companion = v.companion == null ? null : ArenaCompanionEnvelopeSchema.parse(v.companion);
  const metaEvent = v.metaEvent === null ? null : DesktopArenaHostedSseEventSchema.parse(v.metaEvent);
  const terminal = v.terminal === null ? null : DesktopArenaHostedSseEventSchema.parse(v.terminal);
  if ((metaEvent && metaEvent.event !== 'meta' && metaEvent.event !== 'meta_error') || (terminal && terminal.event !== 'done' && terminal.event !== 'error')) throw new Error('Hosted output');
  return { connectionState: v.connectionState as ArenaHostedDetails['connectionState'], serverStatus: v.serverStatus,
    telemetry: v.telemetry === null ? null : DesktopArenaHostedTelemetrySchema.parse(v.telemetry),
    metadataState: v.metadataState as ArenaHostedDetails['metadataState'], headerMeta: v.headerMeta === null ? null : DesktopArenaHostedHeaderMetaSchema.parse(v.headerMeta),
    recoveryCredentialState: v.recoveryCredentialState as ArenaHostedDetails['recoveryCredentialState'], metaEvent, terminal,
    outputValidation: v.outputValidation as ArenaHostedDetails['outputValidation'], validationMessage: v.validationMessage, restored: v.restored, softTimeoutWarning: null,
    ...(v.delivery ? { delivery: v.delivery as ArenaHostedDetails['delivery'] } : {}),
    ...(v.companionState ? { companionState: v.companionState as ArenaHostedDetails['companionState'], companion } : {}) };
};
export interface ArenaHostedPartial {
  rawText: string; markdown: string; reasoning: string; usage?: AiExecutionUsage;
  hosted: ArenaHostedDetails;
}
export interface ArenaHostedIntent {
  requestId: string; mode: 'hosted'; generationMode: 'stream' | 'non-stream'; modelId: string;
  systemConfig?: DesktopHostedSystemConfig; presetConfig?: DesktopHostedPresetConfig;
}
export interface ArenaHostedContext {
  product: 'battle' | 'arena'; scopeKey: string; actor: DesktopArenaHostedActor;
  recovery: DesktopArenaHostedRecovery; replaceRequestId?: string; repair?: import('./hosted-recovery').ArenaHostedRecoveryReplacement;
  resolveWebPackage?: (ref: WebPackageRef) => Promise<ResolvedWebPackage>;
  now?: () => string;
  isCurrent?: () => boolean;
  /** Test ports use synthetic Native-shaped messages; production uses the actual Channel. */
  createChannel?: () => ArenaHostedChannel;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  maxReconnectAttempts?: number;
}
type Common = ArenaHostedPartial & { requestId: string; scopeKey: string; generationId: string | null; mode: 'hosted' };
export type ArenaHostedOutcome = Common & (
  | { status: 'completed'; report: ArenaBattleReport; renderSnapshot?: BattleReportRenderSnapshotV1; canAppendHistory: boolean }
  | { status: 'cancelled'; message: string }
  | { status: 'failed'; message: string }
);

const delay = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('detached', 'AbortError')); return; }
  const aborted = () => { clearTimeout(timer); reject(new DOMException('detached', 'AbortError')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, milliseconds);
  signal?.addEventListener('abort', aborted, { once: true });
});
const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value)))))
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');

export const executeArenaHosted = async (
  options: { invoke: InvokeFn }, input: ArenaGenerationInputSnapshot, intent: ArenaHostedIntent,
  context: ArenaHostedContext, signal: AbortSignal, onPartial?: (partial: ArenaHostedPartial) => void,
): Promise<ArenaHostedOutcome> => {
  context = { ...context };
  const frozen = structuredClone({ input, intent, actor: context.actor });
  const now = context.now ?? (() => new Date().toISOString());
  const snapshot = buildArenaGenerationInputSnapshot({ ...frozen.input, arenaFreeRankingEnabled: false,
    settings: { ...frozen.input.settings } });
  let base: ResolvedWebPackage | undefined;
  if (frozen.input.reportFormat === 'web' && frozen.input.webPackageRef) {
    if (!context.resolveWebPackage) throw new Error('Web 包的精确版本不可用，请重新导入。');
    base = await context.resolveWebPackage(frozen.input.webPackageRef); signal.throwIfAborted();
    if (!sameRef(base.ref, frozen.input.webPackageRef)) throw new Error('Web 包版本不匹配。');
    if (!isBuiltinWebPackageRef(base.ref)) snapshot.webPackagePromptProjection = buildWebPackagePromptProjection(base);
  }
  // JSON serialization is the actual wire projection: undefined properties are absent.
  const nonStream = frozen.intent.generationMode === 'non-stream';
  const create = (nonStream ? DesktopArenaHostedJsonCreateRequestSchema : DesktopArenaHostedCreateRequestSchema).parse({ operation: nonStream ? 'create-json' : 'create-stream', product: context.product,
    requestId: frozen.intent.requestId, actor: frozen.actor, reconciliationVersion: 'arena-reconciliation-v1', body: JSON.parse(JSON.stringify(snapshot)),
    systemConfig: frozen.intent.systemConfig, presetConfig: frozen.intent.presetConfig, replaceRequestId: context.replaceRequestId });
  const bodyHash = await digest({ body: create.body, systemConfig: create.systemConfig, presetConfig: create.presetConfig }); signal.throwIfAborted();
  if (context.isCurrent?.() === false) throw new ArenaHostedBridgeError('scope-changed', 'not-dispatched');
  const pointer = DesktopArenaHostedRecoveryPointerSchema.parse({ version: 3, delivery: nonStream ? 'non-stream' : 'stream', protocolVersion: nonStream ? ARENA_COMPANION_PROTOCOL_VERSION : DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION,
    reconciliationVersion: 'arena-reconciliation-v1', writeArenaHistory: snapshot.writeArenaHistory, writeCurrentState: snapshot.writeCurrentState,
    product: context.product, requestId: frozen.intent.requestId, bodyHash, actor: frozen.actor,
    format: frozen.input.reportFormat, battleMode: frozen.input.battleMode, webPackageRef: frozen.input.webPackageRef ?? undefined,
    state: 'prepared', updatedAt: now() });
  if (!context.recovery.prepare(pointer, context.replaceRequestId, context.repair)) throw new Error(context.recovery.getSnapshot().error ?? '恢复指针未保存，未开始生成。');
  if (create.operation === 'create-json') return runArenaHostedJson(options.invoke, pointer, create, context, signal, onPartial, base,
    () => runHosted(options.invoke, pointer, context, signal, onPartial, undefined, base, true));
  return runHosted(options.invoke, pointer, context, signal, onPartial, create, base);
};

/** Explicit recovery never has an input body, funding configuration or a create port. */
export const resumeArenaHosted = (
  options: { invoke: InvokeFn }, value: DesktopArenaHostedRecoveryPointer,
  context: ArenaHostedContext, signal: AbortSignal, onPartial?: (partial: ArenaHostedPartial) => void,
): Promise<ArenaHostedOutcome> => runHosted(options.invoke, DesktopArenaHostedRecoveryPointerSchema.parse(value), context, signal, onPartial);

const runHosted = async (
  invoke: InvokeFn, pointer: DesktopArenaHostedRecoveryPointer, context: ArenaHostedContext,
  signal: AbortSignal, onPartial?: (partial: ArenaHostedPartial) => void,
  create?: Extract<DesktopArenaHostedStreamRequest, { operation: 'create-stream' }>, frozenBase?: ResolvedWebPackage, automaticRecovery = false,
): Promise<ArenaHostedOutcome> => {
  context = { ...context };
  let explicitRestoreLookup = !create && !automaticRecovery;
  const nonStream = pointer.version !== 1 && pointer.delivery === 'non-stream';
  const scope = { product: pointer.product, requestId: pointer.requestId, actor: pointer.actor };
  let markdown = '', reasoning = '', generationId = pointer.generationId ?? null;
  let usage: AiExecutionUsage | undefined;
  let details: ArenaHostedDetails = { connectionState: create ? 'connecting' : 'resuming', serverStatus: null, telemetry: null,
    metadataState: 'missing', headerMeta: null, recoveryCredentialState: 'stored', metaEvent: null, terminal: null,
    outputValidation: 'pending', validationMessage: null, restored: !create && !automaticRecovery,
    ...(nonStream ? { delivery: 'non-stream', companionState: 'recovered-model-only', companion: null } as const : {}) };
  const partial = (): ArenaHostedPartial => ({ rawText: markdown, markdown, reasoning, usage, hosted: { ...details } });
  const common = (): Common => ({ ...partial(), hosted: { ...details, softTimeoutWarning: null }, requestId: pointer.requestId, scopeKey: context.scopeKey, generationId, mode: 'hosted' });
  const isCurrent = () => context.isCurrent?.() !== false;
  const assertCurrent = () => { if (!isCurrent()) throw new ArenaHostedBridgeError('scope-changed', 'not-dispatched'); };
  const publish = () => { if (isCurrent() && !signal.aborted) onPartial?.(partial()); };
  const onResponse = (value: ArenaHostedHandshake) => {
    if (!isCurrent() || signal.aborted) return;
    if (value.generationId) {
      if (generationId && value.generationId !== generationId) throw new Error('conflicting generation');
      generationId = value.generationId;
    }
    if (value.headerMeta) {
      if (value.headerMeta.reportFormat !== pointer.format || (value.headerMeta.mode && value.headerMeta.mode !== pointer.battleMode)
        || (value.headerMeta.webPackageRef && (!pointer.webPackageRef || !sameRef(value.headerMeta.webPackageRef, pointer.webPackageRef)))) throw new Error('conflicting metadata');
      details = { ...details, headerMeta: value.headerMeta, metadataState: 'available' };
    } else if (!details.headerMeta) details = { ...details, metadataState: value.metadataState };
    details = { ...details, recoveryCredentialState: value.recoveryCredentialState }; publish();
  };
  const short = async (request: DesktopArenaHostedControlRequest, operationSignal?: AbortSignal) => {
    assertCurrent(); operationSignal?.throwIfAborted();
    const reply = await controlArenaHosted(invoke, request); assertCurrent(); operationSignal?.throwIfAborted();
    if (reply.body.generationRequestId && reply.body.generationRequestId !== pointer.requestId) throw new ArenaHostedBridgeError('protocol');
    if (reply.body.generationId && generationId && reply.body.generationId !== generationId) throw new ArenaHostedBridgeError('protocol');
    if (!signal.aborted) { details = { ...details, recoveryCredentialState: reply.recoveryCredentialState }; publish(); }
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  const restoredState: PersistedArenaGeneration | null = create ? null : {
    version: 3, endpoint, bodyHash: pointer.bodyHash, generationRequestId: pointer.requestId,
    // Force the first explicit restore through a same-actor Native rebind before any resume.
    generationId: null, lastEventId: null, state: 'unknown', updatedAt: pointer.updatedAt, routePin: { placement: 'hono-primary' },
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await openArenaGenerationStreamClient({ endpoint, bodyHash: pointer.bodyHash,
      generationRequestId: pointer.requestId, signal, maxReconnectAttempts: context.maxReconnectAttempts,
      getInitialRoutePin: () => ({ placement: 'hono-primary' }),
      onStateChange: (connectionState) => { details = { ...details, connectionState }; publish(); },
    }, {
      loadState: () => restoredState,
      saveState: (value) => {
        if (!isCurrent() || (signal.aborted && signal.reason !== ARENA_HOSTED_USER_STOP)) return;
        context.recovery.update(pointer.requestId, { state: value.state, updatedAt: value.updatedAt,
          ...(value.generationId ? { generationId: value.generationId } : {}), ...(value.lastEventId ? { cursor: value.lastEventId } : {}) });
      },
      prepareCreate: (requestId) => { if (requestId !== pointer.requestId) throw new Error('request identity'); },
      createRequestId: () => { throw new Error('request identity required'); }, encodeUtf8: (text) => encoder.encode(text),
      waitForReconnectOpportunity: context.wait ?? delay,
      classifyExplicitAbort: (reason) => reason === ARENA_HOSTED_USER_STOP ? 'user' : null,
      isInitialCreateOutcomeAmbiguous: (error) => error instanceof ArenaHostedBridgeError && error.dispatchState === 'unknown',
      observeResponse: () => undefined,
      transport: {
        create: async ({ signal: operationSignal, onRoutePinSelected }) => {
          assertCurrent();
          if (!create) return Promise.reject(new ArenaHostedBridgeError('invalid-request', 'not-dispatched'));
          onRoutePinSelected({ placement: 'hono-primary' });
          try {
            const response = await openArenaHostedStream(invoke, create, { signal: operationSignal, onResponse, createChannel: context.createChannel });
            context.recovery.settlePrepared(pointer.requestId); return response;
          } catch (cause) {
            // Only this original create can prove the prewritten new intent never acquired Native ownership.
            if (isCurrent() && cause instanceof ArenaHostedBridgeError && cause.intentOwnership === 'prior-retained' && cause.dispatchState === 'not-dispatched') context.recovery.rollbackPrepared(pointer.requestId);
            else context.recovery.settlePrepared(pointer.requestId);
            throw cause;
          }
        },
        lookup: ({ signal: operationSignal }) => {
          const restoreSession = explicitRestoreLookup; explicitRestoreLookup = false;
          return short({ operation: 'lookup-request', ...scope, ...(restoreSession ? { restoreSession: true } : {}) }, operationSignal);
        },
        resume: ({ generationId: id, lastEventId, signal: operationSignal }) => { assertCurrent(); return openArenaHostedStream(invoke,
          { operation: 'resume', ...scope, generationId: id, ...(lastEventId ? { after: lastEventId } : {}) },
          { signal: operationSignal, onResponse, createChannel: context.createChannel }); },
        cancel: ({ generationId: id, reason, signal: operationSignal }) => short({ operation: 'stop', ...scope,
          ...(id ? { generationId: id } : {}), reason }, operationSignal),
      },
    });
    if (!response.ok || !response.body) throw new Error('服务器暂未提供可读取的战报，请稍后按原请求恢复。');
    const readWithTimeout = createStreamReadWithTimeout({ mode: 'soft', label: '战报流式生成',
      idleTimeoutMs: DEFAULT_STREAM_READ_IDLE_TIMEOUT_MS, totalTimeoutMs: DEFAULT_STREAM_READ_TOTAL_TIMEOUT_MS,
      onSoftTimeout: (event) => {
        if (!isCurrent() || signal.aborted) return;
        details = { ...details, softTimeoutWarning: buildStreamSoftTimeoutMessage(event) }; publish();
      } });
    reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let buffer = '';
    while (true) {
      const next = await readWithTimeout(reader); assertCurrent(); if (next.done) break;
      // C0 closes explicit-stop streams only after its bounded server acknowledgement.
      if (signal.aborted) { if (signal.reason === ARENA_HOSTED_USER_STOP) continue; break; }
      buffer += decoder.decode(next.value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary + 2); buffer = buffer.slice(boundary + 2);
        const event = parseDesktopArenaHostedSseBlock(block);
        if (event.event === 'markdown') markdown += event.data.chunk;
        else if (event.event === 'reasoning') reasoning += event.data.chunk;
        else if (event.event === 'snapshot') { markdown = event.data.markdown; reasoning = event.data.reasoning; details = { ...details, serverStatus: event.data.status }; }
        else if (event.event === 'meta' || event.event === 'meta_error') details = { ...details, metaEvent: event };
        else if (event.event === 'done' || event.event === 'error') details = { ...details, terminal: event, serverStatus: event.data.status };
        const telemetry = event.event === 'telemetry' ? event.data : event.event === 'snapshot' ? event.data.telemetry : null;
        if (event.event === 'telemetry' || event.event === 'snapshot') {
          details = { ...details, telemetry: telemetry ?? null };
          usage = telemetry && 'usage' in telemetry && telemetry.usage
            ? Object.fromEntries(Object.entries(telemetry.usage).filter(([, value]) => typeof value === 'number')) : undefined;
        }
        if (encoder.encode(markdown).byteLength + encoder.encode(reasoning).byteLength > DESKTOP_ARENA_HOSTED_LIMITS.outputContentBytes) throw new Error('战报正文超过 4 MiB 原输出预算。');
        publish(); boundary = buffer.indexOf('\n\n');
      }
      if (encoder.encode(buffer).byteLength > DESKTOP_ARENA_HOSTED_LIMITS.eventWireBytes) throw new Error('生成事件超过协议预算。');
    }
    if (signal.aborted) return { ...common(), status: 'cancelled', message: signal.reason === ARENA_HOSTED_USER_STOP
      ? details.connectionState === 'cancelled' ? '服务器已受理停止请求，最终状态仍以恢复查询为准。' : '停止尚未确认，服务器仍可能运行；可按原请求恢复。'
      : '已停止本机订阅，服务器仍可能运行；可按原请求恢复。' };
    if (details.terminal?.event !== 'done' || details.terminal.data.status !== 'completed' || !details.terminal.data.ok) {
      return { ...common(), status: 'failed', message: '未取得服务器合格完成终态，原文已保留；可按原请求查询或恢复。' };
    }
    const terminal = details.terminal;
    const parsedMeta = StreamUpdateMetaSchema.safeParse(details.metaEvent?.event === 'meta' ? details.metaEvent.data.meta : null);
    const meta = parsedMeta.success ? parsedMeta.data : null;
    const checked = await validateHostedOutput(pointer, markdown, terminal.data.webPackage, context, signal, assertCurrent, frozenBase);
    const { renderSnapshot, ...validation } = checked; details = { ...details, ...validation };
    const reporter = details.headerMeta?.reporterInfo;
    let report: ArenaBattleReport = {
      headline: meta?.report?.headline || extractTitleFromBattleMarkdown(markdown),
      reporterInfo: { name: typeof reporter?.name === 'string' ? reporter.name : '', publication: typeof reporter?.publication === 'string' ? reporter.publication : '' },
      article: { body: markdown, analysis: '' }, officialReport: { winner: meta?.report?.winner ?? '', conclusion: '' },
      mode: pointer.battleMode, reportFormat: pointer.format,
      ...(renderSnapshot?.webPackage ? { webPackage: renderSnapshot.webPackage } : {}),
    };
    let displayMarkdown = markdown;
    if (nonStream && pointer.format === 'markdown') {
      const structured = parseArenaStructuredReportJson(markdown, { enableImpacts: false, enableImpactText: false, enableCurrentState: false });
      if (structured) {
        report = { ...report, headline: structured.headline as string, article: structured.article as ArenaBattleReport['article'], officialReport: structured.officialReport as ArenaBattleReport['officialReport'] };
        displayMarkdown = report.article.body || markdown;
      } else details = { ...details, outputValidation: 'invalid', validationMessage: '服务器已完成，但恢复内容不符合原非流式结构化报告协议；原文可完整导出。' };
    }
    if (nonStream && !details.validationMessage) details = { ...details, validationMessage: '已恢复原任务可用正文与终态；原完整非流式 JSON 和附加元数据未取得。' };
    assertCurrent(); signal.throwIfAborted();
    return { ...common(), markdown: displayMarkdown, status: 'completed', report, renderSnapshot, canAppendHistory: (Boolean(create) || automaticRecovery) && details.outputValidation === 'valid' };
  } catch (cause) {
    if (signal.aborted) return { ...common(), status: 'cancelled', message: '本机订阅已停止；服务器停止/完成状态尚需按原请求确认。' };
    return { ...common(), status: 'failed', message: cause instanceof ArenaHostedBridgeError ? cause.message : '连接或战报校验未完成，收到的原文仍可导出或按原请求恢复。' };
  } finally { if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); } }
};
