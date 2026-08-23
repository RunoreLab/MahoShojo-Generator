import {
  DIRECT_PROVIDER_PROFILE_VERSION,
  DirectProviderAdapterSchema,
  DirectProviderProfileV1Schema,
  type DirectProviderProfileV1,
} from '@mahoshojo/contracts/provider-profile';
import {
  DirectProviderProfileV1Schema as RootDirectProviderProfileV1Schema,
  type DirectProviderProfileV1 as RootDirectProviderProfileV1,
} from '@mahoshojo/contracts';

const validProfile: DirectProviderProfileV1 = {
  version: 1,
  id: 'profile-local',
  name: 'Local model',
  adapter: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:11434/v1',
  modelId: 'qwen3:8b',
  apiKeyRef: 'vault:profile-local:api-key',
  secretHeaderRefs: {
    Authorization: 'vault:profile-local:authorization',
  },
  publicHeaders: {
    'X-Client-Name': 'MahoShojo',
  },
  generationDefaults: {
    temperature: 0.5,
    thinking: { mode: 'enabled' },
  },
  transport: {
    allowPublicHttp: false,
    maxRedirects: 3,
  },
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:01:00.000Z',
};

describe('Direct Provider Profile v1 contract', () => {
  it('accepts the versioned non-secret profile and re-exports it', () => {
    expect(DIRECT_PROVIDER_PROFILE_VERSION).toBe(1);
    expect(DirectProviderAdapterSchema.options).toEqual([
      'openai-compatible',
      'anthropic',
      'google',
    ]);
    expect(DirectProviderProfileV1Schema.parse(validProfile)).toEqual(validProfile);
    expect(RootDirectProviderProfileV1Schema).toBe(DirectProviderProfileV1Schema);

    const rootProfile: RootDirectProviderProfileV1 = validProfile;
    expect(rootProfile.version).toBe(1);
  });

  it('keeps credentials as vault references and rejects plaintext secret fields', () => {
    expect(DirectProviderProfileV1Schema.parse(validProfile)).toMatchObject({
      apiKeyRef: 'vault:profile-local:api-key',
      secretHeaderRefs: {
        Authorization: 'vault:profile-local:authorization',
      },
    });

    for (const field of ['apiKey', 'secretHeaders', 'credentials', 'cookie']) {
      expect(DirectProviderProfileV1Schema.safeParse({
        ...validProfile,
        [field]: 'plaintext-secret',
      }).success).toBe(false);
    }
  });

  it('allows only HTTP(S) endpoints and bounded redirect configuration', () => {
    for (const baseUrl of [
      'https://provider.example/v1',
      'http://localhost:11434/v1',
      'http://192.168.1.10:1234/v1',
    ]) {
      expect(DirectProviderProfileV1Schema.safeParse({ ...validProfile, baseUrl }).success).toBe(true);
    }

    for (const baseUrl of [
      'file:///tmp/model',
      'data:text/plain,secret',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(DirectProviderProfileV1Schema.safeParse({ ...validProfile, baseUrl }).success).toBe(false);
    }

    expect(DirectProviderProfileV1Schema.safeParse({
      ...validProfile,
      transport: { maxRedirects: 4 },
    }).success).toBe(false);
    expect(DirectProviderProfileV1Schema.safeParse({
      ...validProfile,
      transport: { maxRedirects: -1 },
    }).success).toBe(false);
  });

  it('separates known secret headers and blocks transport-controlled headers', () => {
    for (const headerName of ['Authorization', 'Cookie', 'Proxy-Authorization', 'X-Api-Key']) {
      expect(DirectProviderProfileV1Schema.safeParse({
        ...validProfile,
        publicHeaders: { [headerName]: 'plaintext-secret' },
      }).success).toBe(false);
    }

    for (const headerName of ['Host', 'Content-Length', 'Connection']) {
      expect(DirectProviderProfileV1Schema.safeParse({
        ...validProfile,
        publicHeaders: { [headerName]: 'value' },
      }).success).toBe(false);
      expect(DirectProviderProfileV1Schema.safeParse({
        ...validProfile,
        secretHeaderRefs: { [headerName]: 'vault:ref' },
      }).success).toBe(false);
    }
  });

  it('rejects invalid timestamps, blank identifiers, and non-JSON defaults', () => {
    expect(DirectProviderProfileV1Schema.safeParse({
      ...validProfile,
      updatedAt: 'yesterday',
    }).success).toBe(false);
    expect(DirectProviderProfileV1Schema.safeParse({
      ...validProfile,
      modelId: '   ',
    }).success).toBe(false);
    expect(DirectProviderProfileV1Schema.safeParse({
      ...validProfile,
      generationDefaults: { invalid: new Date() },
    }).success).toBe(false);
  });
});
