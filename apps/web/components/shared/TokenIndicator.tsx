'use client';

import { useMemo } from 'react';

import { estimateTokensFromText } from '@/lib/token-estimator';

type TokenIndicatorProps = {
  text: string;
  maxTokens?: number;
  warnTokens?: number;
  warningText?: string;
  budgetLabel?: string;
  estimatedTokens?: number;
  estimateMultiplier?: number;
  className?: string;
};

export function TokenIndicator({
  text,
  maxTokens = 16000,
  warnTokens = 12000,
  warningText,
  budgetLabel,
  estimatedTokens: estimatedTokensOverride,
  estimateMultiplier = 1,
  className,
}: TokenIndicatorProps) {
  const estimatedTokens = useMemo(() => {
    if (typeof estimatedTokensOverride === 'number' && Number.isFinite(estimatedTokensOverride)) {
      return Math.max(0, Math.round(estimatedTokensOverride));
    }
    const input = typeof text === 'string' ? text : '';
    if (!input) return 0;
    const multiplier = Number.isFinite(estimateMultiplier) && estimateMultiplier > 0 ? estimateMultiplier : 1;
    return Math.max(0, Math.round(estimateTokensFromText(input) * multiplier));
  }, [text, estimatedTokensOverride, estimateMultiplier]);

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
  const estimateTitle = '近似估算，不等同于当前模型的真实 tokenizer 结果';

  return (
    <div className={['mt-2', className].filter(Boolean).join(' ')}>
      <div className="flex items-center justify-center gap-2">
        <div className="h-2 w-40 bg-gray-200 rounded-full overflow-hidden" title={estimateTitle}>
          <div className={`h-full ${barColor}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <div className="text-xs text-gray-600 tabular-nums" title={estimateTitle}>
          {budgetLabel
            ? `预计上下文：约 ${estimatedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens`
            : `~${estimatedTokens.toLocaleString()} tokens`}
        </div>
      </div>
      {budgetLabel ? (
        <div className="mt-1 text-center text-xs text-gray-500">
          {budgetLabel}；Token 为近似估算，最终完整 Prompt 由服务端检查；实际模型仍可能因自身上下文限制拒绝请求。
        </div>
      ) : null}
      {shouldWarn && warningText && (
        <div className="mt-1 text-xs text-orange-600 text-center">{warningText}</div>
      )}
    </div>
  );
}
