import { describe, expect, test } from 'vitest';

const loadModule = async () => import('../src/security/authorization');

const identity = {
  issuer: 'https://admin-example.cloudflareaccess.com',
  subject: 'human-subject-1',
  kind: 'human' as const,
};

describe('Admin principal 与 capability authorization', () => {
  test('只使用 verified issuer + subject + kind 解析 active principal', async () => {
    const authorization = await loadModule();
    const directory = authorization.createPrincipalDirectory([
      {
        id: 'principal-1',
        externalIdentity: identity,
        status: 'active',
        capabilities: ['admin.shell.read'],
      },
    ]);

    expect(directory.resolve(identity)).toMatchObject({ id: 'principal-1' });
    const attackerProvidedClaims = { ...identity, subject: 'unknown', email: 'operator@example.com' };
    expect(directory.resolve(attackerProvidedClaims)).toBeNull();
  });

  test('service 与 human principal 使用不同主体语义', async () => {
    const authorization = await loadModule();
    const directory = authorization.createPrincipalDirectory([
      {
        id: 'human-principal',
        externalIdentity: identity,
        status: 'active',
        capabilities: ['admin.shell.read'],
      },
    ]);

    expect(directory.resolve({ ...identity, kind: 'service' })).toBeNull();
  });

  test('未知、disabled、缺 capability 均 deny by default', async () => {
    const authorization = await loadModule();
    const directory = authorization.createPrincipalDirectory([
      {
        id: 'disabled-principal',
        externalIdentity: identity,
        status: 'disabled',
        capabilities: ['admin.shell.read'],
      },
    ]);

    expect(() => authorization.authorizeIdentity(identity, directory, 'admin.shell.read'))
      .toThrow(expect.objectContaining({ code: 'ADMIN_PRINCIPAL_DISABLED' }));

    const activeDirectory = authorization.createPrincipalDirectory([
      {
        id: 'read-only-principal',
        externalIdentity: identity,
        status: 'active',
        capabilities: ['users.read'],
      },
    ]);
    expect(() => authorization.authorizeIdentity(identity, activeDirectory, 'users.write'))
      .toThrow(expect.objectContaining({ code: 'ADMIN_CAPABILITY_MISSING' }));
    expect(() => authorization.authorizeIdentity({ ...identity, subject: 'missing' }, activeDirectory, 'users.read'))
      .toThrow(expect.objectContaining({ code: 'ADMIN_PRINCIPAL_MISSING' }));
  });

  test('route registry 拒绝未声明 route，并区分 read/write capability', async () => {
    const authorization = await loadModule();
    const registry = authorization.createRoutePolicyRegistry([
      {
        method: 'GET',
        path: '/api/admin/users',
        capability: 'users.read',
        requestKind: 'read',
        action: 'users.list',
        audit: {
          required: false,
          reasonRequired: false,
          expectedVersionRequired: false,
          idempotencyKeyRequired: false,
        },
      },
      {
        method: 'POST',
        path: '/api/admin/users/:id/disable',
        capability: 'users.write',
        requestKind: 'mutation',
        action: 'users.disable',
        audit: {
          required: true,
          reasonRequired: true,
          expectedVersionRequired: true,
          idempotencyKeyRequired: true,
        },
      },
    ]);

    expect(registry.requirePolicy('GET', '/api/admin/users')).toMatchObject({
      capability: 'users.read',
      requestKind: 'read',
      action: 'users.list',
    });
    expect(() => registry.requirePolicy('GET', '/api/admin/undeclared'))
      .toThrow(expect.objectContaining({ code: 'ADMIN_ROUTE_UNDECLARED' }));
    expect(() => registry.assertCapability(
      { id: 'read-only', externalIdentity: identity, status: 'active', capabilities: ['users.read'] },
      'POST',
      '/api/admin/users/:id/disable',
    )).toThrow(expect.objectContaining({ code: 'ADMIN_CAPABILITY_MISSING' }));
  });

  test('route registry 在启动时拒绝 GET mutation 或缺失 durable audit 要求的 mutation', async () => {
    const authorization = await loadModule();
    const mutation = {
      path: '/api/admin/users/:id/disable',
      capability: 'users.write',
      requestKind: 'mutation' as const,
      action: 'users.disable',
      audit: {
        required: true,
        reasonRequired: true,
        expectedVersionRequired: true,
        idempotencyKeyRequired: true,
      },
    };

    expect(() => authorization.createRoutePolicyRegistry([{ ...mutation, method: 'GET' }]))
      .toThrow(expect.objectContaining({ code: 'ADMIN_ROUTE_POLICY_INVALID' }));
    expect(() => authorization.createRoutePolicyRegistry([{
      ...mutation,
      method: 'POST',
      audit: { ...mutation.audit, required: false },
    }])).toThrow(expect.objectContaining({ code: 'ADMIN_ROUTE_POLICY_INVALID' }));
    expect(() => authorization.createRoutePolicyRegistry([{
      ...mutation,
      method: 'POST',
      audit: { required: true } as typeof mutation.audit,
    }])).toThrow(expect.objectContaining({ code: 'ADMIN_ROUTE_POLICY_INVALID' }));
    expect(() => authorization.createRoutePolicyRegistry([{
      ...mutation,
      method: 'POST',
      action: 'users.disable\nforged-audit-line',
    }])).toThrow(expect.objectContaining({ code: 'ADMIN_ROUTE_POLICY_INVALID' }));
    expect(() => authorization.createRoutePolicyRegistry([{ ...mutation, method: 'POST' }])).not.toThrow();
  });

  test('重复 stable external identity 在启动时拒绝', async () => {
    const authorization = await loadModule();
    const shared = { externalIdentity: identity, status: 'active' as const, capabilities: ['admin.shell.read'] };

    expect(() => authorization.createPrincipalDirectory([
      { ...shared, id: 'principal-1' },
      { ...shared, id: 'principal-2' },
    ])).toThrow(expect.objectContaining({ code: 'ADMIN_PRINCIPAL_CONFIG_INVALID' }));
  });
});
