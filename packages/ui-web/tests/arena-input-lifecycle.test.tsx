// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ArenaRosterImportPanel, ArenaMaterialSection, ArenaScenarioSection, ScenarioPickerPanel,
  type ArenaInputLifecyclePorts, type ArenaScenarioSectionModel } from '../src/arena';
const scenarioModel = (paste: (text: string) => Promise<void>): ArenaScenarioSectionModel => ({
  disabled: false, isAuthenticated: true, isMatchingBlocked: false, isMatchingScenario: false, mainName: null, mainIsNative: false,
  auxScenarios: [], auxBudgetLine: null, auxBudgetExhausted: false, presets: [], presetsLoading: false, presetsError: null,
  selectedPresetFilenames: [], loadingPresetFilename: null,
  capabilities: { browseMain: false, randomMatchMain: false, clearMain: false, uploadMain: true, pasteMain: true, presetRefs: false, auxSection: false,
    addAux: false, browseAux: false, randomMatchAux: false, uploadAux: false, pasteAux: false, reorderAux: false, removeAux: false, clearAux: false },
  actions: { openMainModal: vi.fn(), randomMatchMain: vi.fn(), clearMain: vi.fn(), uploadMain: async () => {}, pasteMain: paste,
    openAuxModal: vi.fn(), randomMatchAux: vi.fn(), uploadAux: async () => {}, pasteAux: async () => {}, togglePreset: vi.fn(), moveAux: vi.fn(), removeAux: vi.fn(), clearAux: vi.fn() },
});
const cases: Array<[string, (ports: ArenaInputLifecyclePorts, paste: (text: string) => Promise<void>) => ReactElement]> = [
  ['roster', (ports, paste) => <ArenaRosterImportPanel {...ports} onUpload={async () => {}} onPaste={paste} />],
  ['scenario input', (ports, paste) => <ScenarioPickerPanel {...ports} isAuthenticated onScenarioPaste={paste} />],
  ['scenario section', (ports, paste) => <ArenaScenarioSection {...ports} model={scenarioModel(paste)} />],
  ['material', (ports, paste) => <ArenaMaterialSection {...ports} model={{ disabled: false, items: [], hasReferenceCapacity: true,
    capabilities: { browseOnline: false, clearAll: false, upload: true, paste: true, reorder: false },
    actions: { openModal: vi.fn(), clearAll: vi.fn(), upload: async () => {}, paste, move: vi.fn(), remove: vi.fn() } }} />],
];
describe('temporary input state reports to the one host leave guard', () => {
  it.each(cases)('%s reports dirty/busy, keeps rejected input and clears on success/unmount', async (_name, render) => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const dirty = vi.fn(); const busy = vi.fn(); let resolve!: () => void; let reject!: (error: Error) => void;
    const paste = vi.fn(() => new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
    try {
      await act(async () => root.render(render({ onDirtyChange: dirty, onBusyChange: busy }, paste)));
      const disclosure = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('展开'))!;
      await act(async () => disclosure.click());
      const textarea = container.querySelector('textarea')!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'unsaved'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
      expect(dirty).toHaveBeenLastCalledWith(true);
      const submit = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('从文本'))!;
      await act(async () => submit.click()); expect(busy).toHaveBeenLastCalledWith(true);
      await act(async () => reject(new Error('invalid')));
      expect(textarea.value).toBe('unsaved'); expect(busy).toHaveBeenLastCalledWith(false); expect(dirty).toHaveBeenLastCalledWith(true);
      await act(async () => submit.click()); await act(async () => resolve());
      expect(textarea.value).toBe(''); expect(dirty).toHaveBeenLastCalledWith(false); expect(busy).toHaveBeenLastCalledWith(false);
    } finally { await act(async () => root.unmount()); container.remove(); }
    expect(dirty).toHaveBeenLastCalledWith(false); expect(busy).toHaveBeenLastCalledWith(false);
  });
  it('keeps overlapping operations busy until all settle and never renotifies after unmount', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const dirty = vi.fn(); const busy = vi.fn(); const completions: Array<() => void> = [];
    const paste = () => new Promise<void>((resolve) => completions.push(resolve));
    await act(async () => root.render(<ScenarioPickerPanel isAuthenticated onScenarioPaste={paste} onDirtyChange={dirty} onBusyChange={busy} />));
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('展开'))!.click());
    const textarea = container.querySelector('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'pending'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    const submit = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('从文本'))!;
    await act(async () => { submit.click(); submit.click(); });
    expect(completions).toHaveLength(2); expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => completions[0]()); expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => root.unmount()); container.remove();
    expect(busy).toHaveBeenLastCalledWith(false); expect(dirty).toHaveBeenLastCalledWith(false);
    const busyCount = busy.mock.calls.length; const dirtyCount = dirty.mock.calls.length;
    await act(async () => completions[1]());
    expect(busy).toHaveBeenCalledTimes(busyCount); expect(dirty).toHaveBeenCalledTimes(dirtyCount);
  });

});
