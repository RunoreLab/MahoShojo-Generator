import { useId, type ReactNode } from 'react';
import { FREE_GENERATION_ATTACHMENT_LIMITS } from '@mahoshojo/ai-core/reference-attachments';
import { formatBytes } from './format-bytes';
import type { UseFreeAttachmentsResult } from './use-free-attachments';

export interface FreeAttachmentPanelProps {
  readonly state: UseFreeAttachmentsResult;
  readonly disabled?: boolean;
  /** Web 可注入带百科帮助链接的错误投影；共享层不读取账号或发网络请求。 */
  readonly errorContent?: ReactNode;
}

/** 共用附件会话的唯一展示面：预算/截断/明细一致，解析和迟到读取仍由 hook 管理。 */
export function FreeAttachmentPanel({ state, disabled = false, errorContent }: FreeAttachmentPanelProps) {
  const inputId = useId();
  const limits = FREE_GENERATION_ATTACHMENT_LIMITS;
  return (
    <section aria-label="参考附件" className="my-2 bg-gray-100 rounded-lg p-3">
      <div className="input-group">
        <label className="input-label" htmlFor={inputId}>参考附件（可选）</label>
        <input
          ref={state.inputRef}
          id={inputId}
          type="file"
          multiple
          onChange={(event) => void state.addFiles(event.target.files)}
          disabled={disabled || state.isReading}
          className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-gray-600 flex-wrap gap-2">
          <span>已添加 {state.items.length} 个附件｜累计 {state.totalChars.toLocaleString()} 字符｜已读取大小 {formatBytes(state.totalBytes)}</span>
          <button type="button" className="text-red-600 hover:underline" onClick={state.clear} disabled={disabled || (state.items.length === 0 && !state.isReading)}>清空附件</button>
        </div>
        {state.isReading ? <p role="status" className="mt-2 text-xs text-gray-500">正在读取附件…</p> : null}
        <p className="mt-2 text-xs text-gray-500">
          说明：附件会按“文本”注入提示词供 AI 参考；单文件最多读取 {formatBytes(limits.maxBytesPerFile)} / {limits.maxCharsPerFile.toLocaleString()} 字符，总上限 {formatBytes(limits.maxBytesTotal)} / {limits.maxCharsTotal.toLocaleString()} 字符。
        </p>
        {state.items.length > 0 ? <div className="mt-3 space-y-2">
          {state.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/80 border border-gray-200 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate" title={item.name}>{item.name}</div>
              <div className="text-xs text-gray-500">
                {item.includedBytes < item.size ? `${formatBytes(item.includedBytes)} / ${formatBytes(item.size)}` : formatBytes(item.size)}{' '}
                · {item.type} · {item.content.length.toLocaleString()} 字符{item.truncated ? ' · 已截断' : ''}
              </div>
            </div>
            <button type="button" className="text-xs text-red-600 hover:underline shrink-0" onClick={() => state.remove(item.id)} disabled={disabled}>移除</button>
          </div>)}
        </div> : null}
        {state.error ? <div className="mt-3">{errorContent ?? <p role="alert" className="error-message">{state.error}</p>}</div> : null}
      </div>
    </section>
  );
}
