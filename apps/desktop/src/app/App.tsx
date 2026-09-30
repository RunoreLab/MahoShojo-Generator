import { useEffect, useState } from 'react';

import { loadDesktopRuntimeInfo, type DesktopRuntimeInfo } from '../platform';
import { ProviderProfilesPanel } from '../features/providers/ProviderProfilesPanel';

interface RuntimeState {
  status: 'loading' | 'ready' | 'failed';
  info?: DesktopRuntimeInfo;
  message?: string;
}

/**
 * D0 阶段的唯一界面：证明本地打包 UI 能启动、能通过窄 IPC 读到 Rust 侧自述。
 *
 * 它刻意不承载任何业务页面。业务迁移必须等 capability、CSP、secret 存储与 Direct
 * transport 各自通过门禁之后才开始（见 PLAN-desktop-client-v1）。
 */
export const App = () => {
  const [state, setState] = useState<RuntimeState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    loadDesktopRuntimeInfo()
      .then((info) => {
        if (!cancelled) setState({ status: 'ready', info });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          status: 'failed',
          message: cause instanceof Error ? cause.message : 'unknown desktop bridge failure',
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex h-full max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">MahoShojo Generator · Desktop</h1>
        <p className="text-sm text-(--color-ink-muted)">
          本地 client runtime 骨架。本阶段不提供登录，也不访问项目服务器。
        </p>
      </header>

      <section className="rounded-lg border border-white/10 bg-(--color-surface-raised) p-4">
        <h2 className="mb-2 text-sm font-medium text-(--color-ink-muted)">本地运行时</h2>
        {state.status === 'loading' && <p className="text-sm">正在读取本地运行时信息…</p>}
        {state.status === 'failed' && (
          <p className="text-sm text-(--color-accent)">读取失败：{state.message}</p>
        )}
        {state.status === 'ready' && state.info && (
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-(--color-ink-muted)">应用版本</dt>
            <dd>{state.info.appVersion}</dd>
            <dt className="text-(--color-ink-muted)">Tauri 版本</dt>
            <dd>{state.info.tauriVersion}</dd>
            <dt className="text-(--color-ink-muted)">平台</dt>
            <dd>
              {state.info.os} / {state.info.arch}
            </dd>
            <dt className="text-(--color-ink-muted)">打包产物</dt>
            <dd>{state.info.packaged ? '是' : '否（开发构建）'}</dd>
          </dl>
        )}
      </section>

      <ProviderProfilesPanel />
    </main>
  );
};
