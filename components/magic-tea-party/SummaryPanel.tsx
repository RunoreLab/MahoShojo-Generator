import { ErrorMessage } from '@/components/ErrorMessage';

import type { MagicTeaPartySession, MagicTeaPartyUpdateDraft } from '@/lib/magic-tea-party/types';

type MagicTeaPartySummaryPanelProps = {
  activeSession: MagicTeaPartySession | null;
  isGenerating: boolean;
  isSummarizing: boolean;
  summaryError: string | null;
  hasMessages: boolean;
  onGenerateSummary: () => void;
  onClearSummary: () => void;
  onPersistSession: (session: MagicTeaPartySession) => void | Promise<void>;
  updateDrafts: MagicTeaPartyUpdateDraft[] | null;
  updateRangeSize: number;
  isGeneratingUpdates: boolean;
  isApplyingUpdates: boolean;
  updateError: string | null;
  onUpdateRangeSizeChange: (value: number) => void;
  onGenerateUpdates: () => void;
  onApplyUpdates: () => void;
  onClearUpdateDrafts: () => void;
};

const InlineSpinner = () => (
  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-pink-200 border-t-pink-600" aria-hidden="true" />
);

export function MagicTeaPartySummaryPanel(props: MagicTeaPartySummaryPanelProps) {
  const {
    activeSession,
    isGenerating,
    isSummarizing,
    summaryError,
    hasMessages,
    onGenerateSummary,
    onClearSummary,
    onPersistSession,
    updateDrafts,
    updateRangeSize,
    isGeneratingUpdates,
    isApplyingUpdates,
    updateError,
    onUpdateRangeSizeChange,
    onGenerateUpdates,
    onApplyUpdates,
    onClearUpdateDrafts,
  } = props;

  const disableActions = !activeSession || isGenerating || isSummarizing;
  const canGenerate = !disableActions && hasMessages;
  const writeArenaHistory = Boolean(activeSession?.settings.writeArenaHistory);
  const writeCurrentState = Boolean(activeSession?.settings.writeCurrentState);
  const hasWriteEnabled = writeArenaHistory || writeCurrentState;
  const hasDrafts = Boolean(updateDrafts && updateDrafts.length > 0);

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-semibold text-gray-800">会话摘要</div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
        onChange={(event) => {
          if (!activeSession) return;
          const trimmed = event.target.value.trim();
          const now = Date.now();
          void onPersistSession({
            ...activeSession,
            summary: trimmed ? trimmed : undefined,
            summaryMeta: trimmed ? { ...(activeSession.summaryMeta ?? {}), updatedAt: now } : undefined,
            updatedAt: now,
          });
        }}
        placeholder="还没有摘要。点击“生成/更新摘要”自动生成，或手动填写。"
        disabled={!activeSession || isSummarizing}
      />

      {activeSession?.summaryMeta?.updatedAt ? (
        <div className="text-xs text-gray-500">更新时间：{new Date(activeSession.summaryMeta.updatedAt).toLocaleString()}</div>
      ) : null}

      <div className="rounded-lg border border-pink-100 bg-pink-50/60 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-pink-800">角色更新</div>
          {isGeneratingUpdates || isApplyingUpdates ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-pink-700">
              <InlineSpinner />
              <span>{isApplyingUpdates ? '写入中…' : '草案生成中…'}</span>
            </div>
          ) : null}
        </div>

        <div className="text-xs text-gray-600">基于对话历史生成更新草案。茶会写入会移除签名并标记为非原生。</div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="text-xs font-semibold text-gray-600">对话范围</label>
          <select
            className="input-field !h-8 !py-1 text-xs"
            value={String(updateRangeSize)}
            onChange={(event) => onUpdateRangeSizeChange(Number(event.target.value))}
            disabled={disableActions}
          >
            <option value="10">最近 10 轮</option>
            <option value="20">最近 20 轮</option>
            <option value="40">最近 40 轮</option>
            <option value="80">最近 80 轮</option>
          </select>
        </div>

        {!hasWriteEnabled ? (
          <div className="text-xs text-red-600">请先在“资料读写”中开启写入历战记录或当前状态。</div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canGenerate || !hasWriteEnabled || isGeneratingUpdates || isApplyingUpdates}
            onClick={onGenerateUpdates}
          >
            生成更新草案
          </button>
          <button
            type="button"
            className="rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasDrafts || disableActions || isGeneratingUpdates || isApplyingUpdates}
            onClick={onApplyUpdates}
          >
            确认写入
          </button>
          {hasDrafts ? (
            <button
              type="button"
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disableActions || isGeneratingUpdates || isApplyingUpdates}
              onClick={onClearUpdateDrafts}
            >
              清空草案
            </button>
          ) : null}
        </div>

        {updateError ? (
          <ErrorMessage
            message={updateError}
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
          />
        ) : null}

        {hasDrafts ? (
          <div className="space-y-2 text-xs text-gray-700">
            {updateDrafts?.map((draft) => (
              <div key={draft.roleId ?? draft.characterName} className="rounded-md border border-pink-100 bg-white px-3 py-2">
                <div className="font-semibold text-gray-800">{draft.characterName}</div>
                {draft.impact ? <div className="mt-1 text-gray-600">历战影响：{draft.impact}</div> : null}
                {draft.currentStateSummary ? (
                  <div className="mt-1 text-gray-600">状态摘要：{draft.currentStateSummary}</div>
                ) : null}
                <div className="mt-1 text-gray-500">胜者：{draft.winner || '不适用'}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500">暂无更新草案。</div>
        )}
      </div>
    </div>
  );
}
