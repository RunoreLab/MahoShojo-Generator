import { expect, mock, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/head', () => ({
  default: function HeadMock({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
}));

mock.module('next/link', () => ({
  default: function LinkMock({
    children,
    href,
    ...props
  }: {
    children?: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

mock.module('next/router', () => ({
  useRouter() {
    return {
      push: async () => true,
      prefetch: async () => undefined,
      pathname: '/creator',
      route: '/creator',
      query: {},
      asPath: '/creator',
    };
  },
}));

mock.module('@/lib/cooldown', () => ({
  useProviderModeCooldown() {
    return {
      isCooldown: false,
      startCooldown() {},
      remainingTime: 0,
      otherRemainingTime: null,
    };
  },
  getProviderCooldownNoticeText() {
    return 'cooldown notice';
  },
}));

const { default: CreatorPage } = await import('@/pages/creator');

test('pages/creator 的 loading 分支也进入工作台壳', () => {
  const html = renderToStaticMarkup(<CreatorPage />);

  expect(html).toContain('加载中...');
  expect(html).toContain('creator-workbench-shell');
});
