import {
  ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER,
  createArenaInternalGuidanceAuthority,
} from '@mahoshojo/hosted-runtime/arena-generation';
import { createEnvSignatureService } from '@mahoshojo/hosted-runtime/node-runtime/env-signature';

const internalGuidanceAuthority = createArenaInternalGuidanceAuthority(
  createEnvSignatureService(),
);

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
}): Promise<{
  generationRequestId: string;
  headers: Record<string, string>;
}> => {
  const guidanceSignature = await internalGuidanceAuthority.sign(input.internalGuidance);
  if (!guidanceSignature) throw new Error('PVP_ARENA_INTERNAL_AUTHORITY_UNAVAILABLE');
  return {
    generationRequestId: await deriveGenerationRequestId(input),
    headers: {
      [ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER]: guidanceSignature,
    },
  };
};
