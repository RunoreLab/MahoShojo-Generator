import { describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let pathname = '/';

mock.module('next/head', () => ({
  default: function HeadMock({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
}));

mock.module('next/router', () => ({
  useRouter() {
    return {
      pathname,
      route: pathname,
      query: {},
      asPath: pathname,
      push: async () => true,
      prefetch: async () => undefined,
    };
  },
}));

mock.module('@next/third-parties/google', () => ({
  GoogleAnalytics: function GoogleAnalyticsMock() {
    return <div data-google-analytics="mock" />;
  },
}));

mock.module('@/components/Announcement/AnnouncementTicker', () => ({
  default: function AnnouncementTickerMock() {
    return <div data-announcement-ticker="mock" />;
  },
}));

mock.module('@/components/navigation/GlobalTopBar', () => ({
  GlobalTopBar: function GlobalTopBarMock({ pathname: currentPathname }: { pathname: string }) {
    return <div data-global-topbar={currentPathname}>GlobalTopBar</div>;
  },
}));

mock.module('@/components/shared/ColorModeSwitcher', () => ({
  ColorModeSwitcher: function ColorModeSwitcherMock() {
    return <div data-color-mode-switcher="legacy-floating-widget" />;
  },
}));

function Page() {
  return <main>页面内容</main>;
}

describe('App topbar coverage', () => {
  test('covered route renders global topbar before page content', async () => {
    pathname = '/messages';
    const { default: App } = await import('@/pages/_app');
    const html = renderToStaticMarkup(<App Component={Page} pageProps={{}} router={{} as never} />);

    expect(html).toContain('data-global-topbar="/messages"');
    expect(html.indexOf('GlobalTopBar')).toBeLessThan(html.indexOf('页面内容'));
  });

  test('excluded route does not render global topbar', async () => {
    pathname = '/ranking';
    const { default: App } = await import('@/pages/_app');
    const html = renderToStaticMarkup(<App Component={Page} pageProps={{}} router={{} as never} />);

    expect(html).not.toContain('data-global-topbar');
    expect(html).toContain('页面内容');
  });

  test('legacy floating color mode switcher is not rendered globally', async () => {
    pathname = '/battle';
    const { default: App } = await import('@/pages/_app');
    const html = renderToStaticMarkup(<App Component={Page} pageProps={{}} router={{} as never} />);

    expect(html).not.toContain('data-color-mode-switcher="legacy-floating-widget"');
  });
});
