'use client';

import { useMemo } from 'react';

import { formatKilobytes, getUtf8ByteLength, MAX_DATA_CARD_BYTES } from '@/lib/data-card-size';

type JsonSizeIndicatorProps = {
  data?: unknown;
  maxBytes?: number;
  warnBytes?: number;
  warningText?: string;
  estimatedBytes?: number;
  className?: string;
};

function stringifyJson(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === null || data === undefined) return '';
  try {
    return JSON.stringify(data);
  } catch {
    return '';
  }
}

export function JsonSizeIndicator({
  data,
  maxBytes = MAX_DATA_CARD_BYTES,
  warnBytes,
  warningText,
  estimatedBytes,
  className,
}: JsonSizeIndicatorProps) {
  const bytes = useMemo(() => {
    if (typeof estimatedBytes === 'number' && Number.isFinite(estimatedBytes)) {
      return Math.max(0, Math.round(estimatedBytes));
    }
    const json = stringifyJson(data);
    if (!json) return 0;
    return getUtf8ByteLength(json);
  }, [data, estimatedBytes]);

  const ratio = maxBytes > 0 ? Math.min(1, bytes / maxBytes) : 0;
  const barColor =
    ratio <= 0.5
      ? 'bg-emerald-500'
      : ratio <= 0.75
        ? 'bg-yellow-500'
        : ratio <= 0.9
          ? 'bg-orange-500'
          : 'bg-red-600';
  const riskTextColor =
    ratio <= 0.5
      ? 'text-emerald-600'
      : ratio <= 0.75
        ? 'text-yellow-600'
        : ratio <= 0.9
          ? 'text-orange-600'
          : 'text-red-600';
  const riskLabel =
    ratio <= 0.5
      ? '安全'
      : ratio <= 0.75
        ? '留意'
        : ratio <= 0.9
          ? '偏高'
          : '危险';
  const warnThreshold = typeof warnBytes === 'number' && Number.isFinite(warnBytes) ? warnBytes : Math.floor(maxBytes * 0.85);
  const shouldWarn = bytes >= warnThreshold;

  return (
    <div className={['mt-2', 'w-full', 'max-w-sm', 'mx-auto', className].filter(Boolean).join(' ')}>
      <div className="flex items-center justify-center gap-2">
        <div className="h-2 w-40 bg-gray-200 rounded-full overflow-hidden" title="按 UTF-8 字节估算，接近云端写入大小">
          <div className={`h-full ${barColor}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <div className="text-xs text-gray-600 tabular-nums" title="按 UTF-8 字节估算，接近云端写入大小">
          当前/上限：{formatKilobytes(bytes)}KB / {formatKilobytes(maxBytes)}KB
        </div>
        <div className={`text-xs font-medium ${riskTextColor}`}>{riskLabel}</div>
      </div>
      {shouldWarn && warningText && (
        <div className="mt-1 text-xs text-orange-600 text-center">{warningText}</div>
      )}
    </div>
  );
}
