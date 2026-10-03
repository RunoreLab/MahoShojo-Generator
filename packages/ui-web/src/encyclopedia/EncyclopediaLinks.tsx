import type { ReactNode } from 'react';

import { getEncyclopediaEntry, type EncyclopediaEntry } from './catalog';

export interface EncyclopediaLinkItem {
  readonly slug: string;
  readonly text?: string;
}

export interface EncyclopediaLinksProps {
  readonly items: readonly EncyclopediaLinkItem[];
  readonly onNavigate: (href: string) => void;
  readonly className?: string;
  readonly label?: ReactNode;
  readonly labelClassName?: string;
  readonly linkClassName?: string;
}

/**
 * 一组百科条目链接。
 *
 * 首页用它做「新手推荐」位。未知 slug 被**丢弃**而不是渲染成一个打不开的链接——`DESK-PROD-001`
 * 明确禁止可点击但失效的内部链接。
 */
export function EncyclopediaLinks({
  items,
  onNavigate,
  className = 'flex flex-wrap justify-center gap-3 text-xs',
  label = null,
  labelClassName = 'text-gray-500',
  linkClassName = 'text-blue-600 hover:underline',
}: EncyclopediaLinksProps) {
  const normalized = items
    .map((item) => {
      const entry: EncyclopediaEntry | null = getEncyclopediaEntry(item.slug);
      return entry ? { slug: entry.slug, text: item.text ?? entry.title } : null;
    })
    .filter((item): item is { slug: string; text: string } => item !== null);

  if (normalized.length === 0) return null;

  return (
    <div className={className}>
      {label ? <span className={labelClassName}>{label}</span> : null}
      {normalized.map((item) => {
        const href = `/encyclopedia/${item.slug}`;
        return (
          <a
            key={item.slug}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(href);
            }}
            className={linkClassName}
          >
            {item.text}
          </a>
        );
      })}
    </div>
  );
}