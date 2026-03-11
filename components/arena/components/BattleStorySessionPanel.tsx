'use client';

import { MarkdownBlock } from '@/components/MarkdownBlock';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';
import StreamingBattleReportCard from '@/components/stream/StreamingBattleReportCard';
import type {
  BattleStoryChapterRecord,
  BattleStoryChapterCardSnapshot,
  BattleStorySessionRecord,
} from '@/lib/ai-session/battle-story/types';
import { formatDateTime } from '@/lib/constants';

import { useBattleStorySession } from '../hooks/useBattleStorySession';
import {
  resolveBattleStoryChapterCardSnapshot,
  resolveBattleStoryScenarioName,
} from '../utils/battleStorySession';

const actionLabelMap = {
  start: '首章',
  continue: '续写',
  branch: '分支',
  rewrite: '重写',
} as const;

const formatProviderSource = (session: BattleStorySessionRecord | null): string => {
  if (!session) return '—';
  const modeText = session.source.providerMode === 'custom' ? '自定义通道' : '系统通道';
  const providerId = session.source.providerId?.trim() || 'system';
  const modelId = session.source.modelId?.trim() || 'default';
  return `${modeText}｜${providerId}｜${modelId}`;
};

const buildMetaDebugSummary = (
  debug: BattleStoryChapterCardSnapshot['streamUpdateMetaDebug'] | null | undefined
): string | null => {
  if (!debug) return null;
  const sourceLabel = debug.source === 'sse' ? 'SSE' : '内联回填';
  const parseLabel = debug.parseOk ? '解析成功' : '解析失败';
  const rawLabel = debug.raw ? (debug.rawTruncated ? 'raw 已截断' : 'raw 可用') : 'raw 缺失';
  return `${sourceLabel}｜${parseLabel}｜${rawLabel}`;
};

const toCodeFenceMarkdown = (content: string, language?: string): string => {
  const prefix = language ? `\`\`\`${language}` : '```';
  return `${prefix}\n${content}\n\`\`\``;
};

function BattleStoryMetaDebugPanel(props: {
  debug: BattleStoryChapterCardSnapshot['streamUpdateMetaDebug'] | null | undefined;
  storageKey: string;
  title?: string;
}) {
  const { debug, storageKey, title = '章节元数据' } = props;
  if (!debug) return null;

  const parsedMetaJson = debug.meta ? JSON.stringify(debug.meta, null, 2) : '';
  const summary = buildMetaDebugSummary(debug);

  return (
    <CollapsibleSection
      title={title}
      description={summary ?? undefined}
      defaultOpen={false}
      storageKey={storageKey}
      variant="panel"
    >
      <div className="space-y-3 text-sm text-gray-600">
        {debug.error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="font-medium text-amber-800">错误信息</div>
            <div className="mt-1 whitespace-pre-wrap break-words">{debug.error}</div>
          </div>
        ) : null}
        {parsedMetaJson ? (
          <div>
            <div className="font-medium text-gray-700">解析结果（parsed meta）</div>
            <div className="mt-1 rounded-lg border border-gray-200 bg-white p-3">
              <MarkdownBlock content={toCodeFenceMarkdown(parsedMetaJson, 'json')} variant="light" />
            </div>
          </div>
        ) : null}
        {debug.raw ? (
          <div>
            <div className="font-medium text-gray-700">
              原始输出（raw meta）{debug.rawTruncated ? '（已截断）' : ''}
            </div>
            <div className="mt-1 rounded-lg border border-gray-200 bg-white p-3">
              <MarkdownBlock content={toCodeFenceMarkdown(debug.raw)} variant="light" />
            </div>
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}

function ChapterPreviewSection(props: {
  chapter: BattleStoryChapterRecord | null;
  snapshot: BattleStoryChapterCardSnapshot | null;
  scenarioName?: string;
  mode?: BattleStorySessionRecord['source']['mode'];
  onSaveImage?: (imageUrl: string) => void;
}) {
  const { chapter, snapshot, scenarioName, mode, onSaveImage } = props;

  if (!chapter) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-sm text-gray-500">
        选择一章即可查看完整战报卡片；创建首章后，还可以继续续写、分支和重写最后一章。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-gray-500">
        <span>{formatDateTime(chapter.createdAt)}</span>
        <span>{actionLabelMap[chapter.action]}</span>
        {chapter.deterministicDigest.winner ? <span>胜利者：{chapter.deterministicDigest.winner}</span> : null}
        {chapter.generationId ? <span>生成记录：{chapter.generationId}</span> : null}
      </div>
      <StreamingBattleReportCard
        content={chapter.markdown}
        onSaveImage={onSaveImage}
        mode={mode}
        scenarioName={scenarioName}
        reporterInfo={snapshot?.reporterInfo ?? null}
        userGuidance={snapshot?.userGuidance ?? null}
        characterGuidances={snapshot?.characterGuidances ?? null}
        adjudicationResults={snapshot?.adjudicationResults ?? null}
        aiUsage={snapshot?.aiUsage ?? null}
        aiModel={snapshot?.aiModel ?? null}
        narrativeHistoryReadCount={snapshot?.narrativeHistoryReadCount ?? null}
        aiReasoning={snapshot?.aiReasoning ?? null}
      />
    </div>
  );
}

export function BattleStorySessionPanel(props: {
  onSaveImage?: (imageUrl: string) => void;
}) {
  const { onSaveImage } = props;
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
    streamCardSnapshot,
    streamChapterIndex,
    isRefreshingSummary,
    isDeletingSession,
    isCooldown,
    remainingTime,
    canStartFromArena,
    startDisabledReason,
    handleStartSession,
    handleContinueSession,
    handleBranchSession,
    handleRewriteLastChapter,
    handleSelectSession,
    handleDeleteSession,
    handleExportMarkdown,
  } = useBattleStorySession();

  const activeChapterCount = chapters.length;
  const summaryCoverageText = activeSession?.summaryMeta
    ? `已摘要到第 ${activeSession.summaryMeta.coveredUntilChapterIndex} 章`
    : '尚未生成章节摘要';
  const scenarioName = resolveBattleStoryScenarioName(activeSession);
  const selectedChapterSnapshot = resolveBattleStoryChapterCardSnapshot(selectedChapter);
  const streamMetaDebug = streamCardSnapshot?.streamUpdateMetaDebug ?? null;
  const selectedMetaDebug = selectedChapterSnapshot?.streamUpdateMetaDebug ?? null;
  const liveCardContent =
    streamingMarkdown.trim() ||
    `# 第 ${streamChapterIndex ?? '?'} 章\n\n正在等待模型返回正文...`;

  return (
    <div
      className="relative left-1/2 mt-6 max-w-none -translate-x-1/2 rounded-[24px] border p-5 sm:p-6"
      style={{
        width: 'min(1180px, calc(100vw - 2rem))',
        background: 'var(--app-surface-90)',
        borderColor: 'var(--app-border-strong)',
        boxShadow: 'var(--app-card-shadow)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <CollapsibleSection
        title="连续战报会话"
        description="本地 IndexedDB 持久化，可连续续写、分支和重写最后一章"
        defaultOpen
        storageKey="arena.section.battleStorySession.open"
        variant="plain"
        titleClassName="text-lg font-bold text-gray-800"
        headerClassName="mb-3"
      >
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleStartSession()}
              disabled={isGenerating || isDeletingSession || isCooldown || !canStartFromArena}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
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
              disabled={isGenerating || isDeletingSession || isCooldown || !activeSession || !latestActiveChapter}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
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
              disabled={isGenerating || isDeletingSession || isCooldown || !activeSession || !latestActiveChapter}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
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
              disabled={isGenerating || isDeletingSession || isCooldown || !activeSession || !latestActiveChapter}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
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
              disabled={!activeSession || activeChapterCount === 0 || isDeletingSession}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              导出 Markdown
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteSession(activeSession?.id)}
              disabled={isGenerating || isDeletingSession || !activeSession}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              title={activeSession ? '删除当前选中的连续战报会话及其全部章节' : '请先选择一个会话'}
            >
              {isDeletingSession ? '正在删除会话...' : '删除当前会话'}
            </button>
          </div>

          {!isReady ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              正在读取本地连续战报会话...
            </div>
          ) : null}

          {storageError ? (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{storageError}</div>
          ) : null}

          {actionError ? (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
          ) : null}

          {notice ? (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">{notice}</div>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] xl:items-start">
            <div className="space-y-4">
              <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-800">当前会话元数据</div>
                    <div className="mt-1 text-base font-semibold text-gray-900">
                      {activeSession ? activeSession.title : '当前未选择会话'}
                    </div>
                  </div>
                  {activeSession?.branchOf ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      分支会话
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 space-y-2 text-sm text-gray-600">
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-gray-500">会话更新时间</span>
                    <span className="text-right text-gray-700">
                      {activeSession ? formatDateTime(activeSession.updatedAt) : '—'}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-gray-500">章节数</span>
                    <span className="text-right text-gray-700">{activeSession ? activeChapterCount : 0}</span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-gray-500">摘要状态</span>
                    <span className="text-right text-gray-700">{activeSession ? summaryCoverageText : '—'}</span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-gray-500">模型通道</span>
                    <span className="max-w-[16rem] text-right text-gray-700">
                      {formatProviderSource(activeSession)}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-gray-500">本地存储</span>
                    <span className="text-right text-gray-700">仅当前浏览器可见</span>
                  </div>
                  {activeSession?.branchOf ? (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-gray-500">分支来源</span>
                      <span className="max-w-[16rem] break-all text-right text-gray-700">
                        {activeSession.branchOf.sessionId}
                      </span>
                    </div>
                  ) : null}
                  {isRefreshingSummary ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      章节摘要正在后台刷新...
                    </div>
                  ) : null}
                </div>
              </section>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <section className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="mb-3 text-sm font-semibold text-gray-800">本地会话</div>
                  {sessions.length === 0 ? (
                    <div className="text-sm text-gray-500">本地还没有连续战报会话。</div>
                  ) : (
                    <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                      {sessions.map((session) => {
                        const isActive = session.id === activeSession?.id;
                        return (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() => void handleSelectSession(session.id)}
                            className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                              isActive
                                ? 'border-emerald-300 bg-emerald-50'
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                            }`}
                          >
                            <div className="text-sm font-medium text-gray-800">{session.title}</div>
                            <div className="mt-1 text-xs text-gray-500">
                              {formatDateTime(session.updatedAt)}｜{session.chapterCount} 章
                              {session.branchOf ? '｜分支' : ''}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-gray-800">章节列表</div>
                    {chapters.length > 0 ? (
                      <div className="text-xs text-gray-500">共 {chapters.length} 章</div>
                    ) : null}
                  </div>
                  {chapters.length === 0 ? (
                    <div className="text-sm text-gray-500">创建首章后，这里会显示连续章节链。</div>
                  ) : (
                    <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                      {chapters.map((chapter) => {
                        const isSelected = selectedChapterId
                          ? selectedChapterId === chapter.id
                          : latestActiveChapter?.id === chapter.id;
                        return (
                          <button
                            key={chapter.id}
                            type="button"
                            onClick={() => setSelectedChapterId(chapter.id)}
                            className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
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
                </section>
              </div>
            </div>

            <div className="min-w-0 space-y-4">
              {isGenerating ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-sm font-semibold text-emerald-800">
                      正在生成
                      {streamChapterIndex ? `第 ${streamChapterIndex} 章` : '新章节'}
                      {generatingAction ? ` · ${actionLabelMap[generatingAction]}` : ''}
                    </div>
                    <div className="mt-1 text-xs text-emerald-700">
                      章节正文、模型思考与流式元数据会在这里实时更新。
                    </div>
                  </div>
                  <StreamingBattleReportCard
                    content={liveCardContent}
                    onSaveImage={onSaveImage}
                    mode={activeSession?.source.mode}
                    scenarioName={scenarioName}
                    reporterInfo={streamCardSnapshot?.reporterInfo ?? null}
                    userGuidance={streamCardSnapshot?.userGuidance ?? null}
                    characterGuidances={streamCardSnapshot?.characterGuidances ?? null}
                    adjudicationResults={streamCardSnapshot?.adjudicationResults ?? null}
                    aiUsage={streamCardSnapshot?.aiUsage ?? null}
                    aiModel={streamCardSnapshot?.aiModel ?? null}
                    narrativeHistoryReadCount={streamCardSnapshot?.narrativeHistoryReadCount ?? null}
                    aiReasoning={streamCardSnapshot?.aiReasoning ?? null}
                    isStreaming
                  />
                  <BattleStoryMetaDebugPanel
                    debug={streamMetaDebug}
                    storageKey="arena.section.battleStorySession.liveMetaDebug.open"
                    title="实时元数据"
                  />
                </div>
              ) : null}

              <div className="space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="text-sm font-semibold text-gray-800">
                    {selectedChapter
                      ? `章节预览｜第 ${selectedChapter.index} 章 · ${selectedChapter.title}`
                      : '章节预览'}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    可在此处查看任意章节、下载 Markdown，并保存截图。
                  </div>
                </div>
                <ChapterPreviewSection
                  chapter={selectedChapter}
                  snapshot={selectedChapterSnapshot}
                  scenarioName={scenarioName}
                  mode={activeSession?.source.mode}
                  onSaveImage={onSaveImage}
                />
                <BattleStoryMetaDebugPanel
                  debug={selectedMetaDebug}
                  storageKey="arena.section.battleStorySession.selectedMetaDebug.open"
                />
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
