import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/components/magic-tea-party/MagicTeaPartyPage', () => ({
  MagicTeaPartyPage: function MagicTeaPartyPageMock() {
    return <main data-page="magic-tea-party">魔法茶会</main>;
  },
}));

vi.mock('@/components/tavern/TavernPage', () => ({
  TavernPage: function TavernPageMock() {
    return <main data-page="tavern">酒馆生态</main>;
  },
}));

vi.mock('@/components/tachie/TachiePage', () => ({
  TachiePage: function TachiePageMock() {
    return <main data-page="tachie">立绘生成</main>;
  },
}));

const readProjectFile = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('tea/tavern/tachie App Router pages', () => {
  test('magic tea party route renders migrated client page and metadata', async () => {
    const { default: MagicTeaPartyRoute, metadata } = await import('@/app/magic-tea-party/page');
    const html = renderToStaticMarkup(<MagicTeaPartyRoute />);

    expect(metadata).toMatchObject({
      title: '魔法茶会',
      description: '基于角色卡/情景卡的长期对话与剧情体验（本地存储，自备 API Key）',
    });
    expect(html).toContain('data-page="magic-tea-party"');
  });

  test('magic tavern route preserves legacy redirect target', async () => {
    const { default: MagicTavernRoute, metadata } = await import('@/app/magic-tavern/page');
    const html = renderToStaticMarkup(<MagicTavernRoute />);

    expect(metadata).toMatchObject({
      title: '魔法茶馆',
    });
    expect(html).toContain('正在跳转到魔法茶会');
    expect(html).toContain('/magic-tea-party');
  });

  test('tavern route renders migrated client page and metadata', async () => {
    const { default: TavernRoute, metadata } = await import('@/app/tavern/page');
    const html = renderToStaticMarkup(<TavernRoute />);

    expect(metadata).toMatchObject({
      title: '酒馆生态联动',
      description: 'SillyTavern（酒馆）角色卡导入/导出：PNG 内嵌 JSON 解析与写入（本地处理）',
    });
    expect(html).toContain('data-page="tavern"');
  });

  test('tachie route renders migrated client page and metadata', async () => {
    const { default: TachieRoute, metadata } = await import('@/app/tachie/page');
    const html = renderToStaticMarkup(<TachieRoute />);

    expect(metadata).toMatchObject({
      title: '立绘生成 - MahoShojo Generator',
    });
    expect(html).toContain('data-page="tachie"');
  });

  test('migrated tea/tavern/tachie App Router surface does not import next/router', () => {
    const paths = [
      'app/magic-tea-party/page.tsx',
      'app/magic-tavern/page.tsx',
      'app/tavern/page.tsx',
      'app/tachie/page.tsx',
      'components/magic-tea-party/MagicTeaPartyPage.tsx',
      'components/magic-tea-party/ImportExportPanel.tsx',
      'components/tavern/TavernPage.tsx',
      'components/tavern/TavernImportPanel.tsx',
      'components/tavern/TavernExportPanel.tsx',
      'components/tachie/TachiePage.tsx',
      'lib/magic-tea-party/useMagicTeaPartySessions.ts',
      'lib/magic-tea-party/useMagicTeaPartyChat.ts',
    ];

    const missing = paths.filter((path) => !existsSync(join(process.cwd(), path)));
    expect(missing).toEqual([]);

    for (const path of paths) {
      expect(readProjectFile(path), path).not.toContain('next/router');
    }
  });
});
