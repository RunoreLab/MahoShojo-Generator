// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLocalForgeImage, downloadForgeBlob } from '../src/features/card-forge/export';
const mocks = vi.hoisted(() => ({ capture: vi.fn().mockResolvedValue(new Blob(['png'])), deny: { snapdomProxyUrl: '', isMediaProxyPath: () => false, isAllowedExternalImageUrl: () => false }, dpr: 3 }));
vi.mock('@mahoshojo/ui-web/client', () => ({ capturePngBlob: mocks.capture, DENY_SNAPDOM_MEDIA: mocks.deny, getSafeDpr: () => mocks.dpr }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); mocks.capture.mockClear(); });
describe('Desktop forge actual capture and download adapters', () => {
  it('budgets expanded scroll geometry with scale × DPR and forces DENY before capture', async () => {
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 500 } as DOMRect);
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 2000 });
    expect(() => captureLocalForgeImage(element, { scale: 2, dprMax: 3 })).toThrow('安全上限'); expect(mocks.capture).not.toHaveBeenCalled();
    Object.defineProperty(element, 'scrollHeight', { value: 600 });
    await captureLocalForgeImage(element, { scale: 2, dprMax: 3, mediaAdapter: { snapdomProxyUrl: '/api/media-proxy?url=' } });
    expect(mocks.capture).toHaveBeenCalledWith(element, expect.objectContaining({ scale: 2, mediaAdapter: mocks.deny }));
  });
  it('downloads bytes through local blob URL and releases only after WebView lifetime, including click failure', () => {
    vi.useFakeTimers(); const create = vi.fn().mockReturnValue('blob:local'); const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = new Blob(['original']); downloadForgeBlob(blob, '原件.json'); expect(create).toHaveBeenCalledWith(blob); expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull(); vi.advanceTimersByTime(59999); expect(revoke).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(revoke).toHaveBeenCalledWith('blob:local');
    click.mockImplementationOnce(() => { throw new Error('cancelled'); }); expect(() => downloadForgeBlob(blob, '原件.json')).toThrow('cancelled'); expect(document.querySelector('a[download]')).toBeNull();
    vi.advanceTimersByTime(60000); expect(revoke).toHaveBeenCalledTimes(2);
  });
});
