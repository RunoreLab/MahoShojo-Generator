import type { CSSProperties } from 'react';

import { MarkdownBlock as SharedMarkdownBlock, type MarkdownBlockMode, type MarkdownBlockVariant } from '../markdown';
import type { CharacterCardMarkdown } from './types';

const isMarkdownLike = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (trimmed.includes('\n')) return true;

  return (
    /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>)/.test(trimmed)
    || /`/.test(trimmed)
    || /\$\$?/.test(trimmed)
    || /!\[[^\]]*\]\([^)]+\)/.test(trimmed)
    || /\[[^\]]+\]\([^)]+\)/.test(trimmed)
    || /(\*\*|__|~~)/.test(trimmed)
    || /<(audio|video|img)\b/i.test(trimmed)
  );
};

export interface InlineFieldProps {
  label: string;
  content: string;
  variant?: MarkdownBlockVariant;
  markdownMode?: MarkdownBlockMode;
  className?: string;
  labelClassName?: string;
  contentClassName?: string;
  labelStyle?: CSSProperties;
  contentStyle?: CSSProperties;
  /** Markdown 渲染组件；缺省共享 `MarkdownBlock`。 */
  Markdown?: CharacterCardMarkdown;
}

export function InlineField({
  label,
  content,
  variant = 'dark',
  markdownMode = 'compact',
  className,
  labelClassName,
  contentClassName,
  labelStyle,
  contentStyle,
  Markdown = SharedMarkdownBlock,
}: InlineFieldProps) {
  const normalized = String(content ?? '');
  const shouldRenderMarkdown = isMarkdownLike(normalized);
  const wrapperClassName = ['leading-relaxed', className].filter(Boolean).join(' ');
  const resolvedLabelClassName = ['font-semibold', labelClassName].filter(Boolean).join(' ');
  const resolvedContentClassName = ['whitespace-pre-wrap break-words', contentClassName].filter(Boolean).join(' ');

  return (
    <div className={wrapperClassName}>
      <span className={resolvedLabelClassName} style={labelStyle}>{label}：</span>
      {shouldRenderMarkdown ? (
        <div className={contentClassName ? ['mt-1', contentClassName].join(' ') : 'mt-1'} style={contentStyle}>
          <Markdown content={normalized} variant={variant} mode={markdownMode} />
        </div>
      ) : (
        <span className={resolvedContentClassName} style={contentStyle}>{normalized}</span>
      )}
    </div>
  );
}
