// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SaveJsonButton } from '../src/details-controls/SaveJsonButton';

const card = { templateId: '通用情景', title: '雨后', content: '# 雨后\n\n原始正文', metadata: { signature: 'keep-signature' } };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('downloads once through the injected host with the complete JSON and resolved filename', () => {
  const downloadJson = vi.fn();
  const createObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL });
  act(() => root.render(<SaveJsonButton data={card} mode="download" recommendedMode="download" resolveFileName={(data) => `通用情景_${data.title}.json`} downloadJson={downloadJson} />));
  expect(container.querySelectorAll('button')).toHaveLength(1);
  expect(downloadJson).not.toHaveBeenCalled();
  act(() => container.querySelector('button')!.click());
  expect(downloadJson).toHaveBeenCalledExactlyOnceWith('通用情景_雨后.json', JSON.stringify(card, null, 2));
  expect(createObjectURL).not.toHaveBeenCalled();
});

it('retains the default Web Blob download and its 10-second URL lifetime', () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:https://example.com/json');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('情景_雨后.json');
    expect(this.isConnected).toBe(true);
  });
  act(() => root.render(<SaveJsonButton data={card} mode="download" recommendedMode="download" resolveFileName={() => '情景_雨后.json'} />));
  act(() => container.querySelector('button')!.click());
  expect(click).toHaveBeenCalledOnce();
  expect(createObjectURL).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0][0] as Blob;
  expect(blob.type).toBe('application/json');
  expect(blob.size).toBe(new TextEncoder().encode(JSON.stringify(card, null, 2)).byteLength);
  expect(document.querySelector('a[download]')).toBeNull();
  vi.advanceTimersByTime(9_999);
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:https://example.com/json');
});

it('keeps text-mode selection and copy with unchanged data without invoking a download host', async () => {
  const downloadJson = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  act(() => root.render(<SaveJsonButton data={card} mode="text" recommendedMode="text" resolveFileName={() => '雨后.json'} downloadJson={downloadJson} />));
  const text = container.querySelector('textarea')!;
  expect(text.value).toBe(JSON.stringify(card, null, 2));
  expect(text.readOnly).toBe(true);
  act(() => text.click());
  expect(text.selectionStart).toBe(0);
  expect(text.selectionEnd).toBe(text.value.length);
  await act(async () => container.querySelector('button')!.click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith(JSON.stringify(card, null, 2));
  expect(container.textContent).toContain('JSON 已复制到剪贴板');
  expect(downloadJson).not.toHaveBeenCalled();
});

it('allows the experimental download mode when copy is recommended, with one host invocation', () => {
  const downloadJson = vi.fn();
  act(() => root.render(<SaveJsonButton data={card} mode="download" recommendedMode="text" resolveFileName={() => '雨后.json'} downloadJson={downloadJson} />));
  expect(container.querySelector('button')?.textContent).toBe('🧪 尝试直接下载 JSON');
  act(() => container.querySelector('button')!.click());
  expect(downloadJson).toHaveBeenCalledExactlyOnceWith('雨后.json', JSON.stringify(card, null, 2));
});
