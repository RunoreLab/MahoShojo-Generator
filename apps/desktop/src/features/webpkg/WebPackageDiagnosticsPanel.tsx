import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import type { LocalWebPackageRecordV1 } from '@mahoshojo/local-library/web-package-record';
import {
  createWebPackageResourceSnapshot,
  unpackWebPackageZip,
} from '@mahoshojo/web-package';

import { IpcWebPackageRepository } from '../../platform/web-package-bridge';
import {
  DesktopWebPackageInstanceError,
  openWebPackageInstanceInIsolatedWebview,
} from '../../platform/webpkg-instance-bridge';
import type { RawInvokeFn, StructuredInvokeFn } from '../../platform/local-archive-bridge';

/**
 * Web Package 受限 webview（D4b / DESK-013）的设置页诊断入口。
 *
 * 放在设置而不是本地库：它是 D4b 的**验收面**，不是产品入口——真正的产品打开路径
 * （"从本地库点击一个包并运行"）归后续切片，而那条路径不该借"面板已经有按钮"提前
 * 半成品地上线。`DESK-PROD-001` 的同一原则：调试能力归设置。
 *
 * ## 它验收什么
 *
 * 点"在受限 webview 中打开"会走完整链：读 blob 里的 ZIP → `unpackWebPackageZip` 重新
 * 解包与逐文件摘要校验（不信任记录里缓存的 manifest）→ 物化 base-only 快照 →
 * begin/append/open 三段 → native 创建 `webpkg-<id>` 零 capability webview。
 *
 * **刻意 base-only**：生成 overlay 是运行期产物，不落进本地库记录；诊断面只验证
 * "按导入原样打开一个本地包"。overlay 合并语义的覆盖归
 * `packages/web-package` 自己的测试。
 *
 * ## 它不验收什么
 *
 * 真实 webview 的隔离事实（capability 命中、protocol 路由、permission 拒绝）只能在
 * 运行中的 Tauri 里确认——本面板让那条人工验收路径存在，但不能用"按钮能点出窗口"
 * 代替它。
 */
const describeError = (cause: unknown): string => {
  if (cause instanceof DesktopWebPackageInstanceError) return `${cause.message}（${cause.code}）`;
  if (cause instanceof Error) return cause.message;
  return '打开 Web Package 受限视图失败';
};

const tauriInvoke: StructuredInvokeFn = (command, args) => invoke(command, args as never);
const tauriRawInvoke: RawInvokeFn = (command, body, options) =>
  invoke(command, body as never, options as never);

const PACKAGE_LIST_LIMIT = 50;

export const WebPackageDiagnosticsPanel = () => {
  const packages = useMemo(() => new IpcWebPackageRepository(tauriInvoke), []);
  const [records, setRecords] = useState<readonly LocalWebPackageRecordV1[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const page = await packages.list({ includeDeleted: false, limit: PACKAGE_LIST_LIMIT });
      setRecords(page.items);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, [packages]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openInIsolatedWebview = useCallback(
    async (record: LocalWebPackageRecordV1): Promise<void> => {
      setBusyId(record.id);
      setError(null);
      setNotice(null);
      try {
        const archive = await packages.readArchive(record.ref.digest);
        if (!archive) {
          throw new Error('本地库中存在记录但缺少包字节');
        }
        const base = await unpackWebPackageZip(archive);
        // 物化 id 是渲染层命名空间——native 的 `wpk-<N>` 由 begin 另行分配，两者刻意不混用。
        const snapshot = createWebPackageResourceSnapshot(`desktop-staging-${record.id}`, {
          base,
          overlay: null,
          readFile: (path) => base.readFile(path),
        });
        const opened = await openWebPackageInstanceInIsolatedWebview(
          tauriInvoke,
          tauriRawInvoke,
          snapshot,
          base.manifest.name,
        );
        setNotice(`已在受限 webview 打开（${opened.webviewLabel}）：${base.manifest.name}`);
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setBusyId(null);
      }
    },
    [packages],
  );

  return (
    <section
      className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4"
      aria-labelledby="webpkg-diagnostics-heading"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="webpkg-diagnostics-heading" className="text-sm font-medium">
            Web Package 受限 webview（诊断）
          </h2>
          <p className="mt-1 text-sm text-(--app-text-muted)">
            在独立的零权限 webview 中按导入原样打开一个本地包。资源走 maho-webpkg 只读协议；
            包内容没有任何 Desktop 命令、文件或凭据访问能力。
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-(--app-border) px-3 py-2 text-sm"
          disabled={loading || busyId !== null}
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
        >
          刷新列表
        </button>
      </header>

      {loading && <p role="status" className="mt-3 text-sm">正在读取本地 Web 包…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-(--app-accent-strong)">{error}</p>}
      {notice && <p role="status" className="mt-3 break-all text-sm">{notice}</p>}

      {!loading && !error && records.length === 0 && (
        <p className="mt-3 text-sm text-(--app-text-muted)">
          本地库中还没有 Web 包。先在本地库导入一个包，再用这里验证受限 webview。
        </p>
      )}
      {records.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {records.map((record) => (
            <li
              key={record.id}
              className="min-w-0 rounded border border-(--app-border) p-3 text-sm"
            >
              <p className="font-medium">{record.title}</p>
              <p className="mt-1 break-all text-(--app-text-muted)">
                {record.ref.id}@{record.ref.version}
              </p>
              <button
                type="button"
                className="mt-3 rounded border border-(--app-border) px-3 py-2 text-sm"
                disabled={busyId !== null}
                onClick={() => void openInIsolatedWebview(record)}
              >
                {busyId === record.id ? '正在暂存并打开…' : '在受限 webview 中打开'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-(--app-text-muted)">
        只按导入原样打开（不含生成覆盖层）；真实 webview 的隔离验收需在运行中的桌面应用里确认。
      </p>
    </section>
  );
};
