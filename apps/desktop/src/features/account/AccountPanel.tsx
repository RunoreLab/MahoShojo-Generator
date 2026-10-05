// 账号面板（D5.0c）：native `desktop-auth-v1` 登录/状态/登出 + 按需在线探测。
//
// 凭据边界：UI 只看到「登录中 / 已登录（账号摘要）/ 未登录 / 服务不可达」，会话
// cookie、授权码、PKCE verifier 都不会出现在 IPC 投影里，这里也无法获取。

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import type { DesktopCloudSessionStatus } from '@mahoshojo/contracts/desktop-cloud';

import {
  DesktopCloudError,
  awaitCloudLogin,
  beginCloudLogin,
  cancelCloudLogin,
  probeCloudOnlineStatus,
  readCloudAuthStatus,
  signOutCloud,
} from '../../platform/cloud-bridge';

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; session: DesktopCloudSessionStatus };

interface LoginAttempt {
  flowId: string;
  authorizeUrl: string;
}

const describeError = (cause: unknown): string =>
  cause instanceof DesktopCloudError
    ? `${cause.code}：${cause.message}`
    : cause instanceof Error
      ? cause.message
      : '未知错误';

export const AccountPanel = () => {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [attempt, setAttempt] = useState<LoginAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const flowRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const session = await readCloudAuthStatus(invoke);
      setStatus({ kind: 'ready', session });
    } catch (cause) {
      setError(`会话状态读取失败：${describeError(cause)}`);
      setStatus({ kind: 'ready', session: { state: 'unreachable' } });
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      // 卸载时若还有进行中的流程，取消它——listener 与 await 都由 native 收尾。
      const flowId = flowRef.current;
      if (flowId) void cancelCloudLogin(invoke, flowId);
    };
  }, [refresh]);

  const startLogin = useCallback(async () => {
    setError(null);
    setCopied(false);
    setBusy(true);
    try {
      const begin = await beginCloudLogin(invoke);
      flowRef.current = begin.flowId;
      setAttempt({ flowId: begin.flowId, authorizeUrl: begin.authorizeUrl });
      const outcome = await awaitCloudLogin(invoke, begin.flowId);
      setAttempt(null);
      flowRef.current = null;
      if (outcome.status === 'failed') {
        setError(`登录未完成（${outcome.code}）：${outcome.message}`);
      }
      await refresh();
    } catch (cause) {
      setAttempt(null);
      flowRef.current = null;
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const cancelLogin = useCallback(async () => {
    if (!attempt) return;
    try {
      await cancelCloudLogin(invoke, attempt.flowId);
    } finally {
      setAttempt(null);
      flowRef.current = null;
      setBusy(false);
    }
  }, [attempt]);

  const signOut = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await signOutCloud(invoke);
      if (!result.revoked) {
        setError('本地会话已删除；服务端会话未能同步作废（离线或服务不可用时会话仍会自行过期）。');
      }
      await refresh();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const probe = useCallback(async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const online = await probeCloudOnlineStatus(invoke);
      if (!online.reachable) {
        setError('项目服务暂不可达。本地功能不受影响。');
      } else if (online.compatible === true) {
        setNotice(`项目服务在线（契约 ${online.contractVersion ?? '未声明'}，兼容）。`);
      } else if (online.compatible === false) {
        setError(
          `在线契约版本不兼容（服务端 ${online.contractVersion ?? '未知'}）。`
          + '本次在线操作已被阻止，请升级桌面客户端后再试。',
        );
      } else {
        // 可达但未声明契约版本：fail-closed，不得按「兼容」提示。
        setError('项目服务在线但未声明契约版本，无法确认兼容性；为安全起见在线操作已被阻止。');
      }
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const session = status.kind === 'ready' ? status.session : null;

  return (
    <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
      <h2 className="mb-2 text-sm font-medium text-(--app-text-muted)">账号与项目服务</h2>

      {status.kind === 'loading' && <p className="text-sm">正在读取会话状态…</p>}

      {session?.state === 'active' && (
        <div className="text-sm">
          <p>
            已登录：
            <span className="font-medium">{session.account.displayName ?? session.account.username}</span>
            <span className="text-(--app-text-muted)">（{session.account.username}）</span>
          </p>
          {session.sessionExpiresAt && (
            <p className="mt-1 text-(--app-text-muted)">
              会话有效期至 {new Date(session.sessionExpiresAt).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {session?.state === 'signed-out' && (
        <p className="text-sm text-(--app-text-muted)">未登录。登录通过系统浏览器完成，凭据只保存在本机凭据存储。</p>
      )}
      {session?.state === 'expired' && (
        <p className="text-sm text-(--app-text-muted)">会话已过期，请重新登录。</p>
      )}
      {session?.state === 'unreachable' && (
        <p className="text-sm text-(--app-text-muted)">
          项目服务暂不可达。已保存的登录凭据仍然保留；本地功能不受影响。
        </p>
      )}

      {attempt && (
        <div className="mt-3 rounded border border-(--app-border) p-3 text-sm">
          <p>等待系统浏览器中的授权完成…</p>
          <p className="mt-1 text-(--app-text-muted)">
            若浏览器未自动打开，请手动复制授权地址：
          </p>
          <p className="mt-1 break-all text-xs text-(--app-text-muted)">{attempt.authorizeUrl}</p>
          <button
            type="button"
            className="mt-2 text-xs underline"
            onClick={() => {
              void navigator.clipboard?.writeText(attempt.authorizeUrl).then(() => setCopied(true));
            }}
          >
            {copied ? '已复制' : '复制授权地址'}
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-(--app-accent-strong)">{error}</p>}
      {notice && <p className="mt-3 text-sm text-(--app-text-muted)">{notice}</p>}

      <div className="mt-3 flex gap-2 text-sm">
        {session?.state !== 'active' && !attempt && (
          <button type="button" disabled={busy} onClick={() => void startLogin()}>
            {busy ? '处理中…' : '登录账号'}
          </button>
        )}
        {attempt && (
          <button type="button" onClick={() => void cancelLogin()}>取消登录</button>
        )}
        {session?.state === 'active' && (
          <button type="button" disabled={busy} onClick={() => void signOut()}>
            退出登录
          </button>
        )}
        {!attempt && (
          <button type="button" disabled={busy} onClick={() => void probe()}>
            检查服务连通性
          </button>
        )}
      </div>
    </section>
  );
};
