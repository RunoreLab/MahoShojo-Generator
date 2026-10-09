// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), user: null as { id: number; username: string } | null }));
vi.mock('@/lib/auth', () => ({ authStorage: { fetch: mocks.fetch } }));
vi.mock('@/lib/auth-client-store', () => ({ getAuthSnapshot: () => ({ user: mocks.user }), subscribeAuthSnapshot: () => () => {} }));
import { useMeProfile } from '@/components/me/useMeProfile';
let root: Root; let container: HTMLDivElement; let client: QueryClient; let userId: number | null; let hook: ReturnType<typeof useMeProfile>;
const Harness = () => { const result = useMeProfile(userId); useEffect(() => { hook = result; }); return null; };
const render = () => act(async () => { root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); await new Promise((resolve) => setTimeout(resolve, 10)); });
const response = (signature: string, success = true) => ({ ok: true, json: async () => ({ success, profile: { signature, avatarDataUrl: null } }) });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (cause: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 3 } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  userId = 1; mocks.user = { id: 1, username: 'A' }; mocks.fetch.mockReset(); mocks.fetch.mockImplementation(async () => response('原有'));
});
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); });
describe('Web signature mutation owner and server confirmation', () => {
  it('shares confirmed data with the same account query and normalizes the bounded request', async () => {
    await render(); mocks.fetch.mockResolvedValueOnce(response('服务器确认'));
    await act(async () => { await hook.saveSignature('一\r\n二'); });
    expect(JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body)).toEqual({ signature: '一\n二' });
    expect(client.getQueryData(['me-profile', 1])).toMatchObject({ profile: { signature: '服务器确认' } });
  });
  it('does not accept HTTP200 success:false as a save', async () => {
    await render(); mocks.fetch.mockResolvedValueOnce(response('假的', false));
    await act(async () => { await expect(hook.saveSignature('草稿')).rejects.toThrow('未确认'); });
    expect(client.getQueryData(['me-profile', 1])).toMatchObject({ profile: { signature: '原有' } });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('does not automatically retry failed writes despite global mutation retries', async () => {
    await render(); mocks.fetch.mockRejectedValueOnce(new Error('network'));
    await act(async () => { await expect(hook.saveSignature('草稿')).rejects.toThrow('network'); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it.each(['B', 'same-account-login', 'logout'] as const)('fences late A success after %s', async (next) => {
    await render(); const pending = deferred<ReturnType<typeof response>>(); mocks.fetch.mockReturnValueOnce(pending.promise);
    let result!: Promise<unknown>; act(() => { result = hook.saveSignature('A草稿').catch((cause: unknown) => cause); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    userId = next === 'B' ? 2 : next === 'logout' ? null : 1;
    mocks.user = userId === null ? null : { id: userId, username: next };
    await render(); await act(async () => pending.resolve(response('迟到A')));
    expect(await result).toBeInstanceOf(Error);
    expect(client.getQueryData(['me-profile', 1])).not.toMatchObject({ profile: { signature: '迟到A' } });
    expect(client.getQueryData(['me-profile', 2])).not.toMatchObject({ profile: { signature: '迟到A' } });
  });
});
