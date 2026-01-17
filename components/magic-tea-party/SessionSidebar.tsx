import { useEffect, useMemo, useState, type DragEvent } from 'react';

import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import { MagicTeaPartyBranchChainModal } from '@/components/magic-tea-party/BranchChainModal';
import { MagicTeaPartySessionCleanupPanel } from '@/components/magic-tea-party/SessionCleanupPanel';
import { MagicTeaPartyGlobalSettingsPanel } from '@/components/magic-tea-party/GlobalSettingsPanel';
import { MagicTeaPartyImportExportPanel } from '@/components/magic-tea-party/ImportExportPanel';

import { MAGIC_TEA_PARTY_PRESETS, type MagicTeaPartyPresetId } from '@/lib/magic-tea-party/presets';
import type {
  MagicTeaPartyChoiceCount,
  MagicTeaPartyOutputPlan,
  MagicTeaPartyOutputPlanMode,
  MagicTeaPartyPreferences,
  MagicTeaPartySession,
} from '@/lib/magic-tea-party/types';

type MagicTeaPartySidebarProps = {
  sessions: MagicTeaPartySession[];
  activeSessionId: string | null;
  activeSession: MagicTeaPartySession | null;
  preferences: MagicTeaPartyPreferences;
  onCreateSession: (presetId?: MagicTeaPartyPresetId | null) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onToggleSessionPin: (sessionId: string) => void;
  onReorderPinnedSessions: (orderedIds: string[]) => void;
  onSessionImported: (sessionId: string) => void;
  onPresetSelected: (presetId: MagicTeaPartyPresetId) => void;
  onProviderConfigChange: (config: UserAIProviderConfig | null) => void;
  onPreferenceChange: (patch: Partial<MagicTeaPartyPreferences>) => void;
  onSessionSettingChange: (patch: Partial<MagicTeaPartySession['settings']>) => void;
  onMergeSession: (sessionId?: string | null) => void;
  onCleanupSessions: (sessionIds: string[]) => Promise<void>;
};

const CHOICE_COUNT_MIN = 2;
const CHOICE_COUNT_MAX = 16;
const clampChoiceCount = (value: number, fallback: MagicTeaPartyChoiceCount): MagicTeaPartyChoiceCount => {
  if (!Number.isFinite(value)) return fallback;
  const clamped = Math.max(CHOICE_COUNT_MIN, Math.min(CHOICE_COUNT_MAX, Math.floor(value)));
  return clamped as MagicTeaPartyChoiceCount;
};

export function MagicTeaPartySessionSidebar(props: MagicTeaPartySidebarProps) {
  const {
    sessions,
    activeSessionId,
    activeSession,
    preferences,
    onCreateSession,
    onSelectSession,
    onDeleteSession,
    onToggleSessionPin,
    onReorderPinnedSessions,
    onSessionImported,
    onPresetSelected,
    onProviderConfigChange,
    onPreferenceChange,
    onSessionSettingChange,
    onMergeSession,
    onCleanupSessions,
  } = props;
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  const sidebarPrefKey = 'magic-tea-party:session-sidebar-v1';

  const currentUserDisplayName = activeSession?.settings.userDisplayName ?? preferences.userDisplayName;
  const currentOutputFormat = activeSession?.settings.outputFormat ?? preferences.outputFormat;
  const currentOutputPlan = activeSession?.settings.outputPlan ?? preferences.outputPlan;
  const currentLanguage = activeSession?.settings.language ?? preferences.language;
  const currentEnableChoices = activeSession?.settings.enableChoices ?? preferences.enableChoices;
  const currentChoiceCount = activeSession?.settings.choiceCount ?? preferences.choiceCount;
  const choiceCountValue = clampChoiceCount(currentChoiceCount, preferences.choiceCount);
  const selectedPresetId = activeSession ? activeSession.settings.presetId : preferences.lastPresetId;
  const readArenaHistory = activeSession?.settings.readArenaHistory ?? preferences.readArenaHistory;
  const readArenaHistoryLimit = activeSession?.settings.readArenaHistoryLimit ?? preferences.readArenaHistoryLimit;
  const isArenaHistoryUnlimited = activeSession?.settings.isArenaHistoryUnlimited ?? preferences.isArenaHistoryUnlimited;
  const readCurrentState = activeSession?.settings.readCurrentState ?? preferences.readCurrentState;
  const writeArenaHistory = activeSession?.settings.writeArenaHistory ?? preferences.writeArenaHistory;
  const writeCurrentState = activeSession?.settings.writeCurrentState ?? preferences.writeCurrentState;
  const updateApplyMode = activeSession?.settings.updateApplyMode ?? preferences.updateApplyMode;
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const branchChain: MagicTeaPartySession[] = [];
  if (activeSession?.forkedFrom?.sessionId) {
    let cursor: MagicTeaPartySession | undefined = activeSession;
    while (cursor?.forkedFrom?.sessionId) {
      const parent = sessionMap.get(cursor.forkedFrom.sessionId);
      if (!parent) break;
      branchChain.push(parent);
      cursor = parent;
    }
  }
  const branchTrail = branchChain.slice().reverse();
  const hasParent = Boolean(activeSession?.forkedFrom?.sessionId);
  const hasChildren = sessions.some((session) => session.forkedFrom?.sessionId === activeSession?.id);
  const activeTitle = activeSession?.title ?? '当前会话';

  const normalizedQuery = searchText.trim().toLowerCase();
  const isPinned = (session: MagicTeaPartySession) =>
    typeof session.pinnedAt === 'number' && Number.isFinite(session.pinnedAt) && session.pinnedAt > 0;
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
  const allowPinReorder = normalizedQuery.length === 0 && pinnedSessionsAll.length > 1;

  const handleChoiceCountChange = (nextValue: number) => {
    const choiceCount = clampChoiceCount(nextValue, choiceCountValue);
    onPreferenceChange({ choiceCount });
    onSessionSettingChange({ choiceCount });
  };

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(sidebarPrefKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { pinnedCollapsed?: boolean; recentCollapsed?: boolean };
      if (typeof parsed.pinnedCollapsed === 'boolean') setPinnedCollapsed(parsed.pinnedCollapsed);
      if (typeof parsed.recentCollapsed === 'boolean') setRecentCollapsed(parsed.recentCollapsed);
    } catch {
      // ignore
    }
  }, [sidebarPrefKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        sidebarPrefKey,
        JSON.stringify({ pinnedCollapsed, recentCollapsed })
      );
    } catch {
      // ignore
    }
  }, [pinnedCollapsed, recentCollapsed, sidebarPrefKey]);

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
    onReorderPinnedSessions(nextIds);
    setDraggingSessionId(null);
  };

  const handleDragEnd = () => {
    setDraggingSessionId(null);
  };

  return (
    <aside className="space-y-4 min-w-0">
      <div className="rounded-xl border border-pink-100 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-800">会话列表</div>
          <button
            type="button"
            className="rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-700"
            onClick={() => onCreateSession(preferences.lastPresetId as MagicTeaPartyPresetId)}
          >
            新建
          </button>
        </div>
        <div className="mt-3 grid gap-2">
          <input
            type="text"
            className="input-field !h-9 !px-2 text-xs"
            placeholder="搜索会话标题 / 角色 / 情景"
            value={searchText}
            onChange={(event) => {
              setSearchText(event.target.value);
              setPage(1);
            }}
          />
          <div className="flex items-center justify-between text-[11px] text-gray-500">
            <span>
              共 {filteredSessions.length} 个会话 · 置顶 {pinnedSessions.length} · 第 {currentPage} / {totalPages} 页
            </span>
            <div className="flex items-center gap-2">
              <span>每页</span>
              <select
                className="input-field !h-7 !py-0 !px-2 text-[11px]"
                value={String(pageSize)}
                onChange={(event) => {
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
                onClick={() => setPinnedCollapsed((prev) => !prev)}
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
                      <button type="button" className="block w-full text-left" onClick={() => onSelectSession(session.id)}>
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
                        {session.id === activeSessionId && session.forkedFrom?.sessionId && sessionMap.has(session.forkedFrom.sessionId) ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="text-xs text-pink-600 hover:underline"
                              onClick={() => onSelectSession(session.forkedFrom?.sessionId as string)}
                            >
                              返回原会话
                            </button>
                            <button
                              type="button"
                              className="text-xs text-amber-700 hover:underline"
                              onClick={() => onMergeSession(session.id)}
                            >
                              合并到原会话
                            </button>
                          </div>
                        ) : (
                          <span />
                        )}
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            className="text-xs text-amber-700 hover:underline"
                            onClick={() => onToggleSessionPin(session.id)}
                          >
                            取消置顶
                          </button>
                          <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onDeleteSession(session.id)}>
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
                onClick={() => setRecentCollapsed((prev) => !prev)}
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
                      <button type="button" className="block w-full text-left" onClick={() => onSelectSession(session.id)}>
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
                        {session.id === activeSessionId && session.forkedFrom?.sessionId && sessionMap.has(session.forkedFrom.sessionId) ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="text-xs text-pink-600 hover:underline"
                              onClick={() => onSelectSession(session.forkedFrom?.sessionId as string)}
                            >
                              返回原会话
                            </button>
                            <button
                              type="button"
                              className="text-xs text-amber-700 hover:underline"
                              onClick={() => onMergeSession(session.id)}
                            >
                              合并到原会话
                            </button>
                          </div>
                        ) : (
                          <span />
                        )}
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            className="text-xs text-amber-700 hover:underline"
                            onClick={() => onToggleSessionPin(session.id)}
                          >
                            置顶
                          </button>
                          <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onDeleteSession(session.id)}>
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
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-gray-600">
          <button
            type="button"
            className="rounded-md border border-gray-200 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage <= 1}
          >
            上一页
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-200 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage >= totalPages}
          >
            下一页
          </button>
        </div>
        {hasParent && branchTrail.length > 0 ? (
          <div className="mt-3 rounded-lg border border-pink-100 bg-pink-50/60 px-3 py-2 text-xs text-gray-600">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-pink-800">
              <span>分支链</span>
              <button
                type="button"
                className="text-[11px] text-pink-700 hover:underline"
                onClick={() => setShowBranchModal(true)}
              >
                查看全部
              </button>
            </div>
            <div className="mt-1 space-y-1">
              {branchTrail.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="block text-left text-xs text-gray-600 hover:underline"
                  onClick={() => onSelectSession(session.id)}
                >
                  {session.title}
                </button>
              ))}
              <div className="text-xs text-pink-700">当前：{activeTitle}</div>
            </div>
          </div>
        ) : null}

        {activeSession && !hasParent && hasChildren ? (
          <div className="mt-3 rounded-lg border border-pink-100 bg-pink-50/60 px-3 py-2 text-xs text-gray-600">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-pink-800">
              <span>分支链</span>
              <button
                type="button"
                className="text-[11px] text-pink-700 hover:underline"
                onClick={() => setShowBranchModal(true)}
              >
                查看全部
              </button>
            </div>
            <div className="mt-1 text-[11px] text-gray-600">当前会话已有子分支，可在弹窗中快速跳转。</div>
          </div>
        ) : null}

        {activeSession && hasParent && branchTrail.length === 0 ? (
          <div className="mt-3 rounded-lg border border-pink-100 bg-pink-50/60 px-3 py-2 text-xs text-gray-600">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-pink-800">
              <span>分支链</span>
              <button
                type="button"
                className="text-[11px] text-pink-700 hover:underline"
                onClick={() => setShowBranchModal(true)}
              >
                查看全部
              </button>
            </div>
            <div className="mt-1 text-[11px] text-gray-600">父会话已不存在，但仍可查看子分支列表。</div>
          </div>
        ) : null}
      </div>

      <MagicTeaPartyImportExportPanel activeSession={activeSession} preferences={preferences} onSessionImported={onSessionImported} />

      <div className="rounded-xl border border-pink-100 bg-white p-4">
        <div className="text-sm font-semibold text-gray-800">预设情景</div>
        <div className="mt-3 grid gap-2">
          {MAGIC_TEA_PARTY_PRESETS.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={isSelected}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                  isSelected
                    ? 'border-pink-300 bg-pink-50 text-pink-800'
                    : 'border-pink-200 bg-white hover:bg-pink-50'
                }`}
                onClick={() => onPresetSelected(preset.id)}
                title={isSelected ? '再次点击可取消预设' : '点击选择预设'}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-pink-800">{preset.title}</div>
                  {isSelected ? <span className="text-[10px] font-semibold text-pink-600">已选</span> : null}
                </div>
                <div className="mt-1 text-xs text-gray-600">{preset.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-pink-100 bg-white p-4">
        <AiProviderSelector
          onConfigChange={onProviderConfigChange}
          storageNamespace="magic-tea-party.customProvider"
          allowSystemProvider={false}
          label="自备 API Key（必填）"
        />
      </div>

      <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-800">输出偏好</div>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <label className="text-xs font-semibold text-gray-600">你的称呼（{'{{user}}'}）</label>
            <input
              className="input-field"
              value={currentUserDisplayName}
              onChange={(event) => {
                const value = event.target.value.trim().slice(0, 20) || '旅人';
                onPreferenceChange({ userDisplayName: value });
                onSessionSettingChange({ userDisplayName: value });
              }}
              placeholder="例如：旅人 / 记者 / 观众"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-xs font-semibold text-gray-600">输出模式</label>
            <select
              className="input-field"
              value={currentOutputFormat}
              onChange={(event) => {
                const value = event.target.value === 'markdown' ? 'markdown' : 'jsonl';
                onPreferenceChange({ outputFormat: value });
                onSessionSettingChange({ outputFormat: value });
              }}
            >
              <option value="jsonl">结构化 JSONL</option>
              <option value="markdown">Markdown 故事</option>
            </select>
          </div>

          <div className="rounded-lg border border-pink-100 bg-pink-50/60 px-3 py-2 text-xs text-gray-600">
            <div className="text-xs font-semibold text-gray-600">合并输出计划</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div className="grid gap-1">
                <label className="text-[11px] text-gray-600">选项</label>
                <select
                  className="input-field !h-8 !py-1 text-xs"
                  value={currentOutputPlan.choices}
                  onChange={(event) => {
                    const value = event.target.value as 'off' | 'auto' | 'on';
                    const outputPlan = { ...currentOutputPlan, choices: value };
                    const enableChoices = value !== 'off';
                    onPreferenceChange({ outputPlan, enableChoices });
                    onSessionSettingChange({ outputPlan, enableChoices });
                  }}
                  disabled={currentOutputFormat !== 'jsonl'}
                >
                  <option value="off">关闭</option>
                  <option value="auto">自动</option>
                  <option value="on">强制</option>
                </select>
              </div>
              <div className="grid gap-1">
                <label className="text-[11px] text-gray-600">摘要</label>
                <select
                  className="input-field !h-8 !py-1 text-xs"
                  value={currentOutputPlan.summary}
                  onChange={(event) => {
                    const value = event.target.value as 'off' | 'auto' | 'on';
                    const outputPlan = { ...currentOutputPlan, summary: value };
                    onPreferenceChange({ outputPlan });
                    onSessionSettingChange({ outputPlan });
                  }}
                  disabled={currentOutputFormat !== 'jsonl'}
                >
                  <option value="off">关闭</option>
                  <option value="auto">自动</option>
                  <option value="on">强制</option>
                </select>
              </div>
              <div className="grid gap-1">
                <label className="text-[11px] text-gray-600">更新草案</label>
                <select
                  className="input-field !h-8 !py-1 text-xs"
                  value={currentOutputPlan.updates}
                  onChange={(event) => {
                    const value = event.target.value as 'off' | 'auto' | 'on';
                    const outputPlan = { ...currentOutputPlan, updates: value };
                    onPreferenceChange({ outputPlan });
                    onSessionSettingChange({ outputPlan });
                  }}
                  disabled={currentOutputFormat !== 'jsonl'}
                >
                  <option value="off">关闭</option>
                  <option value="auto">自动</option>
                  <option value="on">强制</option>
                </select>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-gray-500">仅对 JSONL 生效，Markdown 模式会自动降级为关闭。</div>
          </div>

          <div className="grid gap-1">
            <label className="text-xs font-semibold text-gray-600">语言</label>
            <select
              className="input-field"
              value={currentLanguage}
              onChange={(event) => {
                const value = event.target.value as MagicTeaPartyPreferences['language'];
                onPreferenceChange({ language: value });
                onSessionSettingChange({ language: value });
              }}
            >
              <option value="zh-CN">中文</option>
              <option value="ja-JP">日本語</option>
              <option value="en-US">English</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-gray-600">启用选项</div>
              <div className="text-xs text-gray-500">仅对 JSONL 模式有效</div>
            </div>
            <input
              type="checkbox"
              checked={Boolean(currentEnableChoices)}
              onChange={(event) => {
                const enableChoices = Boolean(event.target.checked);
                const choices: MagicTeaPartyOutputPlanMode = enableChoices
                  ? (currentOutputPlan.choices === 'off' ? 'auto' : currentOutputPlan.choices)
                  : 'off';
                const outputPlan: MagicTeaPartyOutputPlan = { ...currentOutputPlan, choices };
                onPreferenceChange({ enableChoices, outputPlan });
                onSessionSettingChange({ enableChoices, outputPlan });
              }}
            />
          </div>

          <div className="grid gap-1">
            <label className="text-xs font-semibold text-gray-600">选项数量</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-8 w-8 rounded-md border border-pink-100 bg-white text-sm font-semibold text-gray-700 shadow-sm hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => handleChoiceCountChange(choiceCountValue - 1)}
                disabled={choiceCountValue <= CHOICE_COUNT_MIN}
                aria-label="减少选项数量"
              >
                -
              </button>
              <input
                type="range"
                min={CHOICE_COUNT_MIN}
                max={CHOICE_COUNT_MAX}
                step={1}
                value={choiceCountValue}
                onChange={(event) => handleChoiceCountChange(Number(event.target.value))}
                className="h-2 flex-1 cursor-pointer rounded-lg bg-pink-100 accent-pink-500"
                aria-label="选项数量滑块"
              />
              <button
                type="button"
                className="h-8 w-8 rounded-md border border-pink-100 bg-white text-sm font-semibold text-gray-700 shadow-sm hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => handleChoiceCountChange(choiceCountValue + 1)}
                disabled={choiceCountValue >= CHOICE_COUNT_MAX}
                aria-label="增加选项数量"
              >
                +
              </button>
              <input
                type="number"
                min={CHOICE_COUNT_MIN}
                max={CHOICE_COUNT_MAX}
                step={1}
                className="input-field !h-8 !w-16 !px-2 !py-1 text-center text-xs"
                value={String(choiceCountValue)}
                onChange={(event) => handleChoiceCountChange(Number(event.target.value))}
              />
            </div>
            <div className="text-[11px] text-gray-500">范围 2~16</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-800">资料读写</div>
        <div className="text-xs text-gray-500">茶会写入会移除签名并标记为非原生。</div>

        <div className="space-y-3">
          <div className="text-xs font-semibold text-gray-600">读取</div>
          <label className="flex items-center justify-between gap-3 text-xs text-gray-700">
            <span>读取历战记录</span>
            <input
              type="checkbox"
              checked={Boolean(readArenaHistory)}
              onChange={(event) => {
                const value = Boolean(event.target.checked);
                onPreferenceChange({ readArenaHistory: value });
                onSessionSettingChange({ readArenaHistory: value });
              }}
            />
          </label>

          {readArenaHistory ? (
            <div className="grid gap-2 rounded-lg border border-pink-100 bg-pink-50/60 px-3 py-2 text-xs text-gray-600">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-gray-600">读取条数</label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  className="input-field !h-8 !w-20 !px-2 !py-1 text-xs"
                  value={String(readArenaHistoryLimit || 3)}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    const limit = Number.isFinite(nextValue) ? Math.max(1, Math.min(999, Math.floor(nextValue))) : 3;
                    onPreferenceChange({ readArenaHistoryLimit: limit });
                    onSessionSettingChange({ readArenaHistoryLimit: limit });
                  }}
                  disabled={isArenaHistoryUnlimited}
                />
              </div>
              <label className="flex items-center justify-between gap-2">
                <span>不限条数</span>
                <input
                  type="checkbox"
                  checked={Boolean(isArenaHistoryUnlimited)}
                  onChange={(event) => {
                    const value = Boolean(event.target.checked);
                    onPreferenceChange({ isArenaHistoryUnlimited: value });
                    onSessionSettingChange({ isArenaHistoryUnlimited: value });
                  }}
                />
              </label>
            </div>
          ) : null}

          <label className="flex items-center justify-between gap-3 text-xs text-gray-700">
            <span>读取当前状态</span>
            <input
              type="checkbox"
              checked={Boolean(readCurrentState)}
              onChange={(event) => {
                const value = Boolean(event.target.checked);
                onPreferenceChange({ readCurrentState: value });
                onSessionSettingChange({ readCurrentState: value });
              }}
            />
          </label>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold text-gray-600">写入</div>
          <label className="flex items-center justify-between gap-3 text-xs text-gray-700">
            <span>写入历战记录</span>
            <input
              type="checkbox"
              checked={Boolean(writeArenaHistory)}
              onChange={(event) => {
                const value = Boolean(event.target.checked);
                onPreferenceChange({ writeArenaHistory: value });
                onSessionSettingChange({ writeArenaHistory: value });
              }}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-xs text-gray-700">
            <span>写入当前状态</span>
            <input
              type="checkbox"
              checked={Boolean(writeCurrentState)}
              onChange={(event) => {
                const value = Boolean(event.target.checked);
                onPreferenceChange({ writeCurrentState: value });
                onSessionSettingChange({ writeCurrentState: value });
              }}
            />
          </label>

          <div className="grid gap-1">
            <label className="text-xs font-semibold text-gray-600">写入策略</label>
            <select
              className="input-field"
              value={updateApplyMode}
              onChange={(event) => {
                const value = event.target.value as 'auto' | 'confirm' | 'draft';
                onPreferenceChange({ updateApplyMode: value });
                onSessionSettingChange({ updateApplyMode: value });
              }}
            >
              <option value="auto">自动写入</option>
              <option value="confirm">确认写入</option>
              <option value="draft">仅草案</option>
            </select>
            <div className="text-[11px] text-gray-500">自动写入会生成可回滚快照。</div>
          </div>
        </div>
      </div>

      <MagicTeaPartyGlobalSettingsPanel
        preferences={preferences}
        activeSession={activeSession}
        onPreferenceChange={onPreferenceChange}
        onSessionSettingChange={onSessionSettingChange}
      />

      <MagicTeaPartySessionCleanupPanel
        preferences={preferences}
        activeSessionId={activeSession?.id ?? null}
        onPreferenceChange={onPreferenceChange}
        onCleanupSessions={onCleanupSessions}
      />

      <MagicTeaPartyBranchChainModal
        isOpen={showBranchModal}
        sessions={sessions}
        activeSession={activeSession}
        onSelectSession={onSelectSession}
        onClose={() => setShowBranchModal(false)}
      />
    </aside>
  );
}
