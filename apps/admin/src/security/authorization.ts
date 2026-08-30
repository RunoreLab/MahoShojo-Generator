import type { AccessIdentity, AccessIdentityKind } from './access';
import { AdminSecurityError } from './errors';

export type AdminPrincipalStatus = 'active' | 'disabled';

export type AdminPrincipal = {
  id: string;
  externalIdentity: {
    issuer: string;
    subject: string;
    kind: AccessIdentityKind;
  };
  status: AdminPrincipalStatus;
  capabilities: readonly string[];
};

export type PrincipalDirectory = {
  resolve(identity: AccessIdentity): AdminPrincipal | null;
};

export type AdminRoutePolicy = {
  method: string;
  path: string;
  capability: string;
  requestKind: 'read' | 'mutation';
  action: string;
  audit: Readonly<{
    required: boolean;
    reasonRequired: boolean;
    expectedVersionRequired: boolean;
    idempotencyKeyRequired: boolean;
  }>;
};

const REGISTERED_ROUTE_POLICY = Symbol('registered Admin route policy');
export type RegisteredAdminRoutePolicy = AdminRoutePolicy & {
  readonly [REGISTERED_ROUTE_POLICY]: true;
};

const identityKey = ({ issuer, subject, kind }: AccessIdentity): string => `${issuer}\u0000${subject}\u0000${kind}`;
const routeKey = (method: string, path: string): string => `${method.toUpperCase()}\u0000${path}`;
const isRoutePolicyString = (value: unknown, maxLength: number): value is string => (
  typeof value === 'string'
  && value.trim().length > 0
  && value.length <= maxLength
  && !/[\u0000-\u001f\u007f]/.test(value)
);

const assertIdentifier = (value: string, field: string): void => {
  if (!value.trim() || value.length > 256 || /[\u0000-\u001f]/.test(value)) {
    throw new AdminSecurityError('ADMIN_PRINCIPAL_CONFIG_INVALID');
  }
  if (field === 'issuer') {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new AdminSecurityError('ADMIN_PRINCIPAL_CONFIG_INVALID');
    }
    if (parsed.protocol !== 'https:' || parsed.toString().replace(/\/$/, '') !== value.replace(/\/$/, '')) {
      throw new AdminSecurityError('ADMIN_PRINCIPAL_CONFIG_INVALID');
    }
  }
};

export const createPrincipalDirectory = (records: readonly AdminPrincipal[]): PrincipalDirectory => {
  const byIdentity = new Map<string, AdminPrincipal>();
  const principalIds = new Set<string>();

  for (const record of records) {
    assertIdentifier(record.id, 'id');
    assertIdentifier(record.externalIdentity.issuer, 'issuer');
    assertIdentifier(record.externalIdentity.subject, 'subject');
    if (!['human', 'service'].includes(record.externalIdentity.kind)) {
      throw new AdminSecurityError('ADMIN_PRINCIPAL_CONFIG_INVALID');
    }
    if (!['active', 'disabled'].includes(record.status) || record.capabilities.length === 0) {
      throw new AdminSecurityError('ADMIN_PRINCIPAL_CONFIG_INVALID');
    }
    if (new Set(record.capabilities).size !== record.capabilities.length) {
      throw new AdminSecurityError('ADMIN_PRINCIPAL_CONFIG_INVALID');
    }
    for (const capability of record.capabilities) assertIdentifier(capability, 'capability');

    const key = identityKey(record.externalIdentity);
    if (principalIds.has(record.id) || byIdentity.has(key)) {
      throw new AdminSecurityError('ADMIN_PRINCIPAL_CONFIG_INVALID');
    }
    principalIds.add(record.id);
    byIdentity.set(key, Object.freeze({
      ...record,
      externalIdentity: Object.freeze({ ...record.externalIdentity }),
      capabilities: Object.freeze([...record.capabilities].sort()),
    }));
  }

  return Object.freeze({
    resolve(identity: AccessIdentity): AdminPrincipal | null {
      return byIdentity.get(identityKey(identity)) ?? null;
    },
  });
};

export const authorizeIdentity = (
  identity: AccessIdentity,
  directory: PrincipalDirectory,
  capability: string,
): AdminPrincipal => {
  const principal = directory.resolve(identity);
  if (!principal) throw new AdminSecurityError('ADMIN_PRINCIPAL_MISSING');
  if (principal.status !== 'active') throw new AdminSecurityError('ADMIN_PRINCIPAL_DISABLED');
  if (!principal.capabilities.includes(capability)) throw new AdminSecurityError('ADMIN_CAPABILITY_MISSING');
  return principal;
};

export const createRoutePolicyRegistry = (policies: readonly AdminRoutePolicy[]) => {
  const byRoute = new Map<string, RegisteredAdminRoutePolicy>();
  for (const policy of policies) {
    const auditKeys = policy.audit && typeof policy.audit === 'object'
      ? Object.keys(policy.audit).sort()
      : [];
    const expectedAuditKeys = [
      'expectedVersionRequired',
      'idempotencyKeyRequired',
      'reasonRequired',
      'required',
    ];
    const normalized = Object.freeze({
      method: policy.method.toUpperCase(),
      path: policy.path,
      capability: policy.capability,
      requestKind: policy.requestKind,
      action: policy.action,
      audit: Object.freeze({ ...policy.audit }),
      [REGISTERED_ROUTE_POLICY]: true as const,
    });
    const auditFlagsAreBoolean = Object.values(normalized.audit)
      .every((value) => typeof value === 'boolean');
    const isReadMethod = normalized.method === 'GET' || normalized.method === 'HEAD';
    const isMutationMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalized.method);
    const requestKindMatchesMethod = normalized.requestKind === 'read'
      ? isReadMethod
      : normalized.requestKind === 'mutation' && isMutationMethod;
    const auditPolicyIsCoherent = normalized.requestKind === 'mutation'
      ? normalized.audit.required
      : !normalized.audit.reasonRequired
        && !normalized.audit.expectedVersionRequired
        && !normalized.audit.idempotencyKeyRequired;
    if (
      !isRoutePolicyString(normalized.path, 512)
      || !normalized.path.startsWith('/')
      || normalized.path.includes('?')
      || normalized.path.includes('#')
      || !isRoutePolicyString(normalized.capability, 256)
      || !isRoutePolicyString(normalized.action, 256)
      || !requestKindMatchesMethod
      || auditKeys.length !== expectedAuditKeys.length
      || auditKeys.some((key, index) => key !== expectedAuditKeys[index])
      || !auditFlagsAreBoolean
      || !auditPolicyIsCoherent
    ) {
      throw new AdminSecurityError('ADMIN_ROUTE_POLICY_INVALID');
    }
    const key = routeKey(normalized.method, normalized.path);
    if (byRoute.has(key)) throw new AdminSecurityError('ADMIN_ROUTE_POLICY_INVALID');
    byRoute.set(key, normalized);
  }

  return Object.freeze({
    requirePolicy(method: string, path: string): RegisteredAdminRoutePolicy {
      const policy = byRoute.get(routeKey(method, path));
      if (!policy) throw new AdminSecurityError('ADMIN_ROUTE_UNDECLARED');
      return policy;
    },
    assertCapability(principal: AdminPrincipal, method: string, path: string): RegisteredAdminRoutePolicy {
      const policy = this.requirePolicy(method, path);
      if (principal.status !== 'active' || !principal.capabilities.includes(policy.capability)) {
        throw new AdminSecurityError('ADMIN_CAPABILITY_MISSING');
      }
      return policy;
    },
  });
};

export const isRegisteredAdminRoutePolicy = (value: unknown): value is RegisteredAdminRoutePolicy => (
  typeof value === 'object'
  && value !== null
  && REGISTERED_ROUTE_POLICY in value
  && value[REGISTERED_ROUTE_POLICY] === true
);
