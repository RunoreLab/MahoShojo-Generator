// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopAiProviderPanelProps } from '../src/features/ai-config/desktop-ai-provider-panel';
import type { DesktopGenerationOutcome } from '../src/features/generation/executor';
import { ForgeGenerationPanel } from '../src/features/card-forge/generation-panel';
const mocks = vi.hoisted(() => ({ provider: null as DesktopAiProviderPanelProps | null, execute: vi.fn(), prepared: vi.fn(), cancel: vi.fn(), target: { location: 'client', mode: 'direct-local', modelId: 'frozen', providerTarget: { kind: 'custom', profileId: 'test' }, profile: { id: 'test' }, unavailableReason: null } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../src/platform/card-library-host', () => ({ useDesktopCardLibraryHost: () => ({}) }));
vi.mock('@mahoshojo/ui-web/card-library', () => ({ CardLibraryModal: () => null }));
vi.mock('../src/features/ai-config/desktop-ai-provider-panel', () => ({ DesktopAiProviderPanel: (props: DesktopAiProviderPanelProps) => { mocks.provider = props; return null; } }));
vi.mock('../src/features/ai-config/desktop-ai-config', () => ({ resolveDesktopAiTargetForState: () => mocks.target }));
vi.mock('../src/features/ai-config/use-desktop-ai-config', () => ({ useDesktopAiConfig: () => ({ state: { profilesState: 'ready', generationActive: false }, store }) }));
vi.mock('../src/features/card-forge/generation', async importOriginal => ({ ...await importOriginal<typeof import('../src/features/card-forge/generation')>(), executeForgeGeneration: mocks.execute }));
const store = { withPreparedGeneration: mocks.prepared, cancelPreparingGeneration: mocks.cancel };
const face = { cardName: '新卡', cardType: 'character', rarity: 'epic', cost: 3, element: 'dark', attack: 2, defense: 1, hp: 3, effects: [{ type: '被动', description: '效果' }], traits: [], flavorText: '', powerLevel: 'A', description: '', themeColor: '#ef4444' };
const result: DesktopGenerationOutcome<'game-card'> = { status: 'completed', mode: 'direct-local', cardKind: 'game-card', card: face, rawText: JSON.stringify(face) };
function inputValue(input: HTMLTextAreaElement, value: string) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }
afterEach(() => { vi.clearAllMocks(); });
describe('forge source generation UI transaction', () => {
  it('forwards provider draft state separately from source edits', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); const root = createRoot(container);
    const onProviderDirtyChange = vi.fn(); const onInputDirty = vi.fn();
    try {
      await act(async () => root.render(<ForgeGenerationPanel disabled={false} onBusyChange={() => {}} onGenerated={() => {}} onProviderDirtyChange={onProviderDirtyChange} onInputDirty={onInputDirty} onBeforeGenerate={() => true} />));
      const buttonLabels = [...container.querySelectorAll('button')].map(button => button.textContent);
      expect(buttonLabels).toContain('选择本地源卡');
      expect(buttonLabels).toContain('生成卡牌卡面');
      expect(mocks.provider!.onDirtyChange).toBe(onProviderDirtyChange);
      act(() => mocks.provider!.onDirtyChange!(true));
      act(() => mocks.provider!.onDirtyChange!(false));
      expect(onProviderDirtyChange.mock.calls).toEqual([[true], [false]]);
      expect(onInputDirty).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); }
  });
  it.each(['completed', 'cancelled', 'invalid-output', 'unmount'] as const)('only commits successful current work: %s', async outcome => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    let finish!: (value: DesktopGenerationOutcome<'game-card'>) => void;
    mocks.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mocks.prepared.mockImplementation(async fn => fn(mocks.target));
    const onGenerated = vi.fn(); const onBusyChange = vi.fn(); const onBeforeGenerate = vi.fn(() => true);
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    let mounted = true;
    try {
      await act(async () => root.render(<ForgeGenerationPanel disabled={false} onBusyChange={onBusyChange} onGenerated={onGenerated} onProviderDirtyChange={() => {}} onInputDirty={() => {}} onBeforeGenerate={onBeforeGenerate} />));
      const source = container.querySelector<HTMLTextAreaElement>('[aria-label="源数据卡 JSON"]')!;
      act(() => inputValue(source, '{"name":"源卡","unknown":true}'));
      const button = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('生成卡牌卡面'))!;
      await act(async () => { button.click(); button.click(); });
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(source.value).toBe('{"name":"源卡","unknown":true}');
      expect(mocks.execute.mock.calls[0]![2]).toMatchObject({ modelId: 'frozen', generationMode: 'non-stream' });
      if (outcome === 'cancelled') act(() => container.querySelector<HTMLButtonElement>('[aria-label="停止生成"]')!.click());
      if (outcome === 'unmount') { act(() => root.unmount()); mounted = false; }
      await act(async () => finish(outcome === 'invalid-output' ? { status: 'invalid-output', mode: 'direct-local', rawText: 'broken', message: '非法 JSON' } : result));
      if (outcome === 'completed') expect(onGenerated).toHaveBeenCalledWith(face, '{"name":"源卡","unknown":true}');
      else expect(onGenerated).not.toHaveBeenCalled();
      if (mounted) expect(source.value).toBe('{"name":"源卡","unknown":true}');
      expect(onBusyChange.mock.calls.at(-1)).toEqual([false]);
    } finally { if (mounted) act(() => root.unmount()); container.remove(); }
  });
  it('keeps the previous input on invalid source-file import and never dispatches', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); const root = createRoot(container);
    try {
      await act(async () => root.render(<ForgeGenerationPanel disabled={false} onBusyChange={() => {}} onGenerated={() => {}} onProviderDirtyChange={() => {}} onInputDirty={() => {}} onBeforeGenerate={() => true} />));
      const source = container.querySelector('textarea')!;
      act(() => inputValue(source, '{"name":"保留源卡"}'));
      const file = container.querySelector<HTMLInputElement>('[aria-label="导入源数据卡"]')!;
      const bytes = new TextEncoder().encode(JSON.stringify(face));
      Object.defineProperty(file, 'files', { configurable: true, value: [{ size: bytes.length, arrayBuffer: async () => bytes.buffer }] });
      await act(async () => file.dispatchEvent(new Event('change', { bubbles: true })));
      expect(source.value).toBe('{"name":"保留源卡"}');
      expect(container.textContent).toContain('这是工坊存档或卡面');
      expect(mocks.prepared).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); }
  });
  it('lets the old-work guard veto replacement before preparing or dispatching', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); const root = createRoot(container);
    try {
      await act(async () => root.render(<ForgeGenerationPanel disabled={false} onBusyChange={() => {}} onGenerated={() => {}} onProviderDirtyChange={() => {}} onInputDirty={() => {}} onBeforeGenerate={() => false} />));
      act(() => inputValue(container.querySelector('textarea')!, '{"name":"源卡"}'));
      await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes('生成卡牌卡面'))!.click());
      expect(mocks.prepared).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); }
  });
});
