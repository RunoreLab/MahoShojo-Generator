import { z } from 'zod/v3';
import {
  BATTLE_STORY_MAX_TOTAL_CHAPTERS,
  buildBattleStoryDeterministicDigest,
  validateBattleStoryGenerateNextInput,
} from '@mahoshojo/domain/arena-battle-story-session';
import { buildBattleStoryArenaRequest, projectBattleStoryArenaPayload } from '@mahoshojo/domain/arena-battle-story-request';
import { BattleStoryCommitByteLimitError, countBattleStoryCommitJsonBytes } from '@mahoshojo/domain/arena-story-commit';
import {
  ARENA_STORY_PROTOCOL_HEADER, ARENA_STORY_PROTOCOL_VERSION,
  ArenaStoryCreateRequestSchema, type ArenaStoryCreateRequest,
} from '@mahoshojo/contracts/arena-story';
import type {
  ArenaGenerationService,
  GenerationStreamEvent,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { ARENA_RESOURCE_BUDGET } from '@mahoshojo/hosted-api/arena-generation/resource-budget';
import { encodeGenerationSseEvent, projectArenaGenerationEventForClient } from '@mahoshojo/hosted-api/arena-generation/sse';
import type { SignatureService } from '../signature';
import {
  ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER,
  createArenaInternalGuidanceAuthority,
} from '../arena-generation/internal-authority';
import {
  resolveArenaCustomProvider,
  type ArenaCustomProvider,
} from '../arena-generation/custom-provider';
import {
  ARENA_COMPANION_OPERATION_HEADER,
  readArenaCompanionJsonPayload,
} from './service';
import { sanitizePublicErrorMessage } from '../node-runtime/error-extraction';

const SessionRequestSchema = z.object({
  sessionId: z.string().min(1),
  generationRequestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u),
  action: z.enum(['start', 'continue', 'branch', 'rewrite']),
  sourceChapterId: z.string().min(1).optional(),
  chapterIndex: z.number().int().positive().optional(),
  chapterPlan: z.object({
    totalChapters: z.number().int().min(1).max(BATTLE_STORY_MAX_TOTAL_CHAPTERS),
  }).optional(),
  chapterContext: z.object({
    sessionSummary: z.string().optional(),
    recentChapters: z.array(z.object({
      id: z.string().min(1),
      index: z.number().int().positive(),
      title: z.string().optional(),
      markdown: z.string(),
      deterministicDigest: z.object({
        chapterTitle: z.string(),
        winner: z.string().optional(),
        officialConclusion: z.string().optional(),
        bodyExcerpt: z.string().optional(),
        impactDigest: z.array(z.object({
          characterName: z.string(),
          impact: z.string().optional(),
          currentStateSummary: z.string().optional(),
        })).optional(),
      }).optional(),
    })).max(12),
    workingCombatants: z.array(z.unknown()).min(1),
  }),
  seed: z.object({
    combatants: z.array(z.unknown()).min(1),
    scenario: z.record(z.unknown()).nullable().optional(),
    auxScenarios: z.array(z.record(z.unknown()))
      .max(ARENA_RESOURCE_BUDGET.maxReferenceItemsSanity)
      .optional(),
    materials: z.array(z.unknown())
      .max(ARENA_RESOURCE_BUDGET.maxReferenceItemsSanity)
      .optional(),
    adjudicationEvents: z.array(z.unknown()).optional(),
    questionnaires: z.array(z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      kind: z.enum(['magical-girl', 'canshou']),
      useLore: z.boolean().optional(),
      loreMarkdown: z.string().optional(),
    })).max(ARENA_RESOURCE_BUDGET.maxReferenceItemsSanity).optional(),
    mode: z.enum(['classic', 'kizuna', 'daily', 'scenario']),
    storyLength: z.enum(['default', 'short', 'standard', 'detailed', 'long']).default('standard'),
    customStoryLength: z.string().optional(),
    language: z.string().default('zh-CN'),
    settings: z.object({
      readArenaHistory: z.boolean(),
      readArenaHistoryLimit: z.number().int().min(1).max(999).optional(),
      isArenaHistoryUnlimited: z.boolean().optional(),
      writeArenaHistory: z.boolean(),
      readCurrentState: z.boolean(),
      writeCurrentState: z.boolean(),
      readNarrativeHistory: z.boolean(),
      readNarrativeHistoryLimit: z.number().int().min(1).max(999).optional(),
      isNarrativeHistoryUnlimited: z.boolean().optional(),
      writeNarrativeHistory: z.boolean(),
    }),
  }),
  userGuidance: z.string().optional(),
  customProvider: z.unknown().optional(),
});

export type ArenaSessionRequest = z.infer<typeof SessionRequestSchema>;

export type ArenaSessionRateLimitResult =
  | { allowed: true; retryAfterSeconds: 0; release(): void }
  | {
    allowed: false;
    retryAfterSeconds: number;
    reason: 'session_in_flight' | 'session_cooldown' | 'ip_burst';
  };

export type ArenaSessionCompanionOptions = {
  generationService: ArenaGenerationService;
  signatures: SignatureService;
  /** Enabled only by Hono composition; no fallback to the legacy wire on unsupported runtimes. */
  storyProtocolEnabled?: boolean;
  acquireRateLimit(_input: {
    request: Request;
    actionType: 'battle_story_session_continue' | 'battle_story_session_regenerate_chapter';
    sessionId: string;
    providerMode: 'system' | 'custom';
  }): ArenaSessionRateLimitResult;
  deriveChapterId?(_input: {
    sessionId: string;
    generationRequestId: string;
    chapterIndex: number;
  }): Promise<string>;
  now?(): Date;
  recordActivity?(_request: Request): void;
  observeLifecycle?(_input: {
    outcome: 'success' | 'failure' | 'cancelled';
    durationMs: number;
  }): void;
};

export interface ArenaSessionCompanionService {
  readonly storyProtocolVersion?: typeof ARENA_STORY_PROTOCOL_VERSION;
  generateNext(_request: Request): Promise<Response>;
}

const jsonResponse = (
  payload: unknown,
  status: number,
  headers?: Readonly<Record<string, string>>,
): Response => new Response(JSON.stringify(payload), {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  },
});

export const buildArenaSessionUpstreamRequestBody = (
  payload: ArenaSessionRequest | ArenaStoryCreateRequest,
  internalGuidance: string,
  customProvider: ArenaCustomProvider | null,
): Record<string, unknown> => ({
  generationRequestId: payload.generationRequestId,
  ...projectBattleStoryArenaPayload(payload, internalGuidance),
  ...(customProvider ? { customProvider } : {}),
});

const encodeCompanionEvent = (
  event: string,
  data: unknown,
  id?: string,
): Uint8Array => id
  ? encodeGenerationSseEvent({ id, type: event, data })
  : new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`);

const recordOf = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const deterministicChapterId = async (input: {
  sessionId: string;
  generationRequestId: string;
  chapterIndex: number;
}): Promise<string> => {
  const bytes = new TextEncoder().encode(
    `arena-session-chapter-v1\u0000${input.sessionId}\u0000${input.generationRequestId}\u0000${input.chapterIndex}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `story_${hex}`;
};

const createUpstreamRequest = (input: {
  request: Request;
  body: Record<string, unknown>;
  guidanceSignature: string;
  includeBody: boolean;
}): Request => {
  const headers = new Headers(input.request.headers);
  headers.delete('content-length');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set(ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER, input.guidanceSignature);
  headers.set(ARENA_COMPANION_OPERATION_HEADER, 'arena/session/generate-next');
  return new Request(input.request.url, {
    method: 'POST',
    headers,
    ...(input.includeBody ? { body: JSON.stringify(input.body) } : {}),
    signal: input.request.signal,
  });
};

const supportsArenaStoryProtocol = (options: ArenaSessionCompanionOptions): boolean => (
  options.storyProtocolEnabled === true
  && options.generationService.storyProtocolVersion === ARENA_STORY_PROTOCOL_VERSION
  && typeof options.generationService.createParsedSubscription === 'function'
);

export const createArenaSessionCompanionService = (
  options: ArenaSessionCompanionOptions,
): ArenaSessionCompanionService => Object.freeze({
  ...(supportsArenaStoryProtocol(options) ? { storyProtocolVersion: ARENA_STORY_PROTOCOL_VERSION } : {}),
  async generateNext(request: Request): Promise<Response> {
    const supportsStoryProtocol = supportsArenaStoryProtocol(options);
    const storyProtocol = request.headers.has(ARENA_STORY_PROTOCOL_HEADER);
    if (storyProtocol && request.headers.get(ARENA_STORY_PROTOCOL_HEADER) !== ARENA_STORY_PROTOCOL_VERSION) {
      return jsonResponse({ code: 'ARENA_STORY_PROTOCOL_UNSUPPORTED', error: '连续故事协议版本不支持' }, 400);
    }
    if (storyProtocol && !supportsStoryProtocol) {
      return jsonResponse({ code: 'ARENA_STORY_PROTOCOL_UNAVAILABLE', error: '连续故事协议暂不可用' }, 503);
    }
    const lifecycleStartedAt = Date.now();
    let lifecycleObserved = false;
    const observeLifecycleOnce = (outcome: 'success' | 'failure' | 'cancelled'): void => {
      if (lifecycleObserved) return;
      lifecycleObserved = true;
      try {
        options.observeLifecycle?.({
          outcome,
          durationMs: Math.max(0, Date.now() - lifecycleStartedAt),
        });
      } catch {
        // Telemetry transport failures must not affect session execution.
      }
    };
    const parsedBody = await readArenaCompanionJsonPayload(request);
    if (parsedBody instanceof Response) return parsedBody;
    const parsed = storyProtocol
      ? ArenaStoryCreateRequestSchema.safeParse(parsedBody.payload)
      : SessionRequestSchema.safeParse(parsedBody.payload);
    if (!parsed.success) return jsonResponse({ error: '请求参数无效' }, 400);
    const payload = parsed.data;
    const customProviderResolution = resolveArenaCustomProvider(payload.customProvider);
    if (!customProviderResolution.ok) {
      return jsonResponse({ error: customProviderResolution.error }, customProviderResolution.status);
    }
    const resolvedCustomProvider = customProviderResolution.value;
    const providerMode = resolvedCustomProvider && resolvedCustomProvider.provider.id !== 'system'
      ? 'custom'
      : 'system';
    const validation = validateBattleStoryGenerateNextInput({
      action: payload.action,
      sourceChapterId: payload.sourceChapterId,
      chapterIndex: payload.chapterIndex,
      chapterPlan: payload.chapterPlan,
      recentChapters: 'recentWindow' in payload.chapterContext
        ? payload.chapterContext.recentWindow.map((chapter) => ({ id: chapter.chapterId, index: chapter.chapterIndex }))
        : payload.chapterContext.recentChapters.map((chapter) => ({
          id: chapter.id,
          index: chapter.index,
        })),
    });
    if (!validation.ok) return jsonResponse({ error: validation.error }, 400);
    const chapterIndex = validation.chapterIndex;
    let internalGuidance: string;
    try {
      internalGuidance = buildBattleStoryArenaRequest(payload).internalGuidance;
    } catch {
      return jsonResponse({ error: '连续故事章节输入无效' }, 400);
    }
    const customProviderPayload: ArenaCustomProvider | null = resolvedCustomProvider
      ? {
        providerId: resolvedCustomProvider.providerId,
        modelId: resolvedCustomProvider.modelId,
        apiKey: resolvedCustomProvider.apiKey,
        ...(resolvedCustomProvider.maxOutputTokens !== undefined ? { maxOutputTokens: resolvedCustomProvider.maxOutputTokens } : {}),
        ...(resolvedCustomProvider.generationOverrides ? { generationOverrides: resolvedCustomProvider.generationOverrides } : {}),
      } : null;
    // The incoming wrapper and the expanded Arena JSON are separate 12 MiB carriers.
    // Count the actual shared producer output before any expanded clone/stringify or dispatch.
    const storyUpstreamBody = storyProtocol
      ? buildArenaSessionUpstreamRequestBody(payload, internalGuidance, customProviderPayload) : null;
    let upstreamBodyBytes = parsedBody.bodyBytes;
    if (storyUpstreamBody) {
      try {
        upstreamBodyBytes = countBattleStoryCommitJsonBytes(storyUpstreamBody, ARENA_RESOURCE_BUDGET.hardBodyBytes);
      } catch (error) {
        return jsonResponse({
          code: error instanceof BattleStoryCommitByteLimitError ? 'ARENA_REQUEST_TOO_LARGE' : 'INVALID_REQUEST',
          error: '展开后的连续故事请求超出预算或无效',
        }, error instanceof BattleStoryCommitByteLimitError ? 413 : 400);
      }
    }
    const guidanceSignature = await createArenaInternalGuidanceAuthority(options.signatures)
      .sign(internalGuidance);
    if (!guidanceSignature) {
      return jsonResponse({
        code: 'ARENA_INTERNAL_AUTHORITY_UNAVAILABLE',
        error: 'Arena internal authority unavailable',
      }, 503);
    }
    const rateLimit = options.acquireRateLimit({
      request,
      actionType: payload.action === 'rewrite'
        ? 'battle_story_session_regenerate_chapter'
        : 'battle_story_session_continue',
      sessionId: payload.sessionId,
      providerMode,
    });
    if (!rateLimit.allowed) {
      return jsonResponse({
        error: '请求过于频繁，请稍后再试',
        reason: rateLimit.reason,
      }, 429, { 'Retry-After': String(rateLimit.retryAfterSeconds) });
    }
    let released = false;
    const releaseOnce = (): void => {
      if (released) return;
      released = true;
      rateLimit.release();
    };
    let chapterId: string | undefined;
    let subscription;
    try {
      if (!storyProtocol) chapterId = await (options.deriveChapterId ?? deterministicChapterId)({
        sessionId: payload.sessionId,
        generationRequestId: payload.generationRequestId,
        chapterIndex,
      });
      options.recordActivity?.(request);
      const upstreamBody = storyUpstreamBody ?? buildArenaSessionUpstreamRequestBody(
        payload,
        internalGuidance,
        customProviderPayload,
      );
      const parsedUpstreamPayload = { ...upstreamBody };
      delete parsedUpstreamPayload.generationRequestId;
      subscription = options.generationService.createParsedSubscription
        ? await options.generationService.createParsedSubscription(createUpstreamRequest({
          request,
          body: parsedUpstreamPayload,
          guidanceSignature,
          includeBody: false,
        }), {
          generationRequestId: payload.generationRequestId,
          payload: parsedUpstreamPayload,
          bodyBytes: upstreamBodyBytes,
          ...(storyProtocol ? { trustedStoryIdentity: {
            version: 1 as const, sessionId: payload.sessionId,
            action: payload.action as 'start' | 'continue', chapterIndex,
            sourceChapterId: payload.sourceChapterId ?? null,
          } } : {}),
        })
        : await options.generationService.createSubscription(createUpstreamRequest({
          request,
          body: upstreamBody,
          guidanceSignature,
          includeBody: true,
        }));
    } catch (error) {
      releaseOnce();
      return jsonResponse({
        error: '生成失败',
        message: sanitizePublicErrorMessage(error, {
          fallbackMessage: '生成服务暂时不可用，请稍后重试',
          secrets: [resolvedCustomProvider?.apiKey ?? '', guidanceSignature],
        }),
      }, 500);
    }
    if (subscription instanceof Response) {
      releaseOnce();
      return subscription;
    }
    let reader: ReadableStreamDefaultReader<GenerationStreamEvent>;
    try {
      reader = subscription.events.getReader();
    } catch {
      releaseOnce();
      return jsonResponse({
        code: 'ARENA_SESSION_STREAM_UNAVAILABLE',
        error: 'Arena session stream unavailable',
        generationId: subscription.generationId,
      }, 500, subscription.headers);
    }
    let readerReleased = false;
    const releaseReaderOnce = (): void => {
      if (readerReleased) return;
      readerReleased = true;
      reader.releaseLock();
    };
    const responseHeaders = new Headers({
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'text/event-stream; charset=utf-8',
      ...subscription.headers,
    });
    if (storyProtocol) responseHeaders.set(ARENA_STORY_PROTOCOL_HEADER, ARENA_STORY_PROTOCOL_VERSION);
    const acceptedAt = (options.now?.() ?? new Date()).getTime();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        if (!storyProtocol) controller.enqueue(encodeCompanionEvent('session_meta', {
          sessionId: payload.sessionId,
          chapterId,
          chapterIndex,
          action: payload.action,
          ...(payload.sourceChapterId ? { sourceChapterId: payload.sourceChapterId } : {}),
          providerMode,
          generationId: subscription.generationId,
          generationRequestId: subscription.generationRequestId,
          acceptedAt,
        }));
        let markdown = '';
        let latestMeta: Record<string, unknown> | null = null;
        let terminalOutcome: 'success' | 'failure' | 'cancelled' | null = null;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            const event: GenerationStreamEvent = next.value;
            const data = recordOf(event.data) ?? {};
            if (!storyProtocol && event.type === 'markdown' && typeof data.chunk === 'string') {
              markdown += data.chunk;
            } else if (!storyProtocol && event.type === 'snapshot') {
              if (typeof data.markdown === 'string') markdown = data.markdown;
            } else if (!storyProtocol && event.type === 'meta') {
              latestMeta = recordOf(data.meta) ?? latestMeta;
            } else if (event.type === 'done' && data.ok === true) {
              terminalOutcome = 'success';
              if (!storyProtocol) {
                const digest = buildBattleStoryDeterministicDigest({
                  markdown,
                  reportJson: latestMeta ? { report: latestMeta.report } : undefined,
                  impacts: latestMeta?.impacts,
                  chapterIndex,
                });
                controller.enqueue(encodeCompanionEvent('chapter_digest', {
                  chapterId,
                  sessionId: payload.sessionId,
                  chapterIndex,
                  chapterTitle: digest.chapterTitle,
                  ...(digest.winner ? { winner: digest.winner } : {}),
                  ...(digest.officialConclusion
                    ? { officialConclusion: digest.officialConclusion }
                    : {}),
                  ...(digest.bodyExcerpt ? { bodyExcerpt: digest.bodyExcerpt } : {}),
                  ...(digest.impactDigest ? { impactDigest: digest.impactDigest } : {}),
                }));
              }
            } else if (event.type === 'done') {
              terminalOutcome = data.status === 'cancelled' ? 'cancelled' : 'failure';
            } else if (event.type === 'error') {
              terminalOutcome = 'failure';
            }
            controller.enqueue(storyProtocol
              ? encodeGenerationSseEvent(projectArenaGenerationEventForClient(event))
              : encodeGenerationSseEvent(event));
          }
          observeLifecycleOnce(terminalOutcome ?? 'failure');
          releaseOnce();
          releaseReaderOnce();
          controller.close();
        } catch (error) {
          observeLifecycleOnce('failure');
          releaseOnce();
          releaseReaderOnce();
          controller.error(error);
        }
      },
      async cancel(reason) {
        observeLifecycleOnce('cancelled');
        releaseOnce();
        try {
          await reader.cancel(reason);
        } finally {
          releaseReaderOnce();
        }
      },
    });
    return new Response(body, { status: 200, headers: responseHeaders });
  },
});
