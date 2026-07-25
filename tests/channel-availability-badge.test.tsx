import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChannelAvailabilityBadge } from '@/components/ChannelAvailabilityBadge';

const renderBadge = (props?: React.ComponentProps<typeof ChannelAvailabilityBadge>) =>
  renderToStaticMarkup(<ChannelAvailabilityBadge {...props} />);

describe('ChannelAvailabilityBadge', () => {
  it('无 availability 时显示 —', () => {
    const html = renderBadge();
    expect(html).toContain('—');
  });

  it('1h healthy → 显示百分比（绿系）', () => {
    const html = renderBadge({
      availability: {
        providerId: 'system',
        modelId: 'default',
        primary: { window: '1h', successRate: 0.96, status: 'healthy' },
      },
    });
    expect(html).toContain('96%');
    expect(html).toContain('emerald');
  });

  it('1h degraded → 显示百分比（琥珀）', () => {
    const html = renderBadge({
      availability: {
        providerId: 'system',
        modelId: 'default',
        primary: { window: '1h', successRate: 0.75, status: 'degraded' },
      },
    });
    expect(html).toContain('75%');
    expect(html).toContain('amber');
  });

  it('1h poor → 显示百分比（玫红）', () => {
    const html = renderBadge({
      availability: {
        providerId: 'system',
        modelId: 'default',
        primary: { window: '1h', successRate: 0.50, status: 'poor' },
      },
    });
    expect(html).toContain('50%');
    expect(html).toContain('rose');
  });

  it('1h 无数据 + 24h 有参考 → 非 compact 显示 暂无近期 · 24h XX%', () => {
    const html = renderBadge({
      availability: {
        providerId: 'system',
        modelId: 'default',
        primary: { window: 'none', successRate: null, status: 'unknown' },
        reference: { window: '24h', successRate: 0.91, status: 'healthy' },
      },
    });
    expect(html).toContain('暂无近期');
    expect(html).toContain('24h 91%');
  });

  it('1h 无数据 + 24h 有参考 → compact 显示 24h XX%', () => {
    const html = renderBadge({
      availability: {
        providerId: 'system',
        modelId: 'default',
        primary: { window: 'none', successRate: null, status: 'unknown' },
        reference: { window: '24h', successRate: 0.91, status: 'healthy' },
      },
      compact: true,
    });
    expect(html).toContain('24h 91%');
    expect(html).not.toContain('暂无近期');
  });

  it('完全无数据 → 非 compact 显示 暂无数据', () => {
    const html = renderBadge({
      availability: {
        providerId: 'system',
        modelId: 'default',
        primary: { window: 'none', successRate: null, status: 'unknown' },
      },
    });
    expect(html).toContain('暂无数据');
  });

  it('完全无数据 → compact 显示 —', () => {
    const html = renderBadge({
      availability: {
        providerId: 'system',
        modelId: 'default',
        primary: { window: 'none', successRate: null, status: 'unknown' },
      },
      compact: true,
    });
    expect(html).toContain('—');
  });

  it('百分比四舍五入为整数', () => {
    const html = renderBadge({
      availability: {
        providerId: 'system',
        modelId: 'default',
        primary: { window: '1h', successRate: 0.956, status: 'healthy' },
      },
    });
    expect(html).toContain('96%');
  });

  it('successRate 为 0 时显示 0% 而非隐藏', () => {
    const html = renderBadge({
      availability: {
        providerId: 'system',
        modelId: 'default',
        primary: { window: '1h', successRate: 0, status: 'poor' },
      },
    });
    expect(html).toContain('0%');
  });
});
