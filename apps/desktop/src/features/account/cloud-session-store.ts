// Desktop 云会话的单一事实源（D5.0c 原生 `desktop-auth-v1` 的 renderer 投影）。
//
// ## 为什么是 store 而不是组件局部状态
//
// 顶栏账号区与设置页 `AccountPanel` 消费的是**同一份**会话：顶栏显示「已登录/
// 离线/服务不可用」、设置页展示授权 URL 与登出，两边各持一份 `useState`
// 就会重新长出「设置页登录了、顶栏还显示未登录」的分叉——这正是
// `use-desktop-ai-config` 单例存在过的同一个问题，所以这里用同一种解法。
//
// ## 启动模型：cached-first + 后台验证（D5.2）
//
// 「冷启动零项目请求」已按 r2 口径撤改（DESK-ONLINE-008 r2 / ADR §4）：
// 有凭据时启动即做一次**有界、非阻塞**的会话再验证。store 构造与订阅仍不发
// 任何 IPC；`bootstrap()` 由首个挂载的消费者触发，分两步：
//
// 1. `cloud_cached_account`——只读 OS 凭据存储（零网络）。有已保存账号就
//    立即投影身份（顶栏直接显示用户名）；没有即已确认 signed-out——
//    `cloud_auth_status` 此时也只可能是 signed-out，不必再问服务端；
// 2. 仅当存在本机身份时才发起一次 `cloud_auth_status` 后台验证。
//
// ## 状态机（三个正交轴）
//
// - `account`：**本机认识谁**（cached 或已验证摘要）。验证在途或失败都不
//   改写它——unreachable 时凭据仍在，身份保留（DESK-ONLINE-012），只有
//   signed-out/expired/登出/登录成功才会改变它；
// - `verification`：本轮启动的**服务端验证结论**——idle（bootstrap 未完）/
//   checking / verified / signed-out / expired / unreachable；
// - `authFlow`：授权流程在途与否（flowId + 授权 URL 供面板展示与取消）。
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
  DesktopCloudAccountSummary,
  DesktopCloudLoginOutcome,
  DesktopCloudSessionStatus,
  DesktopCloudSignOutResult,
} from '@mahoshojo/contracts/desktop-cloud';

import {
  DesktopCloudError,
  awaitCloudLogin,
  beginCloudLogin,
  cancelCloudLogin,
  readCachedCloudAccount,
  readCloudAuthStatus,
  signOutCloud,
  type InvokeFn,
} from '../../platform/cloud-bridge';
import { invalidateTopbarAvatar } from './use-topbar-avatar';

export type DesktopCloudVerification =
  | 'idle'
  | 'checking'
  | 'verified'
  | 'signed-out'
  | 'expired'
  | 'unreachable';

export interface DesktopCloudSessionState {
  /** 本机凭据读取是否完成。false = 尚未知道本机有没有保存过账号（极短窗口）。 */
  readonly bootstrapped: boolean;
  /** 本机认识的账号（cached 或已验证）；null = 已确认无会话。 */
  readonly account: DesktopCloudAccountSummary | null;
  readonly sessionExpiresAt: string | null;
  readonly verification: DesktopCloudVerification;
  readonly authFlow:
    | { readonly kind: 'idle' }
    | {
        readonly kind: 'authenticating';
        readonly flowId: string;
        readonly authorizeUrl: string;
      };
  readonly lastError: string | null;
}

const INITIAL_STATE: DesktopCloudSessionState = {
  bootstrapped: false,
  account: null,
  sessionExpiresAt: null,
  verification: 'idle',
  authFlow: { kind: 'idle' },
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

/** 授权前快照：`refresh`/`requestAuth` 在授权在途时只读它，不发新查询。 */
interface IdentityBeforeLogin {
  readonly account: DesktopCloudAccountSummary | null;
  readonly sessionExpiresAt: string | null;
  readonly verification: DesktopCloudVerification;
}

const toSessionStatus = (identity: IdentityBeforeLogin): DesktopCloudSessionStatus => {
  if (identity.account !== null) {
    return {
      state: 'active',
      account: identity.account,
      ...(identity.sessionExpiresAt !== null
        ? { sessionExpiresAt: identity.sessionExpiresAt }
        : {}),
    };
  }
  if (identity.verification === 'expired') return { state: 'expired' };
  if (identity.verification === 'unreachable') return { state: 'unreachable' };
  return { state: 'signed-out' };
};

const IDLE_FLOW = { kind: 'idle' } as const;

export class DesktopCloudSessionStore {
  private state: DesktopCloudSessionState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private bootstrapPromise: Promise<void> | null = null;
  private statusPromise: Promise<DesktopCloudSessionStatus> | null = null;
  /**
   * 授权流程 single-flight 兼状态机门禁。不能只查 `authFlow === 'authenticating'`：
   * `begin` 返回前 authFlow 还不是 authenticating，两个调用会在那条窗口里各自
   * 创建 listener/PKCE/flowId——native 并没有「全局只允许一条 flow」的限制。
   * 同一窗口里 `refresh` 也不得新发 `cloud_auth_status`：迟到的 signed-out
   * 会在 authenticating 建立后把它覆盖回去，让 renderer 在 native 仍在授权时
   * 忘记自己正在登录（D5.0d-r2）。
   */
  private loginPromise: Promise<DesktopCloudLoginOutcome | null> | null = null;
  /** `authenticating` 期间记住进入前的身份投影，取消授权时原样恢复而不是猜。 */
  private identityBeforeLogin: IdentityBeforeLogin | null = null;

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
   * 启动装载（cached-first）：先读本机凭据把身份投影出来，再在后台验证。
   * 由首个挂载的消费者触发，single-flight——重挂载不会重复发起。
   *
   * 等待与失败都不阻塞首屏：本机身份在 publish 时已生效，随后的
   * `cloud_auth_status` 是后台事实校正。
   */
  bootstrap = (): Promise<void> => {
    this.bootstrapPromise ??= this.doBootstrap();
    return this.bootstrapPromise;
  };

  private doBootstrap = async (): Promise<void> => {
    let cached;
    try {
      cached = await readCachedCloudAccount(this.deps.invoke);
    } catch (cause) {
      // 凭据读取失败 ≠ 已登出：凭据可能存在但读不出，如实按不可达处理。
      this.publish({
        bootstrapped: true,
        verification: 'unreachable',
        lastError: `账号信息读取失败：${describeCloudSessionError(cause)}`,
      });
      return;
    }

    if (cached === null) {
      // 本机没有已保存账号：没有 cookie 可供服务端确认，`cloud_auth_status`
      // 也只可能是 signed-out——直接进入已确认未登录，零网络往返。
      this.publish({ bootstrapped: true, verification: 'signed-out' });
      return;
    }

    this.publish({
      bootstrapped: true,
      account: cached.account,
      sessionExpiresAt: cached.sessionExpiresAt ?? null,
      verification: 'checking',
    });
    // 后台验证：active 确认身份，expired 清除，unreachable 保留身份。
    await this.refresh();
  };

  /**
   * 主动查询一次会话状态（含服务端确认）。在途查询复用同一个 promise；
   * 授权在途期间（含 `begin` 未返回、authFlow 尚未进入 `authenticating` 的
   * 窗口）不再发起新查询——返回进入授权前保存的快照。
   *
   * unreachable 只更新 `verification`：**不清除** `account`——本地凭据仍在，
   * 身份保留，网络状态单独表达。
   */
  refresh = async (): Promise<DesktopCloudSessionStatus> => {
    if (this.loginPromise) {
      return toSessionStatus(this.identityBeforeLogin ?? {
        account: null,
        sessionExpiresAt: null,
        verification: 'unreachable',
      });
    }
    if (this.statusPromise) return this.statusPromise;

    this.statusPromise = (async () => {
      this.publish({ verification: 'checking' });
      try {
        const session = await readCloudAuthStatus(this.deps.invoke);
        switch (session.state) {
          case 'active':
            this.publish({
              account: session.account,
              sessionExpiresAt: session.sessionExpiresAt ?? null,
              verification: 'verified',
              lastError: null,
            });
            break;
          case 'signed-out':
            this.publish({
              account: null,
              sessionExpiresAt: null,
              verification: 'signed-out',
              lastError: null,
            });
            break;
          case 'expired':
            this.publish({
              account: null,
              sessionExpiresAt: null,
              verification: 'expired',
              lastError: null,
            });
            break;
          case 'unreachable':
            // 成功必须清掉旧错误；unreachable 不清身份。
            this.publish({ verification: 'unreachable', lastError: null });
            break;
        }
        return session;
      } catch (cause) {
        this.publish({
          verification: 'unreachable',
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
   * - 已有本机身份：什么都不做（顶栏此时已渲染用户名菜单，不该走到这）；
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
   * `cancelled`/`failed` 是正常终态：恢复进入授权前的身份投影（而不是一律
   * 标成 signed-out——授权流并不消费也不创建凭据）。`signed-in` 直接构造
   * verified 投影，省去一次本不必要的二次查询。
   */
  private runLogin = async (): Promise<DesktopCloudLoginOutcome | null> => {
    const prior: IdentityBeforeLogin = {
      account: this.state.account,
      sessionExpiresAt: this.state.sessionExpiresAt,
      verification: this.state.verification,
    };
    this.identityBeforeLogin = prior;
    this.publish({ lastError: null });

    try {
      const begin = await beginCloudLogin(this.deps.invoke);
      this.publish({
        authFlow: {
          kind: 'authenticating',
          flowId: begin.flowId,
          authorizeUrl: begin.authorizeUrl,
        },
      });
      const outcome = await awaitCloudLogin(this.deps.invoke, begin.flowId);
      this.identityBeforeLogin = null;
      if (outcome.status === 'signed-in') {
        // 新登录成功是一次会话边界：头像缓存随新身份失效一次，下一次
        // 挂载重新拉取（同账号重登也能拿到 Web 侧改过的头像）。
        invalidateTopbarAvatar(outcome.account.userId);
        this.publish({
          authFlow: IDLE_FLOW,
          account: outcome.account,
          sessionExpiresAt: outcome.sessionExpiresAt,
          verification: 'verified',
        });
      } else {
        this.publish({
          authFlow: IDLE_FLOW,
          account: prior.account,
          sessionExpiresAt: prior.sessionExpiresAt,
          verification: prior.verification,
          ...(outcome.status === 'failed'
            ? { lastError: `登录未完成（${outcome.code}）：${outcome.message}` }
            : {}),
        });
      }
      return outcome;
    } catch (cause) {
      this.identityBeforeLogin = null;
      this.publish({
        authFlow: IDLE_FLOW,
        account: prior.account,
        sessionExpiresAt: prior.sessionExpiresAt,
        verification: prior.verification,
        lastError: describeCloudSessionError(cause),
      });
      return null;
    } finally {
      this.loginPromise = null;
    }
  };

  /** 取消在途授权；`await` 随后自然收到 `cancelled` 并恢复先前身份投影。 */
  cancelLogin = async (): Promise<void> => {
    if (this.state.authFlow.kind !== 'authenticating') return;
    try {
      await cancelCloudLogin(this.deps.invoke, this.state.authFlow.flowId);
    } catch {
      // 取消失败的唯一后果是授权流继续走到终态——那是 native 自己能收的状态。
    }
  };

  /** 登出：本地凭据无条件删除；`revoked` 如实回传给面板解释服务端同步结果。 */
  signOut = async (): Promise<DesktopCloudSignOutResult | null> => {
    const previousUserId = this.state.account?.userId;
    try {
      const result = await signOutCloud(this.deps.invoke);
      // 登出即会话边界：已注销账号的头像槽失效，重登后重新拉取。
      if (previousUserId !== undefined) invalidateTopbarAvatar(previousUserId);
      this.publish({
        account: null,
        sessionExpiresAt: null,
        verification: 'signed-out',
        lastError: null,
      });
      return result;
    } catch (cause) {
      this.publish({ lastError: describeCloudSessionError(cause) });
      return null;
    }
  };
}
