import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/components/character/CharacterManagerPage', () => ({
  CharacterManagerPage: function CharacterManagerPageMock() {
    return <main data-page="character-manager">角色管理中心</main>;
  },
}));

vi.mock('@/components/character/CharacterPartyPage', () => ({
  CharacterPartyPage: function CharacterPartyPageMock() {
    return <main data-page="character-party">角色组队</main>;
  },
}));

vi.mock('@/components/badge/BadgeManagerPage', () => ({
  BadgeManagerPage: function BadgeManagerPageMock() {
    return <main data-page="badge-manager">徽章管理</main>;
  },
}));

vi.mock('@/components/me/MeRouteProviders', () => ({
  MeRouteProviders: function MeRouteProvidersMock() {
    return <main data-page="me">个人页</main>;
  },
}));

describe('character domain App Router pages', () => {
  test('character manager route renders migrated client page and metadata', async () => {
    const { default: CharacterManagerRoute, metadata } = await import('@/app/character-manager/page');
    const html = renderToStaticMarkup(<CharacterManagerRoute />);

    expect(metadata).toMatchObject({
      title: '角色管理中心 - MahoShojo Generator',
    });
    expect(html).toContain('data-page="character-manager"');
  });

  test('character party route renders migrated client page and metadata', async () => {
    const { default: CharacterPartyRoute, metadata } = await import('@/app/character-party/page');
    const html = renderToStaticMarkup(<CharacterPartyRoute />);

    expect(metadata).toMatchObject({
      title: '角色组队 - 魔法少女生成器',
    });
    expect(html).toContain('data-page="character-party"');
  });

  test('badge manager route renders migrated client page and metadata', async () => {
    const { default: BadgeManagerRoute, metadata } = await import('@/app/badge-manager/page');
    const html = renderToStaticMarkup(<BadgeManagerRoute />);

    expect(metadata).toMatchObject({
      title: '徽章管理 - MahoShojo Generator',
    });
    expect(html).toContain('data-page="badge-manager"');
  });

  test('me route renders query client providers and migrated metadata', async () => {
    const { default: MeRoute, metadata } = await import('@/app/me/page');
    const html = renderToStaticMarkup(<MeRoute />);

    expect(metadata).toMatchObject({
      title: '个人页 - MahoShojo Generator',
      description: '查看战报记录、PVP 战绩与个人设置',
    });
    expect(html).toContain('data-page="me"');
  });
});
