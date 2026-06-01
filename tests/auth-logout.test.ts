import { describe, expect, test } from 'vitest';
import { signOutBetterAuthSession } from '@/lib/auth/logout';

describe('auth/logout', () => {
  test('signOutBetterAuthSession 会调用 Better Auth sign-out 端点', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ input, init });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const ok = await signOutBetterAuthSession(mockFetch);
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);

    const firstCall = calls[0];
    expect(firstCall.input).toBe('/api/auth/sign-out');
    expect(firstCall.init?.method).toBe('POST');
    expect(firstCall.init?.credentials).toBe('include');
    expect((firstCall.init?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json');
  });

  test('signOutBetterAuthSession 请求失败时返回 false', async () => {
    const mockFetch = async (): Promise<Response> => {
      throw new Error('network down');
    };

    const ok = await signOutBetterAuthSession(mockFetch);
    expect(ok).toBe(false);
  });
});
