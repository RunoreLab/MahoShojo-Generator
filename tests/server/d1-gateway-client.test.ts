import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryD1Payload } from '@/lib/database/core';

const originalEnvironment = {
  gatewayUrl: process.env.D1_GATEWAY_URL,
  gatewaySecret: process.env.D1_GATEWAY_HMAC_SECRET,
  gatewayToken: process.env.D1_GATEWAY_TOKEN,
};

const sign = async (secret: string, value: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalEnvironment.gatewayUrl === undefined) delete process.env.D1_GATEWAY_URL;
  else process.env.D1_GATEWAY_URL = originalEnvironment.gatewayUrl;
  if (originalEnvironment.gatewaySecret === undefined) delete process.env.D1_GATEWAY_HMAC_SECRET;
  else process.env.D1_GATEWAY_HMAC_SECRET = originalEnvironment.gatewaySecret;
  if (originalEnvironment.gatewayToken === undefined) delete process.env.D1_GATEWAY_TOKEN;
  else process.env.D1_GATEWAY_TOKEN = originalEnvironment.gatewayToken;
});

describe('D1 Gateway client transport', () => {
  it('优先使用 Gateway 并对请求体生成 HMAC', async () => {
    process.env.D1_GATEWAY_URL = 'https://d1-gateway.example.com/internal';
    process.env.D1_GATEWAY_HMAC_SECRET = 'test-gateway-secret';
    delete process.env.D1_GATEWAY_TOKEN;

    let capturedUrl = '';
    let capturedHeaders = new Headers();
    let capturedBody = '';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = String(init?.body || '');
      return Response.json({
        success: true,
        result: [{ success: true, results: [{ ok: 1 }], meta: {} }],
      });
    }));

    await queryD1Payload('SELECT ? AS ok', [1]);

    expect(capturedUrl).toBe('https://d1-gateway.example.com/internal/v1/query');
    expect(capturedHeaders.get('authorization')).toBeNull();
    const timestamp = capturedHeaders.get('x-mahoshojo-timestamp') || '';
    const nonce = capturedHeaders.get('x-mahoshojo-nonce') || '';
    const expected = await sign(
      'test-gateway-secret',
      `${timestamp}\n${nonce}\n/internal/v1/query\n${capturedBody}`,
    );
    expect(capturedHeaders.get('x-mahoshojo-signature')).toBe(expected);
  });
});
