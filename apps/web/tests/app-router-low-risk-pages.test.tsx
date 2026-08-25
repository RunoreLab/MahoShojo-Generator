import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/components/home/HomePage', () => ({
  HomePage: function HomePageMock() {
    return <main data-page="home">首页</main>;
  },
}));

vi.mock('@/components/beta-access/BetaAccessPage', () => ({
  BetaAccessPage: function BetaAccessPageMock({ rawFeature }: { rawFeature?: string | null }) {
    return <main data-page="beta-access" data-feature={rawFeature ?? ''}>权限拦截</main>;
  },
}));

vi.mock('@/components/redeem/RedeemPage', () => ({
  RedeemPage: function RedeemPageMock() {
    return <main data-page="redeem">兑换中心</main>;
  },
}));

vi.mock('@/components/encyclopedia/EncyclopediaIndexPage', () => ({
  EncyclopediaIndexPage: function EncyclopediaIndexPageMock({
    initialQuery,
    initialCategoryId,
  }: {
    initialQuery?: string;
    initialCategoryId?: string;
  }) {
    return (
      <main
        data-page="encyclopedia-index"
        data-query={initialQuery ?? ''}
        data-category={initialCategoryId ?? ''}
      >
        百科目录
      </main>
    );
  },
}));

vi.mock('@/components/encyclopedia/EncyclopediaEntryPage', () => ({
  EncyclopediaEntryPage: function EncyclopediaEntryPageMock({ slug }: { slug?: string }) {
    return <main data-page="encyclopedia-entry" data-slug={slug ?? ''}>百科条目</main>;
  },
}));

describe('low-risk App Router pages', () => {
  test('home route exports migrated metadata and renders the home page component', async () => {
    const { default: HomeRoute, metadata } = await import('@/app/page');
    const html = renderToStaticMarkup(<HomeRoute />);

    expect(metadata).toMatchObject({
      title: '✨ 魔法少女生成器 ✨',
      description: 'AI驱动的魔法少女角色生成器，创建独一无二的魔法少女角色',
    });
    expect(html).toContain('data-page="home"');
  });

  test('beta-access route forwards feature query to the client page', async () => {
    const { default: BetaAccessRoute, metadata } = await import('@/app/beta-access/page');
    const element = await BetaAccessRoute({
      searchParams: Promise.resolve({ feature: 'magic-tea-party' }),
    });
    const html = renderToStaticMarkup(element);

    expect(metadata).toMatchObject({
      title: '权限拦截 - 魔法国度',
      description: '内测功能权限拦截页',
    });
    expect(html).toContain('data-page="beta-access"');
    expect(html).toContain('data-feature="magic-tea-party"');
  });

  test('redeem route exports metadata and renders the redeem page component', async () => {
    const { default: RedeemRoute, metadata } = await import('@/app/redeem/page');
    const html = renderToStaticMarkup(<RedeemRoute />);

    expect(metadata).toMatchObject({
      title: '兑换中心 - MahoShojo Generator',
    });
    expect(html).toContain('data-page="redeem"');
  });

  test('encyclopedia index route exports metadata and renders the client page behind Suspense', async () => {
    const { default: EncyclopediaRoute, metadata } = await import('@/app/encyclopedia/page');
    const html = renderToStaticMarkup(<EncyclopediaRoute />);

    expect(metadata).toMatchObject({
      title: '百科 - MahoShojo Generator',
      description: '查看站内使用说明、规则、故障排查与进阶内容',
    });
    expect(html).toContain('data-page="encyclopedia-index"');
  });

  test('encyclopedia entry route generates entry metadata and forwards slug', async () => {
    const {
      default: EncyclopediaEntryRoute,
      generateMetadata,
      generateStaticParams,
    } = await import('@/app/encyclopedia/[slug]/page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'site-guide' }),
    });
    const element = await EncyclopediaEntryRoute({
      params: Promise.resolve({ slug: ['site-guide'] }),
    });
    const html = renderToStaticMarkup(element);

    expect(metadata).toMatchObject({
      title: '站内功能速览（从生成到对战） - 百科',
      description: '新手从生成到对战的一页速查：入口、流程、常见问题。',
    });
    expect(generateStaticParams()).toContainEqual({ slug: 'site-guide' });
    expect(html).toContain('data-page="encyclopedia-entry"');
    expect(html).toContain('data-slug="site-guide"');
  });
});
