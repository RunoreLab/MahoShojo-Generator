'use client';

import { useMemo } from 'react';

import { estimateTokensFromText } from '@/lib/token-estimator';

type TokenIndicatorProps = {
  text: string;
  maxTokens?: number;
  warnTokens?: number;
  warningText?: string;
  className?: string;
};

export function TokenIndicator({
  text,
  maxTokens = 16000,
  warnTokens = 12000,
  warningText,
  className,
}: TokenIndicatorProps) {
  const estimatedTokens = useMemo(() => {
    const input = typeof text === 'string' ? text : '';
    if (!input) return 0;
    return estimateTokensFromText(input);
  }, [text]);

  const ratio = maxTokens > 0 ? Math.min(1, estimatedTokens / maxTokens) : 0;
  const barColor =
    ratio <= 0.5
      ? 'bg-emerald-500'
      : ratio <= 0.75
        ? 'bg-yellow-500'
        : ratio <= 0.9
          ? 'bg-orange-500'
          : 'bg-red-600';
  const shouldWarn = estimatedTokens >= warnTokens;

  return (
    <div className={['mt-2', className].filter(Boolean).join(' ')}>
      <div className="flex items-center justify-center gap-2">
        <div className="h-2 w-40 bg-gray-200 rounded-full overflow-hidden" title="估算仅供参考，不等同于真实 Token">
          <div className={`h-full ${barColor}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <div className="text-xs text-gray-600 tabular-nums" title="估算仅供参考，不等同于真实 Token">
          ~{estimatedTokens.toLocaleString()} tokens
        </div>
      </div>
      {shouldWarn && warningText && (
        <div className="mt-1 text-xs text-orange-600 text-center">{warningText}</div>
      )}
    </div>
  );
}

