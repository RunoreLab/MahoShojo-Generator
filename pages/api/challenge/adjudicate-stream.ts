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

const TrackValueSchema = z.object({
  current: z.number().finite(),
  max: z.number().finite().nullable(),
});

const PlayerSnapshotSchema = z.object({
  version: z.literal(1),
  sourceType: z.enum(['preset', 'local-card', 'public-card']),
  sourceId: z.string().min(1),
  displayName: z.string().min(1),
  snapshotSeed: z.string().min(1),
  strengthTier: z.enum(['common', 'elite', 'boss']),
  baseTrackSnapshot: z.record(TrackValueSchema),
  combatProfile: z.record(z.unknown()),
  tags: z.array(z.string()),
  promptSummary: z.string(),
});

const WorldStateSchema = z.object({
  version: z.literal(1),
  schemaId: z.string().min(1),
  tracks: z.record(TrackValueSchema),
  temporaryStatuses: z.array(z.string()),
  runFlags: z.array(z.string()),
  persistentItemIds: z.array(z.string()),
  consumableIds: z.array(z.string()),
});

const MapNodeSchema = z.object({
  version: z.literal(1),
  nodeId: z.string().min(1),
  layer: z.number().int().nonnegative(),
  nodeType: z.enum(['battle', 'elite', 'event', 'rest', 'shop', 'boss']),
  visibility: z.enum(['summary', 'focused', 'resolved']),
  riskHint: z.enum(['low', 'mid', 'high']),
  rewardHint: z.enum(['low', 'mid', 'high']),
  encounterRef: z.string().min(1),
});

const MapEdgeSchema = z.object({
  version: z.literal(1),
  edgeId: z.string().min(1),
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
});

const MapStateSchema = z.object({
  version: z.literal(1),
  rootNodeId: z.string().min(1),
  totalLayers: z.number().int().positive(),
  bossNodeId: z.string().min(1),
  nodes: z.array(MapNodeSchema),
  edges: z.array(MapEdgeSchema),
});

const PendingRewardChoiceSchema = z.object({
  selectionMode: z.enum(['auto', 'choose-one']),
  rewardOptionIds: z.array(z.string()),
  sourceNodeId: z.string().min(1),
});

const RunStateSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  worldPresetId: z.string().min(1),
  runSeed: z.string().nullable(),
  status: z.enum(['bootstrapping', 'in_progress', 'completed', 'failed', 'abandoned']),
  playerSnapshot: PlayerSnapshotSchema.nullable(),
  worldState: WorldStateSchema.nullable(),
  mapState: MapStateSchema.nullable(),
  pendingRewardChoice: PendingRewardChoiceSchema.nullable(),
  currentNodeId: z.string().nullable(),
  visitedNodeCount: z.number().int().nonnegative(),
  checkpointSeq: z.number().int().nonnegative(),
  usedBootstrapReroll: z.boolean(),
  startedAt: z.number().finite(),
  updatedAt: z.number().finite(),
});

const RewardOptionSchema = z.object({
  version: z.literal(1),
  rewardOptionId: z.string().min(1),
  kind: z.enum([
    'adjust_track',
    'add_consumable',
    'add_persistent_item',
    'add_status',
    'clear_negative_status',
  ]),
  label: z.string().min(1),
  payload: z.object({
    trackId: z.string().optional(),
    amount: z.number().finite().optional(),
    itemId: z.string().optional(),
    statusId: z.string().optional(),
    clearCount: z.number().finite().optional(),
  }),
});

const EffectPatchSchema = z.object({
  version: z.literal(1),
  trackDeltas: z.record(z.number().finite()),
  addStatuses: z.array(z.string()),
  removeStatuses: z.array(z.string()),
  rewardSelectionMode: z.enum(['none', 'auto', 'choose-one']),
  rewardOptionIds: z.array(z.string()),
});

const EventOptionSchema = z.object({
  version: z.literal(1),
  optionId: z.string().min(1),
  label: z.string().min(1),
  notePolicy: z.enum(['none', 'optional', 'required']),
  effectPatch: EffectPatchSchema,
  disabled: z.boolean().optional(),
});

const ShopOfferSchema = z.object({
  version: z.literal(1),
  offerId: z.string().min(1),
  price: z.number().finite(),
  reward: RewardOptionSchema.extend({
    kind: z.enum(['add_consumable', 'add_persistent_item', 'add_status', 'clear_negative_status']),
  }),
  disabled: z.boolean().optional(),
});

const EnemySnapshotSchema = z.object({
  version: z.literal(1),
  sourceType: z.enum(['preset', 'public-card', 'season-entity']),
  sourceId: z.string().min(1),
  displayName: z.string().min(1),
  strengthTier: z.enum(['common', 'elite', 'boss']),
  combatProfile: z.record(z.unknown()),
  tags: z.array(z.string()),
  promptSummary: z.string(),
});

const EncounterSchema = z.object({
  version: z.literal(1),
  nodeId: z.string().min(1),
  templateId: z.string().min(1),
  kind: z.enum(['battle', 'elite', 'event', 'rest', 'shop', 'boss']),
  inputMode: z.enum(['choice-only', 'choice-plus-note', 'free-intent', 'recommended-action-plus-free-intent']),
  enemySnapshot: EnemySnapshotSchema.nullable(),
  rewardOptions: z.array(RewardOptionSchema),
  eventOptions: z.array(EventOptionSchema),
  shopOffers: z.array(ShopOfferSchema),
});

const RequestBodySchema = z.object({
  runState: RunStateSchema,
  encounter: EncounterSchema,
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
        onAttemptError: (error, context) => {
          log.warn('挑战流式裁定 attempt 失败，准备重试或降级', {
            error,
            runId: context.runState.runId,
            nodeId: context.encounter.nodeId,
            nodeType: context.encounter.kind,
            attemptIndex: context.attemptIndex,
          });
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

      const result = await deps.adjudicateChallengeRequest({
        req,
        runState: runState as RunStateV1,
        encounter: encounter as EncounterSnapshotV1,
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
