import React, { useCallback, useMemo, useState } from 'react';

import { downloadBlob } from '@/lib/client/blobUrl';
import { buildSafeFileName } from '@/lib/client/fileName';
import { copyTextToClipboard } from '@/lib/clipboard';

type CopyStatus = 'idle' | 'success' | 'error';
type PanelVariant = 'light' | 'dark';

type QuestionnaireAnswerExportPanelProps = {
  variant: PanelVariant;
  title: string;
  filenameBase: string;
  hasContent: boolean;
  buildContent: () => string;
  disabled?: boolean;
};

export function QuestionnaireAnswerExportPanel({
  variant,
  title,
  filenameBase,
  hasContent,
  buildContent,
  disabled = false,
}: QuestionnaireAnswerExportPanelProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);

  const actionDisabled = disabled || !hasContent;

  const statusText = useMemo(() => {
    if (!hasContent) return '暂无可导出的答案（尚未填写或已全部清空）。';
    if (copyStatus === 'success') return '✅ 已复制到剪贴板。';
    if (copyStatus === 'error') return '⚠️ 复制失败（内容可能过长或浏览器限制）。建议下载 TXT，或展开下方手动复制。';
    return '提示：内容较长时，下载 TXT 往往比复制更稳定。';
  }, [copyStatus, hasContent]);

  const resolveContent = useCallback(() => {
    const next = buildContent();
    if (showPreview) {
      setPreviewContent(next);
    }
    return next;
  }, [buildContent, showPreview]);

  const handleDownload = () => {
    if (actionDisabled) return;
    const latest = resolveContent();
    const blob = new Blob([latest], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, buildSafeFileName(filenameBase, 'txt', 'questionnaire-answers'));
    setCopyStatus('idle');
  };

  const handleCopy = async () => {
    if (actionDisabled) return;
    const latest = resolveContent();
    const ok = await copyTextToClipboard(latest);
    setCopyStatus(ok ? 'success' : 'error');
    if (!ok) {
      setPreviewContent(latest);
      setShowPreview(true);
    }
    window.setTimeout(() => setCopyStatus('idle'), ok ? 2000 : 4000);
  };

  const cardClassName = variant === 'dark'
    ? 'my-4 rounded-lg border border-slate-700 bg-slate-900/60 p-3'
    : 'my-4 rounded-lg border border-slate-200 bg-slate-50 p-3';

  const titleClassName = variant === 'dark'
    ? 'text-sm font-semibold text-slate-100'
    : 'text-sm font-semibold text-slate-700';

  const metaClassName = variant === 'dark'
    ? 'mt-1 text-xs text-slate-400'
    : 'mt-1 text-xs text-slate-500';

  const buttonBase = 'rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50';
  const downloadButtonClassName = variant === 'dark'
    ? `${buttonBase} border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-500/20`
    : `${buttonBase} border-indigo-200 bg-white text-indigo-700 hover:border-indigo-400`;
  const copyButtonClassName = variant === 'dark'
    ? `${buttonBase} border-slate-600 bg-slate-950/40 text-slate-200 hover:border-slate-400 hover:text-white`
    : `${buttonBase} border-slate-200 bg-white text-slate-700 hover:border-slate-400`;
  const toggleButtonClassName = variant === 'dark'
    ? `${buttonBase} border-slate-700 bg-transparent text-slate-300 hover:border-slate-500`
    : `${buttonBase} border-slate-200 bg-transparent text-slate-600 hover:border-slate-400`;

  const textareaClassName = variant === 'dark'
    ? 'mt-3 h-60 w-full rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-100'
    : 'mt-3 h-60 w-full rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-900';

  return (
    <div className={cardClassName}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <p className={titleClassName}>{title}</p>
          <p className={metaClassName}>
            {statusText}
            {previewContent ? `（约 ${previewContent.trim().length.toLocaleString()} 字）` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <button
            type="button"
            onClick={handleDownload}
            disabled={actionDisabled}
            className={downloadButtonClassName}
          >
            下载 TXT
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={actionDisabled}
            className={copyButtonClassName}
          >
            复制到剪贴板
          </button>
          <button
            type="button"
            onClick={() => {
              setShowPreview((prev) => {
                const next = !prev;
                if (next && previewContent === null) {
                  try {
                    setPreviewContent(buildContent());
                  } catch {
                    setPreviewContent('');
                  }
                }
                return next;
              });
            }}
            className={toggleButtonClassName}
          >
            {showPreview ? '收起内容' : '展开内容'}
          </button>
        </div>
      </div>

      {showPreview && (
        <>
          <textarea
            value={previewContent ?? ''}
            readOnly
            className={textareaClassName}
            onClick={(event) => (event.target as HTMLTextAreaElement).select()}
          />
          <p className={metaClassName}>点击文本框可全选内容（用于手动复制或分段处理）。</p>
        </>
      )}
    </div>
  );
}
