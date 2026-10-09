// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { GenerationActionButton, generationActionClassNames } from '../src/generation-actions';
import { SaveJsonButton } from '../src/details-controls/SaveJsonButton';

const download = vi.hoisted(() => vi.fn());
vi.mock('../src/client/blob', () => ({ downloadBlob: download }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement('div');
document.body.append(container);
const root = createRoot(container);
afterAll(() => { act(() => root.unmount()); container.remove(); });
afterEach(() => { act(() => root.render(null)); vi.useRealTimers(); });

test('limits action hierarchy to three reusable variants and defaults to a non-submit secondary button', () => {
  const click = vi.fn(); const submit = vi.fn(); const ref = createRef<HTMLButtonElement>();
  expect(Object.keys(generationActionClassNames)).toEqual(['primary', 'secondary', 'destructive']);
  act(() => root.render(<form onSubmit={submit}>
    <GenerationActionButton ref={ref} onClick={click} className="w-full" aria-label="下载">JSON</GenerationActionButton>
  </form>));
  const button = container.querySelector('button')!;
  expect(button.className).toBe(`${generationActionClassNames.secondary} w-full`);
  expect(button.type).toBe('button');
  expect(button.getAttribute('aria-label')).toBe('下载');
  expect(ref.current).toBe(button);
  button.focus();
  expect(document.activeElement).toBe(button);
  act(() => button.click());
  expect(click).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

test('preserves disabled, inherited disabled, and explicit submit semantics', () => {
  const click = vi.fn();
  act(() => root.render(<>
    <GenerationActionButton variant="primary" disabled onClick={click}>保存</GenerationActionButton>
    <fieldset disabled><GenerationActionButton variant="destructive" onClick={click}>确认清除</GenerationActionButton></fieldset>
    <GenerationActionButton type="submit">提交</GenerationActionButton>
  </>));
  const buttons = container.querySelectorAll('button');
  expect(buttons[0].className).toBe(generationActionClassNames.primary);
  expect(buttons[1].className).toBe(generationActionClassNames.destructive);
  act(() => { buttons[0].click(); buttons[1].click(); });
  expect(click).not.toHaveBeenCalled();
  expect(buttons[2].type).toBe('submit');
});

test('uses secondary download and copy actions while retaining the export payload and expanded text mode', async () => {
  const data = { name: '百合', signature: 'unchanged' };
  act(() => root.render(<SaveJsonButton data={data} mode="download" recommendedMode="download" resolveFileName={() => '百合.json'} />));
  const button = container.querySelector('button')!;
  expect(button.classList.contains('ui-web-generation-action--secondary')).toBe(true);
  expect(button.classList.contains('generate-button')).toBe(false);
  expect(button.type).toBe('button');
  act(() => button.click());
  expect(download).toHaveBeenCalledWith(expect.any(Blob), '百合.json');
  expect((download.mock.calls[0][0] as Blob).type).toBe('application/json');

  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  vi.useFakeTimers();
  act(() => root.render(<SaveJsonButton data={data} mode="text" recommendedMode="text" resolveFileName={() => '百合.json'} />));
  expect(container.querySelector('textarea')?.value).toBe(JSON.stringify(data, null, 2));
  expect(container.querySelector('details')).toBeNull();
  expect(container.querySelector('button')?.className).toBe(generationActionClassNames.secondary);
  await act(async () => container.querySelector('button')!.click());
  expect(writeText).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  expect(container.textContent).toContain('JSON 已复制到剪贴板');
  act(() => vi.runAllTimers());
});
