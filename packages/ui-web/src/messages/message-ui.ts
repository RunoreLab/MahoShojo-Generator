/**
 * 消息呈现层的纯展示助手（自 `apps/web` 上移，DOM/文案逐字保留）。
 *
 * 只消费 `@mahoshojo/contracts/messages` 的 DTO 类型——不 fetch、不依赖
 * 路由或宿主 runtime；Web 页面与 Desktop 消息窄通道消费同一套输出。
 */
import type { MessagePriority, MessageScope } from '@mahoshojo/contracts/messages';

export function getMessageScopeLabel(scope: MessageScope): string {
  return scope === 'site' ? '全站通知' : '定向通知';
}

export function getMessagePriorityClassName(priority: MessagePriority): string {
  if (priority === 'high') {
    return 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-200';
  }
  if (priority === 'low') {
    return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300';
  }
  return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-200';
}

export function getMessagePriorityLabel(priority: MessagePriority): string {
  if (priority === 'high') {
    return '高优先级';
  }
  if (priority === 'low') {
    return '低优先级';
  }
  return '普通优先级';
}

export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** 宿主对消息内产品路径的导航回调（百科同款：只回传路径，路由由宿主接管）。 */
export type MessageNavigate = (href: string) => void;

/**
 * 消息卡/众查卡共享的链接处理器集合。
 *
 * - `onNavigate`：internal actionUrl 普通主键点击时调用（Web→router.push，
 *   Desktop→hash-history navigate）；缺省即原生锚点语义；
 * - `onNavigateExternal`：http(s) 站外 actionUrl 的宿主接管（Desktop→
 *   openContent 确认 + `open_external_url`）；缺省让浏览器原生打开；
 * - `resolveInternalHref`：hash-history 宿主把产品路径解析成运行时 href，
 *   使「复制链接/新标签」落到正确地址。
 */
export interface MessageLinkHandlers {
  readonly onNavigate?: MessageNavigate;
  readonly onNavigateExternal?: ((href: string) => void) | undefined;
  readonly resolveInternalHref?: ((href: string) => string) | undefined;
}

/**
 * actionUrl 的呈现分类。
 *
 * 服务端内容不能盲目渲染成 `<a href>`：`javascript:` 一类 scheme 在 Web 与
 * Desktop WebView 里都是脚本执行面——只放行产品路径与 http(s)，其余一律
 * 不渲染链接（比原 Web `<Link>` 更严，合法消息不受影响）。
 */
export type MessageActionTarget =
  | { readonly kind: 'internal'; readonly href: string }
  | { readonly kind: 'external'; readonly href: string }
  | { readonly kind: 'unsafe' };

export const classifyMessageActionUrl = (actionUrl: string | null): MessageActionTarget => {
  if (typeof actionUrl !== 'string' || actionUrl === '') return { kind: 'unsafe' };
  if (actionUrl.startsWith('/')) return { kind: 'internal', href: actionUrl };
  try {
    const url = new URL(actionUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { kind: 'external', href: actionUrl };
    }
  } catch {
    // 非 URL 原文不渲染链接。
  }
  return { kind: 'unsafe' };
};

