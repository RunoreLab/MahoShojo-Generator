import React from 'react';
import { expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

test('CreatorEntryLink 渲染前往 /creator 的简短入口', async () => {
  try {
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

    const { CreatorEntryLink } = await import('@/components/shared/CreatorEntryLink');
    const html = renderToStaticMarkup(<CreatorEntryLink />);

    expect(html).toContain('href="/creator"');
    expect(html).toContain('前往创作工坊');
  } finally {
    mock.restore();
  }
});
