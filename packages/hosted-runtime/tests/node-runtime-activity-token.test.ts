import { createActivityTokenService } from '../src/node-runtime/activity-token';

const decodeToken = (token: string): Record<string, unknown> => JSON.parse(
  Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
) as Record<string, unknown>;

const encodeToken = (payload: Record<string, unknown>): string => Buffer
  .from(JSON.stringify(payload), 'utf8')
  .toString('base64url');

const signatureFor = (payload: Record<string, unknown>): string =>
  `${String(payload.userId)}:${String(payload.expiresAt)}`;

const service = createActivityTokenService({
  generateSignature: async (payload) => signatureFor(payload as Record<string, unknown>),
  verifySignature: async (value) => {
    if (!value || typeof value !== 'object') return false;
    const payload = value as Record<string, unknown>;
    return payload.signature === signatureFor(payload);
  },
});

describe('package-owned activity token authority', () => {
  test('有效 token 建立用户身份，过期 token fail closed', async () => {
    const issuedAt = new Date('2026-08-24T00:00:00.000Z');
    const token = await service.issueActivityToken(382, { now: issuedAt, ttlDays: 1 });
    expect(token).not.toBeNull();
    if (!token) return;

    await expect(service.verifyActivityToken(token, { now: issuedAt })).resolves.toMatchObject({
      userId: 382,
    });
    await expect(
      service.verifyActivityToken(token, { now: new Date('2026-08-25T00:00:00.000Z') }),
    ).resolves.toBeNull();
  });

  test('篡改 token 不会升级身份，且裸 user-id header 永不建立身份', async () => {
    const token = await service.issueActivityToken(382, {
      now: new Date('2026-08-24T00:00:00.000Z'),
    });
    expect(token).not.toBeNull();
    if (!token) return;

    const forged = encodeToken({ ...decodeToken(token), userId: 999 });
    await expect(service.verifyActivityToken(forged)).resolves.toBeNull();
    await expect(service.getUserIdFromActivityHeaders(new Headers({
      'x-mahoshojo-activity-token': forged,
      'x-mahoshojo-user-id': '999',
    }))).resolves.toBeNull();
    await expect(service.getUserIdFromActivityHeaders(new Headers({
      'x-mahoshojo-user-id': '999',
    }))).resolves.toBeNull();
  });
});
