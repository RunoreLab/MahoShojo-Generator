// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameCardFace, CardForgeThemeEditor, ImageCropEditor } from '../src/card-forge';
import { DENY_SNAPDOM_MEDIA, type capturePngBlob } from '../src/client/snapdomCapture';
const face = { cardName: '蔷薇', cardType: 'character' as const, rarity: 'epic' as const, cost: 3, element: 'dark' as const, attack: 2, defense: 1, hp: 3, effects: [{ type: '被动', description: '效果' }], traits: [], flavorText: '', powerLevel: 'A', description: '', themeColor: '#ef4444' };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('shared forge real controls and capture lifecycle', () => {
  it('preserves card/crop DOM, selected preset and canonical control callbacks', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const color = vi.fn(); const ratio = vi.fn();
    try {
      await act(async () => root.render(<><CardForgeThemeEditor color="#ef4444" onChange={color} /><ImageCropEditor imageUrl="data:image/png;base64,aA==" imageAspectRatio="4:3" imageTransform={{ scale: 1, x: 0, y: 0 }} onAspectRatioChange={ratio} onTransformChange={() => {}} onReset={() => {}} /><GameCardFace faceData={face} showSaveButton={false} /></>));
      expect(container.querySelector('.gc-card')).toBeTruthy(); expect(container.querySelector('.gc-name-text')?.textContent).toBe('蔷薇');
      expect(container.querySelector('.card-forge-crop-viewport')).toBeTruthy();
      const colors = [...container.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.style.backgroundColor);
      expect(colors.filter((button) => button.style.boxShadow !== 'none')).toHaveLength(1);
      act(() => colors[0].click()); expect(color).toHaveBeenCalledWith('#ff6b9d');
      const select = container.querySelector('select')!;
      act(() => { select.value = '3:4'; select.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(ratio).toHaveBeenCalledWith('3:4');
    } finally { act(() => root.unmount()); container.remove(); }
  });
  it('single-flights capture, supplies media host, and suppresses late download and callbacks after unmount', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    let resolve!: (blob: Blob) => void;
    const capture = vi.fn<typeof capturePngBlob>(() => new Promise<Blob>((done) => { resolve = done; })); const download = vi.fn(); const busy = vi.fn();
    await act(async () => root.render(<GameCardFace faceData={face} mediaAdapter={DENY_SNAPDOM_MEDIA} captureImage={capture} downloadImage={download} imageSaveMode="download" onExportStateChange={busy} />));
    const button = container.querySelector('button')!;
    await act(async () => { button.click(); button.click(); });
    expect(capture).toHaveBeenCalledTimes(1); expect(capture.mock.calls[0]?.[1]).toMatchObject({ mediaAdapter: DENY_SNAPDOM_MEDIA, scale: 2, dprMax: 3 });
    expect(busy.mock.calls).toEqual([[true]]);
    act(() => root.unmount());
    await act(async () => resolve(new Blob(['png'], { type: 'image/png' })));
    expect(download).not.toHaveBeenCalled(); expect(busy.mock.calls).toEqual([[true]]); container.remove();
  });
  it('reports rejected capture and permits retry; host veto prevents cross-operation capture', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = document.createElement('div'); const root = createRoot(container);
    const capture = vi.fn().mockRejectedValueOnce(new Error('budget')).mockResolvedValue(new Blob(['png']));
    const error = vi.fn(); const download = vi.fn(); let allowed = false;
    try {
      await act(async () => root.render(<GameCardFace faceData={face} canStartExport={() => allowed} captureImage={capture} downloadImage={download} imageSaveMode="download" onExportError={error} />));
      await act(async () => container.querySelector('button')!.click()); expect(capture).not.toHaveBeenCalled();
      allowed = true; await act(async () => container.querySelector('button')!.click()); expect(error).toHaveBeenCalledTimes(1);
      await act(async () => container.querySelector('button')!.click()); expect(download).toHaveBeenCalledTimes(1);
    } finally { act(() => root.unmount()); }
  });
});
