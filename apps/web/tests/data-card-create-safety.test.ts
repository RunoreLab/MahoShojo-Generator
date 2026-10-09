import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStorage, dataCardApi } from '@/lib/auth';

const auth = { userId: 7, username: 'owner', authKey: 'mock-only' };
beforeEach(() => {
  vi.spyOn(authStorage, 'buildAuthenticatedRequestInit').mockImplementation(async (init) => init ?? {});
  vi.spyOn(authStorage, 'getAuth').mockResolvedValue(auth);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const create = () => dataCardApi.createCard('character', 'name', 'description', { name: 'result' }, 0);

describe('create-card strict response and non-replay', () => {
  it.each([
    [200, { success: true, id: 'card-1' }, true, false],
    [201, { success: true, id: 'card-2' }, true, false],
    [200, { success: true, id: '' }, false, true],
    [200, { success: true, id: '   ' }, false, true],
    [200, { success: true, id: 123 }, false, true],
    [200, { id: 'card-1' }, false, true],
    [200, { success: false, error: 'unexpected' }, false, true],
    [500, { success: true, id: 'possibly-inserted' }, false, true],
    [503, { error: 'down' }, false, true],
    [400, { error: 'invalid' }, false, false],
    [401, { error: 'auth' }, false, false],
    [403, { error: 'denied' }, false, false],
    [413, { error: 'too big' }, false, false],
    [429, { error: 'limited' }, false, false],
  ])('HTTP %s %j', async (status, body, success, uncertain) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetcher);
    const result = await create();
    expect(result.success).toBe(success);
    expect(Boolean(result.uncertain)).toBe(uncertain);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps malformed success and network failures uncertain without replay', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('broken', { status: 200 })).mockRejectedValueOnce(new TypeError('network'));
    vi.stubGlobal('fetch', fetcher);
    expect((await create()).uncertain).toBe(true);
    expect((await create()).uncertain).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('sends frozen wire fields without changing the data or public setting', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"success":true,"id":"created"}', { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    await create();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ type: 'character', name: 'name', description: 'description', data: { name: 'result' }, isPublic: 0 });
  });
  it.each(['owner', 'credential', 'operation'])('fences %s changes before POST', async (change) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(authStorage.getAuth).mockResolvedValue(change === 'owner' ? { ...auth, userId: 8 } : change === 'credential' ? { ...auth, authKey: 'new-mock' } : auth);
    const result = await dataCardApi.createCard('character', 'name', '', {}, 0, { expectedUserId: 7, expectedAuth: auth, isCurrent: () => change !== 'operation' });
    expect(result.success).toBe(false);
    expect(result.uncertain).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the frozen bearer without another credential bootstrap', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"success":true,"id":"created"}', { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    await dataCardApi.createCard('character', 'name', '', {}, 0, { expectedUserId: 7, expectedAuth: auth, isCurrent: () => true });
    expect(authStorage.buildAuthenticatedRequestInit).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer mock-only');
  });
  it('times out once and reports uncertainty without clearing auth', async () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(authStorage, 'clearAuth');
    const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout')))));
    vi.stubGlobal('fetch', fetcher);
    const pending = create();
    await vi.advanceTimersByTimeAsync(30_001);
    expect((await pending).uncertain).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
  });
});
