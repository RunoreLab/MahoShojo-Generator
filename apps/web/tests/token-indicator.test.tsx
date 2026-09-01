import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TokenIndicator } from '@/components/shared/TokenIndicator';

describe('TokenIndicator', () => {
  it('keeps the compact estimate-only display by default', () => {
    const html = renderToStaticMarkup(<TokenIndicator text="abcd" />);

    expect(html).toContain('~1 tokens');
    expect(html).not.toContain('/ 16,000 tokens');
    expect(html).not.toContain('±20%');
  });

  it('shows the current estimate and application budget when requested', () => {
    const html = renderToStaticMarkup(
      <TokenIndicator
        text="魔法少女abcd"
        maxTokens={128_000}
        budgetLabel="当前默认渠道应用预算"
      />,
    );

    expect(html).toContain('预计上下文：约 5 / 128,000 tokens');
    expect(html).toContain('当前默认渠道应用预算');
    expect(html).toContain('Token 为近似估算');
    expect(html).toContain('实际模型仍可能因自身上下文限制拒绝请求');
  });
});
