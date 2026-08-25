import type { SignatureService } from '../signature';

export const ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER =
  'x-mahoshojo-arena-internal-guidance-signature';

const buildSignedValue = (guidance: string): Record<string, unknown> => ({
  kind: 'arena-internal-guidance-v1',
  guidance,
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
