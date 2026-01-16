import { useState } from 'react';

import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import { MagicTeaPartyBranchChainModal } from '@/components/magic-tea-party/BranchChainModal';
import { MagicTeaPartyGlobalSettingsPanel } from '@/components/magic-tea-party/GlobalSettingsPanel';
import { MagicTeaPartyImportExportPanel } from '@/components/magic-tea-party/ImportExportPanel';

import { MAGIC_TEA_PARTY_PRESETS, type MagicTeaPartyPresetId } from '@/lib/magic-tea-party/presets';
import type { MagicTeaPartyPreferences, MagicTeaPartySession } from '@/lib/magic-tea-party/types';

type MagicTeaPartySidebarProps = {
  sessions: MagicTeaPartySession[];
  activeSessionId: string | null;
  activeSession: MagicTeaPartySession | null;
  preferences: MagicTeaPartyPreferences;
  onCreateSession: (presetId?: MagicTeaPartyPresetId | null) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onSessionImported: (sessionId: string) => void;
  onPresetSelected: (presetId: MagicTeaPartyPresetId) => void;
  onProviderConfigChange: (config: UserAIProviderConfig | null) => void;
  onPreferenceChange: (patch: Partial<MagicTeaPartyPreferences>) => void;
  onSessionSettingChange: (patch: Partial<MagicTeaPartySession['settings']>) => void;
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
    onSessionImported,
    onPresetSelected,
    onProviderConfigChange,
    onPreferenceChange,
    onSessionSettingChange,
  } = props;
  const [showBranchModal, setShowBranchModal] = useState(false);

  const currentUserDisplayName = activeSession?.settings.userDisplayName ?? preferences.userDisplayName;
  const currentOutputFormat = activeSession?.settings.outputFormat ?? preferences.outputFormat;
  const currentLanguage = activeSession?.settings.language ?? preferences.language;
  const currentEnableChoices = activeSession?.settings.enableChoices ?? preferences.enableChoices;
  const currentChoiceCount = activeSession?.settings.choiceCount ?? preferences.choiceCount;
  const selectedPresetId = activeSession ? activeSession.settings.presetId : preferences.lastPresetId;
  const readArenaHistory = activeSession?.settings.readArenaHistory ?? preferences.readArenaHistory;
  const readArenaHistoryLimit = activeSession?.settings.readArenaHistoryLimit ?? preferences.readArenaHistoryLimit;
  const isArenaHistoryUnlimited = activeSession?.settings.isArenaHistoryUnlimited ?? preferences.isArenaHistoryUnlimited;
  const readCurrentState = activeSession?.settings.readCurrentState ?? preferences.readCurrentState;
  const writeArenaHistory = activeSession?.settings.writeArenaHistory ?? preferences.writeArenaHistory;
  const writeCurrentState = activeSession?.settings.writeCurrentState ?? preferences.writeCurrentState;
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
        <div className="mt-3 space-y-2">
          {sessions.length === 0 ? (
            <div className="text-sm text-gray-500">还没有会话，先新建一个吧。</div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`rounded-lg border px-3 py-2 transition-colors ${session.id === activeSessionId
                  ? 'border-pink-300 bg-pink-50'
                  : 'border-pink-100 bg-white hover:bg-pink-50/50'
                  }`}
              >
                <button type="button" className="block w-full text-left" onClick={() => onSelectSession(session.id)}>
                  <div className="text-sm font-semibold text-gray-800 line-clamp-1">{session.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{new Date(session.updatedAt).toLocaleString()}</div>
                  {session.forkedFrom ? (
                    <div className="mt-1 text-[11px] text-pink-600">
                      分支 · {session.branchLabel || '从历史分支'}
                    </div>
                  ) : null}
                </button>
                <div className="mt-2 flex justify-between gap-2">
                  {session.id === activeSessionId && session.forkedFrom?.sessionId && sessionMap.has(session.forkedFrom.sessionId) ? (
                    <button
                      type="button"
                      className="text-xs text-pink-600 hover:underline"
                      onClick={() => onSelectSession(session.forkedFrom?.sessionId as string)}
                    >
                      返回原会话
                    </button>
                  ) : (
                    <span />
                  )}
                  <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onDeleteSession(session.id)}>
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
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
                onPreferenceChange({ enableChoices });
                onSessionSettingChange({ enableChoices });
              }}
            />
          </div>

          <div className="grid gap-1">
            <label className="text-xs font-semibold text-gray-600">选项数量</label>
            <select
              className="input-field"
              value={String(currentChoiceCount)}
              onChange={(event) => {
                const value = Number(event.target.value);
                const choiceCount = (value === 2 || value === 4) ? (value as 2 | 4) : 3;
                onPreferenceChange({ choiceCount });
                onSessionSettingChange({ choiceCount });
              }}
            >
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </select>
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
        </div>
      </div>

      <MagicTeaPartyGlobalSettingsPanel
        preferences={preferences}
        activeSession={activeSession}
        onPreferenceChange={onPreferenceChange}
        onSessionSettingChange={onSessionSettingChange}
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
