import { describe, expect, it, mock } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('@/components/arena-lite/BattleLitePage', () => ({
  BattleLitePage() {
    return <div data-battle-lite-page="1">battle-lite-page</div>;
  },
}));

const { default: BattlePage } = await import('@/pages/battle');

describe('pages/battle', () => {
  it('使用 BattleLitePage 作为简洁版入口，并包裹 QueryClientProvider', () => {
    const html = renderToStaticMarkup(<BattlePage />);

    expect(html).toContain('data-battle-lite-page="1"');
  });
});
