import type { AdminPrincipal } from './security/authorization';
import { createPrincipalDirectory, type PrincipalDirectory } from './security/authorization';

export type AdminConfiguration = {
  accessIssuer: string;
  accessAudience: string;
  accessJwksUrl: string;
  principals: PrincipalDirectory;
};

type AdminConfigurationSource = {
  ADMIN_ACCESS_ISSUER?: string;
  ADMIN_ACCESS_AUDIENCE?: string;
  ADMIN_ACCESS_JWKS_URL?: string;
  ADMIN_PRINCIPALS_JSON?: string;
};

const required = (value: string | undefined, field: string): string => {
  if (!value?.trim()) throw new Error(`${field} is required`);
  return value.trim();
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const parsePrincipal = (value: unknown): AdminPrincipal => {
  if (!isRecord(value) || !isRecord(value.externalIdentity)) throw new Error('invalid Admin principal');
  const { externalIdentity } = value;
  if (
    typeof value.id !== 'string'
    || (value.status !== 'active' && value.status !== 'disabled')
    || !Array.isArray(value.capabilities)
    || !value.capabilities.every((capability) => typeof capability === 'string')
    || typeof externalIdentity.issuer !== 'string'
    || typeof externalIdentity.subject !== 'string'
    || (externalIdentity.kind !== 'human' && externalIdentity.kind !== 'service')
  ) {
    throw new Error('invalid Admin principal');
  }
  return {
    id: value.id,
    status: value.status,
    capabilities: value.capabilities,
    externalIdentity: {
      issuer: externalIdentity.issuer,
      subject: externalIdentity.subject,
      kind: externalIdentity.kind,
    },
  };
};

const parsePrincipals = (serialized: string): PrincipalDirectory => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('ADMIN_PRINCIPALS_JSON must be valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('ADMIN_PRINCIPALS_JSON must be an array');
  return createPrincipalDirectory(parsed.map(parsePrincipal));
};

export const loadAdminConfiguration = (source: AdminConfigurationSource): AdminConfiguration => ({
  accessIssuer: required(source.ADMIN_ACCESS_ISSUER, 'ADMIN_ACCESS_ISSUER'),
  accessAudience: required(source.ADMIN_ACCESS_AUDIENCE, 'ADMIN_ACCESS_AUDIENCE'),
  accessJwksUrl: required(source.ADMIN_ACCESS_JWKS_URL, 'ADMIN_ACCESS_JWKS_URL'),
  principals: parsePrincipals(required(source.ADMIN_PRINCIPALS_JSON, 'ADMIN_PRINCIPALS_JSON')),
});
