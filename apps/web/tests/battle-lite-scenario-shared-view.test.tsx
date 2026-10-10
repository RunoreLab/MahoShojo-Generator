// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BattleLiteScenarioSection } from '@/components/arena-lite/BattleLiteScenarioSection';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { SCENARIO_PRESET_LIST } from '@/lib/scenario-presets';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
const openOnline = vi.fn();
const button = (label: string) => {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};
const render = async () => {
  await act(async () => root.render(<QueryClientProvider client={queryClient}>
    <BattleLiteScenarioSection onOpenScenarioModal={openOnline} isAuthenticated={false} />
  </QueryClientProvider>));
};
const input = async (value: string) => {
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return textarea;
};
beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(['arena', 'scenario-presets'], SCENARIO_PRESET_LIST);
  useBattleStore.setState(useBattleStore.getInitialState(), true);
  useBattleStore.setState({ battleMode: 'scenario', auxScenarios: [{ id: 'kept', content: { title: 'advanced' }, fileName: 'advanced.json', isNative: false }] });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ title: SCENARIO_PRESET_LIST[0].title })));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); queryClient.clear(); vi.unstubAllGlobals(); localStorage.clear();
});
describe('Lite Web adapter consumes shared main-scenario controls', () => {
  it('keeps Web links and disabled rules, while auxiliary controls stay absent and inherited auxiliary data stays untouched', async () => {
    await render();
    expect(container.querySelector('.battle-lite-surface-card')).not.toBeNull();
    expect(container.textContent).toContain('未选择主情景');
    expect(button('清空情景').disabled).toBe(true);
    expect(container.querySelector('a[href="/character-manager"]')).not.toBeNull();
    expect(container.textContent).not.toContain('辅助情景（可选）');
    await act(async () => button('浏览在线情景库').click()); expect(openOnline).toHaveBeenCalledOnce();
    await act(async () => useBattleStore.setState({ isGenerating: true }));
    expect(button('浏览在线情景库').disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('#scenario-upload')!.disabled).toBe(true);
    expect(useBattleStore.getState().auxScenarios[0].id).toBe('kept');
  });
  it('retains failed paste, clears successful paste, and clears main selection without clearing advanced data', async () => {
    await render();
    await act(async () => button('展开情景粘贴区域（手机端推荐）').click());
    const textarea = await input('{ invalid');
    await act(async () => button('从文本加载情景').click());
    expect(textarea.value).toBe('{ invalid'); expect(useBattleStore.getState().error).toContain('❌');
    await input(JSON.stringify({ title: '雨夜舞台' }));
    await act(async () => button('从文本加载情景').click());
    expect(textarea.value).toBe(''); expect(container.textContent).toContain('雨夜舞台');
    await act(async () => button('清空情景').click());
    expect(useBattleStore.getState().scenario.content).toBeNull();
    expect(useBattleStore.getState().auxScenarios[0].id).toBe('kept');
  });
  it('uses the same preset picker for select, deselect, pagination and original Web downloads', async () => {
    await render();
    const heading = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('推荐预设情景'))!;
    await act(async () => heading.click());
    const filename = SCENARIO_PRESET_LIST[0].filename;
    expect(container.querySelector(`a[download="${filename}"]`)?.getAttribute('href')).toBe(`/scenario-presets/${encodeURIComponent(filename)}`);
    const selection = () => container.querySelector<HTMLButtonElement>(`button[aria-label$="：${SCENARIO_PRESET_LIST[0].title}"]`)!;
    await act(async () => selection().click());
    expect(selection().getAttribute('aria-pressed')).toBe('true');
    expect(useBattleStore.getState().scenario.isPreset).toBe(true);
    await act(async () => selection().click());
    expect(selection().getAttribute('aria-pressed')).toBe('false');
    expect(useBattleStore.getState().scenario.content).toBeNull();
    await act(async () => button('下一页').click()); expect(container.textContent).toContain('第 2 / 4 页');
    expect(useBattleStore.getState().auxScenarios[0].id).toBe('kept');
  });
});
