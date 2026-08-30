import { useRef, useState } from 'react';

import { DisclosureButton } from '@/components/shared/CollapsibleSection';

type ChallengeCardImportPanelProps = {
  isSubmitting: boolean;
  localImportError: string | null;
  onImportFile: (file: File) => void | Promise<void>;
  onImportText: (text: string) => void | Promise<void>;
};

export function ChallengeCardImportPanel({
  isSubmitting,
  localImportError,
  onImportFile,
  onImportText,
}: ChallengeCardImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pastedText, setPastedText] = useState('');
  const [isPasteOpen, setIsPasteOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-800" htmlFor="challenge-card-file">
          上传角色卡文件
        </label>
        <input
          ref={inputRef}
          id="challenge-card-file"
          type="file"
          accept=".json,application/json"
          disabled={isSubmitting}
          className="w-full cursor-pointer rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 file:mr-4 file:rounded-full file:border-0 file:bg-rose-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-rose-700 hover:file:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void onImportFile(file);
            if (inputRef.current) {
              inputRef.current.value = '';
            }
          }}
        />
      </div>

      <div>
        <DisclosureButton
          open={isPasteOpen}
          onToggle={() => setIsPasteOpen((current) => !current)}
          className="text-rose-700 hover:underline"
        >
          {isPasteOpen ? '收起粘贴文本' : '展开粘贴文本'}
        </DisclosureButton>

        {isPasteOpen ? (
          <div className="mt-3 space-y-3">
            <textarea
              value={pastedText}
              onChange={(event) => setPastedText(event.target.value)}
              placeholder="粘贴单张角色卡 JSON。当前 challenge 仍只支持单卡入场。"
              disabled={isSubmitting}
              className="min-h-[180px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs leading-6 text-slate-700 outline-none transition focus:border-rose-300 focus:bg-white"
            />
            <button
              type="button"
              onClick={() => void onImportText(pastedText)}
              disabled={isSubmitting || !pastedText.trim()}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              从粘贴文本导入
            </button>
          </div>
        ) : null}
      </div>

      {localImportError ? <p className="text-sm text-red-600">{localImportError}</p> : null}
    </div>
  );
}
