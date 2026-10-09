// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { downloadTextFile } from '../src/platform/download-text-file';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('uses one WebView2 download and retains the URL for the full 60 seconds', () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:https://desktop.example/json');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('情景_雨后.json');
    expect(this.rel).toBe('noopener');
    expect(this.isConnected).toBe(true);
  });
  const payload = JSON.stringify({ title: '雨后', metadata: { signature: 'preserved' } }, null, 2);
  downloadTextFile('情景_雨后.json', payload);
  expect(click).toHaveBeenCalledOnce();
  expect(createObjectURL).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0][0] as Blob;
  expect(blob.type).toBe('application/json');
  expect(blob.size).toBe(new TextEncoder().encode(payload).byteLength);
  expect(document.querySelector('a[download]')).toBeNull();
  vi.advanceTimersByTime(10_000);
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(49_999);
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:https://desktop.example/json');
});
