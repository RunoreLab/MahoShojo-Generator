import type { ReactNode } from 'react';

export interface CharacterManagerEditorActionsProps {
  readonly onSaveLocal: () => void;
  readonly onDownload: () => void;
  readonly onCopy: () => void;
  readonly onLoadOtherData: () => void;
  readonly localSaveBusy?: boolean;
  readonly localSaveDisabled?: boolean;
  readonly exportBusy?: boolean;
  readonly exportDisabled?: boolean;
  readonly copied?: boolean;
  /** 云端保存、容量提示等仅由具备相应能力的宿主提供。 */
  readonly cloudActions?: ReactNode;
  /** Web 的万途往返导出等附加能力，位于通用导出与重新加载之间。 */
  readonly exportExtra?: ReactNode;
  readonly feedback?: ReactNode;
}

/** 编辑器底部完整动作区。保存、签名、文件与剪贴板副作用仍由宿主负责。 */
export function CharacterManagerEditorActions({
  onSaveLocal,
  onDownload,
  onCopy,
  onLoadOtherData,
  localSaveBusy = false,
  localSaveDisabled = false,
  exportBusy = false,
  exportDisabled = false,
  copied = false,
  cloudActions,
  exportExtra,
  feedback,
}: CharacterManagerEditorActionsProps) {
  const busy = localSaveBusy || exportBusy;
  return (
    <div className="mt-8 pt-4 border-t space-y-2">
      <button
        type="button"
        onClick={onSaveLocal}
        disabled={busy || localSaveDisabled}
        className="generate-button w-full"
        style={{ backgroundColor: '#10b981', backgroundImage: 'linear-gradient(to right, #10b981, #059669)' }}
      >
        {localSaveBusy ? '正在保存…' : '保存到本地库'}
      </button>
      {cloudActions}
      <button type="button" onClick={onDownload} disabled={busy || exportDisabled} className="generate-button w-full" title="下载当前编辑内容，不会写入本地库">
        {exportBusy ? '处理中...' : '保存修改并下载'}
      </button>
      <button
        type="button"
        onClick={onCopy}
        disabled={busy || exportDisabled}
        className="generate-button w-full"
        style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
      >
        {exportBusy ? '处理中...' : copied ? '已复制！' : '复制到剪贴板'}
      </button>
      {exportExtra}
      <button type="button" onClick={onLoadOtherData} disabled={busy} className="footer-link mt-4 w-full text-center">
        加载其他数据
      </button>
      {feedback}
    </div>
  );
}
