// 设置页：云账号面板（`DESK-ONLINE-008`）。
//
// 会话状态来自 `DesktopCloudSessionStore` 进程级单例——顶栏账号区与本面板读的是
// 同一份投影、同一个授权流程（`use-desktop-cloud-session.ts`）。面板只保留自己
// 私有的交互状态：在线探针 busy 结果、授权 URL 的「已复制」提示与退出后的
// revoked 说明。
//
// `refresh()` 在进入设置页时主动触发一次：这不是后台轮询，而是「用户打开了
// 账号面板」这一动作的结果——DESK-ONLINE-012 禁止的是无用户动作的在线探测。

import { useEffect, useState } from 'react';

import type { DesktopCloudOnlineStatus } from '@mahoshojo/contracts/desktop-cloud';

import { invoke } from '@tauri-apps/api/core';
import { DesktopCloudError, probeCloudOnlineStatus } from '../../platform/cloud-bridge';
import { useDesktopCloudSession } from './use-desktop-cloud-session';

const describeProbeError = (cause: unknown): string =>
  cause instanceof DesktopCloudError ? `${cause.code}：${cause.message}` : 'unknown bridge failure';

const StatusChip = ({ label, className }: { label: string; className: string }) => (
  <span className={`rounded-full border px-2 py-0.5 text-xs ${className}`}>{label}</span>
);

export const AccountPanel = () => {
  const { state: sessionState, store: sessionStore } = useDesktopCloudSession();
  const phase = sessionState.phase;
  const session = phase.kind === 'ready' ? phase.session : null;
  const checking = phase.kind === 'checking';
  const attempt = phase.kind === 'authenticating' ? phase : null;
  const busy = checking || attempt !== null;

  // 面板私有状态：退出结果说明、在线探针、授权 URL 复制提示。
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probe, setProbe] = useState<DesktopCloudOnlineStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void sessionStore.refresh();
    // 离开设置页时取消在途授权：flowId 只在 native 进程里有效，用户离开面板
    // 意味着放弃了这次「手动复制 URL」的机会——继续挂着只会留一条孤儿流程。
    return () => {
      const latest = sessionStore.getSnapshot();
      if (latest.phase.kind === 'authenticating') void sessionStore.cancelLogin();
    };
  }, [sessionStore]);

  const login = async () => {
    setError(null);
    setNotice(null);
    setCopied(false);
    await sessionStore.startLogin();
  };

  const signOut = async () => {
    setError(null);
    setNotice(null);
    const result = await sessionStore.signOut();
    if (result !== null) {
      setNotice(
        result.revoked
          ? '已退出登录，服务端会话已同步作废。'
          : '已退出登录：本地凭据已删除，但服务端会话未能确认作废（可能已过期）。',
      );
      setProbe(null);
    }
  };

  const runProbe = async () => {
    setProbeBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await probeCloudOnlineStatus(invoke);
      setProbe(result);
    } catch (cause) {
      setProbe(null);
      setError(`在线探针失败：${describeProbeError(cause)}`);
    } finally {
      setProbeBusy(false);
    }
  };

  const copyAuthorizeUrl = async () => {
    if (!attempt) return;
    try {
      await navigator.clipboard.writeText(attempt.authorizeUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      setError('复制授权地址失败，请手动选中地址复制。');
    }
  };

  const panelError = error ?? sessionState.lastError;

  return (
    <section
      data-testid="account-panel"
      className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4"
    >
      <h2 className="mb-2 text-sm font-medium text-(--app-text-muted)">云账号</h2>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>会话状态：</span>
        {checking && <span>正在读取…</span>}
        {!checking && (!session || session.state === 'signed-out') && (
          <StatusChip
            label="未登录"
            className="border-(--app-border) text-(--app-text-muted)"
          />
        )}
        {!checking && session?.state === 'active' && (
          <StatusChip
            label={`已登录 · ${session.account.displayName ?? session.account.username}`}
            className="border-(--app-accent) text-(--app-accent-strong)"
          />
        )}
        {!checking && session?.state === 'expired' && (
          <StatusChip
            label="会话已过期"
            className="border-(--app-accent) text-(--app-accent-strong)"
          />
        )}
        {!checking && session?.state === 'unreachable' && (
          <StatusChip
            label="服务不可用（本地凭据保留）"
            className="border-(--app-border) text-(--app-text-muted)"
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {!busy && session?.state !== 'active' && (
          <button
            type="button"
            className="rounded-md border border-(--app-border) px-3 py-1.5 hover:bg-(--app-surface-muted)"
            onClick={() => void login()}
          >
            登录账号
          </button>
        )}
        {attempt && (
          <button
            type="button"
            className="rounded-md border border-(--app-border) px-3 py-1.5 hover:bg-(--app-surface-muted)"
            onClick={() => void sessionStore.cancelLogin()}
          >
            取消登录
          </button>
        )}
        {session?.state === 'active' && !attempt && (
          <button
            type="button"
            className="rounded-md border border-(--app-border) px-3 py-1.5 hover:bg-(--app-surface-muted)"
            onClick={() => void signOut()}
          >
            退出登录
          </button>
        )}
        <button
          type="button"
          className="rounded-md border border-(--app-border) px-3 py-1.5 hover:bg-(--app-surface-muted)"
          disabled={probeBusy}
          onClick={() => void runProbe()}
        >
          {probeBusy ? '正在探测…' : '检查在线服务'}
        </button>
      </div>

      {attempt && (
        <div className="mt-3 space-y-1.5 text-sm">
          <p>
            已在系统浏览器中打开授权页。完成登录后本面板会自动更新；若浏览器未弹出，请复制以下地址手动打开：
          </p>
          <p className="break-all rounded-md border border-(--app-border) bg-(--app-surface-muted) px-2 py-1.5 font-mono text-xs">
            {attempt.authorizeUrl}
          </p>
          <button
            type="button"
            className="rounded-md border border-(--app-border) px-3 py-1.5 hover:bg-(--app-surface-muted)"
            onClick={() => void copyAuthorizeUrl()}
          >
            复制授权地址
          </button>
          {copied && <span className="ml-2 text-xs text-(--app-text-muted)">已复制</span>}
        </div>
      )}

      {probe && (
        <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-(--app-text-muted)">服务可达</dt>
          <dd>{probe.reachable ? '是' : '否'}</dd>
          <dt className="text-(--app-text-muted)">服务端契约</dt>
          <dd>{probe.contractVersion ?? '未声明'}</dd>
          <dt className="text-(--app-text-muted)">版本兼容</dt>
          <dd>
            {probe.compatible === null ? '无法判定' : probe.compatible ? '兼容' : '不兼容'}
          </dd>
        </dl>
      )}

      {notice && <p className="mt-3 text-sm text-(--app-text-muted)">{notice}</p>}
      {panelError && (
        <p role="alert" className="mt-3 text-sm text-(--app-accent-strong)">
          {panelError}
        </p>
      )}
    </section>
  );
};


