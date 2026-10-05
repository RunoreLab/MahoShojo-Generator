// 产品化 AI 连接面板（D5.0b，取代 D1 的 ProviderProfilesPanel 调试面板）。
//
// 布局分四块：执行位置（客户端｜服务器）、当前连接与高级生成设置、项目预设
// （隐藏/恢复/复制为自定义连接）、自定义连接 CRUD。凭据只写 OS 凭据存储，
// UI 只展示「是否存在」，永远读不回明文。

import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { getModelGenerationCapabilities } from '@mahoshojo/ai-core/generation-settings';
import {
  AiExecutionLocationField,
  AdvancedGenerationSettings,
  describeAiDirectUnsupportedReason,
} from '@mahoshojo/ui-web/ai-provider';
import {
  requiresExplicitPublicHttpConfirmation,
  type DirectProviderProfileV1,
} from '@mahoshojo/contracts/provider-profile';
import type { AIModelOption } from '@mahoshojo/ai-core/provider-catalog';

import { createDesktopAiExecutionPort } from '../../platform/desktop-ai-execution';
import { DesktopAiError } from '../../platform/direct-ai-bridge';
import {
  PROVIDER_PRESETS,
  ProfileDraftError,
  type ProfileDraft,
} from '../providers/profile-draft';

import {
  DESKTOP_EDITABLE_PROFILE_ADAPTERS,
  describeDesktopPresetModelSupport,
  listDesktopPresetEntries,
  resolveDesktopAiTarget,
  type DesktopPresetEntry,
  type DesktopSecretPresence,
} from './desktop-ai-config';
import { useDesktopAiConfig, type UseDesktopAiConfigResult } from './use-desktop-ai-config';

const newConnectionId = () => `conn_${Math.random().toString(36).slice(2, 12)}`;

const modeLabel = (mode: 'direct-local' | 'direct-remote'): string =>
  mode === 'direct-local'
    ? '客户端 · 本机模型服务'
    : '客户端 · 远端供应商（需要联网）';

interface EditingState {
  draft: ProfileDraft;
  /** 从预设复制时带入的直连模型清单（供 modelId datalist）；自由连接为 null。 */
  presetModels: readonly AIModelOption[] | null;
  isExisting: boolean;
}

const draftFromProfile = (profile: DirectProviderProfileV1): ProfileDraft => ({
  id: profile.id,
  name: profile.name,
  baseUrl: profile.baseUrl,
  modelId: profile.modelId,
  allowPublicHttp: profile.transport?.allowPublicHttp === true,
});

const ConnectionEditor = ({
  editing,
  existingSecretKnown,
  saving,
  onCancel,
  onSave,
}: {
  editing: EditingState;
  existingSecretKnown: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: ProfileDraft) => Promise<void>;
}) => {
  const [draft, setDraft] = useState<ProfileDraft>(editing.draft);
  const [error, setError] = useState<string | null>(null);
  const needsHttpConfirm = useMemo(
    () => requiresExplicitPublicHttpConfirmation(draft.baseUrl.trim()),
    [draft.baseUrl],
  );

  const patch = (changes: Partial<ProfileDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setError(null);
  };

  const submit = async () => {
    setError(null);
    try {
      // 用户明确勾选过 allowPublicHttp 才写入；非 loopback http 未勾选时让 schema 拒绝。
      const payload: ProfileDraft = needsHttpConfirm
        ? draft
        : { ...draft, allowPublicHttp: undefined };
      await onSave(payload);
    } catch (cause) {
      setError(
        cause instanceof ProfileDraftError
          ? `${cause.field}: ${cause.message}`
          : cause instanceof Error
            ? cause.message
            : '保存连接失败',
      );
    }
  };

  const datalistId = `ai-conn-models-${draft.id}`;

  return (
    <div className="battle-lite-accent-box flex flex-col gap-3 rounded-lg p-3 text-sm">
      <h3 className="battle-lite-strong-text text-xs font-semibold">
        {editing.isExisting ? '编辑连接' : '新建连接'}
      </h3>
      <label className="flex flex-col gap-1 text-xs">
        <span className="battle-lite-muted-text">显示名</span>
        <input
          className="input-field"
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="battle-lite-muted-text">Endpoint（OpenAI-compatible 根路径）</span>
        <input
          className="input-field font-mono"
          value={draft.baseUrl}
          placeholder="https://api.example.com/v1"
          onChange={(event) => patch({ baseUrl: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="battle-lite-muted-text">模型 id</span>
        <input
          className="input-field font-mono"
          value={draft.modelId}
          placeholder="例如 qwen3:8b"
          list={editing.presetModels ? datalistId : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => patch({ modelId: event.target.value })}
        />
        {editing.presetModels && (
          <datalist id={datalistId}>
            {editing.presetModels.map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </datalist>
        )}
      </label>
      {needsHttpConfirm && (
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={draft.allowPublicHttp === true}
            onChange={(event) => patch({ allowPublicHttp: event.target.checked })}
          />
          <span>
            允许通过明文 HTTP 连接此远端地址。请求内容将以明文经过网络，仅在你信任该网络时启用。
          </span>
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs">
        <span className="battle-lite-muted-text">API Key（可留空）</span>
        <input
          className="input-field font-mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={
            editing.isExisting && existingSecretKnown
              ? '已保存凭据，留空保持不变'
              : '输入后写入操作系统凭据存储'
          }
          value={draft.apiKey ?? ''}
          onChange={(event) => patch({ apiKey: event.target.value })}
        />
        <span className="battle-lite-subtle-text">
          凭据只写入操作系统凭据存储，保存后本页无法再读回。
        </span>
      </label>
      {error && <p className="battle-lite-subtle-text text-xs">保存失败：{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg bg-(--app-accent) px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? '保存中…' : '保存连接'}
        </button>
        <button
          type="button"
          className="rounded-lg border border-(--app-border-strong) px-3 py-1.5 text-xs"
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </div>
  );
};

/** DESK-ONLINE-004：区分未配置、缺失、已配置与存储失败；未知不猜成「未配置」。 */
const secretStatusLabel = (
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
        {profile.baseUrl} · {profile.modelId} · {profile.adapter}
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
  const [showHidden, setShowHidden] = useState(false);
  const [testState, setTestState] = useState<
    | { status: 'idle' }
    | { status: 'running' }
    | { status: 'done'; text: string }
    | { status: 'cancelled' }
    | { status: 'failed'; message: string }
  >({ status: 'idle' });
  const testAbortRef = useRef<AbortController | null>(null);
  // run identity：切换目标时 revision++，旧 run 的迟到终态不得再写 UI。
  const testRevisionRef = useRef(0);

  const target = resolveDesktopAiTarget(
    state.selection,
    state.profiles,
    state.generationOverrides,
  );
  const presetEntries = useMemo(
    () => listDesktopPresetEntries(state.hiddenPresetIds),
    [state.hiddenPresetIds],
  );
  const visiblePresets = presetEntries.filter((entry) => !entry.hidden);
  const hiddenPresets = presetEntries.filter((entry) => entry.hidden);

  const targetCapabilities = target.profile
    ? getModelGenerationCapabilities(target.profile.id, target.modelId ?? '')
    : undefined;

  const startCopyPreset = (entry: DesktopPresetEntry, modelId: string) => {
    const draft = newDraftFromPreset(entry, modelId);
    if (!draft) return;
    setEditing({ draft, presetModels: entry.directCapableModels, isExisting: false });
  };

  const startNewConnection = (baseUrl = '') => {
    setEditing({
      draft: { id: newConnectionId(), name: '', baseUrl, modelId: '' },
      presetModels: null,
      isExisting: false,
    });
  };

  const saveEditing = async (draft: ProfileDraft) => {
    await store.saveConnection(draft);
    setEditing(null);
  };

  const runConnectionTest = async () => {
    const profile = target.profile;
    const mode = target.mode;
    if (!profile || !mode || testState.status === 'running') return;
    const revision = ++testRevisionRef.current;
    setTestState({ status: 'running' });
    const controller = new AbortController();
    testAbortRef.current = controller;
    // 目标已切换时迟到的结果直接丢弃——新旧目标之间的状态不串台。
    const isCurrentRun = () => revision === testRevisionRef.current;
    try {
      const result = await createDesktopAiExecutionPort({
        invoke,
        profileId: profile.id,
      }).execute(
        {
          requestId: `conn-test-${crypto.randomUUID()}`,
          contractVersion: 1,
          mode,
          modelId: profile.modelId,
          messages: [{ role: 'user', content: '用一句话介绍你自己。' }],
        },
        controller.signal,
      );
      if (!isCurrentRun()) return;
      setTestState(
        result.status === 'completed'
          ? { status: 'done', text: result.output.text ?? '' }
          : result.status === 'cancelled'
            ? { status: 'cancelled' }
            : { status: 'failed', message: result.error.message ?? result.error.code },
      );
    } catch (cause) {
      if (!isCurrentRun()) return;
      setTestState(
        controller.signal.aborted
          ? { status: 'cancelled' }
          : {
              status: 'failed',
              message:
                cause instanceof DesktopAiError
                  ? `${cause.code}: ${cause.message}`
                  : cause instanceof Error
                    ? cause.message
                    : '连接测试失败',
            },
      );
    } finally {
      if (testAbortRef.current === controller) testAbortRef.current = null;
    }
  };

  const cancelConnectionTest = () => {
    testAbortRef.current?.abort();
  };

  // 切换/删除当前连接时中止在途测试并重置结果；卸载同样中止（Direct 默认无应用层
  // 硬超时，挂着没人收会一直占流）。用字段值做依赖而不是拼字符串，id/modelId 含
  // 分隔符也不会误判。
  const testTargetId = target.profile?.id ?? null;
  const testTargetModel = target.profile?.modelId ?? null;
  useEffect(() => {
    testRevisionRef.current += 1;
    testAbortRef.current?.abort();
    setTestState({ status: 'idle' });
  }, [testTargetId, testTargetModel]);
  useEffect(
    () => () => {
      testRevisionRef.current += 1;
      testAbortRef.current?.abort();
    },
    [],
  );

  const blockedOverlay = state.overlayState === 'blocked';

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
      <header className="flex flex-col gap-1">
        <h2 className="battle-lite-strong-text text-sm font-medium">AI 连接</h2>
        <p className="battle-lite-muted-text text-xs">
          客户端直接连接你配置的模型服务；API Key 只写入操作系统凭据存储，本页只能看到是否已配置。
        </p>
      </header>

      {blockedOverlay && (
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

      <AiExecutionLocationField
        value={target.location}
        // 执行位置偏好不依赖能力：客户端被偏好但没有连接时，由不可用说明引导配置；
        // 服务器执行走 hosted System Default，匿名可选、DESK-094 在 dispatch 时校验。
        client={{ enabled: true }}
        server={{ enabled: true }}
        onChange={(location) => store.selectExecutionLocation(location)}
      />

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="battle-lite-muted-text">当前连接</span>
          <select
            aria-label="当前 AI 连接"
            className="input-field"
            disabled={blockedOverlay}
            value={state.selection.clientConnectionId ?? ''}
            onChange={(event) => {
              // 「当前连接」下拉=立即用它执行：连接选择与执行位置一起显式落定。
              if (event.target.value) {
                store.selectClientConnection(event.target.value);
                store.selectExecutionLocation('client');
              }
            }}
          >
            {state.selection.clientConnectionId === null && (
              <option value="">未选择连接</option>
            )}
            {state.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {profile.modelId}
              </option>
            ))}
          </select>
        </label>
        {state.profilesState === 'loading' && (
          <p className="battle-lite-subtle-text text-xs">正在读取连接列表…</p>
        )}
        {state.profilesState === 'failed' && (
          <p className="battle-lite-subtle-text text-xs">连接列表读取失败：{state.profilesError}</p>
        )}
        {target.unavailableReason && (
          <p className="battle-lite-subtle-text text-xs" role="status">
            {target.unavailableReason}
          </p>
        )}
        {target.profile && target.mode && (
          <div className="battle-lite-info-box rounded-lg p-3 text-xs">
            <p>{modeLabel(target.mode)}</p>
            <p className="break-all font-mono">接收方：{target.profile.baseUrl}</p>
            <p>模型：{target.profile.modelId}</p>
            {target.mode === 'direct-remote' && (
              <p className="battle-lite-subtle-text">远端生成需要联网；本功能不构成离线路径。</p>
            )}
          </div>
        )}
        {target.profile && target.mode && (
          <div className="flex gap-2">
            {testState.status === 'running' ? (
              <button
                type="button"
                className="rounded-lg border border-(--app-border-strong) px-3 py-1.5 text-xs"
                onClick={cancelConnectionTest}
              >
                取消测试
              </button>
            ) : (
              <button
                type="button"
                className="rounded-lg border border-(--app-border-strong) px-3 py-1.5 text-xs"
                onClick={() => void runConnectionTest()}
              >
                测试当前连接
              </button>
            )}
          </div>
        )}
        {testState.status === 'done' && (
          <p className="battle-lite-subtle-text whitespace-pre-wrap text-xs">
            测试输出：{testState.text || '（空）'}
          </p>
        )}
        {testState.status === 'cancelled' && (
          <p className="battle-lite-subtle-text text-xs">测试已取消。</p>
        )}
        {testState.status === 'failed' && (
          <p className="battle-lite-subtle-text text-xs">测试失败：{testState.message}</p>
        )}
      </div>

      {/* 未实现 adapter 的连接不展示高级参数——不显示无实际发送效果的控件
          （DESK-ONLINE-004）。 */}
      {target.profile && target.mode && (
        <AdvancedGenerationSettings
          value={target.generationOverrides}
          onChange={(next) =>
            target.profile &&
            store.setGenerationOverrides(target.profile.id, target.profile.modelId, next)
          }
          temperatureSupported={
            targetCapabilities ? targetCapabilities.temperature.support !== 'unsupported' : true
          }
          temperatureMax={targetCapabilities?.temperature.max}
          maxOutputTokensMax={targetCapabilities?.maxOutputTokens.max}
          thinkingSupport={targetCapabilities?.thinking.support ?? 'unknown'}
          thinkingEfforts={targetCapabilities?.thinking.efforts}
          canDisableThinking={
            targetCapabilities
              ? targetCapabilities.thinking.support === 'supported' &&
                targetCapabilities.thinking.canDisable !== false
              : true
          }
        />
      )}

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
                // 「设为当前」明确含义是立即用它执行。
                store.selectClientConnection(profile.id);
                store.selectExecutionLocation('client');
              }}
              onEdit={() =>
                setEditing({ draft: draftFromProfile(profile), presetModels: null, isExisting: true })
              }
              onDelete={() => void store.deleteConnection(profile.id)}
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
          onCancel={() => setEditing(null)}
          onSave={saveEditing}
        />
      )}
    </section>
  );
};

export const AiConnectionsPanel = () => {
  const aiConfig = useDesktopAiConfig();
  return <ConnectionsPanelBody aiConfig={aiConfig} />;
};
