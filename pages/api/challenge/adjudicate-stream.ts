import { z } from 'zod/v3';

import { normalizeUsage } from '@/lib/arena/battle-report-log-utils';
import { parseAiSessionCustomProvider, resolveAiSessionProvider } from '@/lib/ai-session/provider';
import { acquireAiSessionSoftRateLimit } from '@/lib/ai-session/rate-limit';
import { adjudicateChallengeNode, generateChallengeAttemptFromStreamAi } from '@/lib/challenge/server/adjudicate-stream';
import type { ChallengePlayerInputV1 } from '@/lib/challenge/resolver-envelope';
import type { EncounterSnapshotV1, RunStateV1 } from '@/lib/challenge/types';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { encodeSseEvent, shouldUseClientSse } from '@/lib/stream/reasoning-sse';
import type { RawReasoningStreamEvent } from '@/lib/stream/raw-ai';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

export const runtime = 'edge';

const log = getLogger('api-challenge-adjudicate-stream');

const RequestBodySchema = z.object({
  runState: z.unknown(),
  encounter: z.unknown(),
  playerInput: z
    .object({
      recommendedActionId: z.string().optional(),
      optionId: z.string().optional(),
      note: z.string().optional(),
    })
    .partial()
    .optional()
    .default({}),
  customProvider: z.unknown().optional(),
});

const json = (payload: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const mapReasoningEvents = (events: RawReasoningStreamEvent[]): Array<{ event: string; payload: unknown }> => {
  const output: Array<{ event: string; payload: unknown }> = [];
  let sawReasoningDone = false;
  let hasReasoningText = false;

  for (const event of events) {
    if (event.type === 'reasoning-start') {
      output.push({
        event: 'reasoning',
        payload: { source: 'sdk', status: 'thinking', chunk: '' },
      });
      continue;
    }
    if (event.type === 'reasoning-delta') {
      const chunk = typeof event.text === 'string' ? event.text : '';
      if (chunk.trim()) hasReasoningText = true;
      output.push({
        event: 'reasoning',
        payload: { source: 'sdk', status: 'thinking', chunk },
      });
      continue;
    }
    if (event.type === 'reasoning-end') {
      sawReasoningDone = true;
      output.push({
        event: 'reasoning_done',
        payload: { source: 'sdk', status: hasReasoningText ? 'done' : 'unavailable' },
      });
    }
  }

  if (!sawReasoningDone) {
    output.push({
      event: 'reasoning_done',
      payload: { source: 'sdk', status: hasReasoningText ? 'done' : 'unavailable' },
    });
  }

  return output;
};

const buildBufferedSseResponse = async (result: Awaited<ReturnType<typeof adjudicateChallengeNode>>): Promise<Response> => {
  const usage = await result.generation?.usagePromise?.catch(() => null);
  const normalizedUsage = normalizeUsage(usage);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const bufferedReasoningEvents = mapReasoningEvents(result.generation?.reasoningEvents ?? []);
      for (const event of bufferedReasoningEvents) {
        controller.enqueue(encodeSseEvent(event.event, event.payload));
      }

      controller.enqueue(encodeSseEvent('markdown', { chunk: result.storyMarkdownWithMeta }));

      if (normalizedUsage || result.generation?.aiModel || result.finalSource) {
        controller.enqueue(
          encodeSseEvent('telemetry', {
            version: 1,
            ...(result.generation?.aiModel ? { aiModel: result.generation.aiModel } : {}),
            ...(normalizedUsage ? { usage: normalizedUsage } : {}),
            finalSource: result.finalSource,
          })
        );
      }

      controller.enqueue(encodeSseEvent('done', { ok: true, finalSource: result.finalSource }));
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};

type ChallengeAdjudicateRequestInput = {
  req: Request;
  runState: RunStateV1;
  encounter: EncounterSnapshotV1;
  playerInput: ChallengePlayerInputV1;
  customProvider?: unknown;
};

type HandlerDeps = {
  adjudicateChallengeRequest: (
    input: ChallengeAdjudicateRequestInput
  ) => Promise<Awaited<ReturnType<typeof adjudicateChallengeNode>>>;
};

const defaultAdjudicateChallengeRequest: HandlerDeps['adjudicateChallengeRequest'] = async (input) => {
  const customProviderParsed = parseAiSessionCustomProvider(input.customProvider);
  if (!customProviderParsed.ok) {
    throw new Error(customProviderParsed.error);
  }

  const providerResolved = resolveAiSessionProvider(customProviderParsed.value);
  if (!providerResolved.ok) {
    const error = new Error(providerResolved.error);
    (error as Error & { status?: number }).status = providerResolved.status;
    throw error;
  }

  const note = input.playerInput.note?.trim() ?? '';
  if (note) {
    const safetyResponse = await enforceTextSafety({
      text: note,
      log,
      logMeta: {
        runId: input.runState.runId,
        nodeId: input.encounter.nodeId,
        nodeType: input.encounter.kind,
      },
      enableAiSafetyCheck: false,
      sensitiveWordReason: '在挑战输入中使用了危险符文',
    });
    if (safetyResponse) {
      const payload = await safetyResponse.json().catch(() => ({ error: '输入内容不合规' }));
      const error = new Error(
        typeof payload?.reason === 'string'
          ? payload.reason
          : typeof payload?.error === 'string'
            ? payload.error
            : '输入内容不合规'
      );
      (error as Error & { status?: number }).status = safetyResponse.status;
      throw error;
    }
  }

  const rateLimit = acquireAiSessionSoftRateLimit({
    req: input.req,
    actionType: 'challenge_node_adjudicate',
    sessionId: input.runState.runId,
    providerMode: providerResolved.value.providerMode,
  });
  if (!rateLimit.allowed) {
    const error = new Error('请求过于频繁，请稍后再试');
    (error as Error & { status?: number }).status = 429;
    (error as Error & { retryAfterSeconds?: number }).retryAfterSeconds = rateLimit.retryAfterSeconds;
    throw error;
  }

  try {
    const result = await adjudicateChallengeNode(
      {
        runState: input.runState,
        encounter: input.encounter,
        playerInput: input.playerInput,
      },
      {
        generateAttempt: async ({ runState, encounter, playerInput, resolverEnvelope, attemptIndex }) => {
          return generateChallengeAttemptFromStreamAi(
            {
              runState,
              encounter,
              playerInput,
              resolverEnvelope,
              attemptIndex,
            },
            {
              providerOptions: providerResolved.value.providerOptions,
              modelOverride: providerResolved.value.modelId,
            }
          );
        },
      }
    );

    recordUserActivityFromRequest(input.req);
    return result;
  } finally {
    rateLimit.release();
  }
};

export const createChallengeAdjudicateStreamHandler = (
  deps: HandlerDeps = {
    adjudicateChallengeRequest: defaultAdjudicateChallengeRequest,
  }
) => {
  return async function handler(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      const parsed = RequestBodySchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return json({ error: '请求参数无效' }, { status: 400 });
      }

      const { runState, encounter, playerInput, customProvider } = parsed.data;
      if (!isRecord(runState) || !isRecord(encounter)) {
        return json({ error: '请求参数无效' }, { status: 400 });
      }

      const result = await deps.adjudicateChallengeRequest({
        req,
        runState: runState as unknown as RunStateV1,
        encounter: encounter as unknown as EncounterSnapshotV1,
        playerInput: playerInput ?? {},
        customProvider,
      });

      if (shouldUseClientSse(req)) {
        return buildBufferedSseResponse(result);
      }

      return json({
        success: true,
        finalSource: result.finalSource,
        storyMarkdown: result.storyMarkdown,
        storyMarkdownWithMeta: result.storyMarkdownWithMeta,
        adjudication: result.adjudication,
        resolverEnvelope: result.resolverEnvelope,
        nextRunState: result.nextRunState,
        checkpoints: result.checkpoints,
        nodeRecordPatch: result.nodeRecordPatch,
        runRecordPatch: result.runRecordPatch,
      });
    } catch (error) {
      log.error('挑战流式裁定失败', { error });
      const message = error instanceof Error ? error.message : '未知错误';
      const status =
        error instanceof Error && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
          ? ((error as { status: number }).status)
          : 500;

      const response = json(
        {
          error: status === 500 ? '挑战流式裁定失败' : message,
          ...(status === 500 ? { message } : {}),
        },
        { status }
      );

      if (status === 429 && error instanceof Error && 'retryAfterSeconds' in error) {
        const retryAfterSeconds = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
        if (typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds)) {
          response.headers.set('Retry-After', String(Math.max(1, Math.floor(retryAfterSeconds))));
        }
      }

      return response;
    }
  };
};

export default createChallengeAdjudicateStreamHandler();
