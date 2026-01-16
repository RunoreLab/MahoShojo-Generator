import { ErrorMessage } from '@/components/ErrorMessage';

import type { MagicTavernSession } from '@/lib/magic-tavern/types';

type MagicTavernSummaryPanelProps = {
  activeSession: MagicTavernSession | null;
  isGenerating: boolean;
  isSummarizing: boolean;
  summaryError: string | null;
  hasMessages: boolean;
  onGenerateSummary: () => void;
  onClearSummary: () => void;
  onSummaryChange: (value: string) => void;
};

const InlineSpinner = () => (
  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-pink-200 border-t-pink-600" aria-hidden="true" />
);

export function MagicTavernSummaryPanel(props: MagicTavernSummaryPanelProps) {
  const {
    activeSession,
    isGenerating,
    isSummarizing,
    summaryError,
    hasMessages,
    onGenerateSummary,
    onClearSummary,
    onSummaryChange,
  } = props;

  const disableActions = !activeSession || isGenerating || isSummarizing;
  const canGenerate = !disableActions && hasMessages;

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-800">会话摘要</div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isSummarizing ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-pink-700">
              <InlineSpinner />
              <span>生成中…</span>
            </div>
          ) : null}
          <button
            type="button"
            className="rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canGenerate}
            onClick={onGenerateSummary}
            title="生成摘要会消耗额外 Token"
          >
            生成/更新摘要
          </button>
          {activeSession?.summary ? (
            <button
              type="button"
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disableActions}
              onClick={onClearSummary}
            >
              清空
            </button>
          ) : null}
        </div>
      </div>

      <div className="text-xs text-gray-500">用于长对话压缩（仅保存在本地浏览器）。生成摘要会消耗额外 Token。</div>

      {summaryError ? (
        <ErrorMessage
          message={summaryError}
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
        />
      ) : null}

      <textarea
        className="input-field h-32 resize-y"
        value={activeSession?.summary ?? ''}
        onChange={(event) => onSummaryChange(event.target.value)}
        placeholder="还没有摘要。点击“生成/更新摘要”自动生成，或手动填写。"
        disabled={!activeSession || isSummarizing}
      />

      {activeSession?.summaryMeta?.updatedAt ? (
        <div className="text-xs text-gray-500">更新时间：{new Date(activeSession.summaryMeta.updatedAt).toLocaleString()}</div>
      ) : null}
    </div>
  );
}
