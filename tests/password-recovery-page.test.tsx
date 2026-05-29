import { expect, mock, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('password-recovery 页面默认展示邮箱单独找回入口', async () => {
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

  mock.module('@/lib/use-next-router', () => ({
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

  mock.module('@/components/Turnstile', () => ({
    __esModule: true,
    default: function TurnstileMock() {
      return <div data-turnstile="mock" />;
    },
  }));

  try {
    const { default: PasswordRecoveryPage } = await import('@/pages/password-recovery');
    const html = renderToStaticMarkup(<PasswordRecoveryPage />);

    expect(html).toContain('请输入注册邮箱，系统会发送一次性重置链接。');
    expect(html).not.toContain('用户名');
    expect(html).toContain('邮箱地址');
  } finally {
    mock.restore();
  }
});
