import { expect, vi, test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/head', () => ({
  default: function HeadMock({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
}));

vi.mock('next/link', () => ({
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

vi.mock('@/lib/use-next-router', () => ({
  useNextRouter() {
    return {
      query: {},
      pathname: '/password-recovery',
      route: '/password-recovery',
      asPath: '/password-recovery',
      push: async () => true,
      prefetch: async () => undefined,
    };
  },
}));

vi.mock('@/components/Turnstile', () => ({
  __esModule: true,
  default: function TurnstileMock() {
    return <div data-turnstile="mock" />;
  },
}));

test('password-recovery 页面默认展示邮箱单独找回入口', async () => {
  const { default: PasswordRecoveryPage } = await import('@/pages/password-recovery');
  const html = renderToStaticMarkup(<PasswordRecoveryPage />);

  expect(html).toContain('请输入注册邮箱，系统会发送一次性重置链接。');
  expect(html).not.toContain('用户名');
  expect(html).toContain('邮箱地址');
});
