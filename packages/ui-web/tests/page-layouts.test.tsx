// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LocalLibraryPageLayout } from '../src/local-cards/index';
import { SettingsPage } from '../src/settings/index';
import { CharacterManagerPreviewPanel } from '../src/character-manager/index';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('owns local-library width/padding once while keeping native maintenance and notices as slots', () => {
  act(() => root.render(<LocalLibraryPageLayout notes={<p>草稿不在备份中</p>}><button disabled>原生维护</button></LocalLibraryPageLayout>));
  const page = container.querySelector('[data-testid="page-local-library"]')!;
  expect(page.className).toContain('max-w-4xl');
  expect(page.className).toContain('px-4 py-6');
  expect(page.querySelector('h1')?.textContent).toBe('本地库');
  expect(page.textContent).toContain('草稿不在备份中');
  expect(page.querySelector('button')?.disabled).toBe(true);
});

it('places an injected settings footer outside the groups in the same width as the page', () => {
  act(() => root.render(<SettingsPage groups={[{ id: 'appearance', content: <button>外观</button> }]} footer={<footer><a href="/">首页</a></footer>} />));
  const page = container.querySelector('[data-testid="settings-page"]')!;
  const footer = container.querySelector('footer')!;
  expect(page.contains(footer)).toBe(false);
  expect(footer.parentElement?.className).toContain('max-w-3xl');
  expect(footer.querySelector('a')?.getAttribute('href')).toBe('/');
  expect(container.querySelector('#settings-appearance')?.textContent).toContain('外观');
});


it('shows the shared character preview as a named region without hiding its host content', () => {
  act(() => root.render(<CharacterManagerPreviewPanel><p>完整角色卡</p></CharacterManagerPreviewPanel>));
  const preview = container.querySelector('section[aria-label="角色卡片预览"]')!;
  expect(preview.className).toBe('card mt-6');
  expect(preview.querySelector('details')).toBeNull();
  expect(preview.textContent).toContain('完整角色卡');
});
