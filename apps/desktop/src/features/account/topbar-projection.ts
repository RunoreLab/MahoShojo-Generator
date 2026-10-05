// 顶栏账号投影的映射（`TopBarAccountState` ← `DesktopCloudSessionPhase`）。
//
// 映射是产品语义而不只是字段拷贝：
// - `idle` → `unknown`：从未查询过不等于「已登出」——已保存身份不冒称
//   未验证（DESK-ONLINE-008），顶栏渲染中性「账号」占位；
// - `unreachable` 原样透出：本地凭据仍在，绝不能映射成已注销（契约注释与
//   DESK-ONLINE-012 同一句话的两个面向）；
// - `authenticating` 映射为独立态：顶栏账号区此时是等待授权，而不是「登录/注册」。

import type { TopBarAccountState } from '@mahoshojo/ui-web/shell';

import type { DesktopCloudSessionPhase } from './cloud-session-store';

export const projectTopBarAccount = (
  phase: DesktopCloudSessionPhase,
): TopBarAccountState => {
  switch (phase.kind) {
    case 'idle':
      return { kind: 'unknown' };
    case 'checking':
      return { kind: 'loading' };
    case 'authenticating':
      return { kind: 'authenticating' };
    case 'ready':
      switch (phase.session.state) {
        case 'active':
          return {
            kind: 'signed-in',
            username: phase.session.account.username,
            displayName: phase.session.account.displayName ?? null,
          };
        case 'signed-out':
          return { kind: 'signed-out' };
        case 'expired':
          return { kind: 'expired' };
        case 'unreachable':
          return { kind: 'unreachable' };
      }
  }
};
