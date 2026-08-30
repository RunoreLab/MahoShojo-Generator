import { describe, expect, test } from 'vitest';

const loadModules = async () => {
  return {
    requestSafety: await import('../src/security/request-safety'),
    audit: await import('../src/security/audit'),
    authorization: await import('../src/security/authorization'),
  };
};

const mutationRequest = (headers: Record<string, string> = {}) => new Request('https://admin.example.test/api/admin/future', {
  method: 'POST',
  headers: {
    Origin: 'https://admin.example.test',
    'Sec-Fetch-Site': 'same-origin',
    'X-Mahoshojo-Admin-CSRF': '1',
    'Content-Type': 'application/json',
    ...headers,
  },
  body: '{}',
});

describe('same-origin mutation safety', () => {
  test('同源 + Fetch Metadata + custom header + JSON 才允许 mutation', async () => {
    const modules = await loadModules();
    expect(() => modules.requestSafety.assertMutationRequestSafety(mutationRequest())).not.toThrow();
  });

  test.each([
    ['cross-site Origin', { Origin: 'https://evil.example' }],
    ['cross-site Fetch Metadata', { 'Sec-Fetch-Site': 'cross-site' }],
    ['错误 custom header', { 'X-Mahoshojo-Admin-CSRF': '0' }],
    ['非 JSON mutation', { 'Content-Type': 'text/plain' }],
  ])('%s fail closed', async (_name, headers) => {
    const modules = await loadModules();
    expect(() => modules.requestSafety.assertMutationRequestSafety(mutationRequest(headers)))
      .toThrow(expect.objectContaining({ code: 'ADMIN_CSRF_REJECTED' }));
  });

  test('缺失 CSRF/Origin/Fetch Metadata 信号 fail closed', async () => {
    const modules = await loadModules();
    const request = new Request('https://admin.example.test/api/admin/future', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(() => modules.requestSafety.assertMutationRequestSafety(request))
      .toThrow(expect.objectContaining({ code: 'ADMIN_CSRF_REJECTED' }));
  });

  test('safe method 不依赖 ambient CSRF signal', async () => {
    const modules = await loadModules();
    expect(() => modules.requestSafety.assertMutationRequestSafety(
      new Request('https://admin.example.test/api/admin/session'),
    )).not.toThrow();
  });
});

describe('server-only audit envelope', () => {
  const identity = {
    issuer: 'https://admin-example.cloudflareaccess.com',
    subject: 'human-subject-1',
    kind: 'human' as const,
  };
  const principal = {
    id: 'principal-1',
    externalIdentity: identity,
    status: 'active' as const,
    capabilities: ['users.write'],
  };
  const mutationPolicy = {
    method: 'POST',
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
  const runtime = {
    now: () => new Date('2026-08-29T10:00:00.000Z'),
    randomUuid: (() => {
      const values = ['event-00000000-0000-4000-8000-000000000001', 'request-00000000-0000-4000-8000-000000000002'];
      return () => values.shift() ?? 'unexpected';
    })(),
  };
  const contextFor = (modules: Awaited<ReturnType<typeof loadModules>>, verifiedIdentity = identity) => ({
    identity: verifiedIdentity,
    principal,
    policy: modules.authorization.createRoutePolicyRegistry([mutationPolicy])
      .requirePolicy(mutationPolicy.method, mutationPolicy.path),
  });

  test('actor/capability/action/ids/timestamp 只从 verified server context 派生', async () => {
    const modules = await loadModules();
    const envelope = await modules.audit.createAuditEnvelope(
      contextFor(modules),
      {
        targetType: 'user',
        targetIdOrSafeScope: 'user-1',
        reason: 'policy violation',
        expectedVersion: '7',
        idempotencyKey: 'operation-1',
        result: 'conflict',
        resultSummary: 'version no longer current',
        errorCodeSafe: 'ADMIN_VERSION_CONFLICT',
      },
      runtime,
    );

    expect(envelope).toMatchObject({
      eventId: 'event-00000000-0000-4000-8000-000000000001',
      requestId: 'request-00000000-0000-4000-8000-000000000002',
      timestamp: '2026-08-29T10:00:00.000Z',
      actorPrincipalId: 'principal-1',
      capability: 'users.write',
      action: 'users.disable',
      sourceContextSafe: 'apps/admin',
      result: 'conflict',
    });
    expect(envelope.authnContextSafeRef).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(envelope)).not.toContain('human-subject-1');
  });

  test('可能含 raw credential/control character 的 audit field 被拒绝', async () => {
    const modules = await loadModules();
    const rawCredential = ['Bearer', 'eyJfake', 'payload', 'signature'].join(' ');
    await expect(modules.audit.createAuditEnvelope(
      contextFor(modules),
      {
        targetType: 'user',
        targetIdOrSafeScope: 'user-1',
        reason: 'policy violation',
        expectedVersion: '7',
        idempotencyKey: 'operation-2',
        result: 'denied',
        resultSummary: rawCredential,
        errorCodeSafe: 'ADMIN_DENIED',
      },
    )).rejects.toMatchObject({ code: 'ADMIN_AUDIT_INVALID' });
    await expect(modules.audit.createAuditEnvelope(
      contextFor(modules),
      {
        targetType: 'user',
        targetIdOrSafeScope: 'user-1',
        reason: 'policy\nviolation',
        expectedVersion: '7',
        idempotencyKey: 'operation-3',
        result: 'failed',
        resultSummary: 'rejected',
        errorCodeSafe: 'ADMIN_AUDIT_INPUT_REJECTED',
      },
    )).rejects.toMatchObject({ code: 'ADMIN_AUDIT_INVALID' });
  });

  test('缺失 action-specific reason/version/idempotency 或夹带伪造字段时拒绝', async () => {
    const modules = await loadModules();
    const base = {
      targetType: 'user',
      targetIdOrSafeScope: 'user-1',
      result: 'success' as const,
      resultSummary: 'ok',
      errorCodeSafe: 'NONE',
    };

    await expect(modules.audit.createAuditEnvelope(
      contextFor(modules),
      base,
    )).rejects.toMatchObject({ code: 'ADMIN_AUDIT_INVALID' });
    await expect(modules.audit.createAuditEnvelope(
      contextFor(modules),
      {
        ...base,
        reason: 'policy violation',
        expectedVersion: '7',
        idempotencyKey: 'operation-4',
        actorPrincipalId: 'attacker-selected-principal',
      },
    )).rejects.toMatchObject({ code: 'ADMIN_AUDIT_INVALID' });
  });

  test('identity/principal/policy 不一致时 fail closed', async () => {
    const modules = await loadModules();
    await expect(modules.audit.createAuditEnvelope(
      contextFor(modules, { ...identity, subject: 'attacker' }),
      {
        targetType: 'user',
        targetIdOrSafeScope: 'user-1',
        reason: 'policy violation',
        expectedVersion: '7',
        idempotencyKey: 'operation-5',
        result: 'failed',
        resultSummary: 'rejected',
        errorCodeSafe: 'ADMIN_IDENTITY_MISMATCH',
      },
    )).rejects.toMatchObject({ code: 'ADMIN_AUDIT_INVALID' });
  });
});
