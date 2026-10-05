// Desktop 云会话的单一事实源（D5.0c 原生 `desktop-auth-v1` 的 renderer 投影）。
//
// ## 为什么是 store 而不是组件局部状态
//
// 顶栏账号区与设置页 `AccountPanel` 消费的是**同一份**会话：顶栏显示「已登录/
// 未验证/服务不可用」、设置页展示授权 URL 与登出，两边各持一份 `useState`
// 就会重新长出「设置页登录了、顶栏还显示未登录」的分叉——这正是
// `use-desktop-ai-config` 单例存在过的同一个问题，所以这里用同一种解法。
//
// ## 惰性约束（DESK-ONLINE-008 / DESK-ONLINE-012 / DESK-PROD-004）
//
// store 构造与订阅都不发任何 IPC。唯一发起 `cloud_auth_status` 的时机是用户
// 的主动动作：点开设置页账号面板（`refresh`）或点击顶栏账号区（`requestAuth`）。
// 因此冷启动的顶栏投影是 `idle → 'unknown'`——中性「账号」占位，而不是
// 一次在线探测的结果。
//
// ## 状态机
//
// - `idle`：从未查询过（冷启动的诚实投影）；
// - `checking`：一次 `cloud_auth_status` 在途（并发请求复用同一 promise）；
// - `ready`：已知会话快照（active/signed-out/expired/unreachable）；
// - `authenticating`：授权流程在途（flowId + 授权 URL 供面板展示与取消）。
//
// `lastError` 只承载最近一次会话级操作的可读错误；成功操作会清空它。
//
// ## 授权流程的所有权
//
// 登录 flow 是**进程级**会话操作：顶栏与设置页共享同一条，终止条件只有
// 显式 `cancelLogin`、native deadline 或应用生命周期结束——React 页面卸载
// 一律不取消它。发起入口对 UI 只有 `requestAuth`（先验证身份再按需
// `startLogin`），外部拿不到 `startLogin`，因此不存在「绕过身份确认直接
// 建 flow」的路径；整条链经 `statusPromise`/`loginPromise` 收敛为
// single-flight：授权在途（含 `begin` 未返回的窗口）内 `requestAuth` 搭上
// 同一条授权、`refresh` 只读授权前快照——两个 surface 并发请求只会产生一条
// native flow，状态机也不会被迟到的 status read 覆盖。

import type {
  DesktopCloudLoginOutcome,
  DesktopCloudSessionStatus,
  DesktopCloudSignOutResult,
} from '@mahoshojo/contracts/desktop-cloud';

import {
  DesktopCloudError,
  awaitCloudLogin,
  beginCloudLogin,
  cancelCloudLogin,
  readCloudAuthStatus,
  signOutCloud,
  type InvokeFn,
} from '../../platform/cloud-bridge';

export type DesktopCloudSessionPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly session: DesktopCloudSessionStatus }
  | {
      readonly kind: 'authenticating';
      readonly flowId: string;
      readonly authorizeUrl: string;
    };

export interface DesktopCloudSessionState {
  readonly phase: DesktopCloudSessionPhase;
  readonly lastError: string | null;
}

const INITIAL_STATE: DesktopCloudSessionState = {
  phase: { kind: 'idle' },
  lastError: null,
};

export const describeCloudSessionError = (cause: unknown): string =>
  cause instanceof DesktopCloudError
    ? `${cause.code}：${cause.message}`
    : cause instanceof Error
      ? cause.message
      : '未知错误';

export interface DesktopCloudSessionDeps {
  invoke: InvokeFn;
}

export class DesktopCloudSessionStore {
  private state: DesktopCloudSessionState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private statusPromise: Promise<DesktopCloudSessionStatus> | null = null;
  /**
   * 授权流程 single-flight 兼状态机门禁。不能只查 `phase === 'authenticating'`：
   * `begin` 返回前 phase 还不是 authenticating，两个调用会在那条窗口里各自
   * 创建 listener/PKCE/flowId——native 并没有「全局只允许一条 flow」的限制。
   * 同一窗口里 `refresh` 也不得新发 `cloud_auth_status`：迟到的 signed-out
   * 会在 authenticating 建立后把它覆盖回去，让 renderer 在 native 仍在授权时
   * 忘记自己正在登录（D5.0d-r2）。
   */
  private loginPromise: Promise<DesktopCloudLoginOutcome | null> | null = null;
  /** `authenticating` 期间记住进入前的会话，取消授权时原样恢复而不是猜。 */
  private sessionBeforeLogin: DesktopCloudSessionStatus | null = null;

  constructor(private readonly deps: DesktopCloudSessionDeps) {}

  getSnapshot = (): DesktopCloudSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(patch: Partial<DesktopCloudSessionState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  /**
   * 主动查询一次会话状态（含服务端确认）。在途查询复用同一个 promise；
   * 授权在途期间（含 `begin` 未返回、phase 尚未进入 `authenticating` 的
   * 窗口）不再发起新查询——返回进入授权前保存的快照。
   */
  refresh = async (): Promise<DesktopCloudSessionStatus> => {
    if (this.loginPromise) {
      return this.sessionBeforeLogin ?? { state: 'unreachable' };
    }
    if (this.statusPromise) return this.statusPromise;

    this.statusPromise = (async () => {
      this.publish({ phase: { kind: 'checking' } });
      try {
        const session = await readCloudAuthStatus(this.deps.invoke);
        // 成功必须清掉旧错误：一次失败后的成功读取不该让 UI 同时显示
        // 「已登录/服务正常」与上一次的「会话状态读取失败」。
        this.publish({ phase: { kind: 'ready', session }, lastError: null });
        return session;
      } catch (cause) {
        this.publish({
          phase: { kind: 'ready', session: { state: 'unreachable' } },
          lastError: `会话状态读取失败：${describeCloudSessionError(cause)}`,
        });
        return { state: 'unreachable' };
      } finally {
        this.statusPromise = null;
      }
    })();

    return this.statusPromise;
  };

  /**
   * 授权的唯一入口：先验证当前身份，需要时才打开系统浏览器授权流。
   *
   * - 已有 active 会话：什么都不做（顶栏此时已渲染头像菜单，不该走到这）；
   * - signed-out / expired：开始系统浏览器授权；
   * - unreachable：什么都不做——UI 投影成「服务不可用」，再次点击会重试；
   * - 授权在途（含 `begin` 未返回窗口）：搭上同一条 `loginPromise`，不新建
   *   第二条 flow。
   */
  requestAuth = async (): Promise<DesktopCloudLoginOutcome | null> => {
    if (this.loginPromise) return this.loginPromise;
    const session = await this.refresh();
    // 等 refresh 期间授权可能已被另一入口发起（refresh 也可能只返回授权前
    // 快照）——动手前再确认一次，才真正不存在第二条 flow。
    if (this.loginPromise) return this.loginPromise;
    if (session.state === 'signed-out' || session.state === 'expired') {
      return this.startLogin();
    }
    return null;
  };

  /**
   * 开始一次系统浏览器授权——私有实现细节，UI 一律走 `requestAuth`。
   *
   * 收敛在这里而不是每个调用方：所有「需要登录」的入口都必须先过身份确认，
   * single-flight 也只需要维护一份。
   */
  private startLogin = (): Promise<DesktopCloudLoginOutcome | null> => {
    this.loginPromise ??= this.runLogin();
    return this.loginPromise;
  };

  /**
   * `cancelled`/`failed` 是正常终态：恢复进入授权前的会话快照（而不是一律
   * 标成 signed-out——授权流并不消费也不创建凭据）。`signed-in` 直接构造
   * active 投影，省去一次本不必要的二次查询。
   */
  private runLogin = async (): Promise<DesktopCloudLoginOutcome | null> => {
    const priorSession =
      this.state.phase.kind === 'ready' ? this.state.phase.session : null;
    this.sessionBeforeLogin = priorSession;
    this.publish({ lastError: null });

    try {
      const begin = await beginCloudLogin(this.deps.invoke);
      this.publish({
        phase: {
          kind: 'authenticating',
          flowId: begin.flowId,
          authorizeUrl: begin.authorizeUrl,
        },
      });
      const outcome = await awaitCloudLogin(this.deps.invoke, begin.flowId);
      this.sessionBeforeLogin = null;
      if (outcome.status === 'signed-in') {
        this.publish({
          phase: {
            kind: 'ready',
            session: {
              state: 'active',
              account: outcome.account,
              sessionExpiresAt: outcome.sessionExpiresAt,
            },
          },
        });
      } else {
        this.publish({
          phase: { kind: 'ready', session: priorSession ?? { state: 'signed-out' } },
          ...(outcome.status === 'failed'
            ? { lastError: `登录未完成（${outcome.code}）：${outcome.message}` }
            : {}),
        });
      }
      return outcome;
    } catch (cause) {
      this.sessionBeforeLogin = null;
      this.publish({
        phase: { kind: 'ready', session: priorSession ?? { state: 'unreachable' } },
        lastError: describeCloudSessionError(cause),
      });
      return null;
    } finally {
      this.loginPromise = null;
    }
  };

  /** 取消在途授权；`await` 随后自然收到 `cancelled` 并恢复先前会话。 */
  cancelLogin = async (): Promise<void> => {
    if (this.state.phase.kind !== 'authenticating') return;
    try {
      await cancelCloudLogin(this.deps.invoke, this.state.phase.flowId);
    } catch {
      // 取消失败的唯一后果是授权流继续走到终态——那是 native 自己能收的状态。
    }
  };

  /** 登出：本地凭据无条件删除；`revoked` 如实回传给面板解释服务端同步结果。 */
  signOut = async (): Promise<DesktopCloudSignOutResult | null> => {
    try {
      const result = await signOutCloud(this.deps.invoke);
      this.publish({
        phase: { kind: 'ready', session: { state: 'signed-out' } },
        lastError: null,
      });
      return result;
    } catch (cause) {
      this.publish({ lastError: describeCloudSessionError(cause) });
      return null;
    }
  };
}
