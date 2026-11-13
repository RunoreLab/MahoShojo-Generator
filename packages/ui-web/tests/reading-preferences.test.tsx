// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_READING_PREFERENCES,
  READING_PREFERENCE_STORAGE_KEY,
  normalizeReadingPreferences,
  parseReadingPreferencesText,
} from '../src/device-preferences/reading-init';
import { getReadingPreferenceInitScript } from '../src/device-preferences/init';
import { ReadingPreferenceStore } from '../src/device-preferences/reading';
import { ReadingSettingsCard } from '../src/settings/ReadingSettingsCard';

const stores: ReadingPreferenceStore[] = [];
const makeStore = (deps?: ConstructorParameters<typeof ReadingPreferenceStore>[0]) => {
  const store = new ReadingPreferenceStore(deps);
  stores.push(store);
  return store;
};

beforeEach(() => {
  localStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  stores.splice(0).forEach((store) => store.dispose());
  for (const key of ['readingSize', 'readingFont', 'readingLineHeight', 'readingWidth']) {
    delete document.documentElement.dataset[key];
  }
});

describe('reading preference contract and bootstrap', () => {
  it('normalizes each invalid field without letting arbitrary CSS values through', () => {
    expect(normalizeReadingPreferences({ sizePercent: 999, font: 'url(remote)', lineHeight: 1, width: 'wide' }))
      .toEqual(DEFAULT_READING_PREFERENCES);
    expect(normalizeReadingPreferences({ sizePercent: 150, font: 'serif', lineHeight: 'relaxed', width: 'narrow' }))
      .toEqual({ sizePercent: 150, font: 'serif', lineHeight: 'relaxed', width: 'narrow' });
    expect(() => parseReadingPreferencesText('{"version":2}')).toThrow();
    expect(() => parseReadingPreferencesText('broken')).toThrow();
  });

  it.each([110, 125, 150, 175, 200])('bootstrap and runtime normalize %s%% identically', (sizePercent) => {
    const text = JSON.stringify({ version: 1, sizePercent, font: 'serif', lineHeight: 'comfortable', width: 'narrow' });
    const addEventListener = vi.fn();
    new Function('window', 'document', getReadingPreferenceInitScript())({
      localStorage: { getItem: () => text }, addEventListener,
    }, document);
    expect(document.documentElement.dataset.readingSize).toBe(String(parseReadingPreferencesText(text).sizePercent));
    expect(document.documentElement.dataset.readingFont).toBe('serif');
    expect(document.documentElement.dataset.readingLineHeight).toBe('comfortable');
    expect(document.documentElement.dataset.readingWidth).toBe('narrow');
    expect(addEventListener).toHaveBeenCalledWith('storage', expect.any(Function));
  });

  it('bootstrap tolerates inaccessible storage and applies safe defaults', () => {
    new Function('window', 'document', getReadingPreferenceInitScript())({
      get localStorage() { throw new Error('denied'); }, addEventListener: () => {},
    }, document);
    expect(document.documentElement.dataset.readingSize).toBe('100');
    expect(document.documentElement.dataset.readingFont).toBe('default');
  });

  it('bootstrap observes cross-tab changes even without mounting settings', () => {
    let callback: ((event: { key: string | null }) => void) | undefined;
    new Function('window', 'document', getReadingPreferenceInitScript())({
      localStorage,
      addEventListener: (_name: string, handler: typeof callback) => { callback = handler; },
    }, document);
    localStorage.setItem(READING_PREFERENCE_STORAGE_KEY, JSON.stringify({ version: 1, sizePercent: 200 }));
    callback?.({ key: 'unrelated' });
    expect(document.documentElement.dataset.readingSize).toBe('100');
    callback?.({ key: READING_PREFERENCE_STORAGE_KEY });
    expect(document.documentElement.dataset.readingSize).toBe('200');
    localStorage.clear();
    callback?.({ key: null });
    expect(document.documentElement.dataset.readingSize).toBe('100');
  });
});

describe('single reading preference store', () => {
  it('does not create or overwrite storage merely by reading defaults or corrupt data', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const store = makeStore();
    store.ready();
    expect(setItem).not.toHaveBeenCalled();
    expect(store.getSnapshot().preferences).toEqual(DEFAULT_READING_PREFERENCES);
    localStorage.setItem(READING_PREFERENCE_STORAGE_KEY, 'broken');
    const corrupt = makeStore();
    corrupt.ready();
    expect(corrupt.getSnapshot().saveError).toContain('无法读取');
    expect(localStorage.getItem(READING_PREFERENCE_STORAGE_KEY)).toBe('broken');
  });

  it('merges rapid changes, persists exactly one reading blob, and restores after restart', () => {
    const store = makeStore();
    store.setPreferences({ sizePercent: 150 });
    store.setPreferences({ font: 'serif' });
    store.setPreferences({ lineHeight: 'relaxed' });
    expect(localStorage.length).toBe(1);
    const restored = makeStore();
    restored.ready();
    expect(restored.getSnapshot().preferences).toEqual({ sizePercent: 150, font: 'serif', lineHeight: 'relaxed', width: 'default' });
    expect(document.documentElement.dataset.readingSize).toBe('150');
  });

  it('keeps the requested appearance for this session and reports failed persistence', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const store = makeStore();
    store.setPreferences({ sizePercent: 200 });
    expect(store.getSnapshot().preferences.sizePercent).toBe(200);
    expect(document.documentElement.dataset.readingSize).toBe('200');
    expect(store.getSnapshot().saveError).toContain('未能保存在本机');
    setItem.mockRestore();
    store.setPreferences({ font: 'sans' });
    expect(store.getSnapshot().saveError).toBeNull();
    expect(parseReadingPreferencesText(localStorage.getItem(READING_PREFERENCE_STORAGE_KEY)).sizePercent).toBe(200);
  });

  it('reads external changes and reset only clears reading preferences', () => {
    const store = makeStore();
    const changed = vi.fn();
    store.subscribe(changed);
    store.ready();
    localStorage.setItem('mahoshojo.color-mode', 'dark');
    localStorage.setItem('draft', 'keep');
    localStorage.setItem(READING_PREFERENCE_STORAGE_KEY, JSON.stringify({ version: 1, sizePercent: 175 }));
    window.dispatchEvent(new StorageEvent('storage', { key: READING_PREFERENCE_STORAGE_KEY }));
    expect(store.getSnapshot().preferences.sizePercent).toBe(175);
    expect(changed).toHaveBeenCalled();
    store.reset();
    expect(store.getSnapshot().preferences).toEqual(DEFAULT_READING_PREFERENCES);
    expect(localStorage.getItem(READING_PREFERENCE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('mahoshojo.color-mode')).toBe('dark');
    expect(localStorage.getItem('draft')).toBe('keep');
  });
});

describe('production reading settings', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('updates two mounted settings panels through one source and retains a semantic preview', () => {
    const store = makeStore();
    act(() => root.render(<><ReadingSettingsCard store={store} /><ReadingSettingsCard store={store} /></>));
    const controls = container.querySelectorAll<HTMLSelectElement>('select[aria-label="阅读字号"]');
    act(() => {
      controls[0].value = '150';
      controls[0].dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(controls[1].value).toBe('150');
    const preview = container.querySelector('[aria-label="阅读效果预览"]')!;
    expect(preview.querySelector('.app-reading.app-reading-width')).not.toBeNull();
    expect(preview.querySelector('h4')).not.toBeNull();
    expect(preview.querySelectorAll('li')).toHaveLength(2);
    expect(preview.textContent).toContain('The story continues');
    act(() => (container.querySelector('button') as HTMLButtonElement).click());
    expect(controls[0].value).toBe('100');
    expect(controls[1].value).toBe('100');
  });

  it('renders an explicit temporary-display message if saving is blocked', () => {
    const store = makeStore();
    act(() => root.render(<ReadingSettingsCard store={store} />));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const font = container.querySelector<HTMLSelectElement>('select[aria-label="阅读字体"]')!;
    act(() => {
      font.value = 'serif';
      font.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('未能保存在本机');
  });
});
