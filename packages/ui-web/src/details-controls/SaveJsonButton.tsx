import { useMemo, useState, type ReactNode } from 'react';

import { downloadBlob } from '../client/blob';

export type SaveJsonMode = 'download' | 'text';

export interface SaveJsonButtonProps<T> {
  data: T;
  mode: SaveJsonMode;
  recommendedMode: SaveJsonMode;
  /** 生成下载文件名（含扩展名），如 `魔法少女_小圆.json`。 */
  resolveFileName: (data: T) => string;
  /** `recommendedMode === 'download'` 时的按钮文案；缺省为「💾 下载设定文件」。 */
  downloadLabel?: ReactNode;
}

/**
 * 「下载 JSON / 复制 JSON」保存控件。
 *
 * 由 DetailsPage / CanshouPage / CreatorPage 三份逐字变体收敛而来；文案统一为
 * DetailsPage 口径，文件名与推荐按钮文案由宿主注入。
 */
export function SaveJsonButton<T>({ data, mode, recommendedMode, resolveFileName, downloadLabel }: SaveJsonButtonProps<T>) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const jsonPayload = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const downloadJson = () => {
    const blob = new Blob([jsonPayload], { type: 'application/json' });
    downloadBlob(blob, resolveFileName(data));
    setCopyStatus('idle');
  };

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard) {
        throw new Error('clipboard-not-available');
      }
      await navigator.clipboard.writeText(jsonPayload);
      setCopyStatus('success');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (err) {
      console.error('复制 JSON 失败：', err);
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 2500);
    }
  };

  const statusMessage = copyStatus === 'success'
    ? '✅ JSON 已复制到剪贴板'
    : copyStatus === 'error'
      ? '⚠️ 复制失败，请手动长按选择'
      : recommendedMode === 'text'
        ? '建议复制后在本地粘贴到新文件中'
        : '若无法下载，可改用复制模式';

  if (mode === 'download') {
    return (
      <div className="flex-1 min-w-[260px] text-left">
        <p className="text-xs text-gray-500 mb-2 text-center dark:text-gray-400">
          {recommendedMode === 'download'
            ? '推荐：直接下载 JSON 文件，适合桌面端或支持下载的浏览器'
            : '实验功能：部分移动端浏览器也支持直接下载，如失败请切换到复制模式'}
        </p>
        <button onClick={downloadJson} className="generate-button w-full">
          {recommendedMode === 'download' ? downloadLabel ?? '💾 下载设定文件' : '🧪 尝试直接下载 JSON'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-[260px] text-left">
      <div className="mb-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-200">
        <p className="font-semibold mb-1">复制模式</p>
        <p>复制下方全部内容，并将其粘贴到文本文件中保存为 <code className="bg-yellow-100 px-1 rounded dark:bg-yellow-800/50">.json</code>。</p>
        <p className="mt-1">也可粘贴到竞技场的文本输入框继续使用。</p>
      </div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">{statusMessage}</span>
        <button
          onClick={handleCopy}
          className="rounded-md border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-600 hover:border-indigo-400 hover:text-indigo-700 dark:border-indigo-700 dark:bg-slate-800 dark:text-indigo-300 dark:hover:border-indigo-500"
          type="button"
        >
          复制 JSON
        </button>
      </div>
      <textarea
        value={jsonPayload}
        readOnly
        className="w-full h-64 p-3 border rounded-lg text-xs font-mono bg-gray-50 text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        onClick={(e) => (e.target as HTMLTextAreaElement).select()}
      />
      <p className="text-xs text-gray-400 mt-2 text-center">点击文本框可全选内容</p>
    </div>
  );
}
