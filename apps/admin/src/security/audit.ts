import type { AccessIdentity } from './access';
import {
  isRegisteredAdminRoutePolicy,
  type AdminPrincipal,
  type RegisteredAdminRoutePolicy,
} from './authorization';
import { AdminSecurityError } from './errors';

export type AdminAuditResult = 'success' | 'denied' | 'conflict' | 'failed';

export type AdminAuditEnvelope = {
  eventId: string;
  timestamp: string;
  actorPrincipalId: string;
  authnContextSafeRef: string;
  capability: string;
  action: string;
  targetType: string;
  targetIdOrSafeScope: string;
  requestId: string;
  sourceContextSafe: 'apps/admin';
  reason?: string;
  expectedVersion?: string;
  idempotencyKey?: string;
  result: AdminAuditResult;
  resultSummary: string;
  errorCodeSafe: string;
};

type AdminAuditContext = {
  identity: AccessIdentity;
  principal: AdminPrincipal;
  policy: RegisteredAdminRoutePolicy;
};

type AdminAuditRuntime = {
  now(): Date;
  randomUuid(): string;
};

const OUTCOME_REQUIRED_FIELDS = ['targetType', 'targetIdOrSafeScope', 'result', 'resultSummary', 'errorCodeSafe'] as const;
const OUTCOME_OPTIONAL_FIELDS = ['reason', 'expectedVersion', 'idempotencyKey'] as const;
const OUTCOME_ALLOWED_FIELDS = new Set<string>([
  ...OUTCOME_REQUIRED_FIELDS,
  ...OUTCOME_OPTIONAL_FIELDS,
]);

const CREDENTIAL_PATTERN = /(?:\bBearer\s+\S+|\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:Authorization|password|api[_-]?token|secret)\s*[:=]\s*\S+|\b(?:postgres|mysql):\/\/[^\s:@/]+:[^\s@/]+@|\bsk_(?:live|prod)_[A-Za-z0-9_-]{8,})/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const assertAuditString: (value: unknown) => asserts value is string = (value) => {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.length > 1024
    || CONTROL_CHARACTER_PATTERN.test(value)
    || CREDENTIAL_PATTERN.test(value)
  ) {
    throw new AdminSecurityError('ADMIN_AUDIT_INVALID');
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isAuditResult = (value: unknown): value is AdminAuditResult => (
  value === 'success' || value === 'denied' || value === 'conflict' || value === 'failed'
);

const identitiesMatch = (left: AccessIdentity, right: AccessIdentity): boolean => (
  left.issuer === right.issuer && left.subject === right.subject && left.kind === right.kind
);

export const createAuthnContextSafeRef = async (identity: AccessIdentity): Promise<string> => {
  const encoded = new TextEncoder().encode(`${identity.issuer}\u0000${identity.subject}\u0000${identity.kind}`);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
};

const defaultRuntime: AdminAuditRuntime = {
  now: () => new Date(),
  randomUuid: () => crypto.randomUUID(),
};

export const createAuditEnvelope = async (
  context: AdminAuditContext,
  outcome: unknown,
  runtime: AdminAuditRuntime = defaultRuntime,
): Promise<Readonly<AdminAuditEnvelope>> => {
  if (
    context.principal.status !== 'active'
    || !isRegisteredAdminRoutePolicy(context.policy)
    || !identitiesMatch(context.identity, context.principal.externalIdentity)
    || !context.principal.capabilities.includes(context.policy.capability)
    || !context.policy.audit.required
    || !isRecord(outcome)
    || Object.keys(outcome).some((field) => !OUTCOME_ALLOWED_FIELDS.has(field))
  ) {
    throw new AdminSecurityError('ADMIN_AUDIT_INVALID');
  }

  for (const field of OUTCOME_REQUIRED_FIELDS) assertAuditString(outcome[field]);
  for (const field of OUTCOME_OPTIONAL_FIELDS) {
    if (outcome[field] !== undefined) assertAuditString(outcome[field]);
  }
  if (!isAuditResult(outcome.result)) throw new AdminSecurityError('ADMIN_AUDIT_INVALID');
  if (context.policy.audit.reasonRequired && outcome.reason === undefined) {
    throw new AdminSecurityError('ADMIN_AUDIT_INVALID');
  }
  if (context.policy.audit.expectedVersionRequired && outcome.expectedVersion === undefined) {
    throw new AdminSecurityError('ADMIN_AUDIT_INVALID');
  }
  if (context.policy.audit.idempotencyKeyRequired && outcome.idempotencyKey === undefined) {
    throw new AdminSecurityError('ADMIN_AUDIT_INVALID');
  }

  const timestamp = runtime.now();
  if (Number.isNaN(timestamp.getTime())) throw new AdminSecurityError('ADMIN_AUDIT_INVALID');
  const eventId = runtime.randomUuid();
  const requestId = runtime.randomUuid();
  const { targetType, targetIdOrSafeScope, resultSummary, errorCodeSafe } = outcome;
  assertAuditString(targetType);
  assertAuditString(targetIdOrSafeScope);
  assertAuditString(resultSummary);
  assertAuditString(errorCodeSafe);
  assertAuditString(eventId);
  assertAuditString(requestId);

  const envelope: AdminAuditEnvelope = {
    eventId,
    timestamp: timestamp.toISOString(),
    actorPrincipalId: context.principal.id,
    authnContextSafeRef: await createAuthnContextSafeRef(context.identity),
    capability: context.policy.capability,
    action: context.policy.action,
    targetType,
    targetIdOrSafeScope,
    requestId,
    sourceContextSafe: 'apps/admin',
    result: outcome.result,
    resultSummary,
    errorCodeSafe,
  };
  for (const field of OUTCOME_OPTIONAL_FIELDS) {
    const value = outcome[field];
    if (value !== undefined) Object.assign(envelope, { [field]: value });
  }

  return Object.freeze(envelope);
};
