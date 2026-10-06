// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductFooter } from '../src/shell/ProductFooter';
import type { HomeAssetSource } from '../src/home/index';

let container: HTMLDivElement;
let root: Root;

const ASSET_SOURCE: HomeAssetSource = { baseUrl: '/app/' };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: ReactNode): void => {
  act(() => root.render(node));
};

describe('ProductFooter', () => {
  it('renders the product content: sponsor, community groups, credits, repo', () => {
    render(<ProductFooter assetSource={ASSET_SOURCE} />);

    const text = container.textContent ?? '';
    expect(text).toContain('爱发电');
    expect(text).toContain('1059830952');
    expect(text).toContain('1076725478');
    expect(text).toContain('1078309485');
    expect(text).toContain('pd73230758');
    expect(text).toContain('末伏之夜');
    expect(text).toContain('Colanns');
    expect(text).toContain('KouriChat');
    expect(text).toContain('colasama/MahoShojo-Generator');
  });

  it('renders external links as non-clickable notes when the host gives no opener', () => {
    // DESK-PROD-001：没有系统浏览器能力时，站外入口宁可说明原因也不给点了没反应的链接。
    render(<ProductFooter assetSource={ASSET_SOURCE} />);

    expect(container.querySelector('a[href^="https://"]')).toBeNull();
    const disabled = container.querySelectorAll('.footer-link-disabled');
    expect(disabled.length).toBeGreaterThan(0);
    expect(disabled[0].getAttribute('title')).toContain('系统浏览器');
  });

  it('routes external clicks through the host opener', () => {
    const onNavigateExternal = vi.fn();
    render(<ProductFooter assetSource={ASSET_SOURCE} onNavigateExternal={onNavigateExternal} />);

    const anchor = container.querySelector<HTMLAnchorElement>('a[href^="https://"]');
    expect(anchor).not.toBeNull();
    act(() => {
      anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onNavigateExternal).toHaveBeenCalledWith(anchor!.href);
  });

  it('lets the host render its own anchors (Web: Next Link / target=_blank)', () => {
    render(
      <ProductFooter
        assetSource={ASSET_SOURCE}
        renderInternalLink={({ href, children, className }) => (
          <a data-kind="internal" href={href} className={className}>
            {children}
          </a>
        )}
        renderExternalLink={({ href, children, className }) => (
          <a data-kind="external" href={href} target="_blank" rel="noopener noreferrer" className={className}>
            {children}
          </a>
        )}
      />,
    );

    expect(container.querySelectorAll('a[data-kind="external"]').length).toBeGreaterThan(0);
    const encyclopedia = [...container.querySelectorAll<HTMLAnchorElement>('a[data-kind="internal"]')].find(
      (a) => a.getAttribute('href') === '/encyclopedia',
    );
    expect(encyclopedia).not.toBeUndefined();
  });

  it('switches the afdian logo variant with textWhite and joins the asset root', () => {
    render(<ProductFooter assetSource={ASSET_SOURCE} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/app/afdian.svg');

    render(<ProductFooter assetSource={ASSET_SOURCE} textWhite />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/app/afdian-white.svg');
  });
});
