import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';

import { AdminSecurityError } from './errors';

export type AccessIdentityKind = 'human' | 'service';

export type AccessIdentity = {
  issuer: string;
  subject: string;
  kind: AccessIdentityKind;
};

export type AccessVerifier = {
  verify(assertion: string): Promise<AccessIdentity>;
};

export type AccessJwtVerifierOptions = {
  issuer: string;
  audience: string;
  jwks?: JWTVerifyGetKey;
  jwksUrl?: string;
  maxTokenLength?: number;
};

const requireHttpsUrl = (value: string, field: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${field} must be an HTTPS URL without credentials or fragment`);
  }
  return parsed;
};

const classifyIdentity = (payload: Record<string, unknown>, issuer: string): AccessIdentity => {
  if (payload.type !== 'app' || typeof payload.sub !== 'string') {
    throw new AdminSecurityError('ACCESS_IDENTITY_INVALID');
  }

  const subject = payload.sub.trim();
  const serviceSubject = typeof payload.common_name === 'string' ? payload.common_name.trim() : '';
  if (serviceSubject) {
    if (payload.sub !== '' || serviceSubject.length > 512) {
      throw new AdminSecurityError('ACCESS_IDENTITY_INVALID');
    }
    return { issuer, subject: serviceSubject, kind: 'service' };
  }
  if (!subject || subject.length > 512) throw new AdminSecurityError('ACCESS_IDENTITY_INVALID');

  return { issuer, subject, kind: 'human' };
};

export const createAccessJwtVerifier = ({
  issuer,
  audience,
  jwks,
  jwksUrl,
  maxTokenLength = 16_384,
}: AccessJwtVerifierOptions): AccessVerifier => {
  const issuerUrl = requireHttpsUrl(issuer, 'issuer');
  if (issuerUrl.pathname !== '/' || issuerUrl.search) throw new Error('issuer must be an HTTPS origin');
  const normalizedIssuer = issuerUrl.origin;
  if (!audience.trim() || audience.length > 512) throw new Error('audience must be non-empty');
  if (!Number.isSafeInteger(maxTokenLength) || maxTokenLength < 512) throw new Error('maxTokenLength is invalid');

  const remoteJwksUrl = jwksUrl ? requireHttpsUrl(jwksUrl, 'jwksUrl') : null;
  if (remoteJwksUrl && remoteJwksUrl.origin !== issuerUrl.origin) {
    throw new Error('jwksUrl must use the issuer origin');
  }
  const keyProvider = jwks ?? (remoteJwksUrl ? createRemoteJWKSet(remoteJwksUrl) : null);
  if (!keyProvider) throw new Error('jwks or jwksUrl is required');

  return {
    async verify(assertion: string): Promise<AccessIdentity> {
      if (!assertion || assertion.length > maxTokenLength) {
        throw new AdminSecurityError('ACCESS_TOKEN_INVALID');
      }

      let payload: Record<string, unknown>;
      try {
        const verified = await jwtVerify(assertion, keyProvider, {
          algorithms: ['RS256'],
          issuer: normalizedIssuer,
          audience,
          requiredClaims: ['exp', 'sub', 'type'],
        });
        payload = verified.payload;
      } catch {
        throw new AdminSecurityError('ACCESS_TOKEN_INVALID');
      }

      return classifyIdentity(payload, normalizedIssuer);
    },
  };
};
