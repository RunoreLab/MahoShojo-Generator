// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useUnsavedPageGuard } from '../src/client/useUnsavedPageGuard';
let root: Root;
let container: HTMLDivElement;
let dirty = false;
let programmatic: () => boolean;
function Page() {
  programmatic = useUnsavedPageGuard(() => dirty);
  return <><a href="/other"><span>离开</span></a><a href="#same">锚点</a><a href="/other" target="_blank">新窗口</a><a href="/export" download>下载</a></>;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  dirty = false; vi.spyOn(window, 'confirm').mockReturnValue(false);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(<Page />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const click = (element: Element, options: MouseEventInit = {}) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
  act(() => { element.dispatchEvent(event); }); return event;
};
it('leaves an untouched page alone and protects actual unsaved work on unload', () => {
  const empty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(empty);
  expect(empty.defaultPrevented).toBe(false);
  dirty = true;
  const edited = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(edited);
  expect(edited.defaultPrevented).toBe(true);
});
it('rejects route-link navigation before the router sees it, and explicitly confirms leaving', () => {
  dirty = true;
  const router = vi.fn(); container.addEventListener('click', router);
  expect(click(container.querySelector('span')!).defaultPrevented).toBe(true);
  expect(router).not.toHaveBeenCalled();
  expect(programmatic()).toBe(false);
  vi.mocked(window.confirm).mockReturnValue(true);
  expect(programmatic()).toBe(true);
  expect(click(container.querySelector('span')!).defaultPrevented).toBe(false);
  expect(router).toHaveBeenCalledTimes(1);
});
it('does not interrupt copying/opening a link separately, downloads or same-document anchors', () => {
  dirty = true;
  const links = container.querySelectorAll('a');
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) click(links[0], options);
  click(links[1]); click(links[2]); click(links[3]);
  expect(window.confirm).not.toHaveBeenCalled();
});
it('removes its document listener when the page unmounts', () => {
  dirty = true; act(() => root.render(null));
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
