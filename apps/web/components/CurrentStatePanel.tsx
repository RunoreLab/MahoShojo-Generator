import clsx from 'clsx';

import type { CharacterCurrentState, CurrentStateField } from '@/types/arena';

import { MarkdownBlock, type MarkdownBlockVariant } from '@/components/MarkdownBlock';

const formatCurrentStateValue = (field: CurrentStateField) => {
  if (field.type === 'boolean') {
    return field.value ? '是' : '否';
  }
  if (field.type === 'number') {
    return typeof field.value === 'number' ? field.value : Number(field.value) || 0;
  }
  return String(field.value ?? '');
};

export interface CurrentStatePanelProps {
  state?: CharacterCurrentState | null;
  variant?: MarkdownBlockVariant;
  className?: string;
}

export function CurrentStatePanel({ state, variant = 'dark', className }: CurrentStatePanelProps) {
  if (!state) return null;
  const hasSummary = Boolean(state.summary && state.summary.trim());
  const fields = Array.isArray(state.fields) ? state.fields : [];
  const hasFields = fields.length > 0;
  if (!hasSummary && !hasFields) return null;

  const labelClass = variant === 'light' ? 'text-gray-700' : 'text-white/80';
  const valueClass = variant === 'light' ? 'text-gray-900' : 'text-white/90';
  const timestampClass = variant === 'light' ? 'text-gray-400' : 'text-white/50';

  return (
    <div className={clsx('result-item', className)}>
      <div className="result-label">🧭 当前状态</div>
      <div className="result-value text-sm space-y-2">
        {hasSummary && (
          <MarkdownBlock content={state.summary} variant={variant} />
        )}
        {hasFields && (
          <ul className="text-xs space-y-1">
            {fields.map((field) => (
              <li key={field.id} className="flex items-start justify-between gap-2 min-w-0">
                <span className={clsx('font-semibold shrink-0', labelClass)}>{field.label}</span>
                <span className={clsx('flex-1 min-w-0 text-right whitespace-pre-wrap break-words', valueClass)}>
                  {formatCurrentStateValue(field)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {state.updated_at && (
          <p className={clsx('text-[10px]', timestampClass)}>最近更新：{new Date(state.updated_at).toLocaleString()}</p>
        )}
      </div>
    </div>
  );
}

