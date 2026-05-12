import { expect, mock, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/link', () => ({
  __esModule: true,
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

mock.module('../Turnstile', () => ({
  __esModule: true,
  default: React.forwardRef(function TurnstileMock() {
    return <div data-turnstile="mock" />;
  }),
}));

mock.module('@/components/Turnstile', () => ({
  __esModule: true,
  default: React.forwardRef(function TurnstileMock() {
    return <div data-turnstile="mock" />;
  }),
}));

test('登录弹窗初始不展示 Turnstile', async () => {
  try {
    const { default: AuthModal } = await import('@/components/CharManager/AuthModal');
    const html = renderToStaticMarkup(
      <AuthModal
        isOpen
        onClose={() => undefined}
        onLogin={async () => undefined}
        onRegister={async () => undefined}
        authMessage={null}
      />,
    );

    expect(html).toContain('登录');
    expect(html).not.toContain('data-turnstile="mock"');
  } finally {
    mock.restore();
  }
});
