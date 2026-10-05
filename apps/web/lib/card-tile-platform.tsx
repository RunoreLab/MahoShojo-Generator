'use client';

// Web 运行地的卡片块（DataCard）平台端口（D5.0e）。
// 与 card-library-host 共用同一份传输/标记实现；单独成文件是为了让
// `components/DataCard.tsx` 的薄包装不必引入整个卡库宿主依赖面。

import Link from 'next/link';
import type {
  CardLibraryLinkProps,
  CardLibraryStatKind,
  CardLibraryTilePlatform,
} from '@mahoshojo/ui-web/card-library';
import { addLikedCard, isCardLiked } from '@/lib/localStorage';
import { copyTextToClipboard } from '@/lib/clipboard';

export const WebCardLibraryLink = ({
  href,
  className,
  title,
  target,
  rel,
  onClick,
  children,
}: CardLibraryLinkProps) => (
  <Link href={href} className={className} title={title} target={target} rel={rel} onClick={onClick}>
    {children}
  </Link>
);

export const copyCardText = async (text: string): Promise<void> => {
  const ok = await copyTextToClipboard(text);
  if (!ok) throw new Error('copy failed');
};

/** `/api/data-card-stats` 上报；返回值为「服务端确认成功」。 */
export const reportDataCardStat = async (
  cardId: string,
  stat: CardLibraryStatKind,
): Promise<boolean> => {
  const response = await fetch('/api/data-card-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, type: stat }),
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
};

export const webCardTilePlatform: CardLibraryTilePlatform = {
  Link: WebCardLibraryLink,
  reviewHref: '/encyclopedia/review',
  marks: { isLiked: isCardLiked, markLiked: addLikedCard },
  copyText: copyCardText,
  reportStat: reportDataCardStat,
};
