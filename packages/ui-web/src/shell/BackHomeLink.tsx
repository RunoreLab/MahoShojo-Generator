import type { ReactNode } from 'react';

import type { InternalLinkRenderProps } from '../markdown/MarkdownBlock';

export interface BackHomeLinkProps {
  href?: string;
  onNavigate?: () => void;
  renderLink?: (props: InternalLinkRenderProps) => ReactNode;
}

/** 共同的返回首页入口；路由与离开保护仍由宿主承担。 */
export function BackHomeLink({ href = '/', onNavigate, renderLink }: BackHomeLinkProps) {
  const props = { href, className: 'footer-link', children: '返回首页' };
  if (renderLink) return <>{renderLink(props)}</>;
  return (
    <a {...props} onClick={onNavigate ? (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onNavigate();
    } : undefined} />
  );
}
