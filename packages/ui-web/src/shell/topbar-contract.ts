/**
 * 共源产品顶栏的宿主契约（`DESK-ONLINE-008` / `DESK-ONLINE-014`）。
 *
 * 这些类型是 ProductTopBar 与宿主之间的注入面：共享 DOM、交互与语义在此闭合，
 * 而**账号真相、消息数据、路由、系统浏览器**全部留在宿主——DESK-012 要求桌面端的
 * 线上状态惰性接入，所以本契约只表达"宿主已经知道的事实"，不表达任何获取方式。
 *
 * 所有展示/禁用决策经 CapabilityAvailability 表达：`{ kind: 'available' }` 的入口才
 * 可点击；`unavailable` 带产品文案解释；`unknown` 按不可用处理但不写死原因。
 */
import type { MouseEvent, ReactNode } from 'react';

import { unavailable, type CapabilityAvailability } from '../capability/index';

/**
 * 顶栏导航回调。共享组件渲染真实 `<a href>`；宿主在回调里决定是否
 * `event.preventDefault()` 后接管路由（Web→Next Router，Desktop→TanStack）。
 */
export type TopBarNavigate = (href: string, event: MouseEvent<HTMLAnchorElement>) => void;

/**
 * 渲染 `<a href>` 时把产品路径解析成运行时 href——hash-history 宿主（Desktop）
 * 传 `(href) => '#' + href`，使「复制链接/新标签打开」落到正确地址。导航回调
 * 仍收到未解析的产品路径；站外 URL 不经过本函数。
 */
export type TopBarResolveInternalHref = (href: string) => string;

/** 不可用入口的处置策略，与产品导航一致。 */
export type TopBarUnavailablePolicy = 'hide' | 'explain';

/**
 * 顶栏账号投影——宿主已验证身份的只读状态机，不携带任何凭据或获取方式。
 *
 * - `unknown`：宿主尚未验证（本地优先冷启动）。不得渲染"登录/注册"按钮——
 *   已保存身份不冒称未验证（DESK-ONLINE-008）；点击经 `onRequestAuth` 由宿主决定动作。
 * - `authenticating`：宿主正在走授权流程（如系统浏览器往返）；按钮禁用等待。
 * - `expired`/`unreachable`/`signed-out`：宿主已完成验证且没有当前可用身份。
 */
export type TopBarAccountState =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'authenticating' }
  | {
      readonly kind: 'signed-in';
      readonly username: string;
      /** 宿主侧展示名（Desktop 可能优先 displayName）；缺省回退 username。 */
      readonly displayName?: string | null;
      /** 已验证 data: URL 头像；无头像/未加载时渲染首字母。 */
      readonly avatarDataUrl?: string | null;
      /** 账号装饰插槽（如 Web 的 UserTitle 徽章）；共享层只负责摆放，不渲染秘密。 */
      readonly title?: ReactNode;
    };

/**
 * 顶栏消息中心摘要。只由宿主在**用户已登录且已查询**时注入；没有数据就是
 * 无角标的铃铛入口，绝不由共享组件伪造未读数。
 */
export interface TopBarMessagesSummary {
  readonly unreadTotal: number;
  readonly hasCrowdReviewPending: boolean;
}

/**
 * 顶栏自身消费的产品路径（logo / 消息中心 / 账号下拉两项）。
 *
 * 这些是 NAV_GROUPS 之外的顶栏语义路径，宿主的 CapabilitySnapshot 必须把
 * 它们一并声明——能力快照与真实路由分叉时，未声明路径按 `unknown` 禁用，
 * 顶栏永远不会渲染可点击的死链。
 */
export const TOPBAR_HOME_HREF = '/';
export const TOPBAR_MESSAGES_HREF = '/messages';
export const TOPBAR_ACCOUNT_LINK_HREFS = ['/me', '/character-manager'] as const;

export const TOPBAR_PRODUCT_HREFS: readonly string[] = [
  TOPBAR_HOME_HREF,
  TOPBAR_MESSAGES_HREF,
  ...TOPBAR_ACCOUNT_LINK_HREFS,
];

/** 不可用原因的产品文案——所有能力判定入口共用这一份表述。 */
export const describeUnavailableReason = (
  availability: CapabilityAvailability,
  isExternal: boolean,
): string => {
  if (isExternal) return '此入口需要在系统浏览器中打开，当前运行时未提供该能力';
  switch (availability.kind) {
    case 'available':
      return '';
    case 'unknown':
      return '当前运行时未声明此入口的可用状态';
    case 'unavailable':
      switch (availability.reason) {
        case 'not-configured':
          return availability.detail ?? '需要先完成配置';
        case 'requires-sign-in':
          return availability.detail ?? '需要登录后使用';
        case 'service-unavailable':
          return availability.detail ?? '服务暂时不可用';
        case 'not-implemented':
          return availability.detail ?? '尚未实现';
        case 'storage-unavailable':
          return availability.detail ?? '本地存储不可用';
      }
  }
};

/**
 * 入口的有效可用性：站外链接额外要求宿主提供系统浏览器接管回调，
 * 没有回调时无论快照如何都按"需系统浏览器"禁用——打开站外站点是宿主能力，
 * 共源组件绝不渲染一个点了没反应的链接。
 */
export const topBarEntryAvailability = (
  availability: CapabilityAvailability,
  isExternal: boolean | undefined,
  hasExternalHandler: boolean,
): CapabilityAvailability =>
  isExternal === true && !hasExternalHandler
    ? unavailable('not-implemented', describeUnavailableReason(availability, true))
    : availability;
