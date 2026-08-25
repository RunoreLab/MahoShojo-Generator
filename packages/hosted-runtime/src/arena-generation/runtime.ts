import type {
  ArenaGenerationExecutor,
  ArenaGenerationExecutionInput,
  ArenaGenerationObserver,
  GenerationEventInput,
  GenerationTerminal,
  PreparedArenaGeneration,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { createArenaStreamProjector } from './stream-projector';

const MAX_ARENA_MATERIALS = 10;
const MAX_ARENA_AUX_SCENARIOS = 10;
const PREPARED_PAYLOAD_KEY = '__arenaGenerationRuntimeV1';

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
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  markdown: string;
  telemetry: Record<string, unknown>;
  status: 'completed' | 'failed' | 'cancelled';
  errorCode: string | null;
  signal: AbortSignal;
};

export type ArenaGenerationFinalizationResult = {
  resultRef: string | null;
  ranking: unknown | null;
};

export interface ArenaGenerationRuntimeDependencies {
  random?(): number;
  preparePayload?(_input: {
    request: Request;
    actorKey: string;
    payload: Record<string, unknown>;
  }): Promise<Record<string, unknown> | Response>;
  checkSafety(_input: {
    request: Request;
    actorKey: string;
    payload: Record<string, unknown>;
  }): Promise<Response | null>;
  buildPrompt(_input: {
    actorKey: string;
    payload: Record<string, unknown>;
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

const validatePayload = (payload: Record<string, unknown>): Response | null => {
  const mode = typeof payload.mode === 'string' ? payload.mode : 'classic';
  const combatants = payload.combatants;
  const minimum = mode === 'daily' || mode === 'scenario' ? 1 : 2;
  if (!Array.isArray(combatants) || combatants.length < minimum) {
    return jsonResponse({
      code: 'ARENA_PARTICIPANTS_INVALID',
      error: `该模式至少需要 ${minimum} 位角色`,
    }, 400);
  }
  if (
    Array.isArray(payload.auxScenarios)
    && payload.auxScenarios.length > MAX_ARENA_AUX_SCENARIOS
  ) {
    return jsonResponse({ code: 'ARENA_AUX_SCENARIOS_LIMIT', error: '辅助情景最多 10 个' }, 400);
  }
  if (Array.isArray(payload.materials) && payload.materials.length > MAX_ARENA_MATERIALS) {
    return jsonResponse({ code: 'ARENA_MATERIALS_LIMIT', error: '素材最多 10 个' }, 400);
  }
  if (payload.pvpContext !== undefined) {
    const context = payload.pvpContext;
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      return jsonResponse({ code: 'ARENA_PVP_CONTEXT_INVALID', error: 'pvpContext 无效' }, 400);
    }
    const record = context as Record<string, unknown>;
    if (['roomId', 'matchId', 'roundId'].some((key) => (
      typeof record[key] !== 'string'
      || !(record[key] as string).trim()
      || (record[key] as string).trim().length > 128
    ))) {
      return jsonResponse({ code: 'ARENA_PVP_CONTEXT_INVALID', error: 'pvpContext 无效' }, 400);
    }
  }
  return null;
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

const redactSemanticPayload = (
  payload: Record<string, unknown>,
): Record<string, unknown> => redactSemanticValue(payload) as Record<string, unknown>;

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
  if (signal.aborted) return 'USER_CANCELLED';
  if (error instanceof Error && error.name === 'AbortError') return 'GENERATION_ABORTED';
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
  const prepare: NonNullable<ArenaGenerationExecutor['prepare']> = async ({
    request,
    actorKey,
    payload,
  }): Promise<PreparedArenaGeneration | Response> => {
    const authorizedPayload = dependencies.preparePayload
      ? await dependencies.preparePayload({ request, actorKey, payload: { ...payload } })
      : { ...payload };
    if (authorizedPayload instanceof Response) return authorizedPayload;
    const invalid = validatePayload(authorizedPayload);
    if (invalid) return invalid;
    const executionPayload = { ...authorizedPayload };
    delete executionPayload.adjudicationResults;
    if (
      Array.isArray(authorizedPayload.adjudicationEvents)
      && authorizedPayload.adjudicationEvents.length > 0
    ) {
      executionPayload.adjudicationResults = resolveAdjudicationEvents(
        authorizedPayload.adjudicationEvents,
        dependencies.random ?? Math.random,
      );
    }
    const safetyStartedAt = performance.now();
    let safetyResponse: Response | null;
    try {
      safetyResponse = await dependencies.checkSafety({
        request,
        actorKey,
        payload: executionPayload,
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
    if (safetyResponse) return safetyResponse;
    const promptStartedAt = performance.now();
    let prepared: ArenaGenerationPrompt;
    try {
      prepared = await dependencies.buildPrompt({ actorKey, payload: executionPayload });
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
    const reporterInfo = prepared.metadata.reporterInfo;
    const streamMeta = {
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
    };
    return {
      semanticPayload: redactSemanticPayload(authorizedPayload),
      executionPayload: {
        ...executionPayload,
        [PREPARED_PAYLOAD_KEY]: prepared,
      },
      responseHeaders: {
        'X-Mahoshojo-Stream-Meta': encodeURIComponent(JSON.stringify(streamMeta)),
      },
    };
  };

  const execute = async (
    input: ArenaGenerationExecutionInput,
  ): Promise<GenerationTerminal> => {
    const prepared = readPrepared(input.payload);
    const executionMetadata = { ...prepared.metadata };
    const decoder = new TextDecoder();
    let markdown = '';
    let telemetry: Record<string, unknown> = {};
    let reasoningEnded = false;
    let finalizationStarted = false;
    let providerStartedAt: number | null = null;
    let providerSettled = false;
    const projector = createArenaStreamProjector({
      expectsMeta: prepared.metadata.expectsMeta === true,
    });

    const emit = async (event: GenerationEventInput): Promise<void> => input.emit(event);
    const finalizeOnce = async (
      status: ArenaGenerationFinalizationInput['status'],
      errorCode: string | null,
    ): Promise<ArenaGenerationFinalizationResult> => {
      if (finalizationStarted) throw new Error('ARENA_GENERATION_FINALIZATION_REENTRY');
      finalizationStarted = true;
      const startedAt = performance.now();
      try {
        const result = await dependencies.finalize({
          generationId: input.generationId,
          generationRequestId: input.generationRequestId,
          actorKey: input.actorKey,
          payload: input.payload,
          metadata: executionMetadata,
          markdown,
          telemetry,
          status,
          errorCode,
          signal: input.signal,
        });
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
        onReasoning: async (event) => {
          if (event.type === 'reasoning-start') {
            await emit({
              type: 'reasoning',
              data: { source: 'sdk', status: 'thinking', chunk: '' },
            });
            return;
          }
          if (event.type === 'reasoning-delta') {
            await emit({
              type: 'reasoning',
              data: { source: 'sdk', status: 'thinking', chunk: event.text },
            });
            return;
          }
          reasoningEnded = true;
          await emit({
            type: 'reasoning_done',
            data: { source: 'sdk', status: 'done' },
          });
        },
      });
      telemetry = upstream.telemetry;
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const next = await readWithAbort(reader, input.signal);
          if (next.done) break;
          const chunk = decoder.decode(next.value, { stream: true });
          if (!chunk) continue;
          for (const projected of projector.push(chunk)) {
            markdown += projected;
            await emit({ type: 'markdown', data: { chunk: projected } });
          }
        }
        const tail = decoder.decode();
        if (tail) {
          for (const projected of projector.push(tail)) {
            markdown += projected;
            await emit({ type: 'markdown', data: { chunk: projected } });
          }
        }
      } finally {
        reader.releaseLock();
      }
      for (const projected of projector.finish().markdown) {
        markdown += projected;
        await emit({ type: 'markdown', data: { chunk: projected } });
      }
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
      const code = errorCodeOf(error, input.signal);
      const status = input.signal.aborted ? 'cancelled' : 'failed';
      const finalization = finalizationStarted
        ? { resultRef: null, ranking: null }
        : await finalizeOnce(status, code);
      return { status, code, resultRef: finalization.resultRef };
    }
  };

  return Object.freeze({ prepare, execute });
};
