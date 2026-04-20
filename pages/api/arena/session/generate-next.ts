import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { buildBattleStoryPromptContext } from '@/lib/ai-session/battle-story/context';
import { buildBattleStoryDeterministicDigest } from '@/lib/ai-session/battle-story/digest';
import { validateBattleStoryGenerateNextInput } from '@/lib/ai-session/battle-story/generate-next';
import { buildBattleStoryInternalGuidance } from '@/lib/ai-session/battle-story/prompts';
import { SCENARIO_BATTLE_STORY_MAX_TOTAL_CHAPTERS } from '@/lib/scenario-battle-story';
import {
  resolveAiSessionProvider,
  parseAiSessionCustomProvider,
  type AiSessionCustomProvider,
} from '@/lib/ai-session/provider';
import { acquireAiSessionSoftRateLimit } from '@/lib/ai-session/rate-limit';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';
import { randomUUID } from '@/lib/crypto';
import { getLogger } from '@/lib/logger';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

export const config = {
  runtime: 'edge',
};

const log = getLogger('api-arena-session-generate-next');

const json = (payload: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

const BattleStoryRequestSchema = z.object({
  sessionId: z.string().min(1),
  action: z.enum(['start', 'continue', 'branch', 'rewrite']),
  sourceChapterId: z.string().min(1).optional(),
  chapterIndex: z.number().int().positive().optional(),
  chapterPlan: z.object({
    totalChapters: z.number().int().min(1).max(SCENARIO_BATTLE_STORY_MAX_TOTAL_CHAPTERS),
  }).optional(),
  chapterContext: z.object({
    sessionSummary: z.string().optional(),
    recentChapters: z
      .array(
        z.object({
          id: z.string().min(1),
          index: z.number().int().positive(),
          title: z.string().optional(),
          markdown: z.string(),
          deterministicDigest: z
            .object({
              chapterTitle: z.string(),
              winner: z.string().optional(),
              officialConclusion: z.string().optional(),
              bodyExcerpt: z.string().optional(),
              impactDigest: z
                .array(
                  z.object({
                    characterName: z.string(),
                    impact: z.string().optional(),
                    currentStateSummary: z.string().optional(),
                  })
                )
                .optional(),
            })
            .optional(),
        })
      )
      .max(12),
    workingCombatants: z.array(z.unknown()).min(1),
  }),
  seed: z.object({
    combatants: z.array(z.unknown()).min(1),
    scenario: z.record(z.unknown()).nullable().optional(),
    auxScenarios: z.array(z.record(z.unknown())).max(10).optional(),
    adjudicationEvents: z.array(z.unknown()).optional(),
    questionnaires: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          kind: z.enum(['magical-girl', 'canshou']),
          useLore: z.boolean().optional(),
          loreMarkdown: z.string().optional(),
        })
      )
      .max(20)
      .optional(),
    mode: z.enum(['classic', 'kizuna', 'daily', 'scenario']),
    storyLength: z.enum(['default', 'short', 'standard', 'detailed', 'long']).default('standard'),
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

const extractGenerationMeta = (response: Response): { generationId?: string } => {
  const raw = response.headers.get('x-mahoshojo-stream-meta');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    const generationId = typeof parsed?.generationId === 'string' ? parsed.generationId.trim() : '';
    return generationId ? { generationId } : {};
  } catch {
    return {};
  }
};

const parseSseBlock = (block: string): { event: string; data: string } | null => {
  const lines = block.split('\n');
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
};

const encodeSseEvent = (encoder: TextEncoder, event: string, payload: unknown): Uint8Array => {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload ?? null)}\n\n`);
};

const resolveOptionalReadLimit = (input: {
  enabled: boolean;
  limit?: number;
  unlimited?: boolean;
  fallback: number;
}): number | null | undefined => {
  if (!input.enabled) return undefined;
  if (input.unlimited === true) return null;
  if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
    return Math.max(1, Math.floor(input.limit));
  }
  return input.fallback;
};

export const buildUpstreamRequestBody = (
  payload: z.infer<typeof BattleStoryRequestSchema>,
  internalGuidance: string,
  customProvider: AiSessionCustomProvider | null
): Record<string, unknown> => {
  const arenaHistoryReadLimit = resolveOptionalReadLimit({
    enabled: payload.seed.settings.readArenaHistory,
    limit: payload.seed.settings.readArenaHistoryLimit,
    unlimited: payload.seed.settings.isArenaHistoryUnlimited,
    fallback: 3,
  });
  const narrativeHistoryReadLimit = resolveOptionalReadLimit({
    enabled: payload.seed.settings.readNarrativeHistory,
    limit: payload.seed.settings.readNarrativeHistoryLimit,
    unlimited: payload.seed.settings.isNarrativeHistoryUnlimited,
    fallback: 10,
  });
  const requestBody: Record<string, unknown> = {
    combatants: payload.chapterContext.workingCombatants,
    mode: payload.seed.mode,
    userGuidance: payload.userGuidance,
    internalGuidance,
    scenario: payload.seed.scenario ?? undefined,
    auxScenarios: payload.seed.auxScenarios,
    adjudicationEvents: payload.seed.adjudicationEvents,
    language: payload.seed.language,
    readArenaHistory: payload.seed.settings.readArenaHistory,
    arenaHistoryReadLimit,
    writeArenaHistory: payload.seed.settings.writeArenaHistory,
    readCurrentState: payload.seed.settings.readCurrentState,
    writeCurrentState: payload.seed.settings.writeCurrentState,
    readNarrativeHistory: payload.seed.settings.readNarrativeHistory,
    narrativeHistoryReadLimit,
    writeNarrativeHistory: payload.seed.settings.writeNarrativeHistory,
    storyLength: payload.seed.storyLength,
    questionnaires: payload.seed.questionnaires,
    forceStreamMeta: true,
    ...(customProvider ? { customProvider } : {}),
  };

  return requestBody;
};

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = BattleStoryRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: '请求参数无效' }, { status: 400 });
  }

  const customProviderParsed = parseAiSessionCustomProvider(parsed.data.customProvider);
  if (!customProviderParsed.ok) {
    return json({ error: customProviderParsed.error }, { status: 400 });
  }

  const providerResolved = resolveAiSessionProvider(customProviderParsed.value);
  if (!providerResolved.ok) {
    return json({ error: providerResolved.error }, { status: providerResolved.status });
  }

  const payload = parsed.data;
  const validation = validateBattleStoryGenerateNextInput({
    action: payload.action,
    sourceChapterId: payload.sourceChapterId,
    chapterIndex: payload.chapterIndex,
    chapterPlan: payload.chapterPlan,
    recentChapters: payload.chapterContext.recentChapters.map((chapter) => ({
      id: chapter.id,
      index: chapter.index,
    })),
  });
  if (!validation.ok) {
    return json({ error: validation.error }, { status: 400 });
  }

  const chapterIndex = validation.chapterIndex;
  const promptContext = buildBattleStoryPromptContext({
    source: {
      mode: payload.seed.mode,
      language: payload.seed.language,
      storyLength: payload.seed.storyLength,
      generationMode: 'stream',
      providerMode: providerResolved.value.providerMode,
      providerId: providerResolved.value.providerId,
      ...(providerResolved.value.modelId ? { modelId: providerResolved.value.modelId } : {}),
    },
    seed: {
      combatants: payload.seed.combatants,
      scenario: payload.seed.scenario ?? null,
      auxScenarios: payload.seed.auxScenarios ?? [],
      questionnaires: payload.seed.questionnaires ?? [],
      settings: payload.seed.settings,
    },
    chapterPlan: payload.chapterPlan,
    chapterIndex,
    workingCombatants: payload.chapterContext.workingCombatants,
    sessionSummary: payload.chapterContext.sessionSummary,
    recentChapters: payload.chapterContext.recentChapters,
    userGuidance: payload.userGuidance,
  });

  const internalGuidance = buildBattleStoryInternalGuidance({
    action: payload.action,
    chapterIndex,
    sourceChapterId: payload.sourceChapterId,
    chapterPlan: payload.chapterPlan,
    context: promptContext,
  });

  const rateLimit = acquireAiSessionSoftRateLimit({
    req,
    actionType: payload.action === 'rewrite' ? 'battle_story_session_regenerate_chapter' : 'battle_story_session_continue',
    sessionId: payload.sessionId,
    providerMode: providerResolved.value.providerMode,
  });

  if (!rateLimit.allowed) {
    return json(
      {
        error: '请求过于频繁，请稍后再试',
        reason: rateLimit.reason,
      },
      {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  const chapterId = randomUUID();
  recordUserActivityFromRequest(req);

  try {
    const upstreamUrl = new URL('/api/arena/generate-stream?format=sse', req.url);
    const upstreamHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...buildSubrequestAuthHeaders(req),
    };

    const authorization = req.headers.get('authorization');
    if (authorization) {
      upstreamHeaders.Authorization = authorization;
    }

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(buildUpstreamRequestBody(payload, internalGuidance, customProviderParsed.value)),
      signal: req.signal,
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const text = await upstreamResponse.text();
      rateLimit.release();
      return new Response(text, {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json',
          'Cache-Control': upstreamResponse.headers.get('cache-control') || 'no-store',
          ...(upstreamResponse.headers.get('retry-after')
            ? { 'Retry-After': upstreamResponse.headers.get('retry-after') as string }
            : {}),
        },
      });
    }

    if (!(upstreamResponse.headers.get('content-type') || '').includes('text/event-stream')) {
      const text = await upstreamResponse.text();
      rateLimit.release();
      return new Response(text, {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': upstreamResponse.headers.get('content-type') || 'text/plain; charset=utf-8',
          'Cache-Control': upstreamResponse.headers.get('cache-control') || 'no-store',
        },
      });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const upstreamReader = upstreamResponse.body.getReader();
    const generationMeta = extractGenerationMeta(upstreamResponse);

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', 'text/event-stream; charset=utf-8');
    responseHeaders.set('Cache-Control', 'no-cache, no-transform');
    const upstreamMetaHeader = upstreamResponse.headers.get('x-mahoshojo-stream-meta');
    if (upstreamMetaHeader) {
      responseHeaders.set('x-mahoshojo-stream-meta', upstreamMetaHeader);
    }

    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      rateLimit.release();
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          encodeSseEvent(encoder, 'session_meta', {
            sessionId: payload.sessionId,
            chapterId,
            chapterIndex,
            action: payload.action,
            ...(payload.sourceChapterId ? { sourceChapterId: payload.sourceChapterId } : {}),
            providerMode: providerResolved.value.providerMode,
            ...(generationMeta.generationId ? { generationId: generationMeta.generationId } : {}),
            acceptedAt: Date.now(),
          })
        );

        let sseBuffer = '';
        let accumulatedMarkdown = '';
        let latestMeta: Record<string, unknown> | null = null;

        const flushParsedBlock = (block: string) => {
          if (!block.trim()) return;
          const parsedBlock = parseSseBlock(block);
          if (!parsedBlock) {
            controller.enqueue(encoder.encode(`${block}\n\n`));
            return;
          }

          let payloadJson: any = null;
          try {
            payloadJson = parsedBlock.data ? JSON.parse(parsedBlock.data) : null;
          } catch {
            payloadJson = null;
          }

          if (parsedBlock.event === 'markdown') {
            const chunk = typeof payloadJson?.chunk === 'string' ? payloadJson.chunk : '';
            if (chunk) {
              accumulatedMarkdown += chunk;
            }
          } else if (parsedBlock.event === 'meta' && payloadJson?.meta && typeof payloadJson.meta === 'object') {
            latestMeta = payloadJson.meta as Record<string, unknown>;
          } else if (parsedBlock.event === 'done' && payloadJson?.ok === true) {
            const digest = buildBattleStoryDeterministicDigest({
              markdown: accumulatedMarkdown,
              reportJson: latestMeta ? { report: latestMeta.report } : undefined,
              impacts: latestMeta?.impacts,
              chapterIndex,
            });

            controller.enqueue(
              encodeSseEvent(encoder, 'chapter_digest', {
                chapterId,
                sessionId: payload.sessionId,
                chapterIndex,
                chapterTitle: digest.chapterTitle,
                ...(digest.winner ? { winner: digest.winner } : {}),
                ...(digest.officialConclusion ? { officialConclusion: digest.officialConclusion } : {}),
                ...(digest.bodyExcerpt ? { bodyExcerpt: digest.bodyExcerpt } : {}),
                ...(digest.impactDigest ? { impactDigest: digest.impactDigest } : {}),
              })
            );
          }

          controller.enqueue(encodeSseEvent(encoder, parsedBlock.event, payloadJson ?? parsedBlock.data));
        };

        try {
          while (true) {
            const { value, done } = await upstreamReader.read();
            if (done) {
              if (sseBuffer.trim()) {
                flushParsedBlock(sseBuffer);
              }
              break;
            }

            sseBuffer += decoder.decode(value, { stream: true });
            let delimiterIndex = sseBuffer.indexOf('\n\n');
            while (delimiterIndex >= 0) {
              const block = sseBuffer.slice(0, delimiterIndex);
              sseBuffer = sseBuffer.slice(delimiterIndex + 2);
              flushParsedBlock(block);
              delimiterIndex = sseBuffer.indexOf('\n\n');
            }
          }

          releaseOnce();
          controller.close();
        } catch (error) {
          releaseOnce();
          controller.error(error);
          log.error('battle story generate-next proxy 失败', { error });
        }
      },
      async cancel() {
        releaseOnce();
        try {
          await upstreamReader.cancel();
        } catch {
          // ignore
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    rateLimit.release();
    log.error('battle story generate-next 失败', { error });
    const message = error instanceof Error ? error.message : '未知错误';
    return json({ error: '生成失败', message }, { status: 500 });
  }
}
