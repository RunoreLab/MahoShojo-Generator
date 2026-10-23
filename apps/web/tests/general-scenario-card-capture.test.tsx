// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('@zumer/snapdom', () => ({ snapdom: mocks.capture }));
vi.mock('@/lib/client/snapdomCapture', () => ({ getSnapdomProxyUrl: () => undefined }));
vi.mock('@/components/MarkdownBlock', async () => ({ MarkdownBlock: (await import('@mahoshojo/ui-web/markdown')).MarkdownBlock }));
import GeneralScenarioCard from '@/components/GeneralScenarioCard';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('captures the selected scenario preview while excluding only its recovery controls and preserving JSON', async () => {
  const scenario = { title: '合成情景', content: '# 简报\\n\\n---\\n\\n## 任务\\n记录星轨。' };
  const original = JSON.stringify(scenario);
  const save = vi.fn();
  mocks.capture.mockImplementation(async (element: HTMLElement, options: { exclude: string[]; excludeMode: string }) => {
    expect(element.querySelector('h3')?.textContent).toBe('任务');
    expect(options.exclude).toContain('[data-scenario-preview-controls]');
    expect(options.excludeMode).toBe('remove');
    const controls = element.querySelector(options.exclude[0])!;
    expect(controls.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(controls.querySelector('h2, h3')).toBeNull();
    expect(element.querySelector<HTMLElement>('.save-button')?.style.display).toBe('none');
    return { toPng: async () => ({ src: 'data:image/png;base64,synthetic' }) };
  });
  await act(async () => root.render(<GeneralScenarioCard scenario={scenario} imageSaveMode="modal" onSaveImage={save} />));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('.save-button')!.click());
  expect(mocks.capture).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledExactlyOnceWith('data:image/png;base64,synthetic');
  expect(JSON.stringify(scenario)).toBe(original);
  expect(container.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector<HTMLElement>('.save-button')?.style.display).toBe('block');
});
