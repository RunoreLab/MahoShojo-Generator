import {
  ArenaGenerationFinalizationPendingError,
  generationCancelCode,
  isArenaGenerationAuditableRejection,
  isArenaPreparationSeed,
  isGenerationCancelReason,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { readSafePublicAiError } from '@mahoshojo/hosted-api/regular-generation';
import {
  ARENA_RESOURCE_BUDGET,
  countArenaReferenceItems,
  evaluateArenaPromptBudget,
  type ArenaHostedFundingMode,
} from '@mahoshojo/hosted-api/arena-generation/resource-budget';
import type {
  ArenaGenerationExecutor,
  ArenaGenerationExecutionInput,
  ArenaGenerationAuditableRejection,
  ArenaGenerationObserver,
  GenerationEventInput,
  GenerationTerminal,
  MaterializedArenaGeneration,
  PreflightedArenaGeneration,
  PreparedArenaGeneration,
  ArenaTrustedPvpContext,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { createArenaStreamProjector } from './stream-projector';

export const MAX_ARENA_COMBATANTS = ARENA_RESOURCE_BUDGET.maxCombatants;
const PREPARED_PAYLOAD_KEY = '__arenaGenerationRuntimeV1';
export const ARENA_GENERATION_MATERIALIZATION_VERSION = 'arena-runtime-v1';
const ARENA_RANDOM_DRAW_BUDGET = 4_096;

export type ArenaReasoningEvent =
  | { type: 'reasoning-start' }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'reasoning-end' };

export type ArenaGenerationPrompt = {
  prompt: string;
  metadata: Record<string, unknown>;
};

export type ArenaGenerationUpstream = {
  body: ReadableStream<Uint8Array>;
  telemetry: Record<string, unknown>;
};

export type ArenaGenerationFinalizationInput = {
  generationId: string;
  generationRequestId: string;
  actorKey: string;
  payloadHash: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  markdown: string;
  telemetry: Record<string, unknown>;
  status: 'completed' | 'failed' | 'cancelled' | 'producer_lost';
  errorCode: string | null;
  signal: AbortSignal;
};

export type ArenaGenerationFinalizationResult = {
  resultRef: string | null;
  ranking: unknown | null;
};

export interface ArenaGenerationRuntimeDependencies {
  preparePayload?(_input: {
    request: Request;
    actorKey: string;
    generationRequestId: string;
    payload: Record<string, unknown>;
  }): Promise<Record<string, unknown> | ArenaGenerationAuditableRejection | Response>;
  checkSafety(_input: {
    request: Request;
    actorKey: string;
    payload: Record<string, unknown>;
  }): Promise<Response | null>;
  buildPrompt(_input: {
    actorKey: string;
    payload: Record<string, unknown>;
    random: () => number;
  }): Promise<ArenaGenerationPrompt>;
  generate(_input: {
    generationId: string;
    payload: Record<string, unknown>;
    prompt: string;
    signal: AbortSignal;
    onReasoning(_event: ArenaReasoningEvent): Promise<void>;
  }): Promise<ArenaGenerationUpstream>;
  finalize(
    _input: ArenaGenerationFinalizationInput,
  ): Promise<ArenaGenerationFinalizationResult>;
  observer?: ArenaGenerationObserver;
}

type PreparedRuntimePayload = {
  prompt: string;
  metadata: Record<string, unknown>;
};

const jsonResponse = (payload: unknown, status: number): Response => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  },
);

type ArenaPayloadValidationFailure = {
  response: Response;
  code: string;
};

class ArenaOutputBudgetExceededError extends Error {
  constructor() {
    super('ARENA_OUTPUT_BUDGET_EXCEEDED');
    this.name = 'ArenaOutputBudgetExceededError';
  }
}

const validationFailure = (
  code: string,
  error: string,
  status: number,
): ArenaPayloadValidationFailure => ({
  code,
  response: jsonResponse({ code, error }, status),
});

const validateInfrastructureBudget = (
  payload: Record<string, unknown>,
): ArenaPayloadValidationFailure | null => {
  const combatants = payload.combatants;
  if (Array.isArray(combatants) && combatants.length > MAX_ARENA_COMBATANTS) {
    return validationFailure(
      'ARENA_PARTICIPANTS_LIMIT',
      `角色最多 ${MAX_ARENA_COMBATANTS} 位`,
      413,
    );
  }
  if (
    Array.isArray(payload.adjudicationEvents)
    && payload.adjudicationEvents.length > ARENA_RESOURCE_BUDGET.maxAdjudicationEvents
  ) {
    return validationFailure(
      'ARENA_ADJUDICATION_EVENTS_LIMIT',
      `裁定事件最多 ${ARENA_RESOURCE_BUDGET.maxAdjudicationEvents} 个`,
      413,
    );
  }
  const referenceItems = countArenaReferenceItems(payload);
  if (referenceItems > ARENA_RESOURCE_BUDGET.maxReferenceItemsSanity) {
    return validationFailure(
      'ARENA_REFERENCE_ITEMS_LIMIT',
      `辅助情景、素材、问卷与叙事历史合计最多 ${ARENA_RESOURCE_BUDGET.maxReferenceItemsSanity} 项`,
      413,
    );
  }
  return null;
};

const validatePayload = (payload: Record<string, unknown>): ArenaPayloadValidationFailure | null => {
  const mode = typeof payload.mode === 'string' ? payload.mode : 'classic';
  const combatants = payload.combatants;
  const minimum = mode === 'daily' || mode === 'scenario' ? 1 : 2;
  if (!Array.isArray(combatants) || combatants.length < minimum) {
    return validationFailure(
      'ARENA_PARTICIPANTS_INVALID',
      `该模式至少需要 ${minimum} 位角色`,
      400,
    );
  }
  if (payload.pvpContext !== undefined) {
    const context = payload.pvpContext;
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      return validationFailure('ARENA_PVP_CONTEXT_INVALID', 'pvpContext 无效', 400);
    }
    const record = context as Record<string, unknown>;
    if (['roomId', 'matchId', 'roundId'].some((key) => (
      typeof record[key] !== 'string'
      || !(record[key] as string).trim()
      || (record[key] as string).trim().length > 128
    ))) {
      return validationFailure('ARENA_PVP_CONTEXT_INVALID', 'pvpContext 无效', 400);
    }
  }
  return null;
};

const resolveFundingMode = (payload: Record<string, unknown>): ArenaHostedFundingMode => {
  const context = payload.__arenaServerContextV1;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return 'hosted-system';
  return (context as { fundingMode?: unknown }).fundingMode === 'hosted-byok'
    ? 'hosted-byok'
    : 'hosted-system';
};

const redactSemanticValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSemanticValue);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === PREPARED_PAYLOAD_KEY
      || key.startsWith('__arenaServer')
      || key === 'adjudicationResults'
      || key === 'apiKey'
      || key === 'signature'
    ) continue;
    output[key] = redactSemanticValue(entry);
  }
  return output;
};

export const redactArenaGenerationSemanticPayload = (
  payload: Record<string, unknown>,
): Record<string, unknown> => redactSemanticValue(payload) as Record<string, unknown>;

const readAuditablePvpContext = (
  payload: Record<string, unknown>,
): ArenaGenerationAuditableRejection['audit'] | null => {
  const serverContext = payload.__arenaServerContextV1;
  if (!serverContext || typeof serverContext !== 'object' || Array.isArray(serverContext)) return null;
  const record = serverContext as Record<string, unknown>;
  const pvpValue = record.trustedPvpContext;
  if (!pvpValue || typeof pvpValue !== 'object' || Array.isArray(pvpValue)) return null;
  const pvpRecord = pvpValue as Record<string, unknown>;
  const pvpContext = {
    roomId: typeof pvpRecord.roomId === 'string' ? pvpRecord.roomId : '',
    matchId: typeof pvpRecord.matchId === 'string' ? pvpRecord.matchId : '',
    roundId: typeof pvpRecord.roundId === 'string' ? pvpRecord.roundId : '',
  } satisfies ArenaTrustedPvpContext;
  if (Object.values(pvpContext).some((value) => !value || value.length > 128)) return null;
  const endpoint = typeof record.endpoint === 'string' ? record.endpoint : '';
  const deliveryMode = record.deliveryMode;
  const startedAt = typeof record.startedAt === 'string' ? record.startedAt : '';
  if (!endpoint || !startedAt || (deliveryMode !== 'stream' && deliveryMode !== 'non-stream')) {
    return null;
  }
  return {
    endpoint,
    generationMode: deliveryMode,
    startedAt,
    mode: typeof payload.mode === 'string' && payload.mode.trim() ? payload.mode.trim() : 'classic',
    pvpContext,
  };
};

const auditablePvpRejection = (input: {
  actorKey: string;
  generationRequestId: string;
  payload: Record<string, unknown>;
  response: Response;
  code: string;
  stage: string;
}): ArenaGenerationAuditableRejection | Response => {
  const audit = readAuditablePvpContext(input.payload);
  if (!audit || !input.actorKey || !input.generationRequestId) return input.response;
  return {
    kind: 'auditable-rejection',
    response: input.response,
    actorKey: input.actorKey,
    generationRequestId: input.generationRequestId,
    code: input.code,
    stage: input.stage,
    fingerprintPayload: redactArenaGenerationSemanticPayload(input.payload),
    audit,
  };
};

const createSeededRandom = async (preparationSeed: string): Promise<() => number> => {
  if (!isArenaPreparationSeed(preparationSeed)) {
    throw new Error('ARENA_GENERATION_PREPARATION_SEED_INVALID');
  }
  const keyBytes = Uint8Array.from(
    preparationSeed.match(/.{2}/gu) ?? [],
    (value) => Number.parseInt(value, 16),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-CTR' },
    false,
    ['encrypt'],
  );
  const randomBytes = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-CTR', counter: new Uint8Array(16), length: 64 },
    key,
    new Uint8Array(ARENA_RANDOM_DRAW_BUDGET * Uint32Array.BYTES_PER_ELEMENT),
  ));
  const view = new DataView(randomBytes.buffer, randomBytes.byteOffset, randomBytes.byteLength);
  let offset = 0;
  return (): number => {
    if (offset >= randomBytes.byteLength) {
      throw new Error('ARENA_GENERATION_RANDOM_BUDGET_EXHAUSTED');
    }
    const value = view.getUint32(offset, false) / 0x1_0000_0000;
    offset += Uint32Array.BYTES_PER_ELEMENT;
    return value;
  };
};

type AdjudicationEvent = {
  type?: unknown;
  description?: unknown;
  probability?: unknown;
  outcomes?: unknown;
  onSuccess?: unknown;
  onFailure?: unknown;
};

const resolveAdjudicationEvents = (
  value: unknown,
  random: () => number,
  depth = 0,
): Array<Record<string, unknown>> => {
  if (!Array.isArray(value) || depth > 20) return [];
  const results: Array<Record<string, unknown>> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const event = raw as AdjudicationEvent;
    const roll = Math.floor(Math.max(0, Math.min(0.999999999, random())) * 100) + 1;
    let outcome = '未知';
    let details = '';
    let next: unknown = null;
    if (event.type === 'binary' && typeof event.probability === 'number') {
      const success = roll <= event.probability;
      outcome = success ? '成功' : '失败';
      details = `掷骰(${roll}) vs 成功率(${event.probability}%)`;
      const branch = success ? event.onSuccess : event.onFailure;
      if (branch && typeof branch === 'object') next = (branch as { event?: unknown }).event;
    } else if (event.type === 'custom' && Array.isArray(event.outcomes)) {
      const candidates = event.outcomes.filter((item) => item && typeof item === 'object') as Array<{
        name?: unknown;
        probability?: unknown;
        chainedEvent?: { event?: unknown };
      }>;
      const total = candidates.reduce(
        (sum, item) => sum + (typeof item.probability === 'number' ? item.probability : 0),
        0,
      );
      let cumulative = 0;
      for (const candidate of candidates) {
        const probability = typeof candidate.probability === 'number' ? candidate.probability : 0;
        cumulative += probability * (100 / (total || 100));
        if (roll <= cumulative) {
          outcome = typeof candidate.name === 'string' ? candidate.name : '未知';
          details = `掷骰(${roll}) 命中概率区间`;
          next = candidate.chainedEvent?.event ?? null;
          break;
        }
      }
    }
    results.push({
      depth,
      description: typeof event.description === 'string' ? event.description : '',
      type: typeof event.type === 'string' ? event.type : 'unknown',
      roll,
      outcome,
      details,
    });
    if (next) results.push(...resolveAdjudicationEvents([next], random, depth + 1));
  }
  return results;
};

const readPrepared = (payload: Record<string, unknown>): PreparedRuntimePayload => {
  const value = payload[PREPARED_PAYLOAD_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ARENA_GENERATION_PAYLOAD_NOT_PREPARED');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.prompt !== 'string'
    || !record.metadata
    || typeof record.metadata !== 'object'
    || Array.isArray(record.metadata)
  ) {
    throw new Error('ARENA_GENERATION_PAYLOAD_NOT_PREPARED');
  }
  return {
    prompt: record.prompt,
    metadata: record.metadata as Record<string, unknown>,
  };
};

const readWithAbort = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) => {
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  let removeListener = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => {
      void reader.cancel(signal.reason).catch(() => undefined);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    removeListener = () => signal.removeEventListener('abort', onAbort);
  });
  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    removeListener();
  }
};

const errorCodeOf = (error: unknown, signal: AbortSignal): string => {
  if (signal.reason === 'producer_lost') return 'PRODUCER_OWNERSHIP_LOST';
  if (signal.aborted) {
    return generationCancelCode(
      isGenerationCancelReason(signal.reason) ? signal.reason : 'user',
    );
  }
  if (error instanceof Error && error.name === 'AbortError') return 'GENERATION_ABORTED';
  if (error instanceof ArenaOutputBudgetExceededError) return 'ARENA_OUTPUT_BUDGET_EXCEEDED';
  return 'GENERATION_FAILED';
};

export const createArenaGenerationRuntime = (
  dependencies: ArenaGenerationRuntimeDependencies,
): ArenaGenerationExecutor => {
  const observe: ArenaGenerationObserver['observeArenaGeneration'] = (observation) => {
    try {
      dependencies.observer?.observeArenaGeneration(observation);
    } catch {
      // Observability is deliberately fail-soft.
    }
  };
  const preflight: NonNullable<ArenaGenerationExecutor['preflight']> = async ({
    request,
    actorKey,
    generationRequestId,
    payload,
  }): Promise<PreflightedArenaGeneration | ArenaGenerationAuditableRejection | Response> => {
    const infrastructureFailure = validateInfrastructureBudget(payload);
    if (infrastructureFailure) return infrastructureFailure.response;
    const authorizedPayload = dependencies.preparePayload
      ? await dependencies.preparePayload({
        request,
        actorKey,
        generationRequestId,
        payload: { ...payload },
      })
      : { ...payload };
    if (authorizedPayload instanceof Response) return authorizedPayload;
    if (isArenaGenerationAuditableRejection(authorizedPayload)) return authorizedPayload;
    const invalid = validatePayload(authorizedPayload);
    if (invalid) {
      return auditablePvpRejection({
        actorKey,
        generationRequestId,
        payload: authorizedPayload,
        response: invalid.response,
        code: invalid.code,
        stage: 'payload-validation',
      });
    }
    const materializationPayload = { ...authorizedPayload };
    delete materializationPayload.adjudicationResults;
    const safetyStartedAt = performance.now();
    let safetyResponse: Response | null;
    try {
      safetyResponse = await dependencies.checkSafety({
        request,
        actorKey,
        payload: materializationPayload,
      });
      observe({
        event: 'phase',
        phase: 'safety',
        outcome: 'success',
        durationMs: performance.now() - safetyStartedAt,
      });
    } catch (error) {
      observe({
        event: 'phase',
        phase: 'safety',
        outcome: 'failure',
        durationMs: performance.now() - safetyStartedAt,
      });
      throw error;
    }
    if (safetyResponse) {
      return safetyResponse.status === 400
        ? auditablePvpRejection({
          actorKey,
          generationRequestId,
          payload: authorizedPayload,
          response: safetyResponse,
          code: 'ARENA_CONTENT_POLICY_REJECTED',
          stage: 'safety-policy',
        })
        : safetyResponse;
    }
    return {
      semanticPayload: redactArenaGenerationSemanticPayload(authorizedPayload),
      materializationPayload,
    };
  };

  const materialize: NonNullable<ArenaGenerationExecutor['materialize']> = async ({
    actorKey,
    payload,
    preparationSeed,
    preparationVersion,
  }): Promise<MaterializedArenaGeneration | Response> => {
    if (preparationVersion !== ARENA_GENERATION_MATERIALIZATION_VERSION) {
      return jsonResponse({
        code: 'ARENA_MATERIALIZATION_VERSION_UNSUPPORTED',
        error: 'Generation materialization version unsupported',
      }, 503);
    }
    const random = await createSeededRandom(preparationSeed);
    const executionPayload = { ...payload };
    delete executionPayload.adjudicationResults;
    if (
      Array.isArray(payload.adjudicationEvents)
      && payload.adjudicationEvents.length > 0
    ) {
      executionPayload.adjudicationResults = resolveAdjudicationEvents(
        payload.adjudicationEvents,
        random,
      );
    }
    const promptStartedAt = performance.now();
    let prepared: ArenaGenerationPrompt;
    try {
      prepared = await dependencies.buildPrompt({ actorKey, payload: executionPayload, random });
      observe({
        event: 'phase',
        phase: 'prompt',
        outcome: 'success',
        durationMs: performance.now() - promptStartedAt,
      });
    } catch (error) {
      observe({
        event: 'phase',
        phase: 'prompt',
        outcome: 'failure',
        durationMs: performance.now() - promptStartedAt,
      });
      throw error;
    }
    const promptBudget = evaluateArenaPromptBudget({
      fundingMode: resolveFundingMode(executionPayload),
      prompt: prepared.prompt,
    });
    if (!promptBudget.allowed) {
      return jsonResponse({
        code: 'ARENA_PROMPT_BUDGET_EXCEEDED',
        error: '最终 Prompt 超过当前渠道允许的估算 token 预算',
        estimatedPromptTokens: promptBudget.estimatedPromptTokens,
        maxEstimatedPromptTokens: promptBudget.maxEstimatedPromptTokens,
      }, 413);
    }
    prepared = {
      ...prepared,
      metadata: {
        ...prepared.metadata,
        estimatedPromptTokens: promptBudget.estimatedPromptTokens,
      },
    };
    const reporterInfo = prepared.metadata.reporterInfo;
    const streamMeta = {
      ...(prepared.metadata.outputContract === 'structured-report'
        || prepared.metadata.outputContract === 'stream-markdown'
        ? { outputContract: prepared.metadata.outputContract }
        : {}),
      ...(reporterInfo && typeof reporterInfo === 'object' && !Array.isArray(reporterInfo)
        ? { reporterInfo }
        : {}),
      ...(typeof prepared.metadata.userGuidance === 'string'
        && prepared.metadata.userGuidance.trim()
        ? { userGuidance: prepared.metadata.userGuidance.trim() }
        : {}),
      ...(Array.isArray(prepared.metadata.characterGuidances)
        && prepared.metadata.characterGuidances.length > 0
        ? { characterGuidances: prepared.metadata.characterGuidances }
        : {}),
      ...(Array.isArray(prepared.metadata.adjudicationResults)
        && prepared.metadata.adjudicationResults.length > 0
        ? { adjudicationResults: prepared.metadata.adjudicationResults }
        : {}),
      ...(typeof prepared.metadata.narrativeHistoryReadCount === 'number'
        ? { narrativeHistoryReadCount: prepared.metadata.narrativeHistoryReadCount }
        : {}),
    };
    return {
      executionPayload: {
        ...executionPayload,
        [PREPARED_PAYLOAD_KEY]: prepared,
      },
      responseHeaders: {
        'X-Mahoshojo-Stream-Meta': encodeURIComponent(JSON.stringify(streamMeta)),
      },
    };
  };

  const prepare: NonNullable<ArenaGenerationExecutor['prepare']> = async (input): Promise<
    PreparedArenaGeneration | ArenaGenerationAuditableRejection | Response
  > => {
    const preflighted = await preflight(input);
    if (preflighted instanceof Response) return preflighted;
    if (isArenaGenerationAuditableRejection(preflighted)) return preflighted;
    const seedBytes = crypto.getRandomValues(new Uint8Array(32));
    const preparationSeed = Array.from(
      seedBytes,
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    const materialized = await materialize({
      ...input,
      payload: preflighted.materializationPayload,
      preparationSeed,
      preparationVersion: ARENA_GENERATION_MATERIALIZATION_VERSION,
    });
    if (materialized instanceof Response) return materialized;
    if (isArenaGenerationAuditableRejection(materialized)) return materialized;
    return { ...materialized, semanticPayload: preflighted.semanticPayload };
  };

  const execute = async (
    input: ArenaGenerationExecutionInput,
  ): Promise<GenerationTerminal> => {
    const prepared = readPrepared(input.payload);
    const executionMetadata = { ...prepared.metadata };
    const decoder = new TextDecoder();
    const outputEncoder = new TextEncoder();
    let outputBytes = 0;
    let markdown = '';
    let telemetry: Record<string, unknown> = {};
    let reasoningEnded = false;
    let reasoningOperation = Promise.resolve();
    let reasoningFailure: unknown = null;
    let finalizationStarted = false;
    let durableFinalizationAttempted = false;
    let finalizationClaimIndeterminate = false;
    let finalizationResult: ArenaGenerationFinalizationResult | null = null;
    let claimedCancellationCode: string | null = null;
    let providerStartedAt: number | null = null;
    let providerSettled = false;
    const projector = createArenaStreamProjector({
      expectsMeta: prepared.metadata.expectsMeta === true,
    });

    const consumeOutputBudget = (text: string): void => {
      outputBytes += outputEncoder.encode(text).byteLength;
      if (outputBytes > ARENA_RESOURCE_BUDGET.maxOutputBytes) {
        throw new ArenaOutputBudgetExceededError();
      }
    };

    const emit = async (event: GenerationEventInput): Promise<void> => input.emit(event);
    const queueReasoningEvent = (event: ArenaReasoningEvent): Promise<void> => {
      if (reasoningFailure) return Promise.reject(reasoningFailure);
      let projected: GenerationEventInput;
      try {
        if (event.type === 'reasoning-start') {
          projected = {
            type: 'reasoning',
            data: { source: 'sdk', status: 'thinking', chunk: '' },
          };
        } else if (event.type === 'reasoning-delta') {
          consumeOutputBudget(event.text);
          projected = {
            type: 'reasoning',
            data: { source: 'sdk', status: 'thinking', chunk: event.text },
          };
        } else {
          reasoningEnded = true;
          projected = {
            type: 'reasoning_done',
            data: { source: 'sdk', status: 'done' },
          };
        }
      } catch (error) {
        reasoningFailure = error;
        return Promise.reject(error);
      }
      reasoningOperation = reasoningOperation
        .then(() => emit(projected))
        .catch((error: unknown) => {
          reasoningFailure ??= error;
          throw error;
        });
      return reasoningOperation;
    };
    const flushReasoningEvents = async (): Promise<void> => {
      await reasoningOperation;
      if (reasoningFailure) throw reasoningFailure;
    };
    const finalizeOnce = async (
      status: ArenaGenerationFinalizationInput['status'],
      errorCode: string | null,
    ): Promise<ArenaGenerationFinalizationResult> => {
      if (finalizationStarted) throw new Error('ARENA_GENERATION_FINALIZATION_REENTRY');
      finalizationStarted = true;
      const startedAt = performance.now();
      try {
        const terminal: GenerationTerminal = {
          status,
          ...(errorCode ? { code: errorCode } : {}),
        };
        finalizationClaimIndeterminate = true;
        const claim = await input.claimFinalization(terminal);
        finalizationClaimIndeterminate = false;
        if (claim.kind === 'cancelled') {
          claimedCancellationCode = generationCancelCode(claim.cancelReason ?? 'user');
          durableFinalizationAttempted = true;
          finalizationResult = await dependencies.finalize({
            generationId: input.generationId,
            generationRequestId: input.generationRequestId,
            actorKey: input.actorKey,
            payloadHash: input.payloadHash,
            payload: input.payload,
            metadata: executionMetadata,
            markdown,
            telemetry,
            status: 'cancelled',
            errorCode: claimedCancellationCode,
            signal: input.signal,
          });
          throw new Error('ARENA_GENERATION_CANCELLED');
        }
        if (claim.kind !== 'claimed') {
          throw new Error('ARENA_GENERATION_FINALIZATION_OWNERSHIP_LOST');
        }
        durableFinalizationAttempted = true;
        const result = await dependencies.finalize({
          generationId: input.generationId,
          generationRequestId: input.generationRequestId,
          actorKey: input.actorKey,
          payloadHash: input.payloadHash,
          payload: input.payload,
          metadata: executionMetadata,
          markdown,
          telemetry,
          status,
          errorCode,
          signal: input.signal,
        });
        finalizationResult = result;
        observe({
          event: 'phase',
          generationId: input.generationId,
          phase: 'finalization',
          outcome: 'success',
          durationMs: performance.now() - startedAt,
        });
        return result;
      } catch (error) {
        observe({
          event: 'phase',
          generationId: input.generationId,
          phase: 'finalization',
          outcome: 'failure',
          durationMs: performance.now() - startedAt,
        });
        throw error;
      }
    };

    try {
      providerStartedAt = performance.now();
      observe({ event: 'provider', generationId: input.generationId, outcome: 'started' });
      const upstream = await dependencies.generate({
        generationId: input.generationId,
        payload: input.payload,
        prompt: prepared.prompt,
        signal: input.signal,
        onReasoning: queueReasoningEvent,
      });
      telemetry = upstream.telemetry;
      await flushReasoningEvents();
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const next = await readWithAbort(reader, input.signal);
          await flushReasoningEvents();
          if (next.done) break;
          const chunk = decoder.decode(next.value, { stream: true });
          if (!chunk) continue;
          consumeOutputBudget(chunk);
          for (const projected of projector.push(chunk)) {
            markdown += projected;
            await emit({ type: 'markdown', data: { chunk: projected } });
          }
        }
        const tail = decoder.decode();
        if (tail) {
          consumeOutputBudget(tail);
          for (const projected of projector.push(tail)) {
            markdown += projected;
            await emit({ type: 'markdown', data: { chunk: projected } });
          }
        }
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      for (const projected of projector.finish().markdown) {
        markdown += projected;
        await emit({ type: 'markdown', data: { chunk: projected } });
      }
      await flushReasoningEvents();
      const { metaEvent } = projector.result();
      if (metaEvent) {
        if (
          metaEvent.type === 'meta'
          && metaEvent.data
          && typeof metaEvent.data === 'object'
          && !Array.isArray(metaEvent.data)
        ) {
          executionMetadata.streamMeta = (metaEvent.data as Record<string, unknown>).meta ?? null;
        }
        await emit(metaEvent);
      }
      if (!reasoningEnded) {
        await emit({
          type: 'reasoning_done',
          data: { source: 'sdk', status: 'unavailable' },
        });
      }
      if (!markdown.trim()) {
        providerSettled = true;
        observe({
          event: 'provider',
          generationId: input.generationId,
          outcome: 'failure',
          durationMs: performance.now() - providerStartedAt,
        });
        const finalization = await finalizeOnce('failed', 'EMPTY_STREAM_OUTPUT');
        return {
          status: 'failed',
          code: 'EMPTY_STREAM_OUTPUT',
          resultRef: finalization.resultRef,
        };
      }
      providerSettled = true;
      observe({
        event: 'provider',
        generationId: input.generationId,
        outcome: 'success',
        durationMs: performance.now() - providerStartedAt,
      });
      const finalization = await finalizeOnce('completed', null);
      await emit({ type: 'telemetry', data: telemetry });
      if (finalization.ranking !== null) {
        await emit({ type: 'ranking', data: finalization.ranking });
      }
      return { status: 'completed', resultRef: finalization.resultRef };
    } catch (error) {
      if (!providerSettled && providerStartedAt !== null) {
        providerSettled = true;
        observe({
          event: 'provider',
          generationId: input.generationId,
          outcome: input.signal.aborted ? 'cancelled' : 'failure',
          durationMs: performance.now() - providerStartedAt,
        });
      }
      if (
        (durableFinalizationAttempted || finalizationClaimIndeterminate)
        && finalizationResult === null
      ) {
        throw new ArenaGenerationFinalizationPendingError(error);
      }
      const cancellationFenced = error instanceof Error
        && error.message === 'ARENA_GENERATION_CANCELLED';
      const publicError = readSafePublicAiError(error);
      const code = cancellationFenced
        ? claimedCancellationCode ?? 'USER_CANCELLED'
        : publicError?.code ?? errorCodeOf(error, input.signal);
      const status = input.signal.reason === 'producer_lost'
        ? 'producer_lost'
        : input.signal.aborted || cancellationFenced
          ? 'cancelled'
          : 'failed';
      let finalization: ArenaGenerationFinalizationResult;
      if (finalizationStarted) {
        finalization = finalizationResult ?? { resultRef: null, ranking: null };
      } else {
        try {
          finalization = await finalizeOnce(status, code);
        } catch (finalizationError) {
          if (
            (durableFinalizationAttempted || finalizationClaimIndeterminate)
            && finalizationResult === null
          ) {
            throw new ArenaGenerationFinalizationPendingError(finalizationError);
          }
          throw finalizationError;
        }
      }
      return {
        status,
        code,
        resultRef: finalization.resultRef,
        ...(status === 'failed' && publicError ? { publicError } : {}),
      };
    }
  };

  return Object.freeze({
    materializationVersion: ARENA_GENERATION_MATERIALIZATION_VERSION,
    preflight,
    materialize,
    prepare,
    execute,
  });
};
