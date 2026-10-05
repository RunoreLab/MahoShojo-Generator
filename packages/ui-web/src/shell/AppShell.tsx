import type { CSSProperties, ReactNode } from 'react';

export interface AppShellProps {
  /** 品牌区。默认渲染产品名；传入 `null` 可完全隐藏（归档等工具页）。 */
  readonly brand?: ReactNode;
  /** 顶栏。位置与品牌区并列，因此在导航之前渲染。 */
  readonly topBar?: ReactNode;
  readonly navigation?: ReactNode;
  readonly children: ReactNode;
  /**
   * 页面内容是否已经是全宽滚动容器。
   *
   * 共享壳只负责**背景、层级与内容宽度**三件事，不负责页面内部布局。让每个页面自己再套一层滚动容器
   * 的后果是出现双滚动条，而双滚动条在桌面窗口里尤其容易被误认为布局错乱。
   */
  readonly bleedContent?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * 共源产品壳的外框。
 *
 * 它刻意**不含**登录探测、公告轮询、统计、云端徽章或远端图片——`apps/web/app/providers.tsx` 挂载的
 * 那些是 Web 在线启动流程的一部分，`DESK-PROD-004` 明确禁止本地壳自动发起项目请求。共用一个布局
 * 外观并不证明离线启动已达成，因此这里只保留纯本地的呈现。
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
    className={['flex min-h-full flex-col bg-(--app-page-bg) text-(--app-text)', className]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ')}
    style={style}
  >
    {brand ?? (
      <header className="flex items-center gap-3 px-4 py-3 sm:px-6 lg:px-10">
        <span className="text-base font-semibold">MahoShojo Generator</span>
      </header>
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