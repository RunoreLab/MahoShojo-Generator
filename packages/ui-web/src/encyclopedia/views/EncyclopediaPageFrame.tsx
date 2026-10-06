import type { ReactNode } from 'react';

export interface EncyclopediaPageFrameProps {
  /** 白卡头部分隔线以上的内容：标题、宿主简介与 `headerLinks`。 */
  readonly header: ReactNode;
  readonly children: ReactNode;
}

/**
 * 共源百科的页面骨架：`magic-background-white` 页面背景 → `max-w-6xl` 限宽容器 → 半透明白卡
 * → header/body 分层。
 *
 * ## 为什么骨架属于共源，而不是宿主 wrapper
 *
 * 这套层次是百科的**可读性契约**——限宽、圆角 surface、阴影与背景层次、header 分隔线与各自
 * padding——不是宿主包装偏好。共源抽取（`c7f3421f`）曾把它和业务视图一起拆掉、却只把业务视图
 * 接回 Web，造成白卡骨架丢失的回归（D5.1 百科 UI compatibility 收口）。两个宿主渲染同一骨架
 * 是 `ADR-desktop-shared-product` §2「同一信息架构」的直接推论；宿主差异经 `subtitle`、
 * `headerLinks` 等 props 注入，不靠各自重写骨架。
 *
 * 宿主挂载注意：frame 自带全幅页面背景，宿主壳若带限宽内容容器，需要让百科路由走
 * full-bleed（例如 Desktop `FULL_BLEED_PATHS`），否则背景会被栏盒裁切。
 */
export const EncyclopediaPageFrame = ({ header, children }: EncyclopediaPageFrameProps) => (
  <div data-testid="encyclopedia-page-frame" className="magic-background-white">
    <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4 sm:px-6 lg:px-10">
      <div
        data-testid="encyclopedia-page-card"
        className="rounded-2xl bg-white/95 shadow-[0_20px_40px_rgba(0,0,0,0.10)] ring-1 ring-white/50 backdrop-blur"
      >
        <header className="border-b border-gray-100 px-6 py-5 sm:px-8">{header}</header>
        <div className="px-6 py-6 sm:px-8 sm:py-8">{children}</div>
      </div>
    </div>
  </div>
);
