// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPagePreferencesAdapter, PagePreferencesCard } from '@mahoshojo/ui-web/settings';
import { DESKTOP_CREATOR_PREFERENCES, DESKTOP_SCENARIO_PREFERENCES, DESKTOP_SUBLIMATION_PREFERENCES } from '../src/app/settings-page-preferences';
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
it.each([DESKTOP_CREATOR_PREFERENCES, DESKTOP_SCENARIO_PREFERENCES, DESKTOP_SUBLIMATION_PREFERENCES])('$pageId settings card displays writes/reset errors and does not pretend to save', async (source) => {
  const adapter = createPagePreferencesAdapter(source, localStorage);
  const field = source.fields.find((item) => item.kind === 'boolean')!;
  expect(adapter.writeField(field.key, true)).toBe(true);
  const raw = localStorage.getItem(source.storageKey);
  await act(async () => root.render(<PagePreferencesCard adapter={adapter} />));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label='${field.label}']`)!.click());
  expect(container.querySelector('[role=alert]')?.textContent).toContain('写入失败');
  expect(localStorage.getItem(source.storageKey)).toBe(raw);
  const reset = [...container.querySelectorAll('button')].find((button) => button.textContent === '重置该页偏好')!;
  await act(async () => reset.click()); await act(async () => reset.click());
  expect(container.querySelector('[role=alert]')?.textContent).toContain('重置失败');
  expect(localStorage.getItem(source.storageKey)).toBe(raw);
});
