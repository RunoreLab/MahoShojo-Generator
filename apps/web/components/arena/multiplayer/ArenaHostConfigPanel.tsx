'use client';

import { useState } from 'react';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';
import type { ArenaRoomHostWorkspaceDirtyReason } from '@/lib/arena-room/host-workspace';

import type { ArenaRoomHostReconciliation } from './useArenaRoomHostReconciliation';

const buttonClass = 'rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = `${buttonClass} border-fuchsia-600 bg-fuchsia-600 text-white hover:bg-fuchsia-700`;
const secondaryButtonClass = `${buttonClass} border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100`;

const reasonLabel: Readonly<Record<ArenaRoomHostWorkspaceDirtyReason, string>> = {
  'baseline-missing': '缺少房主本地 payload baseline',
  'host-local-content': '房主本地正文已修改',
  'shared-config': '共享配置有未发布修改',
  'working-copy-invalid': '当前 Arena 配置无法安全发布',
};

export function ArenaHostConfigPanel({
  controllerState,
  reconciliation,
}: {
  readonly controllerState: ArenaRoomControllerState;
  readonly reconciliation: ArenaRoomHostReconciliation;
}) {
  const [diffOpen, setDiffOpen] = useState(false);
  const session = controllerState.session;
  if (!session || session.self.role !== 'host') return null;
  const status = reconciliation.state;
  const busy = status.kind === 'synchronizing'
    || controllerState.configPublishPending
    || controllerState.configPublishResultUnknown;

  return (
    <section aria-labelledby="arena-host-config-heading" className="rounded-xl border border-fuchsia-200 bg-white/70 p-3 dark:border-fuchsia-900 dark:bg-gray-900/60">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="arena-host-config-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">房间配置</h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            本地编辑不会逐键联网；只有显式更新才覆盖 Room authority。
          </p>
        </div>
        <button
          type="button"
          className={primaryButtonClass}
          disabled={busy}
          onClick={() => { void reconciliation.publishLocal(); }}
        >
          {status.kind === 'synchronizing' && status.action === 'publish'
            ? '正在更新…'
            : '更新房间配置'}
        </button>
      </div>

      {status.kind === 'synced' ? (
        <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
          {status.message}（revision {status.revision}）
        </p>
      ) : status.kind === 'error' ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{status.message}</p>
      ) : status.kind === 'synchronizing' && status.action !== 'publish' ? (
        <p role="status" className="mt-3 text-sm text-gray-700 dark:text-gray-300">正在同步房间权威配置…</p>
      ) : null}

      {status.kind === 'conflicted' ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-medium">房间配置已更新，但本地 Arena 同时有未发布修改。</p>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {status.reasons.map((reason) => <li key={reason}>{reasonLabel[reason]}</li>)}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => { void reconciliation.syncRoom(); }}>
              同步房间配置
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => setDiffOpen(true)}>
              查看差异
            </button>
            <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => { void reconciliation.publishLocal(); }}>
              保留本地修改并重新发布
            </button>
          </div>
        </div>
      ) : null}

      {diffOpen && status.kind === 'conflicted' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6">
          <section role="dialog" aria-modal="true" aria-labelledby="arena-host-config-diff-heading" className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-950">
            <div className="flex items-center justify-between gap-3 border-b p-4 dark:border-gray-800">
              <div>
                <h3 id="arena-host-config-diff-heading" className="font-semibold text-gray-950 dark:text-gray-100">Room authority / 本地 working copy</h3>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">仅展示 safe Shared Config，不包含 host-local 正文。</p>
              </div>
              <button type="button" className={secondaryButtonClass} onClick={() => setDiffOpen(false)}>关闭</button>
            </div>
            <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 lg:grid-cols-2">
              <div>
                <h4 className="text-sm font-semibold">ROOM · revision {status.revision}</h4>
                <pre className="mt-2 overflow-auto rounded-lg bg-gray-950 p-3 text-xs text-gray-100">{JSON.stringify(status.roomConfig, null, 2)}</pre>
              </div>
              <div>
                <h4 className="text-sm font-semibold">LOCAL</h4>
                <pre className="mt-2 overflow-auto rounded-lg bg-gray-950 p-3 text-xs text-gray-100">{status.localConfig ? JSON.stringify(status.localConfig, null, 2) : '当前 working copy 无法安全投影'}</pre>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
