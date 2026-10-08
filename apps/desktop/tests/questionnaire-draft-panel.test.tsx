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
const props = () => ({ pendingRestore: false, draftSaved: true, draftError: null, draftBlocked: false, busy: false, actionClass: 'action', onRestore: vi.fn(), onRetrySave: vi.fn(), onRequestClear: vi.fn(), onReload: vi.fn() });

it('collapses normal maintenance while exposing saved state and retains explicit maintenance actions', () => {
  const input = props();
  act(() => root.render(<QuestionnaireDraftPanel {...input} />));
  const details = container.querySelector('details')!;
  expect(details.open).toBe(false);
  expect(container.querySelector('[role="status"]')?.closest('details')).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toContain('已保存');
  act(() => { details.open = true; });
  const buttons = [...details.querySelectorAll('button')];
  act(() => buttons.find((button) => button.textContent === '清除草稿')!.click());
  act(() => buttons.find((button) => button.textContent === '重新加载问卷与配置')!.click());
  expect(input.onRequestClear).toHaveBeenCalledOnce();
  expect(input.onReload).toHaveBeenCalledOnce();
  expect(input.onRestore).not.toHaveBeenCalled();
});

it('keeps pending restore, errors and clear confirmation visible, and preserves busy/blocked action gates', () => {
  const input = props();
  act(() => root.render(<QuestionnaireDraftPanel {...input} pendingRestore draftError="读取失败" draftBlocked busy confirmation={<div role="group" aria-label="确认清除草稿">确认内容</div>} />));
  expect(container.querySelector('details')?.open).toBe(true);
  expect(container.querySelector('[role="alert"]')?.closest('details')).toBeNull();
  expect(container.querySelector('[role="group"]')?.closest('details')).toBeNull();
  const buttons = [...container.querySelectorAll('button')];
  expect(buttons.some((button) => button.textContent === '重试保存草稿')).toBe(false);
  expect(buttons.find((button) => button.textContent === '清除草稿')?.disabled).toBe(true);
  expect(buttons.find((button) => button.textContent === '重新加载问卷与配置')?.disabled).toBe(true);
  expect(buttons.find((button) => button.textContent === '恢复草稿')?.closest('details')).toBeNull();
});
