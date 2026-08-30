import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter() {
    return { replace: async () => undefined };
  },
}));

describe('App Router not-found page', () => {
  test('exports 404 metadata migrated from legacy pages route', async () => {
    const { metadata } = await import('@/app/not-found');

    expect(metadata).toMatchObject({
      title: '404 - 页面不存在 | 魔法少女生成器',
      description: '页面未找到',
    });
  });

  test('renders the legacy 404 surface in App Router', async () => {
    const { default: NotFound } = await import('@/app/not-found');

    const html = renderToStaticMarkup(<NotFound />);

    expect(html).toContain('404');
    expect(html).toContain('页面走丢了捏');
    expect(html).toContain('立即返回首页');
    expect(html).toContain('将在');
    expect(html).toContain('秒后自动返回首页');
  });

  test('uses App Router navigation APIs instead of next/router or next/head', () => {
    const routeSource = readFileSync('app/not-found.tsx', 'utf8');
    const clientSource = readFileSync('app/not-found-client.tsx', 'utf8');

    expect(routeSource).toContain('export const metadata');
    expect(routeSource).not.toContain("'use client'");
    expect(clientSource).toContain("'use client'");
    expect(clientSource).toContain("import { useRouter } from 'next/navigation'");
    expect(`${routeSource}\n${clientSource}`).not.toContain('next/router');
    expect(`${routeSource}\n${clientSource}`).not.toContain('next/head');
    expect(clientSource).toContain("router.replace('/')");
  });
});
