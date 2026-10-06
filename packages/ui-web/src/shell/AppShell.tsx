import type { CSSProperties, ReactNode } from 'react';

export interface AppShellProps {
  /**
   * 品牌区三态（DESK-PARITY-002）：
   * - `undefined`：渲染默认文字品牌；
   * - `null`：完全隐藏（产品壳已由顶栏 logo 承担品牌，不再重复文字）；
   * - 其它 ReactNode：原样渲染宿主自定义品牌。
   */
  readonly brand?: ReactNode;
  /** 顶栏。位置与品牌区并列，因此在导航之前渲染。 */
  readonly topBar?: ReactNode;
  readonly navigation?: ReactNode;
  readonly children: ReactNode;
  /**
   * 页面内容是否已经是全宽滚动容器。
   *
   * 共享壳只负责**层级与内容宽度**两件事，不负责页面内部布局。页面背景由 body 的传播背景
   * （`--app-page-bg`，fixed 到视口）与各页面的 `magic-background*` 变体提供——壳自身不再
   * 另刷一层（`bg-(--app-page-bg)` 编译为 `background-color`，渐变值对它非法，本就是死
   * 规则）。让每个页面自己再套一层滚动容器的后果是出现双滚动条，而双滚动条在桌面窗口里
   * 尤其容易被误认为布局错乱。
   */
  readonly bleedContent?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * 共源产品壳的外框。
 *
 * 它刻意**不含**登录探测、公告轮询、统计、云端徽章或远端图片——`apps/web/app/providers.tsx` 挂载的
 * 那些是 Web 在线启动流程的一部分。`AppShell` 是共享展示组件，本身不直接执行 fetch/auth/bootstrap；
 * 在线刷新由宿主 adapter 按「离线可用、不阻塞、有界、不泄漏」原则负责（`DESK-PROD-004` r2 口径，
 * 不再要求冷启动零项目请求）。共用一个布局外观并不证明离线启动已达成，因此这里只保留纯本地的呈现。
 *
 * 它同样不含路由、不读 `location`、不注册任何全局监听：宿主把已算好的内容作为 children 传入。
 */
export const AppShell = ({
  brand,
  topBar,
  navigation,
  children,
  bleedContent = false,
  className,
  style,
}: AppShellProps) => (
  <div
    data-testid="product-shell"
    className={['flex min-h-screen flex-col text-(--app-text)', className]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ')}
    style={style}
  >
    {brand === undefined ? (
      <header className="flex items-center gap-3 px-4 py-3 sm:px-6 lg:px-10">
        <span className="text-base font-semibold">MahoShojo Generator</span>
      </header>
    ) : (
      brand
    )}
    {topBar}
    {navigation}
    <main
      className={
        bleedContent
          ? 'flex-1'
          : 'mx-auto w-full max-w-6xl flex-1 px-4 pb-10 sm:px-6 lg:px-10'
      }
    >
      {children}
    </main>
  </div>
);