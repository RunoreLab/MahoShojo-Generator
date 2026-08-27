import { describe, expect, it } from 'vitest';
import { createNodeD1ClientFromEnvironment } from '@mahoshojo/hosted-runtime/node-runtime/d1-client';

const credential = { D1_GATEWAY_HMAC_SECRET: 'h'.repeat(32) };

describe('Node D1 Gateway origin gate', () => {
  it.each([
    ['remote HTTP', 'http://gateway.example.test'],
    ['credentials', 'https://user:pass@gateway.example.test'],
    ['path', 'https://gateway.example.test/hidden'],
    ['query', 'https://gateway.example.test?database=production'],
    ['fragment', 'https://gateway.example.test#unsafe'],
  ])('rejects %s before constructing transport', (_label, gatewayUrl) => {
    expect(() => createNodeD1ClientFromEnvironment({
      env: { ...credential, D1_GATEWAY_URL: gatewayUrl },
    })).toThrow(/D1_GATEWAY_URL/);
  });

  it('requires HMAC or Bearer transport credential', () => {
    expect(() => createNodeD1ClientFromEnvironment({
      env: { D1_GATEWAY_URL: 'https://gateway.example.test' },
    })).toThrow(/D1_GATEWAY_HMAC_SECRET.*D1_GATEWAY_TOKEN/);
  });

  it('accepts an exact HTTPS root origin', () => {
    expect(createNodeD1ClientFromEnvironment({
      env: { ...credential, D1_GATEWAY_URL: 'https://gateway.example.test' },
    })).not.toBeNull();
  });

  it('accepts HTTP loopback only for explicit local fault injection', () => {
    expect(() => createNodeD1ClientFromEnvironment({
      env: { ...credential, D1_GATEWAY_URL: 'http://127.0.0.1:8788' },
    })).toThrow(/D1_GATEWAY_URL/);

    expect(createNodeD1ClientFromEnvironment({
      env: {
        ...credential,
        D1_GATEWAY_URL: 'http://127.0.0.1:8788',
        HOSTED_DR_LOCAL_FAULT_INJECTION: 'true',
      },
    })).not.toBeNull();
  });
});
