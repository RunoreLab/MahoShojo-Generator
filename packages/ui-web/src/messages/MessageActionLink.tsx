import type { ReactNode } from 'react';

import { shouldInterceptInternalLinkClick } from '../link-click';

import { classifyMessageActionUrl, type MessageLinkHandlers } from './message-ui';

interface MessageActionLinkProps extends MessageLinkHandlers {
  readonly actionUrl: string | null;
  readonly className: string;
  readonly children: ReactNode;
}

/**
 * 消息内的动作链接（「查看详情」「前往调查院」）。
 *
 * - internal（`/…`）：渲染真实 `<a href>`（hash-history 宿主经
 *   `resolveInternalHref` 解析）；普通主键点击拦截后交 `onNavigate`，
 *   修饰键/非主键交回运行时原生语义；
 * - external（http/https）：渲染原生 `<a href>`；宿主提供
 *   `onNavigateExternal` 时拦截交给它（Desktop→openContent 确认 +
 *   native `open_external_url` 校验），缺省即浏览器原生打开（Web 与
 *   原 `<Link>` 同 tab 行为一致）；
 * - 其余（空串、`javascript:` 等）：**不渲染**——服务端内容不构成
 *   脚本执行面。
 */
export function MessageActionLink({
  actionUrl,
  className,
  children,
  onNavigate,
  onNavigateExternal,
  resolveInternalHref,
}: MessageActionLinkProps) {
  const target = classifyMessageActionUrl(actionUrl);
  if (target.kind === 'unsafe') return null;

  if (target.kind === 'external') {
    return (
      <a
        href={target.href}
        className={className}
        onClick={(event) => {
          if (!onNavigateExternal) return;
          event.preventDefault();
          onNavigateExternal(target.href);
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <a
      href={resolveInternalHref?.(target.href) ?? target.href}
      className={className}
      onClick={(event) => {
        if (!onNavigate || !shouldInterceptInternalLinkClick(event)) return;
        event.preventDefault();
        onNavigate(target.href);
      }}
    >
      {children}
    </a>
  );
}
