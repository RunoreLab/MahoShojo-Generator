// 顶栏账号投影的映射（`TopBarAccountState` ← `DesktopCloudSessionState`）。
//
// 映射是产品语义而不只是字段拷贝：
// - `!bootstrapped` → `unknown`：本机凭据读取在途（极短窗口）渲染中性「账号」
//   占位——此时还不知道本机是否保存过身份，不冒称已登出（DESK-ONLINE-008）；
// - `account != null` → `signed-in`：本机认识这个账号就直接显示名字
//   （cached-first）——验证在途并不在顶栏闪烁「用户」占位；`unreachable`
//   时叠一枚「离线」徽标，身份仍按本机凭据保留（DESK-ONLINE-012 同一句话的
//   两个面向：unreachable 既不映射成已注销，也不冒称已验证）；
// - `authenticating` 映射为独立态：顶栏账号区此时是等待授权，而不是「登录/注册」。

import type { ReactElement } from 'react';
import type { TopBarAccountState } from '@mahoshojo/ui-web/shell';

import type { DesktopCloudSessionState } from './cloud-session-store';

/** unreachable 时的身份徽标：名字照常显示，但标注这是本机凭据而非已验证身份。 */
const OfflineMark = (): ReactElement => (
  <span
    className="rounded-full border border-amber-300/70 bg-amber-50/80 px-1.5 text-[10px] font-medium leading-4 text-amber-600 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300"
    title="服务暂时不可达，正在显示本机保存的账号"
  >
    离线
  </span>
);

export const projectTopBarAccount = (
  state: DesktopCloudSessionState,
): TopBarAccountState => {
  if (state.authFlow.kind === 'authenticating') {
    return { kind: 'authenticating' };
  }
  if (state.account !== null) {
    return {
      kind: 'signed-in',
      username: state.account.username,
      displayName: state.account.displayName ?? null,
      ...(state.verification === 'unreachable' ? { title: <OfflineMark /> } : {}),
    };
  }
  switch (state.verification) {
    case 'idle':
      // bootstrap 在途（或未触发）：还不知道本机是否保存过身份。
      return { kind: 'unknown' };
    case 'checking':
      return { kind: 'loading' };
    case 'expired':
      return { kind: 'expired' };
    case 'unreachable':
      return { kind: 'unreachable' };
    default:
      return { kind: 'signed-out' };
  }
};
