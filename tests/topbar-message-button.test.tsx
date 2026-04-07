import { describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/link', () => ({
  default: ({ children, href, ...props }: { children?: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('TopBarMessageButton', () => {
  test('links to messages and renders unread count', async () => {
    const { clearTopBarMessagesMemoryCacheForTests, setTopBarMessagesMemoryCacheForTests } = await import(
      '@/components/navigation/useTopBarMessages'
    );
    clearTopBarMessagesMemoryCacheForTests();
    setTopBarMessagesMemoryCacheForTests(7, {
      unreadTotal: 12,
      fetchedAt: Date.now(),
    });

    const { TopBarMessageButton } = await import('@/components/navigation/TopBarMessageButton');
    const html = renderToStaticMarkup(<TopBarMessageButton isAuthenticated={true} userId={7} />);

    expect(html).toContain('href="/messages"');
    expect(html).toContain('12');
    expect(html).toContain('消息');
  });
});
