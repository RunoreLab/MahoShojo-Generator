// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_LIST } from '@mahoshojo/domain/presets';
import { PresetGridPicker } from '@/components/PresetGridPicker';
import { PresetSelector } from '@/components/arena/components/PresetSelector';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

vi.mock('@/components/arena/hooks/useArenaData', () => ({ usePresetQuery: () => ({ grouped: { magicalGirl: PRESET_LIST.filter(preset => preset.type === 'magical-girl'), canshou: PRESET_LIST.filter(preset => preset.type === 'canshou') }, isLoading: false, error: null }) }));
let root: Root, container: HTMLDivElement;
const preset = PRESET_LIST.find((entry) => entry.filename === 'M01_centaurea.json')!;
const originalPreset = (path: string) => new Uint8Array(readFileSync(resolve(process.cwd(), '../../content', path.slice(1))));
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  useBattleStore.setState({ combatants: [], isGenerating: false, loadingPreset: null, error: null });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(originalPreset(String(input)))));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('Web character preset selector shared composition', () => {
  it('retains real selection/deselection, original download links and independent page positions', async () => {
    await act(async () => root.render(<PresetSelector />));
    const girls = [...container.querySelectorAll('h3')].find(item => item.textContent === '选择预设魔法少女')!.parentElement!;
    const monsters = [...container.querySelectorAll('h3')].find(item => item.textContent === '选择预设残兽')!.parentElement!;
    const select = () => girls.querySelector<HTMLButtonElement>('[aria-pressed]')!;
    await act(async () => select().click());
    expect(useBattleStore.getState().combatants[0]).toMatchObject({ filename: 'M01_centaurea.json', isPreset: true, isValid: true });
    expect(select().getAttribute('aria-pressed')).toBe('true');
    const link = girls.querySelector<HTMLAnchorElement>('[download]')!;
    expect(link.getAttribute('href')).toBe('/presets/M01_centaurea.json'); expect(link.download).toBe('M01_centaurea.json');
    await act(async () => select().click()); expect(useBattleStore.getState().combatants).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => [...girls.querySelectorAll('button')].find(button => button.textContent === '下一页')!.click());
    expect(girls.textContent).toContain('第 2 /'); expect(monsters.textContent).toContain('第 1 /');
    await act(async () => useBattleStore.setState({ isGenerating: true }));
    expect(select().disabled).toBe(true); expect(monsters.querySelector<HTMLButtonElement>('[aria-pressed]')!.disabled).toBe(true);
  });

  it.each([
    ['竞技场预设区', () => <PresetSelector />],
    ['茶会预设网格', () => <PresetGridPicker title="预设魔法少女" presets={[preset]} currentPage={1}
      onPageChange={() => {}} selectedFilenames={[]} onToggle={vi.fn()} />],
  ] as const)('%s 在 Android Edge 上取消保存后可重试，写入原始角色文件', async (_label, renderView) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 10; K) EdgA/151.0.0.0');
    const write = vi.fn<(blob: Blob) => Promise<void>>().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const showSaveFilePicker = vi.fn()
      .mockRejectedValueOnce(new DOMException('Picker closed', 'AbortError'))
      .mockResolvedValue({ createWritable: async () => ({ write, close }) });
    vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);
    await act(async () => root.render(renderView()));
    const link = container.querySelector<HTMLAnchorElement>('a[download="M01_centaurea.json"]')!;
    const path = '/presets/M01_centaurea.json';
    expect(link.getAttribute('href')).toBe(path);
    const clickDownload = () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await act(async () => {
      expect(clickDownload()).toBe(false);
      expect(showSaveFilePicker).toHaveBeenCalledExactlyOnceWith({ suggestedName: preset.filename });
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();

    await act(async () => { expect(clickDownload()).toBe(false); });
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(path, { credentials: 'omit', redirect: 'error' });
    expect(write).toHaveBeenCalledOnce();
    expect(new Uint8Array(await write.mock.calls[0]![0].arrayBuffer())).toEqual(originalPreset(path));
    expect(close).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(useBattleStore.getState().combatants).toHaveLength(0);
  });
});
