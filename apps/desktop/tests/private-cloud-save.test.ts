import { describe, expect, it, vi } from 'vitest';
import { createPrivateCloudCopy, readPrivateCloudCapacity } from '../src/platform/private-cloud-save';
const form = { name: '角色', description: '描述', data: { name: '角色', signature: 'unchanged', extra: { future: true } } };
describe('private result fixed cloud routes', () => {
  it('sends fixed private create with owner fence and preserves complete data', async () => {
    const invoke = vi.fn(async () => ({ status: 201, body: { success: true, id: 'new-copy' } }));
    expect(await createPrivateCloudCopy(invoke, 7, form)).toEqual({ kind: 'saved', id: 'new-copy' });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('cloud_card_library_request', { request: {
      routeId: 'data-cards.create', expectedUserId: 7, body: { type: 'character', ...form, isPublic: false },
    } });
    expect(form.data.signature).toBe('unchanged');
  });
  it('sends explicit scenario type and rejects unsupported types without guessing', async () => {
    const invoke = vi.fn(async () => ({ status: 201, body: { success: true, id: 'new-copy' } }));
    await createPrivateCloudCopy(invoke, 7, { ...form, type: 'scenario' });
    expect(invoke.mock.calls[0]).toEqual(['cloud_card_library_request', { request: {
      routeId: 'data-cards.create', expectedUserId: 7, body: { ...form, type: 'scenario', isPublic: false },
    } }]);
    invoke.mockClear();
    expect((await createPrivateCloudCopy(invoke, 7, { ...form, type: 'questionnaire' as never })).kind).toBe('rejected');
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([{}, { success: true }, { success: true, id: ' ' }, { success: false, id: 'x' }])('does not accept ambiguous success %j', async (body) => {
    const invoke = vi.fn(async () => ({ status: 201, body }));
    expect((await createPrivateCloudCopy(invoke, 7, form)).kind).toBe('uncertain'); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403, 413, 429])('classifies definite refusal %s without retry', async (status) => {
    const invoke = vi.fn(async () => ({ status, body: { error: '拒绝' } }));
    expect(await createPrivateCloudCopy(invoke, 7, form)).toEqual({ kind: 'rejected', message: '拒绝' }); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it.each([500, 502, 503])('treats %s as possibly inserted, never replays', async (status) => {
    const invoke = vi.fn(async () => ({ status, body: { error: 'failed after insert' } }));
    expect((await createPrivateCloudCopy(invoke, 7, form)).kind).toBe('uncertain'); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('retains uncertain transport outcome and does not retry', async () => {
    const invoke = vi.fn().mockRejectedValue({ code: 'network-error', message: 'timeout' });
    expect((await createPrivateCloudCopy(invoke, 7, form)).kind).toBe('uncertain'); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['not-authenticated', 'invalid-request'])('local pre-send rejection %s is definite', async (code) => {
    const invoke = vi.fn().mockRejectedValue({ code, message: 'rejected before HTTP' });
    expect((await createPrivateCloudCopy(invoke, 7, form)).kind).toBe('rejected'); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('reads capacity through fixed GET identity scope; failure is unknown', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { success: true, capacity: 10, usedSlots: 3 } }));
    expect(await readPrivateCloudCapacity(invoke, 7)).toEqual({ capacity: 10, usedSlots: 3 });
    expect(invoke).toHaveBeenCalledWith('cloud_card_library_request', { request: { routeId: 'user-capacity.query', expectedUserId: 7 } });
    invoke.mockRejectedValueOnce(new Error('offline')); expect(await readPrivateCloudCapacity(invoke, 7)).toBeNull();
    invoke.mockResolvedValueOnce({ status: 200, body: { success: true, capacity: NaN, usedSlots: 0 } }); expect(await readPrivateCloudCapacity(invoke, 7)).toBeNull();
  });
});
