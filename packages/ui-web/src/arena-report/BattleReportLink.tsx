import type { ComponentPropsWithoutRef, SyntheticEvent } from 'react';
import type { BattleReportHostPorts } from './ports';

type BattleReportLinkProps = ComponentPropsWithoutRef<'a'> & Pick<BattleReportHostPorts, 'onNavigateExternal'>;

/** The host owns all link activation when provided; no native navigation can bypass its policy. */
export function BattleReportLink({ onNavigateExternal, onClick, onAuxClick, onKeyDown, href, ...props }: BattleReportLinkProps) {
  if (!onNavigateExternal) return <a {...props} href={href} onClick={onClick} onAuxClick={onAuxClick} onKeyDown={onKeyDown} />;
  const trimmedHref = href?.trim() ?? '';
  const destination = trimmedHref.startsWith('//') ? `https:${trimmedHref}` : trimmedHref;
  const navigate = (event: SyntheticEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (destination) void onNavigateExternal(destination);
  };
  return <a {...props} role="link" tabIndex={props.tabIndex ?? 0}
    onClick={(event) => { onClick?.(event); navigate(event); }}
    onAuxClick={(event) => { onAuxClick?.(event); if (event.button === 1) navigate(event); }}
    onKeyDown={(event) => { onKeyDown?.(event); if (event.key === 'Enter') navigate(event); }}
  />;
}
