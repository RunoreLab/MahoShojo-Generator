// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';

import { WebEncyclopediaEntry } from '@/components/encyclopedia/WebEncyclopediaEntry';

vi.mock('@/components/encyclopedia/WebEncyclopediaViews', () => ({
  WEB_ENCYCLOPEDIA_CONTENT_SOURCE: { baseUrl: '/' },
  useWebEncyclopediaNavigate: () => vi.fn(),
  WebEncyclopediaHeaderLinks: () => null,
}));
vi.mock('@/components/encyclopedia/TagsLibraryPanel', () => ({ TagsLibraryPanel: () => null }));
vi.mock('@/lib/use-location-hash', () => ({ useLocationHash: () => '' }));

test('百科异步正文中的外链使用 Web 原生安全链接', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[仓库](https://github.com/example/repo)')));
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<WebEncyclopediaEntry slug="ai-errors" />));
    const anchor = container.querySelector<HTMLAnchorElement>('a[href="https://github.com/example/repo"]');
    expect(anchor?.textContent).toBe('仓库');
    expect(anchor?.target).toBe('_blank');
    expect(anchor?.rel).toBe('noopener noreferrer');
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
