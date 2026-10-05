'use client';

import { useRouter } from 'next/navigation';

import {
  EncyclopediaLinks as SharedEncyclopediaLinks,
  type EncyclopediaLinkItem,
} from '@mahoshojo/ui-web/encyclopedia-views';

export type { EncyclopediaLinkItem };

export interface EncyclopediaLinksProps {
  items: readonly EncyclopediaLinkItem[];
  className?: string;
  label?: React.ReactNode;
  labelClassName?: string;
  linkClassName?: string;
}

/**
 * Web 的百科链接条包装。
 *
 * 九个页面（创作各入口、竞技场、首页）都在用它。视图本身是共享实现；这里只补上 Web 的路由事实，
 * 因此这些调用点不需要改动——搬迁它们的导入路径属于与 D3.0 无关的改动。
 */
export function EncyclopediaLinks({
  items,
  className,
  label,
  labelClassName,
  linkClassName,
}: EncyclopediaLinksProps) {
  const router = useRouter();

  return (
    <SharedEncyclopediaLinks
      items={items}
      onNavigate={(href) => {
        void router.push(href);
      }}
      {...(className === undefined ? {} : { className })}
      {...(label === undefined ? {} : { label })}
      {...(labelClassName === undefined ? {} : { labelClassName })}
      {...(linkClassName === undefined ? {} : { linkClassName })}
    />
  );
}