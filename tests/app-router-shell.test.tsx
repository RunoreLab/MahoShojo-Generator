import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi, beforeEach } from 'vitest';

let pathname = '/';

vi.mock('next/navigation', () => ({
  usePathname() {
    return pathname;
  },
}));

vi.mock('@next/third-parties/google', () => ({
  GoogleAnalytics: function GoogleAnalyticsMock({ gaId }: { gaId: string }) {
    return <div data-google-analytics={gaId} />;
  },
}));

vi.mock('@/components/Announcement/AnnouncementTicker', () => ({
  default: function AnnouncementTickerMock() {
    return <div data-announcement-ticker="mock" />;
  },
}));

vi.mock('@/components/navigation/GlobalTopBar', () => ({
  GlobalTopBar: function GlobalTopBarMock({ pathname: currentPathname }: { pathname: string }) {
    return <div data-global-topbar={currentPathname}>GlobalTopBar</div>;
  },
}));

function Page() {
  return <main>App 页面内容</main>;
}

describe('App Router global shell', () => {
  beforeEach(() => {
    pathname = '/';
    delete process.env.NEXT_PUBLIC_GA_ID;
    vi.resetModules();
  });

  test('exports default metadata migrated from pages app head', async () => {
    const { metadata, viewport } = await import('@/app/layout');

    expect(metadata).toEqual({
      title: '✨ 魔法少女生成器 ✨',
      description: '为你生成独特的魔法少女角色',
      icons: {
        icon: '/favicon.svg',
      },
    });
    expect(viewport).toEqual({
      width: 'device-width',
      initialScale: 1,
    });
  });

  test('root layout sets zh-CN html shell and installs color mode init script', async () => {
    const { default: RootLayout } = await import('@/app/layout');
    const html = renderToStaticMarkup(<RootLayout><Page /></RootLayout>);

    expect(html).toContain('<html lang="zh-CN"');
    expect(html).toContain('mahoshojo.color-mode');
    expect(html).toContain('document.documentElement.dataset.colorMode');
    expect(html).toContain('App 页面内容');
  });

  test('covered App route renders global topbar before page content', async () => {
    pathname = '/investigation';
    const { AppProviders } = await import('@/app/providers');
    const html = renderToStaticMarkup(<AppProviders><Page /></AppProviders>);

    expect(html).toContain('data-global-topbar="/investigation"');
    expect(html.indexOf('GlobalTopBar')).toBeLessThan(html.indexOf('App 页面内容'));
  });

  test('dynamic App pathnames are mapped to legacy canonical topbar paths', async () => {
    pathname = '/pvp/room-7';
    const { AppProviders } = await import('@/app/providers');
    const html = renderToStaticMarkup(<AppProviders><Page /></AppProviders>);

    expect(html).toContain('data-global-topbar="/pvp/[roomId]"');
  });

  test('details and canshou routes keep the blue theme wrapper', async () => {
    pathname = '/details';
    const { AppProviders } = await import('@/app/providers');
    const html = renderToStaticMarkup(<AppProviders><Page /></AppProviders>);

    expect(html).toContain('class="blue-theme"');
  });

  test('arrested route keeps announcement ticker excluded', async () => {
    pathname = '/arrested';
    const { AppProviders } = await import('@/app/providers');
    const html = renderToStaticMarkup(<AppProviders><Page /></AppProviders>);

    expect(html).not.toContain('data-announcement-ticker');
    expect(html).toContain('App 页面内容');
  });

  test('renders Google Analytics once when public id is configured', async () => {
    process.env.NEXT_PUBLIC_GA_ID = ' G-TEST ';
    const { AppProviders } = await import('@/app/providers');
    const html = renderToStaticMarkup(<AppProviders><Page /></AppProviders>);

    expect(html.match(/data-google-analytics="G-TEST"/g)?.length ?? 0).toBe(1);
  });
});
