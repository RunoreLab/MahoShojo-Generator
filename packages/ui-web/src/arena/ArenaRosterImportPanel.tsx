'use client';
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useArenaInputLifecycle, type ArenaInputLifecyclePorts } from './input-lifecycle';
import { DisclosureButton } from '../creator';
export type ArenaRosterImportPanelProps = Readonly<ArenaInputLifecyclePorts & {
  disabled?: boolean;
  limitReached?: boolean;
  onUpload(files: FileList): Promise<void>;
  onPaste(text: string): Promise<void>;
  onError?(error: unknown, source: 'upload' | 'paste'): void;
  afterUpload?: ReactNode;
}>;
/** Local form lifecycle only. Parsing, budgets and optional persistence belong to the host adapter. */
export function ArenaRosterImportPanel({ disabled = false, limitReached = false, onUpload, onPaste: paste, onError, afterUpload, onDirtyChange, onBusyChange }: ArenaRosterImportPanelProps) {
  const [isPasteVisible, setIsPasteVisible] = useState(false);
  const [pastedJson, setPastedJson] = useState('');
  const runWithBusy = useArenaInputLifecycle(pastedJson.length > 0, { onDirtyChange, onBusyChange });
  const [isPasting, setIsPasting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (/mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(navigator.userAgent.toLowerCase())) setIsPasteVisible(true);
  }, []);
  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    try { await runWithBusy(() => onUpload(files)); }
    catch (error) { onError?.(error, 'upload'); }
    finally { if (inputRef.current) inputRef.current.value = ''; }
  };
  const onPaste = async () => {
    setIsPasting(true);
    try { await runWithBusy(() => paste(pastedJson)); setPastedJson(''); }
    catch (error) { onError?.(error, 'paste'); }
    finally { setIsPasting(false); }
  };
  return (
    <>
      <div className="input-group">
        <label htmlFor="file-upload" className="input-label">
          上传自己的 .json 设定文件
        </label>
        <input
          ref={inputRef}
          id="file-upload"
          type="file"
          multiple
          accept=".json"
          onChange={onFileChange}
          disabled={disabled}
          className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {afterUpload}
      </div>

      <div className="mb-6">
        <DisclosureButton
          open={isPasteVisible}
          onToggle={() => setIsPasteVisible((prev) => !prev)}
          className="text-pink-700 hover:underline mb-2"
        >
          {isPasteVisible ? '收起角色粘贴区域' : '展开角色粘贴区域（手机端推荐）'}
        </DisclosureButton>
        {isPasteVisible && (
          <div className="input-group mt-2">
            <textarea
              value={pastedJson}
              onChange={(e) => setPastedJson(e.target.value)}
              placeholder="在此处粘贴一个或多个角色设定文件(.json)内容..."
              className="input-field resize-y h-32"
              disabled={disabled}
            />
            <button
              onClick={onPaste}
              disabled={
                !pastedJson.trim() ||
                disabled ||
                isPasting ||
                limitReached
              }
              className="generate-button mt-2 mb-0"
            >
              从文本添加角色
            </button>
          </div>
        )}
      </div>
    </>
  );
}
