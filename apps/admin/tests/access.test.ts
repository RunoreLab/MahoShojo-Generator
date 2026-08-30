import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';
import { beforeAll, describe, expect, test } from 'vitest';

const issuer = 'https://admin-example.cloudflareaccess.com';
const audience = 'admin-audience';

let privateKey: CryptoKey;
let alternatePrivateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const primary = await generateKeyPair('RS256');
  const alternate = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(primary.publicKey);
  publicJwk.alg = 'RS256';
  publicJwk.kid = 'primary';
  publicJwk.use = 'sig';
  privateKey = primary.privateKey;
  alternatePrivateKey = alternate.privateKey;
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

const signToken = async ({
  key = privateKey,
  tokenIssuer = issuer,
  tokenAudience = audience,
  subject = 'human-subject-1',
  expiresIn = '5m',
  claims = {},
}: {
  key?: CryptoKey;
  tokenIssuer?: string;
  tokenAudience?: string;
  subject?: string | null;
  expiresIn?: string | null;
  claims?: Record<string, unknown>;
} = {}): Promise<string> => {
  let signer = new SignJWT({ type: 'app', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: key === privateKey ? 'primary' : 'alternate' })
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setIssuedAt();
  if (expiresIn !== null) signer = signer.setExpirationTime(expiresIn);
  if (subject !== null) signer = signer.setSubject(subject);
  return signer.sign(key);
};

const loadModule = async () => import('../src/security/access');

describe('Cloudflare Access JWT verifier', () => {
  test('验证 RS256/JWKS、issuer、audience、exp 并返回稳定 human identity', async () => {
    const access = await loadModule();
    const verifier = access.createAccessJwtVerifier({ issuer, audience, jwks });

    await expect(verifier.verify(await signToken())).resolves.toEqual({
      issuer,
      subject: 'human-subject-1',
      kind: 'human',
    });
  });

  test.each([
    ['错误签名', () => signToken({ key: alternatePrivateKey }), 'ACCESS_TOKEN_INVALID'],
    ['错误 issuer', () => signToken({ tokenIssuer: `${issuer}/wrong` }), 'ACCESS_TOKEN_INVALID'],
    ['错误 audience', () => signToken({ tokenAudience: 'public-web' }), 'ACCESS_TOKEN_INVALID'],
    ['过期 token', () => signToken({ expiresIn: '-1s' }), 'ACCESS_TOKEN_INVALID'],
    ['缺失 exp', () => signToken({ expiresIn: null }), 'ACCESS_TOKEN_INVALID'],
    ['缺失 subject', () => signToken({ subject: null }), 'ACCESS_TOKEN_INVALID'],
  ])('%s 时 fail closed，且错误不回显 token', async (_name, tokenFactory, expectedCode) => {
    const access = await loadModule();
    const verifier = access.createAccessJwtVerifier({ issuer, audience, jwks });
    const token = await tokenFactory();

    await expect(verifier.verify(token)).rejects.toMatchObject({ code: expectedCode });
    await expect(verifier.verify(token)).rejects.not.toThrow(token);
  });

  test('service identity 不会自动映射为 human principal', async () => {
    const access = await loadModule();
    const verifier = access.createAccessJwtVerifier({ issuer, audience, jwks });
    const token = await signToken({ subject: '', claims: { common_name: 'ci-service-token.access' } });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      issuer,
      subject: 'ci-service-token.access',
      kind: 'service',
    });
  });

  test.each([
    [{ type: 'org' }, 'human-subject-1'],
    [{ common_name: 'ambiguous-service.access' }, 'human-subject-1'],
  ])('拒绝非 application token 或 human/service 歧义 claim', async (claims, subject) => {
    const access = await loadModule();
    const verifier = access.createAccessJwtVerifier({ issuer, audience, jwks });

    await expect(verifier.verify(await signToken({ claims, subject })))
      .rejects.toMatchObject({ code: 'ACCESS_IDENTITY_INVALID' });
  });

  test('拒绝异常大的 assertion，避免把未验证输入交给 JWT parser', async () => {
    const access = await loadModule();
    const verifier = access.createAccessJwtVerifier({ issuer, audience, jwks, maxTokenLength: 1024 });

    await expect(verifier.verify('x'.repeat(1025))).rejects.toMatchObject({ code: 'ACCESS_TOKEN_INVALID' });
  });

  test('remote JWKS 必须与 Access issuer 同源，issuer 只能是 origin', async () => {
    const access = await loadModule();

    expect(() => access.createAccessJwtVerifier({
      issuer,
      audience,
      jwksUrl: 'https://attacker.example/jwks.json',
    })).toThrow('jwksUrl must use the issuer origin');
    expect(() => access.createAccessJwtVerifier({
      issuer: `${issuer}/unexpected-path`,
      audience,
      jwks,
    })).toThrow('issuer must be an HTTPS origin');
  });
});
