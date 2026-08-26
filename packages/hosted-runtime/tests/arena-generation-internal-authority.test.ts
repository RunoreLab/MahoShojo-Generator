import { describe, expect, it } from 'vitest';

import {
  ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER,
  ARENA_PVP_GENERATION_SIGNATURE_HEADER,
  ARENA_PVP_GENERATION_SIGNATURE_PURPOSE,
  createArenaInternalGuidanceAuthority,
  createArenaPvpGenerationAuthority,
} from '../src/arena-generation/internal-authority';
import { createEnvSignatureService } from '../src/node-runtime/env-signature';
import { createSignatureService } from '../src/signature';

const createService = async () => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('test-only-secret-key'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return createSignatureService({ getSigningKey: async () => key });
};

describe('Arena internal guidance authority', () => {
  it('only accepts a server signature bound to the exact guidance', async () => {
    const authority = createArenaInternalGuidanceAuthority(await createService());
    const signature = await authority.sign('ranked server rule');
    const request = new Request('https://example.test/api/arena/generate-stream', {
      headers: { [ARENA_INTERNAL_GUIDANCE_SIGNATURE_HEADER]: signature! },
    });

    await expect(authority.resolve({
      request,
      payload: { internalGuidance: 'ranked server rule' },
    })).resolves.toBe('ranked server rule');
    await expect(authority.resolve({
      request,
      payload: { internalGuidance: 'tampered rule' },
    })).resolves.toBeNull();
  });

  it('binds trusted PVP authority to request identity, context and guidance', async () => {
    const authority = createArenaPvpGenerationAuthority(await createService());
    const input = {
      generationRequestId: 'pvp_request_1234',
      payload: {
        internalGuidance: 'ranked server rule',
        pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
        combatants: [{ name: 'A', _privateRevision: 'v1' }, { name: 'B' }],
      },
    };
    const signature = await authority.sign(input);
    const request = new Request('https://example.test/api/generate-battle-story', {
      headers: { [ARENA_PVP_GENERATION_SIGNATURE_HEADER]: signature! },
    });

    await expect(authority.resolve({ request, ...input })).resolves.toEqual(input.payload.pvpContext);
    await expect(authority.resolve({
      request,
      ...input,
      generationRequestId: 'pvp_request_changed',
    })).resolves.toBeNull();
    await expect(authority.resolve({
      request,
      ...input,
      payload: { ...input.payload, combatants: [{ name: 'tampered' }] },
    })).resolves.toBeNull();
    await expect(authority.resolve({
      request,
      ...input,
      payload: {
        ...input.payload,
        combatants: [{ name: 'A', _privateRevision: 'tampered' }, { name: 'B' }],
      },
    })).resolves.toBeNull();
    await expect(authority.resolve({
      request,
      ...input,
      payload: {
        ...input.payload,
        combatants: [
          { name: 'A', _privateRevision: 'v1', _injected: 'must-not-be-ignored' },
          { name: 'B' },
        ],
      },
    })).resolves.toBeNull();

    const plainInput = {
      generationRequestId: 'pvp_request_plain',
      payload: {
        internalGuidance: 'ranked server rule',
        pvpContext: input.payload.pvpContext,
        combatants: [{ name: 'A' }],
      },
    };
    const plainSignature = await authority.sign(plainInput);
    const plainRequest = new Request('https://example.test/api/generate-battle-story', {
      headers: { [ARENA_PVP_GENERATION_SIGNATURE_HEADER]: plainSignature! },
    });
    await expect(authority.resolve({
      request: plainRequest,
      ...plainInput,
      payload: {
        ...plainInput.payload,
        combatants: [{ name: 'A', _injected: 'must-not-be-ignored' }],
      },
    })).resolves.toBeNull();
  });

  it('rejects signatures minted by the generic public signing domain', async () => {
    const env = { SIGNATURE_SECRET_KEY: 'test-only-domain-separation-secret' };
    const genericSignatures = createEnvSignatureService({ env });
    const pvpSignatures = createEnvSignatureService({
      env,
      purpose: ARENA_PVP_GENERATION_SIGNATURE_PURPOSE,
    });
    const authority = createArenaPvpGenerationAuthority(pvpSignatures);
    const input = {
      generationRequestId: 'pvp_request_domain',
      payload: {
        internalGuidance: 'server rule',
        pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
        combatants: [{ name: 'A' }, { name: 'B' }],
      },
    };
    const envelope = {
      kind: 'arena-pvp-generation-v2',
      generationRequestId: input.generationRequestId,
      payload: input.payload,
    };
    const genericSignature = await genericSignatures.generateSignature(
      envelope,
      { sanitizeIgnoredKeys: false },
    );
    const genericRequest = new Request('https://example.test', {
      headers: { [ARENA_PVP_GENERATION_SIGNATURE_HEADER]: genericSignature! },
    });

    await expect(authority.resolve({ request: genericRequest, ...input })).resolves.toBeNull();

    const pvpSignature = await authority.sign(input);
    const pvpRequest = new Request('https://example.test', {
      headers: { [ARENA_PVP_GENERATION_SIGNATURE_HEADER]: pvpSignature! },
    });
    await expect(authority.resolve({ request: pvpRequest, ...input }))
      .resolves.toEqual(input.payload.pvpContext);
  });
});
