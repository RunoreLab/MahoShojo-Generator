import { ARENA_GENERATION_TERMINAL_STATUS_HEADER } from '@mahoshojo/hosted-api/arena-generation/service';
import {
  ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER,
  ARENA_PVP_GENERATION_SIGNATURE_HEADER,
  ARENA_PVP_GENERATION_SIGNATURE_PURPOSE,
  createArenaInternalGuidanceAuthority,
  createArenaPvpGenerationAuthority,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { createEnvSignatureService } from '@mahoshojo/hosted-runtime/node-runtime/env-signature';

const internalGuidanceAuthority = createArenaInternalGuidanceAuthority(
  createEnvSignatureService(),
);
const pvpGenerationAuthority = createArenaPvpGenerationAuthority(
  createEnvSignatureService({ purpose: ARENA_PVP_GENERATION_SIGNATURE_PURPOSE }),
);

const GENERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const PVP_GENERATION_TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'producer_lost',
]);

const normalizeGenerationId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return GENERATION_ID_PATTERN.test(normalized) ? normalized : null;
};

export const readDurablePvpTerminalGenerationId = (
  response: Pick<Response, 'headers'>,
  body: unknown,
): string | null => {
  const status = response.headers
    .get(ARENA_GENERATION_TERMINAL_STATUS_HEADER)
    ?.trim() ?? '';
  if (!PVP_GENERATION_TERMINAL_STATUSES.has(status)) return null;
  const headerGenerationId = normalizeGenerationId(
    response.headers.get('X-Mahoshojo-Generation-Id'),
  );
  if (headerGenerationId) return headerGenerationId;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return normalizeGenerationId((body as { generationId?: unknown }).generationId);
};

export const assertCompletedPvpGenerationSseDone = (payload: unknown): void => {
  const value = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as { ok?: unknown; status?: unknown; error?: unknown }
    : null;
  if (value?.ok === true && value.status === 'completed') return;
  const message = typeof value?.error === 'string' && value.error.trim()
    ? value.error.trim()
    : typeof value?.status === 'string' && value.status.trim()
      ? `上游流式生成未成功完成：${value.status.trim()}`
      : '上游流式生成未返回成功终态';
  throw new Error(message);
};

export const readDurablePvpGenerationId = (
  response: Pick<Response, 'headers' | 'ok'>,
  body: unknown,
): string | null => {
  if (!response.ok) return readDurablePvpTerminalGenerationId(response, body);
  const headerGenerationId = normalizeGenerationId(
    response.headers.get('X-Mahoshojo-Generation-Id'),
  );
  if (headerGenerationId) return headerGenerationId;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return normalizeGenerationId((body as { generationId?: unknown }).generationId);
};

const deriveGenerationRequestId = async (input: {
  roomId: string;
  matchId: string;
  roundId: string;
  attempt: number;
}): Promise<string> => {
  const bytes = new TextEncoder().encode([
    'pvp-arena-generation-v1',
    input.roomId,
    input.matchId,
    input.roundId,
    String(Math.max(0, Math.floor(input.attempt))),
  ].join('\u0000'));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `pvp_${Array.from(
    digest,
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')}`;
};

export const createPvpArenaGenerationAuthority = async (input: {
  roomId: string;
  matchId: string;
  roundId: string;
  attempt: number;
  internalGuidance: string;
  payload: Readonly<Record<string, unknown>>;
}): Promise<{
  generationRequestId: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
}> => {
  const generationRequestId = await deriveGenerationRequestId(input);
  const pvpContext = {
    roomId: input.roomId,
    matchId: input.matchId,
    roundId: input.roundId,
  };
  const payload = {
    ...input.payload,
    internalGuidance: input.internalGuidance,
    pvpContext,
  };
  const guidanceSignature = await internalGuidanceAuthority.sign(input.internalGuidance);
  const pvpSignature = await pvpGenerationAuthority.sign({
    generationRequestId,
    payload,
  });
  if (!guidanceSignature || !pvpSignature) {
    throw new Error('PVP_ARENA_INTERNAL_AUTHORITY_UNAVAILABLE');
  }
  return {
    generationRequestId,
    payload,
    headers: {
      [ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER]: guidanceSignature,
      [ARENA_PVP_GENERATION_SIGNATURE_HEADER]: pvpSignature,
    },
  };
};
