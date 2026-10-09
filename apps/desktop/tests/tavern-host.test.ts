// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportTavernFile, saveDesktopTavernCard } from '../src/features/tavern/host';
import { buildDefaultFieldsFromDataCard, buildTavernExportCard, convertTavernToGeneralCard, getPlaceholderPngBytes, readTavernLocalDocument, type TavernCardCandidate } from '@mahoshojo/domain/tavern-card';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('Desktop Tavern host adapter', () => {
  it('dispatches local PNG through the existing download path and retains the URL for WebView2', () => {
    vi.useFakeTimers(); const create = vi.fn((_blob: Blob) => 'blob:local-png'); const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('tavern.png'); expect(this.href).toBe('blob:local-png'); });
    exportTavernFile({ name: 'tavern.png', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' });
    expect(click).toHaveBeenCalledTimes(1); expect(document.querySelector('a')).toBeNull(); expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000); expect(revoke).toHaveBeenCalledWith('blob:local-png'); expect(create.mock.calls[0][0].type).toBe('image/png');
  });
  it('saves imported unsigned data through CardRepository and preserves a readable original', async () => {
    vi.stubGlobal('crypto', webcrypto); let saved!: LocalCardRecordV1;
    const repository = { putIfAbsent: vi.fn(async (record) => { saved = record; return { written: true }; }) } as unknown as CardRepository;
    const candidate: TavernCardCandidate = { keyword: 'json', chunkType: 'tEXt', parseMethod: 'json', parsed: { name: '测试', description: 'description', signature: 'unverified', custom: { keep: true } } };
    const data = convertTavernToGeneralCard(candidate);
    expect(await saveDesktopTavernCard(repository, data)).toBe('saved'); expect(saved.provenance).toEqual({ kind: 'unsigned', execution: 'imported' });
    expect(readTavernLocalDocument(new TextEncoder().encode(JSON.stringify(saved.data)), 'json').candidates[0].parsed).toEqual(candidate.parsed);
  });

  it('dispatches shared-builder JSON without rewriting bytes or promoting source signatures', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Blob', NodeBlob);
    const create = vi.fn((_blob: NodeBlob) => 'blob:local-json'); const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('edited.json'); expect(this.href).toBe('blob:local-json');
    });
    const dataCard = { templateId: '通用角色', name: '本地', content: '源正文', signature: 'unverified', extra: { preserved: true } };
    const fields = { ...buildDefaultFieldsFromDataCard('general', dataCard), description: '编辑正文' };
    const { card } = buildTavernExportCard({ fields, dataCard, exportMeta: { source: 'local' }, exportedAt: '2026-10-09T12:00:00Z' });
    const bytes = new TextEncoder().encode(JSON.stringify(card));
    exportTavernFile({ name: 'edited.json', bytes, mimeType: 'application/json' });
    expect(click).toHaveBeenCalledTimes(1);
    const blob = create.mock.calls[0][0]; expect(blob.type).toBe('application/json');
    const downloaded = new Uint8Array(await blob.arrayBuffer()); expect([...downloaded]).toEqual([...bytes]);
    const reopened = readTavernLocalDocument(downloaded, 'json').candidates[0].parsed;
    expect(reopened).toEqual(card); expect(reopened).not.toHaveProperty('signature');
    expect(document.querySelector('a')).toBeNull(); expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000); expect(revoke).toHaveBeenCalledWith('blob:local-json');
  });

  it('loads only the fixed packaged logo, rasterizes it locally and caches the default base', async () => {
    vi.resetModules();
    const svg = '<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"></svg>';
    const fetch = vi.fn(async () => ({ ok: true, text: async () => svg })); vi.stubGlobal('fetch', fetch);
    const create = vi.fn(() => 'blob:packaged-logo'); const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    vi.stubGlobal('Image', class {
      decoding = '';
      onload: (() => void) | null = null;
      set src(value: string) { expect(value).toBe('blob:packaged-logo'); queueMicrotask(() => this.onload?.()); }
    });
    const fillRect = vi.fn(); const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillStyle: '', fillRect, drawImage } as unknown as CanvasRenderingContext2D);
    const png = getPlaceholderPngBytes();
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type) {
      expect(this.width).toBe(768); expect(this.height).toBe(384); expect(type).toBe('image/png');
      callback({ arrayBuffer: async () => new Uint8Array(png).buffer } as Blob);
    });
    const { getDesktopTavernBase } = await import('../src/features/tavern/host');
    const pending = getDesktopTavernBase(); expect(getDesktopTavernBase()).toBe(pending);
    expect(await pending).toEqual(png); expect(await getDesktopTavernBase()).toEqual(png);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/logo.svg');
    expect(fillRect).toHaveBeenCalledWith(0, 0, 768, 384); expect(drawImage).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledWith('blob:packaged-logo');
  });

  it('falls back to the packaged placeholder when the fixed logo cannot load, without other requests', async () => {
    vi.resetModules(); const fetch = vi.fn(async () => { throw new Error('asset unavailable'); }); vi.stubGlobal('fetch', fetch);
    const { getDesktopTavernBase } = await import('../src/features/tavern/host');
    expect(await getDesktopTavernBase()).toEqual(getPlaceholderPngBytes());
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/logo.svg');
  });
});
