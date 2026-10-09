// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPagePreferencesAdapter, PagePreferencesCard, resolvePagePreferenceFieldDefault } from '@mahoshojo/ui-web/settings';
import { createScenarioPagePreferenceAdapter, WEB_SCENARIO_PREFERENCES, WEB_SUBLIMATION_PREFERENCES, WEB_SUBLIMATION_STATE_PREFERENCES } from '@/lib/settings/page-preferences';
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  localStorage.clear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it.each([WEB_SCENARIO_PREFERENCES, WEB_SUBLIMATION_PREFERENCES, WEB_SUBLIMATION_STATE_PREFERENCES])('$pageId settings first-write uses its owner and shows write/reset failure without losing the saved value', async (source) => {
  const adapter = source === WEB_SCENARIO_PREFERENCES ? createScenarioPagePreferenceAdapter(localStorage) : createPagePreferencesAdapter(source, localStorage);
  const field = source.fields.find((item) => item.kind === 'boolean')!;
  await act(async () => root.render(<PagePreferencesCard adapter={adapter} />));
  const control = container.querySelector<HTMLButtonElement>(`[aria-label='${field.label}']`)!;
  await act(async () => control.click());
  expect(adapter.read()).toMatchObject({ status: 'ready', values: { [field.key]: !resolvePagePreferenceFieldDefault(field) } });
  const raw = localStorage.getItem(source.storageKey);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await act(async () => control.click());
  expect(container.querySelector('[role=alert]')?.textContent).toContain('写入失败');
  expect(localStorage.getItem(source.storageKey)).toBe(raw);
  const reset = [...container.querySelectorAll('button')].find((button) => button.textContent === '重置该页偏好')!;
  await act(async () => reset.click()); await act(async () => reset.click());
  expect(container.querySelector('[role=alert]')?.textContent).toContain('重置失败');
  expect(localStorage.getItem(source.storageKey)).toBe(raw);
});
