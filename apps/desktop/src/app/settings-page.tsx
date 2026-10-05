import { useEffect, useState } from 'react';

import { loadDesktopRuntimeInfo, type DesktopRuntimeInfo } from '../platform';
import { AccountPanel } from '../features/account/AccountPanel';
import { AiConnectionsPanel } from '../features/ai-config/AiConnectionsPanel';
import { WebPackageDiagnosticsPanel } from '../features/webpkg/WebPackageDiagnosticsPanel';

interface RuntimeState {
  status: 'loading' | 'ready' | 'failed';
  info?: DesktopRuntimeInfo;
  message?: string;
}

/**
 * 运行时自述。
 *
 * 它曾经是 D0 的**首页**，而 `DESK-PROD-001` 明确禁止运行时/Provider 面板作为最终首页。因此它现在
 * 只出现在设置页：产品入口必须是产品首页，调试信息归设置。
 *
 * 读取失败仍然要显示失败而不是静默降级——`DESK-PROD-007` 要求初始化失败必须报告。
 */
const RuntimeInfoPanel = () => {
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
    <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
      <h2 className="mb-2 text-sm font-medium text-(--app-text-muted)">本地运行时</h2>
      {state.status === 'loading' && <p className="text-sm">正在读取本地运行时信息…</p>}
      {state.status === 'failed' && (
        <p className="text-sm text-(--app-accent-strong)">读取失败：{state.message}</p>
      )}
      {state.status === 'ready' && state.info && (
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-(--app-text-muted)">应用版本</dt>
          <dd>{state.info.appVersion}</dd>
          <dt className="text-(--app-text-muted)">Tauri 版本</dt>
          <dd>{state.info.tauriVersion}</dd>
          <dt className="text-(--app-text-muted)">平台</dt>
          <dd>
            {state.info.os} / {state.info.arch}
          </dd>
          <dt className="text-(--app-text-muted)">打包产物</dt>
          <dd>{state.info.packaged ? '是' : '否（开发构建）'}</dd>
        </dl>
      )}
    </section>
  );
};

/** 设置承载 Provider 面板与运行时信息；调试信息不占首页（`DESK-PROD-001`）。 */
export const DesktopSettings = () => (
  <section data-testid="page-settings" className="flex flex-col gap-4">
    <h1 className="text-lg font-semibold">设置</h1>
    <AccountPanel />
    <AiConnectionsPanel />
    <WebPackageDiagnosticsPanel />
    <RuntimeInfoPanel />
  </section>
);

