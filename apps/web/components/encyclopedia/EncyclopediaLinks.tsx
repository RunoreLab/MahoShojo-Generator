import Link from 'next/link';

import { getEncyclopediaEntry } from '@/lib/encyclopedia';

export type EncyclopediaLinkItem = {
  slug: string;
  text?: string;
};

export interface EncyclopediaLinksProps {
  items: EncyclopediaLinkItem[];
  className?: string;
  label?: string | null;
  labelClassName?: string;
  linkClassName?: string;
}

export function EncyclopediaLinks({
  items,
  className = 'mt-3 flex flex-wrap justify-center gap-3 text-xs',
  label = null,
  labelClassName = 'text-gray-500',
  linkClassName = 'text-blue-600 hover:underline',
}: EncyclopediaLinksProps) {
  const normalized = items
    .map((item) => {
      const entry = getEncyclopediaEntry(item.slug);
      if (!entry) return null;
      return {
        slug: entry.slug,
        text: item.text ?? entry.title,
      };
    })
    .filter((item): item is { slug: string; text: string } => Boolean(item));

  if (normalized.length === 0) return null;

  return (
    <div className={className}>
      {label ? <span className={labelClassName}>{label}</span> : null}
      {normalized.map((item) => (
        <Link key={item.slug} href={`/encyclopedia/${item.slug}`} className={linkClassName}>
          {item.text}
        </Link>
      ))}
    </div>
  );
}
