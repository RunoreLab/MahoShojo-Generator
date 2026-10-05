import { describe, expect, it, vi } from 'vitest';

import {
  CLOUD_LOGIN_AWAIT_COMMAND,
  CLOUD_LOGIN_BEGIN_COMMAND,
  CLOUD_SIGN_OUT_COMMAND,
  CLOUD_AUTH_STATUS_COMMAND,
  type InvokeFn,
} from '../src/platform/cloud-bridge';
import { DesktopCloudSessionStore } from '../src/features/account/cloud-session-store';
import { projectTopBarAccount } from '../src/features/account/topbar-projection';

const ACCOUNT = { userId: 7, username: 'homura', displayName: 'homura' };
const EXPIRES = '2026-10-12T00:00:00.000Z';

interface NativeStub {
  invoke: InvokeFn;
  calls: Array<{ command: string; args?: Record<string, unknown> }>;
  /** 让 `cloud_login_await` 保持挂起——用于断言 authenticating 期间的行为。 */
  holdAwait: () => void;
  releaseAwait: (outcome: unknown) => void;
}

/**
 * 按 command 分发的 invoke 桩。桥对返回值做契约校验，因此桩必须给出合法负载——
 * 这与 `cloud-bridge.test.ts` 的形状一致，只是按 command 查表。
 */
const createNativeStub = (session: unknown = { state: 'signed-out' }): NativeStub => {
  const calls: NativeStub['calls'] = [];
  let awaitResolve: ((value: unknown) => void) | null = null;
  let awaitHeld = false;

  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    switch (command) {
      case CLOUD_AUTH_STATUS_COMMAND:
        return session;
      case CLOUD_LOGIN_BEGIN_COMMAND:
        return { flowId: 'flow-1', authorizeUrl: 'https://example.test/auth/desktop?state=s' };
      case CLOUD_LOGIN_AWAIT_COMMAND:
        if (awaitHeld) {
          return new Promise((resolve) => {
            awaitResolve = resolve;
          });
        }
        return { status: 'signed-in', account: ACCOUNT, sessionExpiresAt: EXPIRES };
      case CLOUD_SIGN_OUT_COMMAND:
        return { revoked: true };
      default:
        throw new Error(`unexpected command ${command}`);
    }
  }) as InvokeFn;

  return {
    invoke,
    calls,
    holdAwait: () => {
      awaitHeld = true;
    },
    releaseAwait: (outcome: unknown) => {
      awaitResolve?.(outcome);
    },
  };
};

describe('DesktopCloudSessionStore', () => {
  it('starts idle and fires zero IPC before any explicit user action', () => {
    // DESK-PROD-004 / DESK-ONLINE-012：冷启动顶栏读取的是 idle 投影，store 构造与订阅
    // 都不发请求——「顶栏渲染了」与「已经查过会话」是两件事。
    const native = createNativeStub();
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot().phase).toEqual({ kind: 'idle' });
    expect(native.calls).toEqual([]);
    expect(projectTopBarAccount(store.getSnapshot().phase)).toEqual({ kind: 'unknown' });
    unsubscribe();
  });

  it('refresh publishes checking → ready and returns the native session projection', async () => {
    const native = createNativeStub({
      state: 'active',
      account: ACCOUNT,
      sessionExpiresAt: EXPIRES,
    });
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    const pending = store.refresh();
    expect(store.getSnapshot().phase).toEqual({ kind: 'checking' });

    const session = await pending;
    expect(session).toMatchObject({ state: 'active', account: ACCOUNT });
    expect(store.getSnapshot().phase).toEqual({ kind: 'ready', session });
    expect(native.calls.map((call) => call.command)).toEqual([CLOUD_AUTH_STATUS_COMMAND]);
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
    expect(store.getSnapshot().phase).toEqual({
      kind: 'ready',
      session: { state: 'unreachable' },
    });
    expect(store.getSnapshot().lastError).toContain('会话状态读取失败');
    expect(projectTopBarAccount(store.getSnapshot().phase)).toEqual({ kind: 'unreachable' });
  });

  it('requestAuth verifies identity first, then begins the native login flow', async () => {
    const native = createNativeStub({ state: 'signed-out' });
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    await store.requestAuth();

    expect(native.calls.map((call) => call.command)).toEqual([
      CLOUD_AUTH_STATUS_COMMAND,
      CLOUD_LOGIN_BEGIN_COMMAND,
      CLOUD_LOGIN_AWAIT_COMMAND,
    ]);
    expect(native.calls[2]?.args).toEqual({ flowId: 'flow-1' });

    const phase = store.getSnapshot().phase;
    expect(phase.kind).toBe('ready');
    if (phase.kind === 'ready') {
      expect(phase.session).toMatchObject({ state: 'active', account: ACCOUNT });
    }
    expect(projectTopBarAccount(store.getSnapshot().phase)).toMatchObject({
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

    expect(native.calls.map((call) => call.command)).toEqual([CLOUD_AUTH_STATUS_COMMAND]);
  });

  it('requestAuth on unreachable stops there — retry is the next click, not an automatic loop', async () => {
    const native = createNativeStub({ state: 'unreachable' });
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    await store.requestAuth();

    expect(native.calls.map((call) => call.command)).toEqual([CLOUD_AUTH_STATUS_COMMAND]);
    expect(projectTopBarAccount(store.getSnapshot().phase)).toEqual({ kind: 'unreachable' });
  });

  it('publishes authenticating while the native flow is held and restores the prior session on cancel', async () => {
    const native = createNativeStub({ state: 'expired' });
    native.holdAwait();
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });
    await store.refresh();

    const pending = store.startLogin();
    // `begin` 是异步的：authenticating 投影要等 begin 的 microtask 结算后才可见——
    // 等待它本身就在断言「在途状态对订阅者可见」。
    await vi.waitFor(() => {
      expect(store.getSnapshot().phase).toEqual({
        kind: 'authenticating',
        flowId: 'flow-1',
        authorizeUrl: 'https://example.test/auth/desktop?state=s',
      });
    });
    const phase = store.getSnapshot().phase;
    expect(projectTopBarAccount(phase)).toEqual({ kind: 'authenticating' });

    native.releaseAwait({ status: 'cancelled' });
    const outcome = await pending;
    expect(outcome).toEqual({ status: 'cancelled' });
    // 取消不创建也不消费凭据：恢复进入授权前的 expired，而不是一律标成 signed-out。
    expect(store.getSnapshot().phase).toEqual({
      kind: 'ready',
      session: { state: 'expired' },
    });
  });

  it('publishes the readable failure when the native outcome is failed', async () => {
    const native = createNativeStub();
    native.holdAwait();
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });

    const pending = store.startLogin();
    // 同样要等 authenticating 到位——await 命令此时才真正发出，releaseAwait 才能生效。
    await vi.waitFor(() => {
      expect(store.getSnapshot().phase.kind).toBe('authenticating');
    });
    native.releaseAwait({ status: 'failed', code: 'state-mismatch', message: '回跳不匹配' });
    await pending;

    expect(store.getSnapshot().phase).toEqual({
      kind: 'ready',
      session: { state: 'signed-out' },
    });
    expect(store.getSnapshot().lastError).toBe('登录未完成（state-mismatch）：回跳不匹配');
  });

  it('signOut clears to signed-out and reports the revoked flag verbatim', async () => {
    const native = createNativeStub({
      state: 'active',
      account: ACCOUNT,
      sessionExpiresAt: EXPIRES,
    });
    const store = new DesktopCloudSessionStore({ invoke: native.invoke });
    await store.refresh();

    const result = await store.signOut();
    expect(result).toEqual({ revoked: true });
    expect(store.getSnapshot().phase).toEqual({
      kind: 'ready',
      session: { state: 'signed-out' },
    });
    expect(native.calls.at(-1)?.command).toBe(CLOUD_SIGN_OUT_COMMAND);
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
