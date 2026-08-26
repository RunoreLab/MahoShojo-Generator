import type { SignatureService } from '../signature';
import type { ArenaTrustedPvpContext } from '@mahoshojo/hosted-api/arena-generation/service';

export const ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER =
  'x-mahoshojo-arena-internal-guidance-signature';
export const ARENA_PVP_GENERATION_SIGNATURE_HEADER =
  'x-mahoshojo-arena-pvp-generation-signature';
export const ARENA_PVP_GENERATION_SIGNATURE_PURPOSE =
  'arena-pvp-generation-v2';

const buildSignedValue = (guidance: string): Record<string, unknown> => ({
  kind: 'arena-internal-guidance-v1',
  guidance,
});

const normalizePvpContext = (value: unknown): ArenaTrustedPvpContext | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const values = ['roomId', 'matchId', 'roundId'].map((key) => (
    typeof record[key] === 'string' ? record[key].trim() : ''
  ));
  if (values.some((entry) => !entry || entry.length > 128)) return null;
  return { roomId: values[0]!, matchId: values[1]!, roundId: values[2]! };
};

const buildPvpSignedValue = (input: {
  generationRequestId: string;
  payload: Readonly<Record<string, unknown>>;
}): Record<string, unknown> => ({
  kind: 'arena-pvp-generation-v2',
  generationRequestId: input.generationRequestId,
  payload: input.payload,
});

export const createArenaInternalGuidanceAuthority = (
  signatures: SignatureService,
) => Object.freeze({
  async sign(guidance: string): Promise<string | null> {
    const normalized = guidance.trim();
    if (!normalized) return null;
    return signatures.generateSignature(buildSignedValue(normalized));
  },

  async resolve(input: {
    request: Request;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<string | null> {
    const guidance = typeof input.payload.internalGuidance === 'string'
      ? input.payload.internalGuidance.trim()
      : '';
    const signature = input.request.headers
      .get(ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER)
      ?.trim() ?? '';
    if (!guidance || !signature) return null;
    const valid = await signatures.verifySignature({
      ...buildSignedValue(guidance),
      signature,
    });
    return valid ? guidance : null;
  },
});

export const createArenaPvpGenerationAuthority = (
  signatures: SignatureService,
) => Object.freeze({
  async sign(input: {
    generationRequestId: string;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<string | null> {
    const generationRequestId = typeof input.generationRequestId === 'string'
      ? input.generationRequestId.trim()
      : '';
    const internalGuidance = typeof input.payload.internalGuidance === 'string'
      ? input.payload.internalGuidance.trim()
      : '';
    const pvpContext = normalizePvpContext(input.payload.pvpContext);
    if (!generationRequestId || !internalGuidance || !pvpContext) return null;
    return signatures.generateSignature(buildPvpSignedValue({
      generationRequestId,
      payload: input.payload,
    }), { sanitizeIgnoredKeys: false });
  },

  async resolve(input: {
    request: Request;
    generationRequestId: string;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<ArenaTrustedPvpContext | null> {
    const generationRequestId = typeof input.generationRequestId === 'string'
      ? input.generationRequestId.trim()
      : '';
    const internalGuidance = typeof input.payload.internalGuidance === 'string'
      ? input.payload.internalGuidance.trim()
      : '';
    const pvpContext = normalizePvpContext(input.payload.pvpContext);
    const signature = input.request.headers
      .get(ARENA_PVP_GENERATION_SIGNATURE_HEADER)
      ?.trim() ?? '';
    if (!generationRequestId || !internalGuidance || !pvpContext || !signature) return null;
    const valid = await signatures.verifySignature({
      ...buildPvpSignedValue({ generationRequestId, payload: input.payload }),
      signature,
    }, { acceptSanitizedPayload: false });
    return valid ? pvpContext : null;
  },
});
