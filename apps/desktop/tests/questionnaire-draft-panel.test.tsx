// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuestionnaireDraftPanel } from '../src/app/questionnaire-draft-panel';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const props = () => ({ draftError: null, draftBlocked: false, busy: false, actionClass: 'action', onRetrySave: vi.fn() });

it('renders no routine saved, restore, clear or maintenance controls', () => {
  act(() => root.render(<QuestionnaireDraftPanel {...props()} />));
  expect(container.textContent).toBe('');
  expect(container.querySelector('button')).toBeNull();
});

it('exposes only recoverable save failure retry and disables it while busy', () => {
  const input = props();
  act(() => root.render(<QuestionnaireDraftPanel {...input} draftError="写入失败" />));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('写入失败');
  act(() => container.querySelector('button')!.click());
  expect(input.onRetrySave).toHaveBeenCalledOnce();
  act(() => root.render(<QuestionnaireDraftPanel {...input} draftError="写入失败" busy />));
  expect(container.querySelector('button')?.disabled).toBe(true);
});

it('keeps damaged source protection visible without offering overwrite or destructive recovery', () => {
  act(() => root.render(<QuestionnaireDraftPanel {...props()} draftError="损坏" draftBlocked />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('可继续填写和生成');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('原数据已保留');
  expect(container.querySelector('button')).toBeNull();
});
