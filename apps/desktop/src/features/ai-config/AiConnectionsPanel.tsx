import { DesktopAiProviderPanel } from './desktop-ai-provider-panel';
// 产品化 AI 连接面板（D5.0b，取代 D1 的 ProviderProfilesPanel 调试面板）。
//
// 布局分四块：执行位置（客户端｜服务器）、当前连接与高级生成设置、项目预设
// （隐藏/恢复/复制为自定义连接）、自定义连接 CRUD。凭据只写 OS 凭据存储，
// UI 只展示「是否存在」，永远读不回明文。

import { useMemo, useState } from 'react';

import {
  describeAiDirectUnsupportedReason,
} from '@mahoshojo/ui-web/ai-provider';
import { type DirectProviderProfileV1 } from '@mahoshojo/contracts/provider-profile';

import { PROVIDER_PRESETS, type ProfileDraft } from '../providers/profile-draft';

import {
  DESKTOP_EDITABLE_PROFILE_ADAPTERS,
  describeDesktopPresetModelSupport,
  listDesktopPresetEntries,
  type DesktopPresetEntry,
  type DesktopSecretPresence,
} from './desktop-ai-config';
import { useDesktopAiConfig, type UseDesktopAiConfigResult } from './use-desktop-ai-config';
import {
  ConnectionEditor,
  draftFromProfile,
  newConnectionId,
  saveConnectionDraft,
  type EditingState,
} from './connection-editor';

/** DESK-ONLINE-004：区分未配置、缺失、已配置与存储失败；未知不猜成「未配置」。 */
export const secretStatusLabel = (
  status: DesktopSecretPresence | undefined,
  hasKeyRef: boolean,
): string => {
  switch (status ?? 'unknown') {
    case 'present':
      return '已存凭据';
    case 'error':
      return '凭据存储读取失败';
    case 'absent':
      return hasKeyRef ? '凭据缺失' : '未配置凭据';
    default:
      return '凭据状态未知';
  }
};

const ConnectionRow = ({
  profile,
  referenced,
  secretStatus,
  onSelect,
  onEdit,
  onDelete,
}: {
  profile: DirectProviderProfileV1;
  /** 该 Profile 是否为记忆里选中的客户端连接（与当前执行位置无关）。 */
  referenced: boolean;
  secretStatus: DesktopSecretPresence | undefined;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) => {
  const [confirming, setConfirming] = useState(false);
  // 编辑器 capability 独立于执行 capability：简化编辑器只表达
  // openai-compatible，其他 adapter 的旧 Profile 只读展示，避免保存时把
  // adapter 静默改写（DESK-ONLINE-003/004）。
  const editable = DESKTOP_EDITABLE_PROFILE_ADAPTERS.has(profile.adapter);
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-(--app-border) p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="battle-lite-strong-text font-semibold">{profile.name}</span>
        {referenced && (
          <span className="battle-lite-info-pill rounded px-1.5 py-0.5 text-xs">当前客户端连接</span>
        )}
        <span className="battle-lite-subtle-text ml-auto text-xs">
          {secretStatusLabel(secretStatus, profile.apiKeyRef !== undefined)}
        </span>
      </div>
      <p className="battle-lite-muted-text break-all font-mono text-xs">
        {profile.baseUrl} · 默认模型 {profile.modelId} · {profile.adapter}
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        {!referenced && (
          <button type="button" className="battle-lite-link underline" onClick={onSelect}>
            设为当前
          </button>
        )}
        {editable ? (
          <button type="button" className="battle-lite-link underline" onClick={onEdit}>
            编辑
          </button>
        ) : (
          <span className="battle-lite-subtle-text">
            当前版本尚未提供该协议的配置编辑器
          </span>
        )}
        {confirming ? (
          <>
            {referenced && (
              <p className="battle-lite-subtle-text basis-full text-xs">
                此连接是当前保存的客户端连接，删除后客户端连接将变为「未选择」，不会自动切换其他供应商。
              </p>
            )}
            <button
              type="button"
              className="text-(--app-accent-strong) underline"
              onClick={onDelete}
            >
              确认删除（连同已存凭据）
            </button>
            <button
              type="button"
              className="battle-lite-link underline"
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            className="battle-lite-link underline"
            onClick={() => setConfirming(true)}
          >
            删除
          </button>
        )}
      </div>
    </li>
  );
};

const PresetRow = ({
  entry,
  onCopy,
  onHide,
}: {
  entry: DesktopPresetEntry;
  onCopy: (entry: DesktopPresetEntry, modelId: string) => void;
  onHide: (presetId: string) => void;
}) => {
  const [modelId, setModelId] = useState(entry.directCapableModels[0]?.value ?? '');
  const capable = entry.directCapableModels.length > 0;
  const modelSupport = capable
    ? describeDesktopPresetModelSupport(entry.preset, modelId)
    : entry.presetSupport;

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-(--app-border) p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="battle-lite-strong-text font-semibold">{entry.preset.name}</span>
        <button
          type="button"
          className="battle-lite-subtle-text ml-auto text-xs underline"
          onClick={() => onHide(entry.preset.id)}
        >
          隐藏
        </button>
      </div>
      <p className="battle-lite-muted-text text-xs">{entry.preset.description}</p>
      {capable ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label={`${entry.preset.name} 直连模型`}
            className="max-w-xs rounded-lg border border-(--app-border-strong) bg-(--app-surface-strong) px-2 py-1 text-xs text-(--app-text)"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          >
            {entry.directCapableModels.map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>
          {modelSupport.supported ? (
            <button
              type="button"
              className="rounded-lg border border-(--app-border-strong) px-2 py-1"
              onClick={() => onCopy(entry, modelId)}
            >
              复制为自定义连接
            </button>
          ) : (
            <span className="battle-lite-subtle-text">
              {describeAiDirectUnsupportedReason(modelSupport.reason)}
            </span>
          )}
        </div>
      ) : (
        <p className="battle-lite-subtle-text text-xs">
          {entry.presetSupport.supported
            ? '该端点暂无可直连的收录模型'
            : describeAiDirectUnsupportedReason(entry.presetSupport.reason)}
        </p>
      )}
    </li>
  );
};

const newDraftFromPreset = (entry: DesktopPresetEntry, modelId: string): ProfileDraft | null => {
  const support = describeDesktopPresetModelSupport(entry.preset, modelId);
  if (!support.supported) return null;
  return {
    id: newConnectionId(),
    name: `${entry.preset.name}`,
    baseUrl: entry.preset.baseUrl,
    modelId,
  };
};

const ConnectionsPanelBody = ({ aiConfig }: { aiConfig: UseDesktopAiConfigResult }) => {
  const { state, store } = aiConfig;
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // DESK-AIP-003.7：编辑器存在未保存修改（含易失 Key 输入）时，另选编辑
  // 对象须显式确认放弃；取消键在编辑器内已有同款确认。
  const confirmDiscardEditing = () =>
    !editorDirty ||
    typeof window === 'undefined' ||
    window.confirm('连接配置有未保存的更改（包括已输入的 API Key），确认放弃？');
  const beginEditing = (next: EditingState) => {
    if (editing !== null && !confirmDiscardEditing()) return;
    setEditing(next);
  };

  const presetEntries = useMemo(
    () => listDesktopPresetEntries(state.hiddenPresetIds),
    [state.hiddenPresetIds],
  );
  const visiblePresets = presetEntries.filter((entry) => !entry.hidden);
  const hiddenPresets = presetEntries.filter((entry) => entry.hidden);

  const startCopyPreset = (entry: DesktopPresetEntry, modelId: string) => {
    const draft = newDraftFromPreset(entry, modelId);
    if (!draft) return;
    beginEditing({ draft, presetModels: entry.directCapableModels, isExisting: false, hasKeyRef: false });
  };

  const startNewConnection = (baseUrl = '') => {
    beginEditing({
      draft: { id: newConnectionId(), name: '', baseUrl, modelId: '' },
      presetModels: null,
      isExisting: false,
      hasKeyRef: false,
    });
  };

  const saveEditing = async (draft: ProfileDraft) => {
    // 连接本体可能已落盘、只是激活/列表刷新失败：如实呈现 saved-not-activated
    // （DESK-AIP-003.5），重试沿用同一 draft.id，不产生第二条 Profile。
    await saveConnectionDraft(store, draft);
    setEditing(null);
  };

  const deleteConnection = async (profileId: string) => {
    setDeleteError(null);
    try {
      await store.deleteConnection(profileId);
      setEditing((current) => current?.draft.id === profileId ? null : current);
    } catch (cause) {
      setDeleteError(`连接删除未完成：${cause instanceof Error ? cause.message : '本地存储操作失败，请重试'}`);
    }
  };

  const blockedOverlay = state.overlayState === 'blocked' || state.generationActive || state.savingCredential || state.deletingConnection;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
      {deleteError && <p role="alert" className="text-sm text-(--app-accent-strong)">{deleteError}</p>}
      {state.deletingConnection && <p role="status" className="text-sm">正在删除连接及其凭据…</p>}
      <fieldset disabled={state.generationActive || state.savingCredential || state.savingConnection || state.deletingConnection} className="contents">
      <header className="flex flex-col gap-1">
        <h2 className="battle-lite-strong-text text-sm font-medium">AI 连接</h2>
        <p className="battle-lite-muted-text text-xs">
          客户端直接连接你配置的模型服务；API Key 只写入操作系统凭据存储，本页只能看到是否已配置。
        </p>
      </header>

      {state.overlayState === 'blocked' && (
        <div role="alert" className="rounded-lg border border-(--app-accent-strong) p-3 text-sm">
          <p>已保存的 AI 配置无法解析，已阻止写入以保护原数据：{state.overlayError}</p>
          <button
            type="button"
            className="mt-2 rounded border border-(--app-border-strong) px-3 py-1 text-xs"
            onClick={() => store.resetBlockedOverlay()}
          >
            清除并重置 AI 配置
          </button>
        </div>
      )}

      <DesktopAiProviderPanel management generationMode="non-stream" copy={{ serverOutput: { stream: '', nonStream: '' }, emptyProfilesHint: '', serverFootnote: '', payloadNoun: '' }} />

      <div className="flex flex-col gap-2 border-t border-(--app-border) pt-3">
        <h3 className="battle-lite-muted-text text-xs font-semibold">预设供应商</h3>
        <ul className="flex flex-col gap-2">
          {visiblePresets.map((entry) => (
            <PresetRow
              key={entry.preset.id}
              entry={entry}
              onCopy={startCopyPreset}
              onHide={(presetId) => store.hidePreset(presetId)}
            />
          ))}
        </ul>
        {hiddenPresets.length > 0 && (
          <div className="text-xs">
            <button
              type="button"
              className="battle-lite-subtle-text underline"
              onClick={() => setShowHidden((prev) => !prev)}
            >
              已隐藏 {hiddenPresets.length} 个预设{showHidden ? '（收起）' : '（展开）'}
            </button>
            {showHidden && (
              <ul className="mt-1 flex flex-col gap-1">
                {hiddenPresets.map((entry) => (
                  <li key={entry.preset.id} className="flex items-center gap-2">
                    <span className="battle-lite-muted-text">{entry.preset.name}</span>
                    <button
                      type="button"
                      className="battle-lite-link underline"
                      onClick={() => store.unhidePreset(entry.preset.id)}
                    >
                      恢复
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="battle-lite-link underline"
                    onClick={() => store.restoreAllPresets()}
                  >
                    全部恢复
                  </button>
                </li>
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-(--app-border) pt-3">
        <h3 className="battle-lite-muted-text text-xs font-semibold">自定义连接</h3>
        {state.profiles.length === 0 && state.profilesState === 'ready' && (
          <p className="battle-lite-subtle-text text-xs">尚未配置任何连接。</p>
        )}
        <ul className="flex flex-col gap-2">
          {state.profiles.map((profile) => (
            <ConnectionRow
              key={profile.id}
              profile={profile}
              referenced={state.selection.clientConnectionId === profile.id}
              secretStatus={state.secretStatus[profile.id]}
              onSelect={() => {
                // 「设为当前」明确含义是立即用它执行：执行位置、连接与模型
                // 作为同一次受检 overlay 更新原子落盘（DESK-AIP-003.3）。
                store.activateConnection(profile.id);
              }}
              onEdit={() =>
                beginEditing({
                  draft: draftFromProfile(profile),
                  presetModels: null,
                  isExisting: true,
                  hasKeyRef: profile.apiKeyRef !== undefined,
                })
              }
              onDelete={() => void deleteConnection(profile.id)}
            />
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-(--app-border-strong) px-3 py-1.5 text-xs"
            disabled={blockedOverlay}
            onClick={() => startNewConnection()}
          >
            新增自定义连接
          </button>
          {PROVIDER_PRESETS.map((template) => (
            <button
              key={template.name}
              type="button"
              className="battle-lite-subtle-text rounded-lg border border-(--app-border) px-3 py-1.5 text-xs"
              disabled={blockedOverlay}
              onClick={() => {
                startNewConnection(template.baseUrl);
                setEditing((current) =>
                  current ? { ...current, draft: { ...current.draft, name: template.name } } : current,
                );
              }}
            >
              套用 {template.name}
            </button>
          ))}
        </div>
      </div>

      {editing && (
        <ConnectionEditor
          editing={editing}
          existingSecretKnown={
            state.secretStatus[editing.draft.id] === 'present'
          }
          saving={state.savingConnection}
          saveLabel="保存连接"
          onCancel={() => setEditing(null)}
          onDirtyChange={setEditorDirty}
          onSave={saveEditing}
        />
      )}
      </fieldset>
    </section>
  );
};

export const AiConnectionsPanel = () => {
  const aiConfig = useDesktopAiConfig();
  return <ConnectionsPanelBody aiConfig={aiConfig} />;
};
