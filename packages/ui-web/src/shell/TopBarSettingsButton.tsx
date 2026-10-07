import { Settings } from 'lucide-react';

import type { CapabilityAvailability } from '../capability/index';

import {
  describeUnavailableReason,
  TOPBAR_SETTINGS_HREF,
  type TopBarNavigate,
  type TopBarResolveInternalHref,
} from './topbar-contract';

interface TopBarSettingsButtonProps {
  /** 宿主对 `/settings` 的能力快照；`available` 才渲染真实链接。 */
  availability: CapabilityAvailability;
  onNavigate: TopBarNavigate;
  /** 渲染 `<a href>` 时把产品路径解析成运行时 href（Desktop hash history 传 `#` 前缀）。 */
  resolveInternalHref?: TopBarResolveInternalHref;
  /** 不可用处置：`'hide'` 整个隐藏、`'explain'` 置灰保留并说明原因（与导航入口同策略）。 */
  unavailable?: 'hide' | 'explain';
}

/**
 * 顶栏设置入口（DESK-SET-001：两端共同的设置页入口）。
 *
 * 设备级设置不要求登录，因此它独立于账号菜单挂载——未登录也可达；
 * 路由未交付时按能力快照禁用而非死链。
 */
export function TopBarSettingsButton({ availability, onNavigate, resolveInternalHref, unavailable = 'hide' }: TopBarSettingsButtonProps) {
  const linkClassName =
    'inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/50 bg-white/70 text-sm font-medium text-gray-700 shadow-sm backdrop-blur transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200 dark:border-slate-600/60 dark:bg-slate-900/70 dark:text-slate-100';

  if (availability.kind !== 'available') {
    if (unavailable === 'hide') return null;
    return (
      <span
        aria-disabled="true"
        title={describeUnavailableReason(availability, false)}
        className={`${linkClassName} cursor-not-allowed opacity-50`}
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
      </span>
    );
  }

  return (
    <a
      href={resolveInternalHref?.(TOPBAR_SETTINGS_HREF) ?? TOPBAR_SETTINGS_HREF}
      onClick={(event) => onNavigate(TOPBAR_SETTINGS_HREF, event)}
      aria-label="设置"
      title="设置"
      className={linkClassName}
    >
      <Settings className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}
