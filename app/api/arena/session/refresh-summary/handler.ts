import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { buildBattleStorySummaryFallback, buildBattleStorySummaryPrompt } from '@/lib/ai-session/battle-story/prompts';
import { resolveAiSessionProvider, parseAiSessionCustomProvider } from '@/lib/ai-session/provider';
import { acquireAiSessionSoftRateLimit } from '@/lib/ai-session/rate-limit';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';
import { getLogger } from '@/lib/logger';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-arena-session-refresh-summary');

const json = (payload: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

const DigestSchema = z.object({
  chapterId: z.string().min(1),
  index: z.number().int().positive(),
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
});

const RequestSchema = z.object({
  sessionId: z.string().min(1),
  previousSummary: z.string().optional(),
  language: z.string().default('zh-CN'),
  digests: z.array(DigestSchema).min(1).max(12),
  customProvider: z.unknown().optional(),
});

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(rawBody);
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

  const rateLimit = acquireAiSessionSoftRateLimit({
    req,
    actionType: 'battle_story_session_refresh_summary',
    sessionId: parsed.data.sessionId,
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

  recordUserActivityFromRequest(req);

  const fallbackSummary = buildBattleStorySummaryFallback({
    previousSummary: parsed.data.previousSummary,
    digests: parsed.data.digests,
  });

  try {
    const prompt = buildBattleStorySummaryPrompt({
      previousSummary: parsed.data.previousSummary,
      digests: parsed.data.digests,
      language: parsed.data.language,
    });

    const providerOptions: GenerateWithAIOptions =
      providerResolved.value.providerOptions ??
      ({
        loadBalanceStrategy: LoadBalanceStrategy.RANDOM,
      } satisfies GenerateWithAIOptions);

    const streamResult = await generateWithStreamAI(
      {
        prompt,
        temperature: 0.3,
      },
      providerOptions
    );

    const summary = (await streamResult.response.text()).trim();
    rateLimit.release();

    return json({
      summary: summary || fallbackSummary,
      coveredChapterIds: parsed.data.digests.map((item) => item.chapterId),
      fallback: !summary,
    });
  } catch (error) {
    rateLimit.release();
    log.error('battle story refresh-summary 失败，已回退 deterministic summary', { error });
    return json({
      summary: fallbackSummary,
      coveredChapterIds: parsed.data.digests.map((item) => item.chapterId),
      fallback: true,
    });
  }
}

export const appRouteHandler = handler;
export default appRouteHandler;
