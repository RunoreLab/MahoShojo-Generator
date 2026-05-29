import { describe, expect, test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MarkdownBlock } from '@/components/MarkdownBlock';

describe('MarkdownBlock', () => {
  test('将百科路径行内代码渲染为可点击链接', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownBlock, {
        content: '见：`/encyclopedia/ai-errors`',
        variant: 'light',
        mode: 'article',
      }),
    );

    expect(html).toContain('href="/encyclopedia/ai-errors"');
    expect(html).toContain('<code');
  });

  test('非百科路径仍保持为普通行内代码', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownBlock, {
        content: '见：`/name`',
        variant: 'light',
        mode: 'article',
      }),
    );

    expect(html).not.toContain('href="/name"');
    expect(html).toContain('<code');
  });

  test('支持渲染 LaTeX 行内公式（$...$）', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownBlock, {
        content: '公式：$y=ax^2+bx+c$',
        variant: 'light',
        mode: 'article',
      }),
    );

    expect(html).toContain('katex');
  });
});
