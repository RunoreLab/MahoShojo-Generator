import clsx from 'clsx';

import type { CharacterCurrentState, CurrentStateField } from '@mahoshojo/domain/arena-types';
import { CurrentStateSchema } from '@mahoshojo/domain/data-card-schemas';

import { MarkdownBlock as SharedMarkdownBlock, type MarkdownBlockVariant } from '../markdown';
import type { CharacterCardMarkdown } from './types';

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
  /** Markdown 渲染组件；缺省共享 `MarkdownBlock`。 */
  Markdown?: CharacterCardMarkdown;
}

export function CurrentStatePanel({ state, variant = 'dark', className, Markdown = SharedMarkdownBlock }: CurrentStatePanelProps) {
  if (!state) return null;
  // 编辑器保留未知/不合法字段，预览只能读安全投影，不能修写原卡。
  const parsed = CurrentStateSchema.safeParse(state);
  if (!parsed.success) {
    return <p role="status" className={clsx('result-item text-xs', className)}>当前状态格式暂不支持预览，原始数据仍保留。</p>;
  }
  const view = parsed.data;
  const hasSummary = Boolean(view.summary.trim());
  const fields = view.fields;
  const hasFields = fields.length > 0;
  const updatedAt = view.updated_at && Number.isFinite(Date.parse(view.updated_at)) ? view.updated_at : null;
  if (!hasSummary && !hasFields) return null;

  const labelClass = variant === 'light' ? 'text-gray-700' : 'text-white/80';
  const valueClass = variant === 'light' ? 'text-gray-900' : 'text-white/90';
  const timestampClass = variant === 'light' ? 'text-gray-400' : 'text-white/50';

  return (
    <div className={clsx('result-item', className)}>
      <div className="result-label">🧭 当前状态</div>
      <div className="result-value text-sm space-y-2">
        {hasSummary && (
          <Markdown content={view.summary} variant={variant} />
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
        {updatedAt && (
          <p className={clsx('text-[10px]', timestampClass)}>最近更新：{new Date(updatedAt).toLocaleString()}</p>
        )}
      </div>
    </div>
  );
}
