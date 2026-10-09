import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertForgeDimensions, decodeForgeDataUrl, inspectForgeRaster, validateForgeImage, FORGE_IMAGE_MAX_BYTES, FORGE_JSON_MAX_BYTES } from '../src/features/card-forge/local-media';
import { readLocalForgeDocument, exportLocalForgeDocument } from '../src/features/card-forge/document';
const face = { cardName: '本地卡', cardType: 'character', rarity: 'epic', cost: 3, element: 'dark', attack: 2, defense: 1, hp: 3, effects: [{ type: '被动', description: '效果', future: { keepInOriginal: true } }], traits: [], flavorText: '', powerLevel: 'A', description: '', themeColor: '#ff0000', future: { retained: true } };
const png = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF6sAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const file = (text: string) => { const bytes = new TextEncoder().encode(text); return { name: '原件.json', size: bytes.length, arrayBuffer: async () => bytes.buffer }; };
afterEach(() => vi.unstubAllGlobals());
describe('Desktop forge hostile media boundary', () => {
  it('never resolves remote, blob, local, SVG or html image references', async () => {
    const fetch = vi.fn(); const image = vi.fn(); vi.stubGlobal('fetch', fetch); vi.stubGlobal('Image', image);
    for (const imageUrl of ['https://example.com/private.png', '/api/media-proxy?url=x', 'file:///etc/passwd', 'blob:foreign', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:text/html;base64,PHN2Zy8+']) {
      const input = '\ufeff'+JSON.stringify({ faceData: face, imageUrl, sourceCardData: { secret: 'original only' } });
      const result = await readLocalForgeDocument(file(input));
      expect(result.state.imageUrl).toBeNull(); expect(result.warning).toContain('未加载');
      expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(result.original)).toBe(input);
      const final = JSON.parse(exportLocalForgeDocument(result.state));
      expect(final.illustration).toBeNull(); expect(final.faceData.future).toEqual({ retained: true });
      expect(final.faceData.effects[0]).not.toHaveProperty('future');
    }
    expect(fetch).not.toHaveBeenCalled(); expect(image).not.toHaveBeenCalled();
  });
  it('rejects huge files before read, MIME spoofing, SVG disguised as PNG and inflated headers before decode', async () => {
    const arrayBuffer = vi.fn();
    await expect(readLocalForgeDocument({ name: 'large.json', size: FORGE_JSON_MAX_BYTES + 1, arrayBuffer })).rejects.toThrow('32 MiB'); expect(arrayBuffer).not.toHaveBeenCalled();
    expect(() => decodeForgeDataUrl(`data:image/jpeg;base64,${btoa(String.fromCharCode(...png()))}`)).toThrow('实际内容');
    expect(() => decodeForgeDataUrl('data:image/png;base64,PHN2Zy8+')).toThrow('有效');
    const inflated = png(); new DataView(inflated.buffer).setUint32(16, 100000);
    const image = vi.fn(); vi.stubGlobal('Image', image);
    await expect(validateForgeImage(inflated)).rejects.toThrow('安全上限'); expect(image).not.toHaveBeenCalled();
    expect(() => inspectForgeRaster(new Uint8Array(FORGE_IMAGE_MAX_BYTES + 1))).toThrow('10 MiB');
  });
  it('rejects animated PNG and WebP before browser decode', () => {
    const bytes = png(); bytes.set(new TextEncoder().encode('acTL'), 37);
    expect(() => inspectForgeRaster(bytes)).toThrow('动画');
    const webp = new Uint8Array(30); webp.set(new TextEncoder().encode('RIFF'),0); webp.set(new TextEncoder().encode('WEBPVP8X'),8); webp[20]=2;
    expect(() => inspectForgeRaster(webp)).toThrow('动画');
  });
  it('checks actual decoded dimensions after bounded raster header, retains validated data and rejects broken decode', async () => {
    let width = 1; let height = 1; let broken = false; const urls: string[] = [];
    vi.stubGlobal('Image', class { onload: (() => void) | null = null; onerror: (() => void) | null = null; get naturalWidth() { return width; } get naturalHeight() { return height; } set src(value: string) { if (value) { urls.push(value); queueMicrotask(() => broken ? this.onerror?.() : this.onload?.()); } } });
    const result = await validateForgeImage(png()); expect(result).toMatch(/^data:image\/png;base64,/);
    expect(decodeForgeDataUrl(result)?.bytes).toEqual(png()); expect(urls).toHaveLength(1);
    width = 100000; await expect(validateForgeImage(png())).rejects.toThrow('安全上限');
    width = 8192; height = 8192; await expect(validateForgeImage(png())).rejects.toThrow('安全上限');
    broken = true; await expect(validateForgeImage(png())).rejects.toThrow('无法解码');
  });
  it('rejects deep, oversized-node and unsafe-key trees before shared schema while keeping original schema limits', async () => {
    const nested = '{"extra":'.repeat(70) + '0' + '}'.repeat(70);
    await expect(readLocalForgeDocument(file(nested))).rejects.toThrow('结构过深');
    await expect(readLocalForgeDocument(file(JSON.stringify({ ...face, extra: Array.from({ length: 10001 }, () => 0) })))).rejects.toThrow('节点过多');
    await expect(readLocalForgeDocument(file('{"__proto__":{"polluted":true}}'))).rejects.toThrow('不安全字段');
  });
  it('rejects unsupported JSON/version without silently treating forge as direct face', async () => {
    await expect(readLocalForgeDocument(file('{broken'))).rejects.toThrow();
    await expect(readLocalForgeDocument(file(JSON.stringify({ documentType: 'maho-shojo-game-card-forge', documentVersion: 999, faceData: face, illustration: null })))).rejects.toThrow('版本');
  });
  it('keeps unrestricted card fields, bounds final UTF-8 JSON without truncating, and bounds capture geometry', async () => {
    const original = await readLocalForgeDocument(file(JSON.stringify(face)));
    original.state.faceData.description = '汉'.repeat(FORGE_JSON_MAX_BYTES / 3);
    expect(() => exportLocalForgeDocument(original.state)).toThrow('未截断');
    expect(() => assertForgeDimensions(2160, 12000)).toThrow('安全上限');
    expect(() => assertForgeDimensions(8192, 8192)).toThrow('安全上限');
    expect(() => assertForgeDimensions(2160, 4000)).not.toThrow();
  });
});
