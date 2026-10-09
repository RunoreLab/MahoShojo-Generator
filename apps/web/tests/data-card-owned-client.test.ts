import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { authStorage, dataCardApi } from '@/lib/auth';
const auth = { userId: 7, username: 'owner', authKey: 'mock-only' };
const guard = { expectedUserId: 7, expectedAuth: auth, isCurrent: () => true };
const target = { id: 'c', type: 'character' as const, name: 'name', description: null, isPublic: 0 as const, reviewStatus: 'pending' as const, hasPendingUpdate: false, version: 'a'.repeat(64) };
const ack = { success: true, id: 'c', accountFenceVersion: 1, ownerUserId: 7, replacementVersion: 1, pendingReview: false };
beforeEach(() => { vi.spyOn(authStorage, 'getAuth').mockResolvedValue(auth); });
afterEach(() => vi.unstubAllGlobals());
describe('owned replacement Web client', () => {
  test('read and mutation use only owned path with frozen owner and no redirect', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ success: true, ownerUserId: 7, accountFenceVersion: 1, target }))
      .mockResolvedValueOnce(Response.json(ack)); vi.stubGlobal('fetch', fetcher);
    expect(await dataCardApi.readOwnedReplacementTarget('c', guard)).toEqual({ success: true, target });
    expect(await dataCardApi.replaceOwnedCard(target, { full: { extension: true } }, guard)).toEqual({ success: true, pendingReview: false });
    for (const [url, init] of fetcher.mock.calls) { expect(url).toContain('/api/data-cards/replace-owned'); expect(init.redirect).toBe('error'); }
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ id: 'c', type: 'character', expectedVersion: target.version, expectedUserId: 7, data: { full: { extension: true } } });
  });
  test.each([
    [200, ack, true, false],
    [200, { ...ack, ownerUserId: 8 }, false, true],
    [200, { ...ack, id: 'other' }, false, true],
    [200, { success: true }, false, true],
    [201, ack, false, true],
    [200, { ...ack, replacementVersion: 2 }, false, true],
    [500, ack, false, true], [503, {}, false, true], [409, { error: 'other' }, false, true],
    [409, { error: 'TARGET_CHANGED' }, false, false], [409, { error: 'ACCOUNT_MISMATCH' }, false, false],
    [400, {}, false, false], [401, {}, false, false], [403, {}, false, false], [404, {}, false, false], [405, {}, false, false], [413, {}, false, false], [429, {}, false, false],
  ])('strict ack or known refusal %s %j', async (status, body, success, uncertain) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(body, { status })); vi.stubGlobal('fetch', fetcher);
    const result = await dataCardApi.replaceOwnedCard(target, {}, guard);
    expect(result.success).toBe(success); expect(Boolean(result.uncertain)).toBe(uncertain); expect(fetcher).toHaveBeenCalledOnce();
  });
  test('network/redirect failure is uncertain and never retries', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('redirect')); vi.stubGlobal('fetch', fetcher);
    expect((await dataCardApi.replaceOwnedCard(target, {}, guard)).uncertain).toBe(true); expect(fetcher).toHaveBeenCalledOnce();
  });
  test('pre-send account or scope changes refuse without network', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await dataCardApi.replaceOwnedCard(target, {}, { ...guard, isCurrent: () => false })).success).toBe(false);
    vi.spyOn(authStorage, 'getAuth').mockResolvedValue({ ...auth, userId: 8 });
    expect((await dataCardApi.readOwnedReplacementTarget('c', guard)).success).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });
  test('late successful ack after account change remains uncertain', async () => {
    const fetcher = vi.fn().mockImplementation(async () => {
      vi.spyOn(authStorage, 'getAuth').mockResolvedValue({ ...auth, userId: 8 });
      return Response.json(ack);
    }); vi.stubGlobal('fetch', fetcher);
    expect(await dataCardApi.replaceOwnedCard(target, {}, guard)).toMatchObject({ success: false, uncertain: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });

});
