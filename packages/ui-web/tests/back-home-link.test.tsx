// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackHomeLink } from '../src/shell/BackHomeLink';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('shares the product label and styling while retaining the host router link', () => {
  act(() => root.render(<BackHomeLink renderLink={(props) => <a {...props} data-host="next" />} />));
  const link = container.querySelector('a')!;
  expect(link.textContent).toBe('返回首页');
  expect(link.className).toBe('footer-link');
  expect(link.getAttribute('href')).toBe('/');
  expect(link.dataset.host).toBe('next');
});
it('only intercepts an ordinary primary click and delegates navigation to the host guard', () => {
  const navigate = vi.fn();
  act(() => root.render(<BackHomeLink href="#/" onNavigate={navigate} />));
  const link = container.querySelector('a')!;
  const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
  act(() => { link.dispatchEvent(plain); });
  expect(plain.defaultPrevented).toBe(true); expect(navigate).toHaveBeenCalledTimes(1);
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
    act(() => { link.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  }
  expect(navigate).toHaveBeenCalledTimes(1);
});
