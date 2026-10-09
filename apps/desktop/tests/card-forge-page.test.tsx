// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopCardForge } from '../src/app/card-forge-page';
const mocks = vi.hoisted(() => ({ blocker: (() => false) as () => boolean, close: ((_event: { preventDefault: () => void }) => {}) as (event: { preventDefault: () => void }) => void, capture: vi.fn(), download: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async (handler: typeof mocks.close) => { mocks.close = handler; return () => {}; } }) }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: ({ shouldBlockFn }: { shouldBlockFn: () => boolean }) => { mocks.blocker = shouldBlockFn; }, useRouter: () => ({ navigate: vi.fn() }), Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock('../src/features/external-links/external-links-provider', () => ({ useExternalLinks: () => ({ openFixed: vi.fn() }) }));
vi.mock('../src/features/card-forge/export', () => ({ captureLocalForgeImage: mocks.capture, downloadForgeBlob: mocks.download }));
const face = { cardName: '原卡', cardType: 'character', rarity: 'epic', cost: 3, element: 'dark', attack: 2, defense: 1, hp: 3, effects: [{ type: '被动', description: '效果', extension: '原件保留' }], traits: [], flavorText: '', powerLevel: 'A', description: '', themeColor: '#ef4444' };
const inputFile = (text: string, name = '原件.json') => { const bytes = new TextEncoder().encode(text); return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer }; };
const choose = (input: HTMLInputElement, file: unknown) => { Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new Event('change', { bubbles: true })); };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.capture.mockReset(); mocks.download.mockReset(); });
describe('Desktop local forge host journey', () => {
  it('imports without network, retains exact original, edits shared controls, exports self-contained JSON and protects dirty state after download', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('Blob', NodeBlob); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const button = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === name)!;
    const original = '\ufeff' + JSON.stringify({ faceData: face, imageUrl: 'https://example.com/private.png', sourceCardData: { extra: '保留' } }, null, 2);
    try {
      await act(async () => root.render(<DesktopCardForge />));
      const input = container.querySelector<HTMLInputElement>('[aria-label="导入卡牌 JSON"]')!;
      await act(async () => choose(input, inputFile(original)));
      expect(container.querySelector('.gc-name-text')?.textContent).toBe('原卡');
      expect([...container.querySelectorAll('img')].some((image) => image.src.includes('example.com'))).toBe(false);
      expect(container.textContent).toContain('不写入存档'); expect(container.textContent).toContain('图片未加载');
      await act(async () => button('导出原始 JSON（完整原件）').click());
      expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await mocks.download.mock.calls[0][0].arrayBuffer())).toBe(original);
      const color = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.style.backgroundColor)!;
      act(() => color.click()); act(() => expect(mocks.blocker()).toBe(true));
      const close = vi.fn(); act(() => mocks.close({ preventDefault: close })); expect(close).toHaveBeenCalledOnce();
      const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
      await act(async () => choose(input, inputFile(JSON.stringify({ ...face, cardName: '不应覆盖' }))));
      expect(container.querySelector('.gc-name-text')?.textContent).toBe('原卡');
      await act(async () => button('导出工坊 JSON（含本地插图）').click());
      const saved = JSON.parse(await mocks.download.mock.calls[1][0].text());
      expect(saved.documentType).toBe('maho-shojo-game-card-forge'); expect(saved.faceData.themeColor).toBe('#ff6b9d'); expect(saved.illustration).toBeNull();
      act(() => expect(mocks.blocker()).toBe(true)); expect(container.textContent).toContain('无法获知系统保存或取消结果');
      confirm.mockReturnValueOnce(true);
      await act(async () => choose(input, inputFile('{broken')));
      expect(container.querySelector('.gc-name-text')?.textContent).toBe('原卡');
      expect(container.querySelector('[role="alert"]')).toBeTruthy();
      await act(async () => button('导出原始 JSON（完整原件）').click());
      expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await mocks.download.mock.calls[2][0].arrayBuffer())).toBe(original);
      expect(fetch).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); container.remove(); }
  });
  it('uploads validated local raster, exports and reimports crop state without external requests', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('Blob', NodeBlob); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal('Image', class { naturalWidth = 1; naturalHeight = 1; onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); } });
    const container = document.createElement('div'); const root = createRoot(container);
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF6sAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    try {
      await act(async () => root.render(<DesktopCardForge />));
      const input = container.querySelector<HTMLInputElement>('[aria-label="导入卡牌 JSON"]')!;
      await act(async () => choose(input, inputFile(JSON.stringify(face))));
      await act(async () => choose(container.querySelector<HTMLInputElement>('[aria-label="选择本地插图"]')!, { name: 'local.png', size: png.length, arrayBuffer: async () => png.buffer }));
      const ratio = container.querySelector<HTMLSelectElement>('[aria-label="卡面插图比例"]')!;
      act(() => { ratio.value = '3:4'; ratio.dispatchEvent(new Event('change', { bubbles: true })); });
      const scale = container.querySelector<HTMLInputElement>('[aria-label="图片缩放"]')!;
      act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(scale, '2'); scale.dispatchEvent(new Event('input', { bubbles: true })); });
      const exportButton = [...container.querySelectorAll('button')].find((button) => button.textContent === '导出工坊 JSON（含本地插图）')!;
      await act(async () => exportButton.click());
      const json = await mocks.download.mock.calls[0][0].text(); const result = JSON.parse(json);
      expect(result.illustration).toMatchObject({ source: 'uploaded', aspectRatio: '3:4', transform: { scale: 2, x: 0, y: 0 } });
      expect(result.illustration.dataUrl).toMatch(/^data:image\/png;base64,/);
      await act(async () => choose(input, inputFile(json, 'round-trip.json')));
      expect(container.querySelector<HTMLSelectElement>('[aria-label="卡面插图比例"]')!.value).toBe('3:4');
      expect(container.querySelector<HTMLInputElement>('[aria-label="图片缩放"]')!.value).toBe('2');
      expect(fetch).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); }
  });
  it('blocks repeated actions and route/native close during import and suppresses late import after unmount', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const container = document.createElement('div'); const root = createRoot(container);
    let finish!: (buffer: ArrayBuffer) => void;
    const read = vi.fn(() => new Promise<ArrayBuffer>((resolve) => { finish = resolve; }));
    await act(async () => root.render(<DesktopCardForge />));
    const input = container.querySelector<HTMLInputElement>('[aria-label="导入卡牌 JSON"]')!;
    act(() => { choose(input, { name: '等待.json', size: 1, arrayBuffer: read }); choose(input, inputFile(JSON.stringify(face))); });
    expect(read).toHaveBeenCalledOnce(); act(() => expect(mocks.blocker()).toBe(true)); expect(confirm).not.toHaveBeenCalled();
    const close = vi.fn(); act(() => mocks.close({ preventDefault: close })); expect(close).toHaveBeenCalledOnce();
    act(() => root.unmount());
    await act(async () => finish(new TextEncoder().encode(JSON.stringify(face)).buffer));
    expect(container.textContent).toBe(''); expect(mocks.download).not.toHaveBeenCalled();
  });
});
