import { getCloudflareContext } from '@opennextjs/cloudflare';

type RateLimiter = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};

export type GenerationRankingRateLimitBindings = {
  ARENA_RANKING_ACTOR_LIMITER?: RateLimiter;
  ARENA_RANKING_IP_GENERATION_LIMITER?: RateLimiter;
  ARENA_RANKING_IP_LIMITER?: RateLimiter;
};

export type GenerationRankingRateLimitResult = {
  allowed: boolean;
  limitedBy: 'actor-generation' | 'ip-generation' | 'ip-global' | null;
  bindingAvailable: boolean;
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const getClientIp = (req: Request): string =>
  req.headers.get('cf-connecting-ip')?.trim()
  || req.headers.get('x-real-ip')?.trim()
  || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  || 'unknown';

const getActorIdentity = (req: Request, ip: string): string => {
  const authorization = req.headers.get('authorization')?.trim();
  if (authorization) return `authorization:${authorization}`;
  const cookie = req.headers.get('cookie')?.trim();
  if (cookie) return `cookie:${cookie}`;
  return `ip:${ip}`;
};

export const getGenerationRankingRateLimitBindings = (): GenerationRankingRateLimitBindings | null => {
  try {
    const { env } = getCloudflareContext();
    return env as GenerationRankingRateLimitBindings;
  } catch {
    return null;
  }
};

export const enforceGenerationRankingRateLimit = async ({
  req,
  generationId,
  bindings,
}: {
  req: Request;
  generationId: string;
  bindings: GenerationRankingRateLimitBindings | null;
}): Promise<GenerationRankingRateLimitResult> => {
  const actorLimiter = bindings?.ARENA_RANKING_ACTOR_LIMITER;
  const ipGenerationLimiter = bindings?.ARENA_RANKING_IP_GENERATION_LIMITER;
  const ipLimiter = bindings?.ARENA_RANKING_IP_LIMITER;
  if (!actorLimiter || !ipGenerationLimiter || !ipLimiter) {
    return { allowed: true, limitedBy: null, bindingAvailable: false };
  }

  const ip = getClientIp(req);
  const [actorHash, generationIdHash, ipHash] = await Promise.all([
    sha256(getActorIdentity(req, ip)),
    sha256(generationId),
    sha256(ip),
  ]);
  const [actorResult, ipGenerationResult, ipResult] = await Promise.all([
    actorLimiter.limit({ key: `${actorHash}:${generationIdHash}` }),
    ipGenerationLimiter.limit({ key: `${ipHash}:${generationIdHash}` }),
    ipLimiter.limit({ key: ipHash }),
  ]);

  if (!actorResult.success) return { allowed: false, limitedBy: 'actor-generation', bindingAvailable: true };
  if (!ipGenerationResult.success) return { allowed: false, limitedBy: 'ip-generation', bindingAvailable: true };
  if (!ipResult.success) return { allowed: false, limitedBy: 'ip-global', bindingAvailable: true };
  return { allowed: true, limitedBy: null, bindingAvailable: true };
};

export const buildGenerationRankingRateLimitResponse = (
  result: GenerationRankingRateLimitResult,
): Response | null => {
  if (result.allowed) return null;
  return new Response(JSON.stringify({ success: false, error: '请求过于频繁，请稍后重试' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Retry-After': '10',
    },
  });
};
