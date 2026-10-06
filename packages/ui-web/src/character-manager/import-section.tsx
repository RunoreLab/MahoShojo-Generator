import { useState, type ReactNode } from 'react';

export interface CharacterManagerImportSectionProps {
  /** 文件选择控件之后、分隔线之前的宿主附加内容（Web：万途往返导入选项）。 */
  readonly fileExtra?: ReactNode;
  readonly onFile: (file: File) => void;
  readonly accept?: string;
  readonly fileLabel?: ReactNode;
  readonly fileInputId?: string;
  /** 粘贴文本区：受控展开/收起（`open` 缺省时由组件内部管理）。 */
  readonly pasteOpen?: boolean;
  readonly onPasteOpenChange?: (open: boolean) => void;
  readonly defaultPasteOpen?: boolean;
  readonly pasteValue: string;
  readonly onPasteChange: (value: string) => void;
  readonly onPasteLoad: () => void;
  readonly pasteBusy?: boolean;
  readonly pastePlaceholder?: string;
  readonly loadLabel?: ReactNode;
  readonly busyLabel?: ReactNode;
}

/**
 * 「第一步：导入现有数据」区段：单文件上传 + 可折叠粘贴文本区。
 * 解析、校验与副作用全部在宿主的 `onFile`/`onPasteLoad` 里——共享组件只承载结构与折叠交互。
 */
export function CharacterManagerImportSection({
  fileExtra,
  onFile,
  accept = '.json',
  fileLabel = '上传 .json 设定文件（支持角色、情景、万途通用卡）',
  fileInputId = 'file-upload',
  pasteOpen,
  onPasteOpenChange,
  defaultPasteOpen = false,
  pasteValue,
  onPasteChange,
  onPasteLoad,
  pasteBusy = false,
  pastePlaceholder = '在此处粘贴角色、情景等数据卡的 .json 内容...',
  loadLabel = '从文本加载数据',
  busyLabel = '加载中...',
}: CharacterManagerImportSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultPasteOpen);
  const open = pasteOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onPasteOpenChange?.(next);
  };

  return (
    <>
      <div className="input-group">
        <label htmlFor={fileInputId} className="input-label">{fileLabel}</label>
        <input
          id={fileInputId}
          type="file"
          accept={accept}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // 允许重复上传同一文件：读取前先重置 value。
            event.target.value = '';
            if (!file) return;
            onFile(file);
          }}
          className="input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0"
        />
        {fileExtra}
      </div>
      <div className="text-center my-4 text-gray-500">或</div>
      <div className="mb-6">
        <button
          onClick={() => setOpen(!open)}
          className="text-pink-700 hover:underline cursor-pointer mb-2 font-semibold text-sm"
        >
          {open ? '▼ 折叠文本粘贴区域' : '▶ 展开文本粘贴区域 (手机端推荐)'}
        </button>
        {open && (
          <div className="input-group mt-2">
            <textarea
              value={pasteValue}
              onChange={(event) => onPasteChange(event.target.value)}
              placeholder={pastePlaceholder}
              className="input-field resize-y h-32"
              disabled={pasteBusy}
            />
            <button
              onClick={onPasteLoad}
              disabled={pasteBusy || !pasteValue.trim()}
              className="generate-button mt-2 mb-0"
            >
              {pasteBusy ? busyLabel : loadLabel}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
