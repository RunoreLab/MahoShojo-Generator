'use client';

import AiReasoningPanel from '@/components/ai/AiReasoningPanel';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';
import { formatDateTime } from '@/lib/constants';

import { useBattleStorySession } from '../hooks/useBattleStorySession';

const actionLabelMap = {
  start: '首章',
  continue: '续写',
  branch: '分支',
  rewrite: '重写',
} as const;

const buildTokenSummary = (usage: Record<string, unknown> | null): string | null => {
  if (!usage) return null;
  const promptTokens =
    typeof usage.promptTokens === 'number' ? usage.promptTokens : null;
  const completionTokens =
    typeof usage.completionTokens === 'number' ? usage.completionTokens : null;
  const reasoningTokens =
    typeof usage.reasoningTokens === 'number' ? usage.reasoningTokens : null;

  const segments = [
    promptTokens !== null ? `输入 ${promptTokens.toLocaleString()}` : null,
    reasoningTokens !== null ? `推理 ${reasoningTokens.toLocaleString()}` : null,
    completionTokens !== null ? `输出 ${completionTokens.toLocaleString()}` : null,
  ].filter((item): item is string => Boolean(item));

  return segments.length > 0 ? segments.join('｜') : null;
};

export function BattleStorySessionPanel() {
  const {
    isReady,
    storageError,
    actionError,
    notice,
    sessions,
    activeSession,
    chapters,
    latestActiveChapter,
    selectedChapter,
    selectedChapterId,
    setSelectedChapterId,
    isGenerating,
    generatingAction,
    streamingMarkdown,
    streamReasoning,
    streamTelemetry,
    streamChapterIndex,
    isRefreshingSummary,
    isCooldown,
    remainingTime,
    canStartFromArena,
    startDisabledReason,
    handleStartSession,
    handleContinueSession,
    handleBranchSession,
    handleRewriteLastChapter,
    handleSelectSession,
    handleExportMarkdown,
  } = useBattleStorySession();

  const activeChapterCount = chapters.length;
  const summaryCoverageText = activeSession?.summaryMeta
    ? `已摘要到第 ${activeSession.summaryMeta.coveredUntilChapterIndex} 章`
    : '尚未生成章节摘要';
  const tokenSummary = buildTokenSummary(streamTelemetry.aiUsage);

  return (
    <div className="card mt-6">
      <CollapsibleSection
        title="连续战报会话"
        description="本地 IndexedDB 持久化，可连续续写、分支和重写最后一章"
        defaultOpen
        storageKey="arena.section.battleStorySession.open"
        variant="plain"
        titleClassName="text-lg font-bold text-gray-800"
        headerClassName="mb-3"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleStartSession()}
              disabled={isGenerating || isCooldown || !canStartFromArena}
              className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
              title={
                isCooldown
                  ? `冷却中，请等待 ${remainingTime} 秒`
                  : (startDisabledReason ?? '基于当前竞技场配置创建新的连续战报会话')
              }
            >
              {isGenerating && generatingAction === 'start'
                ? '正在生成首章...'
                : (isCooldown ? `冷却中 ${remainingTime}s` : '新建连续战报')}
            </button>
            <button
              type="button"
              onClick={() => void handleContinueSession()}
              disabled={isGenerating || isCooldown || !activeSession || !latestActiveChapter}
              className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
              title={
                isCooldown
                  ? `冷却中，请等待 ${remainingTime} 秒`
                  : (activeSession ? '在当前会话结尾继续续写下一章' : '请先选择或创建会话')
              }
            >
              {isGenerating && generatingAction === 'continue'
                ? '正在续写...'
                : (isCooldown ? `冷却中 ${remainingTime}s` : '继续续写')}
            </button>
            <button
              type="button"
              onClick={() => void handleBranchSession()}
              disabled={isGenerating || isCooldown || !activeSession || !latestActiveChapter}
              className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
              title={
                isCooldown
                  ? `冷却中，请等待 ${remainingTime} 秒`
                  : (activeSession ? '以当前结尾为基础复制一条分支会话' : '请先选择或创建会话')
              }
            >
              {isGenerating && generatingAction === 'branch'
                ? '正在分支...'
                : (isCooldown ? `冷却中 ${remainingTime}s` : '创建分支')}
            </button>
            <button
              type="button"
              onClick={() => void handleRewriteLastChapter()}
              disabled={isGenerating || isCooldown || !activeSession || !latestActiveChapter}
              className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
              title={
                isCooldown
                  ? `冷却中，请等待 ${remainingTime} 秒`
                  : (activeSession ? '重写当前会话的最后一章' : '请先选择或创建会话')
              }
            >
              {isGenerating && generatingAction === 'rewrite'
                ? '正在重写...'
                : (isCooldown ? `冷却中 ${remainingTime}s` : '重写最后一章')}
            </button>
            <button
              type="button"
              onClick={handleExportMarkdown}
              disabled={!activeSession || activeChapterCount === 0}
              className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              导出 Markdown
            </button>
          </div>

          {!isReady ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              正在读取本地连续战报会话...
            </div>
          ) : null}

          {storageError ? (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {storageError}
            </div>
          ) : null}

          {actionError ? (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {actionError}
            </div>
          ) : null}

          {notice ? (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {notice}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="text-sm font-semibold text-gray-800">
                  {activeSession ? activeSession.title : '当前未选择会话'}
                </div>
                <div className="mt-2 space-y-1 text-xs text-gray-600">
                  <div>会话更新时间：{activeSession ? formatDateTime(activeSession.updatedAt) : '—'}</div>
                  <div>章节数：{activeSession ? activeChapterCount : 0}</div>
                  <div>摘要状态：{activeSession ? summaryCoverageText : '—'}</div>
                  <div>本地存储：仅当前浏览器可见</div>
                  {activeSession?.branchOf ? (
                    <div>分支来源：{activeSession.branchOf.sessionId}</div>
                  ) : null}
                  {isRefreshingSummary ? <div>章节摘要正在后台刷新...</div> : null}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-2 text-sm font-semibold text-gray-800">最近会话</div>
                {sessions.length === 0 ? (
                  <div className="text-sm text-gray-500">本地还没有连续战报会话。</div>
                ) : (
                  <div className="space-y-2">
                    {sessions.map((session) => {
                      const isActive = session.id === activeSession?.id;
                      return (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => void handleSelectSession(session.id)}
                          className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                            isActive
                              ? 'border-emerald-300 bg-emerald-50'
                              : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                        >
                          <div className="text-sm font-medium text-gray-800">
                            {session.title}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {formatDateTime(session.updatedAt)}｜{session.chapterCount} 章
                            {session.branchOf ? '｜分支' : ''}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-2 text-sm font-semibold text-gray-800">章节列表</div>
                {chapters.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    创建首章后，这里会显示连续章节链。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {chapters.map((chapter) => {
                      const isSelected = selectedChapterId
                        ? selectedChapterId === chapter.id
                        : latestActiveChapter?.id === chapter.id;
                      return (
                        <button
                          key={chapter.id}
                          type="button"
                          onClick={() => setSelectedChapterId(chapter.id)}
                          className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                            isSelected
                              ? 'border-blue-300 bg-blue-50'
                              : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                        >
                          <div className="text-sm font-medium text-gray-800">
                            第 {chapter.index} 章 · {chapter.title}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {actionLabelMap[chapter.action]}｜{formatDateTime(chapter.createdAt)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {isGenerating ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-sm font-semibold text-emerald-800">
                    正在生成
                    {streamChapterIndex ? `第 ${streamChapterIndex} 章` : '新章节'}
                    {generatingAction ? ` · ${actionLabelMap[generatingAction]}` : ''}
                  </div>
                  <div className="mt-2 text-xs text-emerald-700">
                    {streamTelemetry.aiModel ? `模型：${streamTelemetry.aiModel}` : '模型信息待返回'}
                    {tokenSummary ? `｜${tokenSummary}` : ''}
                  </div>
                  <div className="mt-3 rounded-lg border border-emerald-100 bg-white p-3">
                    <MarkdownBlock
                      content={streamingMarkdown || '正在等待模型返回正文...'}
                      variant="light"
                      mode="article"
                    />
                  </div>
                  {streamReasoning ? (
                    <AiReasoningPanel
                      reasoning={streamReasoning}
                      status={streamReasoning.status}
                      compact
                    />
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-sm font-semibold text-gray-800">
                  {selectedChapter
                    ? `第 ${selectedChapter.index} 章 · ${selectedChapter.title}`
                    : '章节预览'}
                </div>
                {selectedChapter ? (
                  <>
                    <div className="mt-2 text-xs text-gray-500">
                      {formatDateTime(selectedChapter.createdAt)}｜{actionLabelMap[selectedChapter.action]}
                      {selectedChapter.deterministicDigest.winner
                        ? `｜胜利者：${selectedChapter.deterministicDigest.winner}`
                        : ''}
                    </div>
                    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <MarkdownBlock content={selectedChapter.markdown} variant="light" mode="article" />
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-sm text-gray-500">
                    选择一章即可查看完整正文；如果当前还没有会话，可以直接点击“新建连续战报”开始。
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
