import { describe, expect, it } from 'vitest';

import { parseAIProvidersFromEnv } from '../src/node-runtime/providers';

describe('Node AI provider URL boundary', () => {
  it.each([
    'https://user:secret@provider.example/v1',
    'https://provider.example/v1?token=secret',
    'https://provider.example/v1#secret',
    'http://provider.example/v1',
  ])('rejects credential-bearing or insecure provider URL %s', (baseUrl) => {
    expect(parseAIProvidersFromEnv({
      NODE_ENV: 'production',
      AI_API_KEY: 'server-secret',
      AI_BASE_URL: baseUrl,
    })).toEqual([]);
  });

  it('enforces an optional server-owned origin allowlist', () => {
    expect(parseAIProvidersFromEnv({
      NODE_ENV: 'production',
      AI_API_KEY: 'server-secret',
      AI_BASE_URL: 'https://provider.example/v1',
      AI_PROVIDER_ALLOWED_ORIGINS: 'https://trusted.example',
    })).toEqual([]);
    expect(parseAIProvidersFromEnv({
      NODE_ENV: 'production',
      AI_API_KEY: 'server-secret',
      AI_BASE_URL: 'https://provider.example/v1',
      AI_PROVIDER_ALLOWED_ORIGINS: 'https://provider.example',
    })).toHaveLength(1);
  });

  it('does not let NODE_ENV=development enable loopback HTTP on a production target', () => {
    expect(parseAIProvidersFromEnv({
      NODE_ENV: 'development',
      HOSTED_API_ENVIRONMENT: 'production',
      AI_API_KEY: 'server-secret',
      AI_BASE_URL: 'http://127.0.0.1:11434/v1',
    })).toEqual([]);
  });

  it('allows loopback HTTP only on an explicit local target', () => {
    expect(parseAIProvidersFromEnv({
      NODE_ENV: 'production',
      HOSTED_API_ENVIRONMENT: 'local',
      AI_API_KEY: 'server-secret',
      AI_BASE_URL: 'http://127.0.0.1:11434/v1',
    })).toHaveLength(1);
  });
});
