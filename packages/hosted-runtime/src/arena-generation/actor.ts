import {
  MAX_ARENA_CREATE_BODY_BYTES,
  type ArenaGenerationActor,
} from '@mahoshojo/hosted-api/arena-generation/service';
import type { NodeDataD1Client } from '../node-runtime/data-ports';
import { createAuthenticatedUserIdResolver } from '../node-runtime/authenticated-user';
import type { SignatureService } from '../signature';
import {
  ARENA_PVP_GENERATION_SIGNATURE_HEADER,
  createArenaPvpGenerationAuthority,
} from './internal-authority';

export const ARENA_ANONYMOUS_TOKEN_HEADER = 'X-Mahoshojo-Generation-Actor-Token';

type ArenaAnonymousTokenPayload = {
  v: 1;
  anonymousId: string;
  issuedAt: string;
  expiresAt: string;
};

type ArenaAnonymousToken = ArenaAnonymousTokenPayload & { signature: string };

export type ArenaGenerationActorResolverOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  signatures: SignatureService;
  pvpSignatures?: SignatureService;
  getD1Client(): NodeDataD1Client | null;
  createAnonymousId?: () => string;
  now?: () => Date;
};

type ArenaActorResolver = (_request: Request) => Promise<ArenaGenerationActor | null>;

const encodeToken = (token: ArenaAnonymousToken): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(token));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
};

const decodeBase64Url = (value: string): string => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('INVALID_BASE64URL');
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
};

const decodeToken = (value: string): ArenaAnonymousToken | null => {
  try {
    const parsed = JSON.parse(decodeBase64Url(value)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const token = parsed as Partial<ArenaAnonymousToken>;
    if (
      token.v !== 1
      || typeof token.anonymousId !== 'string'
      || !/^[A-Za-z0-9._:-]{8,128}$/u.test(token.anonymousId)
      || typeof token.issuedAt !== 'string'
      || !Number.isFinite(Date.parse(token.issuedAt))
      || typeof token.expiresAt !== 'string'
      || !Number.isFinite(Date.parse(token.expiresAt))
      || typeof token.signature !== 'string'
      || !token.signature
    ) return null;
    return token as ArenaAnonymousToken;
  } catch {
    return null;
  }
};

const readBootstrapAnonymousId = (value: string): string | null => {
  const match = value.match(
    /^bootstrap\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu,
  );
  return match?.[1]?.toLowerCase() ?? null;
};

export const createArenaGenerationActorResolver = (
  options: ArenaGenerationActorResolverOptions,
): ArenaActorResolver => {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const createAnonymousId = options.createAnonymousId ?? (() => crypto.randomUUID());
  const resolveAuthenticatedUserId = createAuthenticatedUserIdResolver({
    env,
    fetch: options.fetch,
    signatures: options.signatures,
    getD1Client: options.getD1Client,
    now,
  });
  const pvpAuthority = options.pvpSignatures
    ? createArenaPvpGenerationAuthority(options.pvpSignatures)
    : null;

  const readPvpOperationActor = async (
    request: Request,
  ): Promise<ArenaGenerationActor | null> => {
    if (!pvpAuthority) return null;
    const signature = request.headers.get(ARENA_PVP_GENERATION_SIGNATURE_HEADER)?.trim() ?? '';
    if (!/^[0-9a-f]{64}$/u.test(signature)) return null;
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_ARENA_CREATE_BODY_BYTES) return null;
    try {
      const reader = request.clone().body?.getReader();
      const chunks: Uint8Array[] = [];
      let bodyBytes = 0;
      if (reader) {
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            bodyBytes += next.value.byteLength;
            if (bodyBytes > MAX_ARENA_CREATE_BODY_BYTES) {
              await reader.cancel('arena PVP actor body exceeds byte limit').catch(() => undefined);
              return null;
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const body = new Uint8Array(bodyBytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const requestPayload = { ...(parsed as Record<string, unknown>) };
      const generationRequestId = typeof requestPayload.generationRequestId === 'string'
        ? requestPayload.generationRequestId
        : '';
      delete requestPayload.generationRequestId;
      const pvpContext = await pvpAuthority.resolve({
        request,
        generationRequestId,
        payload: requestPayload,
      });
      return pvpContext ? { actorKey: `pvp-room:${pvpContext.roomId}` } : null;
    } catch {
      return null;
    }
  };

  const issueAnonymousActor = async (
    anonymousId: string,
  ): Promise<ArenaGenerationActor> => {
    const issuedAt = now();
    const payload: ArenaAnonymousTokenPayload = {
      v: 1,
      anonymousId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const signature = await options.signatures.generateSignature(payload);
    if (!signature) return { actorKey: `anonymous:${payload.anonymousId}` };
    return {
      actorKey: `anonymous:${payload.anonymousId}`,
      responseHeaders: {
        [ARENA_ANONYMOUS_TOKEN_HEADER]: encodeToken({ ...payload, signature }),
      },
    };
  };

  const readAnonymousActor = async (request: Request): Promise<ArenaGenerationActor | null> => {
    const raw = request.headers.get(ARENA_ANONYMOUS_TOKEN_HEADER)?.trim() ?? '';
    const token = decodeToken(raw);
    if (
      token
      && Date.parse(token.expiresAt) > now().getTime()
      && await options.signatures.verifySignature(token)
    ) {
      return { actorKey: `anonymous:${token.anonymousId}` };
    }
    const bootstrapAnonymousId = readBootstrapAnonymousId(raw);
    if (bootstrapAnonymousId) return issueAnonymousActor(bootstrapAnonymousId);
    if (raw) return null;
    return issueAnonymousActor(createAnonymousId());
  };

  return async (request): Promise<ArenaGenerationActor | null> => {
    const userId = await resolveAuthenticatedUserId(request);
    const authenticatedActor: ArenaGenerationActor | null = userId
      ? { actorKey: `user:${userId}` }
      : null;
    const authorization = request.headers.get('authorization')?.trim() ?? '';
    const hasStrictCredential = Boolean(
      (authorization.startsWith('Bearer ')
        && authorization.slice('Bearer '.length).trim())
      || request.headers.get('x-mahoshojo-activity-token')?.trim(),
    );
    if (!authenticatedActor && hasStrictCredential) return null;

    const pvpSignature = request.headers.get(ARENA_PVP_GENERATION_SIGNATURE_HEADER)?.trim() ?? '';
    if (pvpSignature) {
      if (!authenticatedActor) return null;
      return readPvpOperationActor(request);
    }
    if (authenticatedActor) return authenticatedActor;
    return readAnonymousActor(request);
  };
};
