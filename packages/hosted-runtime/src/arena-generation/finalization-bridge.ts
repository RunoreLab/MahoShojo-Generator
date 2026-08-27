import { createArenaInternalAuthHeaders } from './internal-http-auth';
import { buildArenaTerminalEffectIdempotencyKey } from './finalization';
import type { ArenaTerminalEffectInput } from './finalization';

const FINALIZATION_PATH = '/api/internal/arena-generation/finalize';

export type ArenaFinalizationBridge = {
  settleRatings(_input: Pick<
    ArenaTerminalEffectInput,
    'generationId' | 'idempotencyKey'
  >): Promise<void>;
  readRanking(_generationId: string): Promise<unknown | null>;
};

export type ArenaFinalizationBridgeOptions = {
  baseUrl: string;
  secret: string;
  fetch?: typeof globalThis.fetch;
  accessClientId?: string;
  accessClientSecret?: string;
  timeoutMs?: number;
};

const parseBaseUrl = (value: string): URL => {
  const base = new URL(value);
  if (
    (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
    || base.username
    || base.password
    || base.search
    || base.hash
  ) throw new Error('ARENA_FINALIZATION_URL_INVALID');
  return base;
};

export const createArenaFinalizationBridge = (
  options: ArenaFinalizationBridgeOptions,
): ArenaFinalizationBridge => {
  if (options.secret.trim().length < 32) throw new Error('ARENA_FINALIZATION_SECRET_INVALID');
  const endpoint = new URL(FINALIZATION_PATH, parseBaseUrl(options.baseUrl));
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const rankings = new Map<string, unknown | null>();

  const finalize = async (input: Pick<
    ArenaTerminalEffectInput,
    'generationId' | 'idempotencyKey'
  >): Promise<unknown | null> => {
    const { generationId, idempotencyKey } = input;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(generationId)) {
      throw new Error('ARENA_GENERATION_ID_INVALID');
    }
    if (idempotencyKey !== buildArenaTerminalEffectIdempotencyKey(generationId, 'ratings')) {
      throw new Error('ARENA_FINALIZATION_IDEMPOTENCY_KEY_INVALID');
    }
    const body = JSON.stringify({ version: 1, generationId, idempotencyKey });
    const authHeaders = await createArenaInternalAuthHeaders({
      secret: options.secret,
      method: 'POST',
      pathname: FINALIZATION_PATH,
      body,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    timer.unref?.();
    try {
      const headers = new Headers({
        ...authHeaders,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      });
      if (options.accessClientId?.trim() && options.accessClientSecret?.trim()) {
        headers.set('CF-Access-Client-Id', options.accessClientId.trim());
        headers.set('CF-Access-Client-Secret', options.accessClientSecret.trim());
      }
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`ARENA_FINALIZATION_HTTP_${response.status}`);
      const payload = await response.json() as { success?: unknown; ranking?: unknown };
      if (payload.success !== true) throw new Error('ARENA_FINALIZATION_RESPONSE_INVALID');
      const ranking = payload.ranking ?? null;
      rankings.set(generationId, ranking);
      return ranking;
    } finally {
      clearTimeout(timer);
    }
  };

  return Object.freeze({
    async settleRatings(input) {
      await finalize(input);
    },
    async readRanking(generationId) {
      if (rankings.has(generationId)) {
        const ranking = rankings.get(generationId) ?? null;
        rankings.delete(generationId);
        return ranking;
      }
      return finalize({
        generationId,
        idempotencyKey: buildArenaTerminalEffectIdempotencyKey(generationId, 'ratings'),
      });
    },
  });
};
