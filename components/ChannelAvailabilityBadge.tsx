'use client';

import React from 'react';

type AvailabilityStatus = 'healthy' | 'degraded' | 'poor' | 'unknown';

type ChannelAvailabilityEntry = {
  providerId: string;
  modelId: string;
  primary: {
    window: '1h' | '24h' | 'none';
    successRate: number | null;
    status: AvailabilityStatus;
  };
  reference?: {
    window: '24h';
    successRate: number;
    status: Exclude<AvailabilityStatus, 'unknown'>;
  };
};

type ChannelAvailabilityBadgeProps = {
  availability?: ChannelAvailabilityEntry;
  compact?: boolean;
};

const STATUS_COLORS: Record<AvailabilityStatus, string> = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  degraded: 'text-amber-600 dark:text-amber-400',
  poor: 'text-rose-600 dark:text-rose-400',
  unknown: 'text-gray-400 dark:text-gray-500',
};

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export const ChannelAvailabilityBadge: React.FC<ChannelAvailabilityBadgeProps> = ({
  availability,
  compact = false,
}) => {
  if (!availability) {
    return (
      <span className="text-xs text-gray-400 dark:text-gray-500" title="暂无数据">
        —
      </span>
    );
  }

  const { primary, reference } = availability;

  // 近 1h 有有效数据
  if (primary.window === '1h' && primary.successRate !== null) {
    return (
      <span
        className={`text-xs font-medium ${STATUS_COLORS[primary.status]}`}
        title={`近 1h 成功率: ${formatPercent(primary.successRate)}`}
      >
        {formatPercent(primary.successRate)}
      </span>
    );
  }

  // 近 1h 无数据，但 24h 有参考
  if (reference && reference.successRate !== null) {
    if (compact) {
      return (
        <span
          className={`text-xs font-medium ${STATUS_COLORS[reference.status]}`}
          title={`近 24h 成功率: ${formatPercent(reference.successRate)}`}
        >
          24h {formatPercent(reference.successRate)}
        </span>
      );
    }
    return (
      <span
        className={`text-xs ${STATUS_COLORS[reference.status]}`}
        title={`近 24h 成功率: ${formatPercent(reference.successRate)}`}
      >
        暂无近期 · 24h {formatPercent(reference.successRate)}
      </span>
    );
  }

  // 完全无数据
  return (
    <span className="text-xs text-gray-400 dark:text-gray-500" title="暂无数据">
      {compact ? '—' : '暂无数据'}
    </span>
  );
};
