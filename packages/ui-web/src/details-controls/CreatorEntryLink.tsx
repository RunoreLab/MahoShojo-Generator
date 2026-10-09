import type { ReactNode } from 'react';

export interface CreatorEntryLinkProps {
  className?: string;
  linkClassName?: string;
  prefixText?: string;
  resolveInternalHref?: (href: string) => string;
  onNavigate?: (href: string) => void;
  renderLink?: (props: { href: string; className: string; children: ReactNode }) => ReactNode;
}

/** Web 原有创作入口；宿主只适配路由，不另写文案与样式。 */
export function CreatorEntryLink({
  className = 'text-sm text-gray-600',
  linkClassName = 'font-semibold text-indigo-600 hover:underline',
  prefixText = '想直接创作？',
  resolveInternalHref = (href) => href,
  onNavigate,
  renderLink,
}: CreatorEntryLinkProps) {
  const props = { href: resolveInternalHref('/creator'), className: linkClassName, children: '前往创作工坊' };
  return (
    <p className={className}>
      {prefixText}{' '}
      {renderLink ? renderLink(props) : <a {...props} onClick={(event) => {
        if (!onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onNavigate('/creator');
      }} />}
    </p>
  );
}
