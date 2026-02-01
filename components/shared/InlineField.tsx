import type { CSSProperties } from 'react';

import { MarkdownBlock, type MarkdownBlockMode, type MarkdownBlockVariant } from '@/components/MarkdownBlock';

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
          <MarkdownBlock content={normalized} variant={variant} mode={markdownMode} />
        </div>
      ) : (
        <span className={resolvedContentClassName} style={contentStyle}>{normalized}</span>
      )}
    </div>
  );
}
