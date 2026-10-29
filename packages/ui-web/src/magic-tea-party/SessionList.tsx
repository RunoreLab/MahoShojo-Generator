'use client';

import { PageJump } from '../pagination';

import { useEffect, useId, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { isMagicTeaPartyPinned } from '@mahoshojo/domain/magic-tea-party/organization';
import type { MagicTeaPartySession } from '@mahoshojo/domain/magic-tea-party/types';

/** Directory previews need names/titles, never full role cards or generation settings. */
export type MagicTeaPartySessionListItem = Pick<MagicTeaPartySession, 'id' | 'title' | 'updatedAt' | 'pinnedAt' | 'branchLabel'> & {
  roles?: { name: string }[];
  scenario?: { title: string };
  auxScenarios?: { title: string }[];
  forkedFrom?: { sessionId: string };
};

export type MagicTeaPartySessionListProps = {
  sessions: MagicTeaPartySessionListItem[];
  activeSessionId: string | null;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  selectedSessionIds?: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  onSelectionViewChange?: () => void;
  onToggleSessionPin?: (id: string) => void;
  onReorderPinnedSessions?: (ids: string[]) => void;
  onMergeSession?: (id: string) => void;
  onReturnToParent?: (parentId: string) => void;
  pinnedCollapsed: boolean;
  recentCollapsed: boolean;
  onPinnedCollapsedChange: (value: boolean) => void;
  onRecentCollapsedChange: (value: boolean) => void;
  busy?: boolean;
  /** Native paged repositories must not imply that an unloaded library was searched. */
  listScope?: 'all' | 'loaded';
  pagination?: ReactNode;
  children?: ReactNode;
};

export function MagicTeaPartySessionList({
  sessions, activeSessionId, onCreateSession, onSelectSession, onDeleteSession,
  onToggleSessionPin, onReorderPinnedSessions, onMergeSession, onReturnToParent,
  pinnedCollapsed, recentCollapsed, onPinnedCollapsedChange, onRecentCollapsedChange,
  selectedSessionIds = [], onSelectionChange, onSelectionViewChange,
  busy = false, listScope = 'all', pagination, children,
}: MagicTeaPartySessionListProps) {
  const controlId = useId();
  const searchLabel = listScope === 'loaded' ? '搜索已加载会话标题 / 角色 / 情景' : '搜索会话标题 / 角色 / 情景';
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const normalizedQuery = searchText.trim().toLowerCase();
  const isPinned = isMagicTeaPartyPinned;
  const filteredSessions = useMemo(() => {
    if (!normalizedQuery) return sessions;
    return sessions.filter((session) => {
      const parts: string[] = [];
      if (session.title) parts.push(session.title);
      if (session.branchLabel) parts.push(session.branchLabel);
      if (session.scenario?.title) parts.push(session.scenario.title);
      (session.auxScenarios ?? []).forEach((item) => item?.title && parts.push(item.title));
      (session.roles ?? []).forEach((role) => role?.name && parts.push(role.name));
      return parts.join(' ').toLowerCase().includes(normalizedQuery);
    });
  }, [normalizedQuery, sessions]);

  const pinnedSessionsAll = useMemo(() => sessions.filter((session) => isPinned(session)), [sessions]);
  const pinnedSessions = useMemo(() => filteredSessions.filter((session) => isPinned(session)), [filteredSessions]);
  const regularSessions = useMemo(() => filteredSessions.filter((session) => !isPinned(session)), [filteredSessions]);
  const totalPages = Math.max(1, Math.ceil(regularSessions.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageSessions = regularSessions.slice(pageStart, pageStart + pageSize);
  const allowPinReorder = !busy && Boolean(onReorderPinnedSessions) && normalizedQuery.length === 0 && pinnedSessionsAll.length > 1;

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleDragStart = (sessionId: string) => (event: DragEvent<HTMLDivElement>) => {
    if (!allowPinReorder) return;
    setDraggingSessionId(sessionId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sessionId);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!allowPinReorder) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (targetSessionId: string) => (event: DragEvent<HTMLDivElement>) => {
    if (!allowPinReorder) return;
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/plain') || draggingSessionId;
    if (!sourceId || sourceId === targetSessionId) return;
    const ids = pinnedSessionsAll.map((session) => session.id);
    const fromIndex = ids.indexOf(sourceId);
    const toIndex = ids.indexOf(targetSessionId);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextIds = [...ids];
    nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, sourceId);
    onReorderPinnedSessions?.(nextIds);
    setDraggingSessionId(null);
  };

  const handleDragEnd = () => {
    setDraggingSessionId(null);
  };

  return (
      <div className="rounded-xl border border-pink-100 bg-white p-4">
      <fieldset disabled={busy} className="contents">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-800">会话列表</div>
          <button
            type="button"
            className="rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-700"
            onClick={() => { if (!busy) onCreateSession(); }}
          >
            新建
          </button>
        </div>
        <div className="mt-3 grid gap-2">
          <label htmlFor={`${controlId}-search`} className="sr-only">{searchLabel}</label>
          <input
            id={`${controlId}-search`}
            type="text"
            className="input-field !h-9 !px-2 text-xs"
            placeholder={searchLabel}
            value={searchText}
            onChange={(event) => {
              onSelectionViewChange?.();
              setSearchText(event.target.value);
              setPage(1);
            }}
          />
          <div className="flex items-center justify-between text-[11px] text-gray-500">
            <span>
              {listScope === 'loaded' ? '已加载' : '共'} {filteredSessions.length} 个会话 · 置顶 {pinnedSessions.length} · 第 {currentPage} / {totalPages} 页
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor={`${controlId}-page-size`}>每页</label>
              <select
                id={`${controlId}-page-size`}
                className="input-field !h-7 !py-0 !px-2 text-[11px]"
                value={String(pageSize)}
                onChange={(event) => {
                  onSelectionViewChange?.();
                  const next = Number(event.target.value);
                  setPageSize(Number.isFinite(next) ? Math.max(5, Math.min(50, Math.floor(next))) : 10);
                  setPage(1);
                }}
              >
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
            </div>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {pinnedSessions.length > 0 ? (
            <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-2">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-xs font-semibold text-amber-800"
                onClick={() => onPinnedCollapsedChange(!pinnedCollapsed)}
              >
                <span>置顶会话（{pinnedSessions.length}）</span>
                <span className="text-[11px] text-amber-600">{pinnedCollapsed ? '展开' : '收起'}</span>
              </button>
              {!pinnedCollapsed ? (
                <div className="mt-2 space-y-2">
                  {pinnedSessions.map((session) => (
                    <div
                      key={`pinned-${session.id}`}
                      className={`rounded-lg border px-3 py-2 transition-colors ${
                        session.id === activeSessionId
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-amber-100 bg-white hover:bg-amber-50/60'
                      } ${allowPinReorder ? 'cursor-move' : ''}`}
                      draggable={allowPinReorder}
                      onDragStart={handleDragStart(session.id)}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop(session.id)}
                      onDragEnd={handleDragEnd}
                      title={allowPinReorder ? '拖拽调整置顶顺序' : undefined}
                    >
                      {onSelectionChange ? <label className="mb-2 flex items-center gap-2 text-xs text-gray-600">
                        <input type="checkbox" aria-label={`选择清理 ${session.title}`} checked={selectedSessionIds.includes(session.id)}
                          disabled={busy || isPinned(session) || session.id === activeSessionId}
                          onChange={event => { if (!busy && !isPinned(session) && session.id !== activeSessionId) onSelectionChange(event.target.checked
                            ? [...selectedSessionIds.filter(id => id !== session.id), session.id] : selectedSessionIds.filter(id => id !== session.id)); }} />
                        {isPinned(session) || session.id === activeSessionId ? '保护中，不参与批量清理' : '选择清理'}
                      </label> : null}
                      <button type="button" className="block w-full text-left" onClick={() => { if (!busy) onSelectSession(session.id); }}>
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold text-gray-800 line-clamp-1">{session.title}</div>
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            置顶
                          </span>
                          {allowPinReorder ? (
                            <span className="text-[10px] text-amber-600">拖拽排序</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">{new Date(session.updatedAt).toLocaleString()}</div>
                        {session.forkedFrom ? (
                          <div className="mt-1 text-[11px] text-pink-600">
                            分支 · {session.branchLabel || '从历史分支'}
                          </div>
                        ) : null}
                      </button>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        {(onReturnToParent || onMergeSession) && session.id === activeSessionId && session.forkedFrom?.sessionId && sessionMap.has(session.forkedFrom.sessionId) ? (
                          <div className="flex items-center gap-2">
                            {onReturnToParent ? (
<button
                              type="button"
                              className="text-xs text-pink-600 hover:underline"
                              onClick={() => { if (!busy) onReturnToParent?.(session.forkedFrom?.sessionId as string); }}
                            >
                              返回原会话
                            </button>
) : null}
                            {onMergeSession ? (
<button
                              type="button"
                              className="text-xs text-amber-700 hover:underline"
                              onClick={() => { if (!busy) onMergeSession?.(session.id); }}
                            >
                              合并到原会话
                            </button>
) : null}
                          </div>
                        ) : (
                          <span />
                        )}
                        <div className="flex items-center gap-3">
                          {onToggleSessionPin ? (
<button
                            type="button"
                            className="text-xs text-amber-700 hover:underline"
                            onClick={() => { if (!busy) onToggleSessionPin?.(session.id); }}
                          >
                            取消置顶
                          </button>
) : null}
                          <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => { if (!busy) onDeleteSession(session.id); }}>
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {pageSessions.length === 0 && pinnedSessions.length === 0 ? (
            <div className="text-sm text-gray-500">{sessions.length === 0 ? '还没有会话，先新建一个吧。' : '未找到匹配会话。'}</div>
          ) : (
            <div className="rounded-lg border border-pink-100 bg-pink-50/30 p-2">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-xs font-semibold text-pink-800"
                onClick={() => onRecentCollapsedChange(!recentCollapsed)}
              >
                <span>最近会话（{regularSessions.length}）</span>
                <span className="text-[11px] text-pink-600">{recentCollapsed ? '展开' : '收起'}</span>
              </button>
              {!recentCollapsed ? (
                <div className="mt-2 space-y-2">
                  {pageSessions.map((session) => (
                    <div
                      key={session.id}
                      className={`rounded-lg border px-3 py-2 transition-colors ${
                        session.id === activeSessionId
                          ? 'border-pink-300 bg-pink-50'
                          : 'border-pink-100 bg-white hover:bg-pink-50/50'
                      }`}
                    >
                      {onSelectionChange ? <label className="mb-2 flex items-center gap-2 text-xs text-gray-600">
                        <input type="checkbox" aria-label={`选择清理 ${session.title}`} checked={selectedSessionIds.includes(session.id)}
                          disabled={busy || isPinned(session) || session.id === activeSessionId}
                          onChange={event => { if (!busy && !isPinned(session) && session.id !== activeSessionId) onSelectionChange(event.target.checked
                            ? [...selectedSessionIds.filter(id => id !== session.id), session.id] : selectedSessionIds.filter(id => id !== session.id)); }} />
                        {isPinned(session) || session.id === activeSessionId ? '保护中，不参与批量清理' : '选择清理'}
                      </label> : null}
                      <button type="button" className="block w-full text-left" onClick={() => { if (!busy) onSelectSession(session.id); }}>
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold text-gray-800 line-clamp-1">{session.title}</div>
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">{new Date(session.updatedAt).toLocaleString()}</div>
                        {session.forkedFrom ? (
                          <div className="mt-1 text-[11px] text-pink-600">
                            分支 · {session.branchLabel || '从历史分支'}
                          </div>
                        ) : null}
                      </button>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        {(onReturnToParent || onMergeSession) && session.id === activeSessionId && session.forkedFrom?.sessionId && sessionMap.has(session.forkedFrom.sessionId) ? (
                          <div className="flex items-center gap-2">
                            {onReturnToParent ? (
<button
                              type="button"
                              className="text-xs text-pink-600 hover:underline"
                              onClick={() => { if (!busy) onReturnToParent?.(session.forkedFrom?.sessionId as string); }}
                            >
                              返回原会话
                            </button>
) : null}
                            {onMergeSession ? (
<button
                              type="button"
                              className="text-xs text-amber-700 hover:underline"
                              onClick={() => { if (!busy) onMergeSession?.(session.id); }}
                            >
                              合并到原会话
                            </button>
) : null}
                          </div>
                        ) : (
                          <span />
                        )}
                        <div className="flex items-center gap-3">
                          {onToggleSessionPin ? (
<button
                            type="button"
                            className="text-xs text-amber-700 hover:underline"
                            onClick={() => { if (!busy) onToggleSessionPin?.(session.id); }}
                          >
                            置顶
                          </button>
) : null}
                          <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => { if (!busy) onDeleteSession(session.id); }}>
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
          <button
            type="button"
            className="rounded-md border border-gray-200 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => { onSelectionViewChange?.(); setPage((prev) => Math.max(1, prev - 1)); }}
            disabled={currentPage <= 1}
          >
            上一页
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-200 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => { onSelectionViewChange?.(); setPage((prev) => Math.min(totalPages, prev + 1)); }}
            disabled={currentPage >= totalPages}
          >
            下一页
          </button>
          <PageJump currentPage={currentPage} totalPages={totalPages} disabled={busy}
            onPageChange={next => { onSelectionViewChange?.(); setPage(next); }} />
        </div>
      </fieldset>
        {children}
        {pagination}
      </div>
  );
}
