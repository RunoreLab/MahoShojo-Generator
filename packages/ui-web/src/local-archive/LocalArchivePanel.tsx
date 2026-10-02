import {
  toArchivePreflightView,
  type ArchiveExportProgress,
  type LocalArchiveView,
} from './contract';

/**
 * 共源归档界面。
 *
 * ## 它展示什么，不展示什么
 *
 * 展示：选择文件、预检摘要、冲突/跳过报告、进度、结果。
 * 不展示：存储实现、native 能力、路径权限、任何网络。
 *
 * 界面**不接受**一个"直接导入"的入口：`confirmImport` 只在 `plan` 存在时可用，因此"先展示摘要再让
 * 用户决定"这条 `DESK-052` 的要求由类型与渲染共同保证，而不是靠调用点记得先 inspect。
 *
 * ## 为什么成功提示必须来自宿主
 *
 * 导出成功的唯一判据是宿主侧的最终确认（Desktop 是 native 报告文件已落盘，`DESK-071b`）。因此本组件
 * 只渲染 `model.lastExport`，从不自己推断"应该成功了"。
 */

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
    <h2 className="mb-1 text-sm font-medium text-(--app-text-muted)">{title}</h2>
    {children}
  </section>
);

const ErrorNote = ({ testId, message }: { testId: string; message: string }) => (
  <p role="alert" data-testid={testId} className="mt-2 text-sm text-(--app-accent-strong)">
    {message}
  </p>
);

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const ExportProgress = ({ progress }: { progress: ArchiveExportProgress }) => {
  if (progress.kind === 'indeterminate') {
    return (
      <p data-testid="archive-export-indeterminate" className="mt-2 text-sm text-(--app-text-muted)">
        正在打包归档…
      </p>
    );
  }

  // 进度用原生 `<progress>` 的 `max`/`value` 表达，而不是自绘一个宽度百分比：原生元素自带
  // `role="progressbar"` 与正确的无障碍语义，自绘 div 需要额外补 aria 属性且容易漏。
  return (
    <div data-testid="archive-export-determinate" className="mt-2">
      <progress className="w-full" max={progress.total} value={progress.written}>
        {progress.written} / {progress.total}
      </progress>
      <p className="mt-1 text-xs text-(--app-text-subtle)">
        {formatBytes(progress.written)} / {formatBytes(progress.total)}
      </p>
    </div>
  );
};

export const LocalArchivePanel = ({ model, actions, limits }: LocalArchiveView) => {
  // 存储不可用时整个界面进入只读说明态。这与「库里没有数据」是两种完全不同的情况：
  // DESK-PROD-003 明确禁止把失败显示成「没有数据」，而两者在界面上如果都只是"没有条目"，
  // 用户会去检查自己的库，而不是去查存储初始化为什么失败。
  if (model.storageError !== null) {
    return (
      <Panel title="本地库归档">
        <ErrorNote testId="archive-storage-error" message={`本地库存储不可用：${model.storageError}`} />
        <p className="mt-2 text-sm text-(--app-text-muted)">
          导入与导出都需要读取本机存储。当前无法访问存储，因此没有可导出的内容。
        </p>
      </Panel>
    );
  }

  const preflight = model.plan === null ? null : toArchivePreflightView(model.plan);

  return (
    <div className="flex flex-col gap-4" data-testid="local-archive-panel">
      <Panel title="导出整库">
        <p className="text-sm text-(--app-text-muted)">
          把本机的数据卡与 Web 包打包成一个归档文件。单个归档上限 {formatBytes(limits.maxArchiveBytes)}。
          <br />
          归档**不包含** AI Provider 凭据、账号信息或服务器凭据；换设备后需要重新配置这些。
        </p>
        <button
          type="button"
          data-testid="archive-export-start"
          disabled={model.exporting}
          onClick={actions.startExport}
          className="mt-3 min-h-11 rounded-lg border border-(--app-border-strong) bg-(--app-surface-strong) px-4 py-2 text-sm font-medium hover:bg-(--app-surface-90) disabled:cursor-not-allowed disabled:opacity-50"
        >
          {model.exporting ? '正在导出…' : '导出整库'}
        </button>
        {model.exportProgress !== null && <ExportProgress progress={model.exportProgress} />}
        {model.exportError !== null && (
          <ErrorNote testId="archive-export-error" message={model.exportError} />
        )}
        {model.lastExport !== null && (
          <p data-testid="archive-export-result" className="mt-2 text-sm text-(--app-text-muted)">
            已导出 {model.lastExport.entryCount} 条记录（{formatBytes(model.lastExport.byteLength)}）
            到 <span className="break-all">{model.lastExport.location}</span>。
          </p>
        )}
      </Panel>

      <Panel title="从归档导入">
        <p className="text-sm text-(--app-text-muted)">
          选择一个此前导出的归档文件。会先完整预检并显示摘要与冲突条数，确认后才写入。
        </p>
        <button
          type="button"
          data-testid="archive-import-pick"
          disabled={model.inspecting || model.applying}
          onClick={actions.pickImportFile}
          className="mt-3 min-h-11 rounded-lg border border-(--app-border-strong) bg-(--app-surface-strong) px-4 py-2 text-sm font-medium hover:bg-(--app-surface-90) disabled:cursor-not-allowed disabled:opacity-50"
        >
          {model.inspecting ? '正在预检…' : '选择归档文件'}
        </button>
        {model.importError !== null && (
          <ErrorNote testId="archive-import-error" message={model.importError} />
        )}

        {preflight !== null && (
          <div data-testid="archive-preflight" className="mt-3 rounded-lg border border-(--app-border) p-3">
            <h3 className="text-sm font-medium">导入前确认</h3>
            <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-(--app-text-muted)">格式</dt>
              <dd>
                {preflight.format} v{preflight.formatVersion}
              </dd>
              <dt className="text-(--app-text-muted)">导出时间</dt>
              <dd>{preflight.exportedAt}</dd>
              <dt className="text-(--app-text-muted)">数据卡</dt>
              <dd data-testid="archive-preflight-cards">
                共 {preflight.cardCount} 条，将写入 {preflight.willWriteCardCount} 条
                {preflight.skippedCardCount > 0 ? `，跳过 ${preflight.skippedCardCount} 条（本机已有）` : ''}
              </dd>
              <dt className="text-(--app-text-muted)">Web 包</dt>
              <dd data-testid="archive-preflight-packages">
                共 {preflight.webPackageCount} 条，将写入 {preflight.willWriteWebPackageCount} 条
                {preflight.skippedWebPackageCount > 0
                  ? `，跳过 ${preflight.skippedWebPackageCount} 条（本机已有）`
                  : ''}
              </dd>
            </dl>
            <p className="mt-2 text-xs text-(--app-text-subtle)">
              已存在的记录不会被覆盖（existing-wins）。导入不会创建 AI Provider，也不会发起网络请求。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="archive-import-confirm"
                disabled={model.applying}
                onClick={actions.confirmImport}
                className="min-h-11 rounded-lg bg-(--app-accent) px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {model.applying ? '正在导入…' : '确认导入'}
              </button>
              <button
                type="button"
                data-testid="archive-import-cancel"
                disabled={model.applying}
                onClick={actions.cancelImport}
                className="min-h-11 rounded-lg border border-(--app-border-strong) px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {model.report !== null && (
          <div data-testid="archive-report" className="mt-3 rounded-lg border border-(--app-border) p-3">
            <h3 className="text-sm font-medium">导入结果</h3>
            <p className="mt-1 text-sm" data-testid="archive-report-summary">
              写入 {model.report.succeededCardIds.length} 张数据卡、
              {model.report.succeededWebPackageIds.length} 个 Web 包；
              跳过 {model.report.skipped.length} 条；失败 {model.report.failed.length} 条。
            </p>
            {model.report.skipped.length > 0 && (
              <p className="mt-1 text-xs text-(--app-text-subtle)">
                跳过是因为本机已有同 id 的记录，按 existing-wins 保留本机版本。
              </p>
            )}
            {model.report.failed.length > 0 && (
              <ul data-testid="archive-report-failures" className="mt-2 flex flex-col gap-1 text-xs">
                {model.report.failed.map((failure) => (
                  <li key={`${failure.kind}:${failure.id}`} className="text-(--app-accent-strong)">
                    {failure.kind === 'card' ? '数据卡' : 'Web 包'} {failure.id}：{failure.reason}
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              data-testid="archive-reset"
              onClick={actions.reset}
              className="mt-3 min-h-11 rounded-lg border border-(--app-border-strong) px-4 py-2 text-sm"
            >
              继续导入另一个归档
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
};