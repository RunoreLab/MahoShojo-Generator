import type { CSSProperties, ReactNode } from 'react';

import {
  EncyclopediaLinks,
  type EncyclopediaLinkItem,
} from '../encyclopedia/views/EncyclopediaLinks';

/**
 * `/details` 介绍区：问卷说明、注意事项、百科链接、
 * 「开始回答问卷 / 快速随机生成」两个 CTA 与可选的补充链接位。
 *
 * 自 Web `DetailsPage` 上移（DESK-PARITY-004）：
 * - 卡片顶部的 Logo 图不属于本区段（问卷页全程显示），由页面自绘；
 * - 百科链接走宿主 `onNavigate`——Web 是 router.push，Desktop 是
 *   hash 路由导航；
 * - 「创作工坊入口」「返回首页」等宿主差异位以 slot 注入；
 * - 快速随机是纯本地生成，两端共享同一入口语义。
 */

export interface DetailsIntroSectionProps {
  onStart: () => void;
  startLabel?: string;
  onQuickRandom: () => void;
  quickRandomLabel?: string;
  quickRandomBusy?: boolean;
  /** 快速随机按钮的覆盖样式（如 `/canshou` 紫色渐变）；缺省为绿色渐变。 */
  quickRandomStyle?: CSSProperties;
  /** 顶部描述块；`undefined` 渲染 `/details` 默认文案，`null` 不渲染。 */
  description?: ReactNode;
  /** 百科条目链接（slug + 文案）；`onNavigateEntry` 收到的是 `/encyclopedia/<slug>` 产品路径。 */
  encyclopediaItems?: readonly EncyclopediaLinkItem[];
  onNavigateEntry?: (href: string) => void;
  /** 百科链接/标签的宿主类名覆盖（深色卡片等场景）。 */
  encyclopediaLinkClassName?: string;
  encyclopediaLabelClassName?: string;
  /** 渲染百科链接 `<a href>` 时把产品路径解析成运行时 href（Desktop hash history 传 `#` 前缀）。 */
  resolveInternalHref?: (href: string) => string;
  /** 创作工坊等补充链接节点（宿主自行决定内跳/外部打开）。 */
  extraLink?: ReactNode;
  /** 返回入口节点；缺省不渲染返回行。 */
  backHome?: ReactNode;
  introStyle?: CSSProperties;
}

export function DetailsIntroSection({
  onStart,
  startLabel = '开始回答问卷',
  onQuickRandom,
  quickRandomLabel = '快速随机生成',
  quickRandomBusy = false,
  quickRandomStyle,
  description,
  encyclopediaItems = [
    { slug: 'character-generator', text: '百科：角色生成入口说明' },
    { slug: 'archive', text: '百科：档案馆（角色管理）' },
  ],
  onNavigateEntry,
  encyclopediaLinkClassName,
  encyclopediaLabelClassName,
  resolveInternalHref,
  extraLink,
  backHome,
  introStyle,
}: DetailsIntroSectionProps) {
  return (
    <div className="text-center">
      {description === undefined ? (
        <div
          className="mb-6 leading-relaxed text-gray-800"
          style={{ lineHeight: '1.5', marginTop: '3rem', marginBottom: '4rem', ...introStyle }}
        >
          你在魔法少女道路上的潜力和表现将会如何？<br />
          <p className="mt-4 text-sm text-gray-500 italic">本测试设定来源于小说《下班，然后变成魔法少女》</p>
        </div>
      ) : description}
      {/* 注意事项 */}
      <div className="mb-6 p-3 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 text-sm text-left rounded-r-lg">
        <p className="font-bold">⚠️ 注意事项</p>
        <p className="mt-1">请勿在问卷中输入任何真实的隐私信息，或任何不适宜、攻击性、不符合公序良俗的内容。所有回答将被用于生成虚拟角色，并且将会被储存在角色信息中。</p>
      </div>
      {onNavigateEntry && (
        <EncyclopediaLinks
          items={encyclopediaItems}
          onNavigate={onNavigateEntry}
          {...(resolveInternalHref ? { resolveInternalHref } : {})}
          {...(encyclopediaLabelClassName ? { labelClassName: encyclopediaLabelClassName } : {})}
          {...(encyclopediaLinkClassName ? { linkClassName: encyclopediaLinkClassName } : {})}
        />
      )}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <button type="button" onClick={onStart} className="generate-button text-lg flex-1">
          {startLabel}
        </button>
        <button
          type="button"
          onClick={onQuickRandom}
          disabled={quickRandomBusy}
          className="generate-button text-lg flex-1"
          style={quickRandomStyle ?? { background: 'linear-gradient(to right, #22c55e, #16a34a)' }}
        >
          {quickRandomBusy ? '生成中...' : quickRandomLabel}
        </button>
      </div>
      {extraLink && <div className="mt-4 text-center">{extraLink}</div>}
      {backHome && <div className="text-center" style={{ marginTop: '2rem' }}>{backHome}</div>}
    </div>
  );
}
