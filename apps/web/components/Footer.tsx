import React from 'react';
import Link from 'next/link';

import { ProductFooter } from '@mahoshojo/ui-web/shell';

interface FooterProps {
  className?: string;
  textWhite?: boolean;
  showSponsor?: boolean;
}

/**
 * Web 的页脚装配：内容与链接表来自共享 `ProductFooter`，本文件只注入宿主差异——
 * 站内走 Next `<Link prefetch={false}>`（与既有行为一致），站外用原生新标签打开。
 */
export default function Footer({ className = 'footer', textWhite = false }: FooterProps) {
  return (
    <ProductFooter
      className={className}
      textWhite={textWhite}
      assetSource={{ baseUrl: '/' }}
      renderInternalLink={({ href, className: linkClassName, children }) => (
        <Link prefetch={false} href={href} className={linkClassName}>
          {children}
        </Link>
      )}
      renderExternalLink={({ href, title, className: linkClassName, children }) => (
        <a href={href} title={title} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          {children}
        </a>
      )}
    />
  );
}
