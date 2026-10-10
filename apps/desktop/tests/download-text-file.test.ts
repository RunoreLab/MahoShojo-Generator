// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { downloadBinaryFile, downloadTextFile } from '../src/platform/download-text-file';

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

it('exports opaque ZIP bytes through the same delayed browser download without mutating the caller', async () => {
  const schedule = vi.spyOn(window, 'setTimeout').mockReturnValue(1 as unknown as ReturnType<typeof window.setTimeout>);
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:https://desktop.example/archive');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('原包.zip'); });
  const bytes = new Uint8Array([0, 255, 80, 75, 17]);
  downloadBinaryFile('原包.zip', bytes, 'application/zip'); bytes.fill(0);
  expect(click).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0]![0]; expect(blob.type).toBe('application/zip');
  const read = new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
  expect(new Uint8Array(await read)).toEqual(new Uint8Array([0, 255, 80, 75, 17]));
  expect(document.querySelector('a[download]')).toBeNull(); expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(schedule).toHaveBeenCalledWith(expect.any(Function), 60_000);
  (schedule.mock.calls[0]![0] as () => void)(); expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:https://desktop.example/archive');
});
