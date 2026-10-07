import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLOUD_CACHED_ACCOUNT_COMMAND,
  CLOUD_LOGIN_AWAIT_COMMAND,
  CLOUD_LOGIN_BEGIN_COMMAND,
  CLOUD_ME_PROFILE_COMMAND,
  CLOUD_SIGN_OUT_COMMAND,
  CLOUD_AUTH_STATUS_COMMAND,
  type InvokeFn,
} from '../src/platform/cloud-bridge';
import {
  DesktopCloudSessionStore,
  type DesktopCloudSessionDeps,
} from '../src/features/account/cloud-session-store';
import { projectTopBarAccount } from '../src/features/account/topbar-projection';
import {
  ensureTopbarAvatar,
  getTopbarAvatar,
  resetTopbarAvatarForTests,
} from '../src/features/account/use-topbar-avatar';

const ACCOUNT = { userId: 7, username: 'homura', displayName: 'homura' };
const EXPIRES = '2026-10-12T00:00:00.000Z';

interface NativeStub {
  invoke: InvokeFn;
  calls: Array<{ command: string; args?: Record<string, unknown> }>;
  /** 让 `cloud_login_begin` 保持挂起——用于覆盖「begin 在途」窗口的竞态。 */
  holdBegin: () => void;
  releaseBegin: () => void;
  /** 让 `cloud_login_await` 保持挂起——用于断言 authenticating 期间的行为。 */
  holdAwait: () => void;
  releaseAwait: (outcome: unknown) => void;
  /** 让 `cloud_auth_status` 保持挂起——用于断言「cached 身份先于验证结论可见」。 */
  holdStatus: () => void;
  releaseStatus: () => void;
}

/**
 * 按 command 分发的 invoke 桩。桥对返回值做契约校验，因此桩必须给出合法负载——
 * 这与 `cloud-bridge.test.ts` 的形状一致，只是按 command 查表。
 */
const BEGIN_RESULT = {
  flowId: 'flow-1',
  authorizeUrl: 'https://example.test/auth/desktop?state=s',
};

const createNativeStub = (
  session: unknown = { state: 'signed-out' },
  cached: unknown = null,
): NativeStub => {
  const calls: NativeStub['calls'] = [];
  let awaitResolve: ((value: unknown) => void) | null = null;
  let awaitHeld = false;
  let beginResolve: (() => void) | null = null;
  let beginHeld = false;
  let statusResolve: (() => void) | null = null;
  let statusHeld = false;

  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    switch (command) {
      case CLOUD_CACHED_ACCOUNT_COMMAND:
        return cached;
      case CLOUD_AUTH_STATUS_COMMAND:
        if (statusHeld) {
          return new Promise((resolve) => {
            statusResolve = () => resolve(session);
          });
        }
        return session;
      case CLOUD_LOGIN_BEGIN_COMMAND:
        if (beginHeld) {
          return new Promise((resolve) => {
            beginResolve = () => resolve(BEGIN_RESULT);
          });
        }
        return BEGIN_RESULT;
      case CLOUD_LOGIN_AWAIT_COMMAND:
        if (awaitHeld) {
          return new Promise((resolve) => {
            awaitResolve = resolve;
          });
        }
        return { status: 'signed-in', account: ACCOUNT, sessionExpiresAt: EXPIRES };
      case CLOUD_SIGN_OUT_COMMAND:
        return { revoked: true };
      case CLOUD_ME_PROFILE_COMMAND:
        return {
          userId: 7,
          signature: '圆焰',
          avatarDataUrl: 'data:image/webp;base64,QUJD',
        };
      default:
        throw new Error(`unexpected command ${command}`);
    }
  }) as InvokeFn;

  return {
    invoke,
    calls,
    holdBegin: () => {
      beginHeld = true;
    },
    releaseBegin: () => {
      beginResolve?.();
    },
    holdAwait: () => {
      awaitHeld = true;
    },
    releaseAwait: (outcome: unknown) => {
      awaitResolve?.(outcome);
    },
    holdStatus: () => {
      statusHeld = true;
    },
    releaseStatus: () => {
      statusResolve?.();
    },
  };
};

const commands = (stub: NativeStub): string[] => stub.calls.map((call) => call.command);

describe('DesktopCloudSessionStore', () => {
  // 头像缓存是进程级模块状态：本文件里 populate/invalidate 的用例相互隔离。
  beforeEach(() => {
    resetTopbarAvatarForTests();
  });

  it('construction and subscription fire zero IPC — bootstrap is what starts the reads', () => {
    // r2 口径后「冷启动零 IPC」收缩为「渲染前零 IPC」：store 构造与订阅本身仍不
    // 发请求，由首个挂载消费者的 `bootstrap()` 触发 cached-first 装载。
    const native = createNativeStub();
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const snapshot = store.getSnapshot();
    expect(snapshot.account).toBeNull();
    expect(snapshot.bootstrapped).toBe(false);
    expect(snapshot.verification).toBe('idle');
    expect(native.calls).toEqual([]);
    expect(projectTopBarAccount(snapshot)).toEqual({ kind: 'unknown' });
    unsubscribe();
  });

  it('bootstrap with no cached account settles signed-out without touching the network', () => {
    // 本机凭据存储为空：没有 cookie 可供服务端确认，`cloud_auth_status` 也只可能
    // 是 signed-out——省掉一次注定无果的网络往返（DESK-ONLINE-008 r2 的「有界」）。
    const native = createNativeStub({ state: 'active', account: ACCOUNT }, null);
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    return store.bootstrap().then(() => {
      const snapshot = store.getSnapshot();
      expect(snapshot.bootstrapped).toBe(true);
      expect(snapshot.account).toBeNull();
      expect(snapshot.verification).toBe('signed-out');
      expect(commands(native)).toEqual([CLOUD_CACHED_ACCOUNT_COMMAND]);
      expect(projectTopBarAccount(snapshot)).toEqual({ kind: 'signed-out' });
    });
  });

  it('bootstrap projects the cached identity before background verification completes', async () => {
    // cached-first 的关键不变量：本机凭据一到就显示用户名，不等服务端——
    // 「账号 → 用户 → 用户名」三段式由此消失。
    const native = createNativeStub(
      { state: 'active', account: ACCOUNT, sessionExpiresAt: EXPIRES },
      { account: ACCOUNT, sessionExpiresAt: EXPIRES },
    );
    native.holdStatus();
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    const pending = store.bootstrap();
    // auth_status 仍挂起：身份已经投影，verification 如实表达「在途」。
    await vi.waitFor(() => {
      expect(store.getSnapshot().account?.username).toBe('homura');
    });
    const during = store.getSnapshot();
    expect(during.verification).toBe('checking');
    expect(projectTopBarAccount(during)).toMatchObject({
      kind: 'signed-in',
      username: 'homura',
    });

    native.releaseStatus();
    await pending;
    expect(store.getSnapshot().verification).toBe('verified');
    expect(commands(native)).toEqual([
      CLOUD_CACHED_ACCOUNT_COMMAND,
      CLOUD_AUTH_STATUS_COMMAND,
    ]);
  });

  it('bootstrap keeps the cached identity when verification is unreachable', async () => {
    // DESK-ONLINE-012：unreachable 时凭据仍在——身份保留，只更新验证结论；
    // 顶栏渲染 signed-in + 离线徽标，而不是把已保存身份说成已注销。
    const native = createNativeStub(
      { state: 'unreachable' },
      { account: ACCOUNT, sessionExpiresAt: EXPIRES },
    );
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    await store.bootstrap();

    const snapshot = store.getSnapshot();
    expect(snapshot.account?.username).toBe('homura');
    expect(snapshot.verification).toBe('unreachable');
    const projection = projectTopBarAccount(snapshot);
    expect(projection.kind).toBe('signed-in');
    if (projection.kind === 'signed-in') {
      expect(projection.username).toBe('homura');
      // unreachable + 身份 → 「离线」徽标注入 title 插槽。
      expect(projection.title).toBeTruthy();
    }
  });

  it('bootstrap clears the identity only when the server confirms expired', async () => {
    const native = createNativeStub(
      { state: 'expired' },
      { account: ACCOUNT, sessionExpiresAt: EXPIRES },
    );
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    await store.bootstrap();

    const snapshot = store.getSnapshot();
    expect(snapshot.account).toBeNull();
    expect(snapshot.verification).toBe('expired');
    expect(projectTopBarAccount(snapshot)).toEqual({ kind: 'expired' });
  });

  it('bootstrap treats a credential-store read failure as unreachable, not signed-out', async () => {
    // 凭据读取失败 ≠ 已登出：凭据可能存在但读不出，如实按不可达处理。
    const deps: DesktopCloudSessionDeps = {
      invoke: (async () => {
        throw new Error('keyring locked');
      }) as InvokeFn,
    };
    const store = new DesktopCloudSessionStore(deps);

    await store.bootstrap();

    const snapshot = store.getSnapshot();
    expect(snapshot.bootstrapped).toBe(true);
    expect(snapshot.account).toBeNull();
    expect(snapshot.verification).toBe('unreachable');
    expect(snapshot.lastError).toContain('账号信息读取失败');
    expect(projectTopBarAccount(snapshot)).toEqual({ kind: 'unreachable' });
  });

  it('bootstrap is single-flight — repeated calls share one load cycle', async () => {
    const native = createNativeStub(
      { state: 'active', account: ACCOUNT, sessionExpiresAt: EXPIRES },
      { account: ACCOUNT, sessionExpiresAt: EXPIRES },
    );
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    await Promise.all([store.bootstrap(), store.bootstrap()]);

    expect(commands(native)).toEqual([
      CLOUD_CACHED_ACCOUNT_COMMAND,
      CLOUD_AUTH_STATUS_COMMAND,
    ]);
  });

  it('refresh publishes checking and returns the native session projection', async () => {
    const native = createNativeStub({
      state: 'active',
      account: ACCOUNT,
      sessionExpiresAt: EXPIRES,
    });
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    const pending = store.refresh();
    expect(store.getSnapshot().verification).toBe('checking');

    const session = await pending;
    expect(session).toMatchObject({ state: 'active', account: ACCOUNT });
    const snapshot = store.getSnapshot();
    expect(snapshot.account).toEqual(ACCOUNT);
    expect(snapshot.sessionExpiresAt).toBe(EXPIRES);
    expect(snapshot.verification).toBe('verified');
    expect(commands(native)).toEqual([CLOUD_AUTH_STATUS_COMMAND]);
  });

  it('coalesces concurrent refreshes into a single status read', async () => {
    const native = createNativeStub();
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    const [first, second] = await Promise.all([store.refresh(), store.refresh()]);
    expect(first).toEqual(second);
    expect(native.calls.filter((call) => call.command === CLOUD_AUTH_STATUS_COMMAND)).toHaveLength(1);
  });

  it('maps a status-read failure to unreachable rather than signed-out', async () => {
    // 契约层明确「unreachable ≠ 已注销」：本地凭据仍在，投影必须保留这个区分
    // （DESK-ONLINE-012 的同一个判据，renderer 侧再守一次）。
    const native = createNativeStub();
    native.invoke = (async () => {
      throw new Error('network down');
    }) as InvokeFn;
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    const session = await store.refresh();
    expect(session).toEqual({ state: 'unreachable' });
    const snapshot = store.getSnapshot();
    expect(snapshot.account).toBeNull();
    expect(snapshot.verification).toBe('unreachable');
    expect(snapshot.lastError).toContain('会话状态读取失败');
    expect(projectTopBarAccount(snapshot)).toEqual({ kind: 'unreachable' });
  });

  it('requestAuth verifies identity first, then begins the native login flow', async () => {
    const native = createNativeStub({ state: 'signed-out' });
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    await store.requestAuth();

    expect(commands(native)).toEqual([
      CLOUD_AUTH_STATUS_COMMAND,
      CLOUD_LOGIN_BEGIN_COMMAND,
      CLOUD_LOGIN_AWAIT_COMMAND,
    ]);
    expect(native.calls[2]?.args).toEqual({ flowId: 'flow-1' });

    const snapshot = store.getSnapshot();
    expect(snapshot.account).toEqual(ACCOUNT);
    expect(snapshot.verification).toBe('verified');
    expect(projectTopBarAccount(snapshot)).toMatchObject({
      kind: 'signed-in',
      username: 'homura',
    });
  });

  it('requestAuth on an active session does not begin a login flow', async () => {
    const native = createNativeStub({
      state: 'active',
      account: ACCOUNT,
      sessionExpiresAt: EXPIRES,
    });
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    await store.requestAuth();

    expect(commands(native)).toEqual([CLOUD_AUTH_STATUS_COMMAND]);
  });

  it('requestAuth on unreachable stops there — retry is the next click, not an automatic loop', async () => {
    const native = createNativeStub({ state: 'unreachable' });
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    await store.requestAuth();

    expect(commands(native)).toEqual([CLOUD_AUTH_STATUS_COMMAND]);
    expect(projectTopBarAccount(store.getSnapshot())).toEqual({ kind: 'unreachable' });
  });

  it('publishes authenticating while the native flow is held and restores the prior identity on cancel', async () => {
    const native = createNativeStub({ state: 'expired' });
    native.holdAwait();
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });
    await store.refresh();

    const pending = store.requestAuth();
    // `begin` 是异步的：authenticating 投影要等 begin 的 microtask 结算后才可见——
    // 等待它本身就在断言「在途状态对订阅者可见」。
    await vi.waitFor(() => {
      expect(store.getSnapshot().authFlow).toEqual({
        kind: 'authenticating',
        flowId: 'flow-1',
        authorizeUrl: 'https://example.test/auth/desktop?state=s',
      });
    });
    expect(projectTopBarAccount(store.getSnapshot())).toEqual({ kind: 'authenticating' });

    native.releaseAwait({ status: 'cancelled' });
    const outcome = await pending;
    expect(outcome).toEqual({ status: 'cancelled' });
    // 取消不创建也不消费凭据：恢复进入授权前的 expired，而不是一律标成 signed-out。
    const snapshot = store.getSnapshot();
    expect(snapshot.account).toBeNull();
    expect(snapshot.verification).toBe('expired');
    expect(snapshot.authFlow).toEqual({ kind: 'idle' });
  });

  it('publishes the readable failure when the native outcome is failed', async () => {
    const native = createNativeStub();
    native.holdAwait();
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    const pending = store.requestAuth();
    // 同样要等 authenticating 到位——await 命令此时才真正发出，releaseAwait 才能生效。
    await vi.waitFor(() => {
      expect(store.getSnapshot().authFlow.kind).toBe('authenticating');
    });
    native.releaseAwait({ status: 'failed', code: 'state-mismatch', message: '回跳不匹配' });
    await pending;

    const snapshot = store.getSnapshot();
    expect(snapshot.verification).toBe('signed-out');
    expect(snapshot.authFlow).toEqual({ kind: 'idle' });
    expect(snapshot.lastError).toBe('登录未完成（state-mismatch）：回跳不匹配');
  });

  it('coalesces concurrent auth requests into a single native login flow', async () => {
    // 顶栏与设置页可能同时请求认证（双击/两 surface 并发）：`begin` 在途窗口内
    // 第二次调用必须搭上同一条 loginPromise——native 对每次 `cloud_login_begin`
    // 都新建 listener/PKCE/flowId，没有「全局只允许一条 flow」的限制，所以这个
    // single-flight 必须由 renderer 提供（D5.0d-r1）。
    const native = createNativeStub({ state: 'signed-out' });
    native.holdAwait();
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    const first = store.requestAuth();
    const second = store.requestAuth();
    await vi.waitFor(() => {
      expect(store.getSnapshot().authFlow.kind).toBe('authenticating');
    });
    native.releaseAwait({ status: 'cancelled' });
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(firstOutcome).toEqual({ status: 'cancelled' });
    expect(secondOutcome).toEqual(firstOutcome);
    expect(
      native.calls.filter((call) => call.command === CLOUD_LOGIN_BEGIN_COMMAND),
    ).toHaveLength(1);
    expect(
      native.calls.filter((call) => call.command === CLOUD_LOGIN_AWAIT_COMMAND),
    ).toHaveLength(1);
  });

  it('gates refresh and requestAuth while cloud_login_begin is still in flight', async () => {
    // D5.0d-r2：`begin` 未返回时 authFlow 仍是 idle——此时 AccountPanel mount 的
    // refresh() 若再发 `cloud_auth_status`，迟到的 signed-out 会在 authenticating
    // 投影建立后把它覆盖回去，renderer 在 native 仍在授权时「忘记」自己正在登录。
    // `loginPromise` 必须同时门禁 refresh 与 requestAuth。
    const native = createNativeStub({ state: 'signed-out' });
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });
    await store.refresh();
    native.holdBegin();
    native.holdAwait();

    const first = store.requestAuth();
    await vi.waitFor(() => {
      expect(commands(native)).toContain(CLOUD_LOGIN_BEGIN_COMMAND);
    });
    // requestAuth 的身份验证 + 初始 refresh 各产生一条 status read；从这里起
    // 进入「begin 在途、authFlow 尚未 authenticating」的窗口。
    const callsBeforeWindow = native.calls.length;

    // 窗口内：第二个入口的 requestAuth 与面板 mount 的 refresh 都必须搭上同一条
    // 授权流程，一条新 IPC 都不能产生。
    const second = store.requestAuth();
    await expect(store.refresh()).resolves.toEqual({ state: 'signed-out' });
    expect(native.calls).toHaveLength(callsBeforeWindow);

    native.releaseBegin();
    await vi.waitFor(() => {
      expect(store.getSnapshot().authFlow.kind).toBe('authenticating');
    });

    native.releaseAwait({ status: 'cancelled' });
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
    expect(firstOutcome).toEqual({ status: 'cancelled' });
    expect(secondOutcome).toEqual(firstOutcome);
    // 窗口内没有产生新 IPC：整串交互只有 begin 前的两条 status read 与一条
    // login flow；授权取消后落回进入授权前的会话，而不是被窗口内迟到的查询
    // 覆盖成的状态。
    expect(commands(native)).toEqual([
      CLOUD_AUTH_STATUS_COMMAND,
      CLOUD_AUTH_STATUS_COMMAND,
      CLOUD_LOGIN_BEGIN_COMMAND,
      CLOUD_LOGIN_AWAIT_COMMAND,
    ]);
    const snapshot = store.getSnapshot();
    expect(snapshot.verification).toBe('signed-out');
    expect(snapshot.authFlow).toEqual({ kind: 'idle' });
  });

  it('clears a prior session error when a later refresh succeeds', async () => {
    // 失败后再成功：UI 不该同时显示「已登录/服务正常」和上一次的
    // 「会话状态读取失败」（D5.0d-r1）。deps 对象由 store 持有引用，
    // 运行中替换 `deps.invoke` 即模拟网络恢复。
    const deps: DesktopCloudSessionDeps = {
      invoke: (async () => {
        throw new Error('network down');
      }) as InvokeFn,
    };
    const store = new DesktopCloudSessionStore(deps);
    await store.refresh();
    expect(store.getSnapshot().lastError).toContain('会话状态读取失败');

    const recovered = createNativeStub({
      state: 'active',
      account: ACCOUNT,
      sessionExpiresAt: EXPIRES,
    });
    deps.invoke = recovered.invoke;
    const session = await store.refresh();
    expect(session.state).toBe('active');
    expect(store.getSnapshot().lastError).toBeNull();
  });

  it('signOut clears identity to signed-out and reports the revoked flag verbatim', async () => {
    const native = createNativeStub(
      { state: 'active', account: ACCOUNT, sessionExpiresAt: EXPIRES },
      { account: ACCOUNT, sessionExpiresAt: EXPIRES },
    );
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });
    await store.bootstrap();

    const result = await store.signOut();
    expect(result).toEqual({ revoked: true });
    const snapshot = store.getSnapshot();
    expect(snapshot.account).toBeNull();
    expect(snapshot.verification).toBe('signed-out');
    expect(native.calls.at(-1)?.command).toBe(CLOUD_SIGN_OUT_COMMAND);
  });

  it('signOut invalidates the signed-out account avatar — a later mount refetches', async () => {
    // 登出即会话边界：Web 侧换过头像后重登必须重新拉取，不能把同进程
    // 旧缓存留到下一次登录（D5.1d-1 r1）。
    const native = createNativeStub(
      { state: 'active', account: ACCOUNT, sessionExpiresAt: EXPIRES },
      { account: ACCOUNT, sessionExpiresAt: EXPIRES },
    );
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });
    await store.bootstrap();

    ensureTopbarAvatar(7, native.invoke);
    await vi.waitFor(() => {
      expect(getTopbarAvatar(7)).toBe('data:image/webp;base64,QUJD');
    });

    await store.signOut();
    expect(getTopbarAvatar(7)).toBeNull();

    // 失效后下一次挂载重新走 `cloud_me_profile`。
    ensureTopbarAvatar(7, native.invoke);
    await vi.waitFor(() => {
      expect(
        native.calls.filter((call) => call.command === CLOUD_ME_PROFILE_COMMAND),
      ).toHaveLength(2);
    });
  });

  it('a fresh signed-in login invalidates the avatar so the topbar revalidates once', async () => {
    // 新登录成功同样是一次会话边界：即使同一 userId，也让缓存失效一次——
    // 顶栏由下一次挂载重新校验，而不是复用授权前的旧头像。
    const native = createNativeStub({ state: 'signed-out' });
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });
    await store.bootstrap();

    // 模拟授权前已存在的缓存槽（上一轮会话留下的）。
    ensureTopbarAvatar(7, native.invoke);
    await vi.waitFor(() => {
      expect(getTopbarAvatar(7)).toBe('data:image/webp;base64,QUJD');
    });

    await store.requestAuth();
    expect(getTopbarAvatar(7)).toBeNull();

    // 失效后下一次挂载重新走 `cloud_me_profile`。
    ensureTopbarAvatar(7, native.invoke);
    await vi.waitFor(() => {
      expect(
        native.calls.filter((call) => call.command === CLOUD_ME_PROFILE_COMMAND),
      ).toHaveLength(2);
    });
  });

  it('never puts credentials in the store state — only the public session projection', async () => {
    // 状态面板上能看到的永远只是契约投影：account 摘要 + 过期时刻。grant code、
    // PKCE verifier、cookie 一律走 native，renderer 快照里没有它们的字段位。
    const native = createNativeStub();
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });
    await store.requestAuth();

    const serialized = JSON.stringify(store.getSnapshot());
    for (const marker of ['verifier', 'grant', 'cookie', 'token']) {
      expect(serialized.toLowerCase()).not.toContain(marker);
    }
  });
});
