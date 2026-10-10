import type { ReactNode } from 'react';

export type CardForgePageViewProps = {
  children: ReactNode;
  description?: ReactNode;
  homeLink: ReactNode;
  footer?: ReactNode;
  overlays?: ReactNode;
};

/** 保留 Web 工坊的标题、宽度与外层，文件/AI/预览等能力由宿主装配。 */
export function CardForgePageView({ children, description = '将角色卡 / 情景卡数据转化为卡牌游戏风格的精美卡面', homeLink, footer, overlays }: CardForgePageViewProps) {
  return <div className="card-forge-shell magic-background-white min-h-[100dvh] pb-12">
    <div className="mx-auto px-4 max-w-7xl">
      <div className="pt-8 pb-6 text-center">
        <h1 className="text-3xl md:text-4xl font-bold mb-2 card-forge-title">卡牌工坊</h1>
        <p className="text-sm text-[var(--app-text-muted)]">{description}</p>
      </div>
      {children}
      <div className="mt-8 text-center">{homeLink}</div>
      {footer}
    </div>
    {overlays}
  </div>;
}

/** Web 输入栏与定宽预览栏使用同一断点和比例；无结果也保留工作区。 */
export function CardForgeWorkspace({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(380px,420px)] gap-6 items-start">{children}</div>;
}
