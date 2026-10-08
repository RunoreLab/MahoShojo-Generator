// Desktop 生成页共用的 AI Provider 面板（D5.1-AIP-4）。
//
// 五个生成页（scenario/free/details/canshou/creator）此前各自复制同一段
// 「执行位置 + 连接选择 + 提示/信息框 + 高级参数」UI，已出现漂移。本面板
// 收敛为单一实现：
//
// - 执行位置经共源 `AiExecutionLocationField` 切换（与设置页同一份 overlay）；
// - 连接选择复用共源 `AiProviderCustomSelect`：分组（内置/我的连接）、
//   操作区（新建/编辑/管理连接）、键盘导航、不可用原因展示；
// - 生效模型多选（modelsByProfileId）+ 自定义模型 ID 添加/移除；
// - 连接测试与高级生成设置只随「客户端目标已解析」出现；
// - 内嵌 `ConnectionEditor` 新建/编辑连接（凭据经 SecretStore 保存）。
//
// 页面差异（生成方式切换器、服务器/客户端文案、载荷名词）通过 props/槽位
// 注入；overlay/profile 状态一律经 `useDesktopAiConfig` 读同一份 store。

import { useState, type ReactNode } from 'react';
import { Link, useRouter } from '@tanstack/react-router';

import { getModelGenerationCapabilities } from '@mahoshojo/ai-core/generation-settings';
import {
  AdvancedGenerationSettings,
  AiExecutionLocationField,
  AiProviderCustomSelect,
} from '@mahoshojo/ui-web/ai-provider';
import type {
  AiProviderSelectAction,
  AiProviderSelectOption,
} from '@mahoshojo/ui-web/ai-provider';

import { navigateByProductHref } from '../../app/hash-history-fragment';
import { useDesktopAiConfig } from './use-desktop-ai-config';
import { resolveDesktopAiTarget } from './desktop-ai-config';
import { secretStatusLabel } from './AiConnectionsPanel';
import {
  ConnectionEditor,
  draftFromProfile,
  newConnectionId,
  saveConnectionDraft,
  type EditingState,
} from './connection-editor';
import { ConnectionTestSection } from './connection-test';

/** 「服务器（System Default）」在选择器中的哨兵值；与 `conn_*` Profile ID 不会冲突。 */
const SERVER_VALUE = '__server__';

export interface DesktopAiProviderPanelCopy {
  /** 服务器通路两种生成方式的输出说明。 */
  serverOutput: { stream: string; nonStream: string };
  /**
   * 空连接提示的第二句：「请先在设置中保存 Provider。{emptyProfilesHint}」
   * 各页名词不同（回答/提示词/问卷…）。
   */
  emptyProfilesHint: string;
  /** 服务器信息框第二行整句（含各页「不会丢失已填写的 X」名词差异）。 */
  serverFootnote: string;
  /** 客户端信息框尾句名词：「点击生成会发送{payloadNoun}；结果不带官方签名。」 */
  payloadNoun: string;
}

export interface DesktopAiProviderPanelProps {
  /** 当前生成方式（只用于服务器信息框文案二选一）。 */
  generationMode: 'stream' | 'non-stream';
  copy: DesktopAiProviderPanelCopy;
  /**
   * 页面控件槽位（生成方式切换器、Schema 选择等页面专属控件），
   * 渲染在执行位置之后、连接选择之前——保持各页既有的控件顺序。
   */
  controlsSlot?: ReactNode;
}

export const DesktopAiProviderPanel = ({
  generationMode,
  copy,
  controlsSlot,
}: DesktopAiProviderPanelProps) => {
  const { state, store } = useDesktopAiConfig();
  const router = useRouter();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [modelError, setModelError] = useState<string | null>(null);

  const target = resolveDesktopAiTarget(
    state.selection,
    state.profiles,
    state.generationOverrides,
    state.modelsByProfileId,
  );
  const profilesLoading = state.profilesState === 'idle' || state.profilesState === 'loading';
  const profilesError = state.profilesState === 'failed' ? state.profilesError : null;
  const blockedOverlay = state.overlayState !== 'ready';
  const profile = target.profile;
  const mode = target.mode;
  const clientReady = target.location === 'client' && profile !== null && mode !== null;

  const providerOptions: AiProviderSelectOption[] = [
    {
      value: SERVER_VALUE,
      label: '服务器 · System Default',
      description: '项目服务托管生成（默认通道）',
      group: '内置供应商',
      kind: 'builtin',
    },
    ...state.profiles.map((item) => ({
      value: item.id,
      label: item.name,
      description: `默认模型 ${item.modelId}`,
      group: '我的连接',
      kind: 'connection',
    })),
  ];
  const providerValue =
    target.location === 'server' ? SERVER_VALUE : (state.selection.clientConnectionId ?? '');

  const providerActions: AiProviderSelectAction[] = [
    { id: 'new-connection', label: '＋ 新建自定义连接' },
    ...(profile !== null ? [{ id: 'edit-current', label: `编辑「${profile.name}」` }] : []),
    { id: 'manage', label: '管理连接（打开设置）' },
  ];

  const handleProviderAction = (actionId: string) => {
    if (actionId === 'new-connection') {
      setEditing({
        draft: { id: newConnectionId(), name: '', baseUrl: '', modelId: '' },
        presetModels: null,
        isExisting: false,
        hasKeyRef: false,
      });
    } else if (actionId === 'edit-current' && profile !== null) {
      setEditing({
        draft: draftFromProfile(profile),
        presetModels: null,
        isExisting: true,
        hasKeyRef: profile.apiKeyRef !== undefined,
      });
    } else if (actionId === 'manage') {
      navigateByProductHref(router, '/settings?section=generation');
    }
  };

  const handleProviderChange = (value: string) => {
    if (value === SERVER_VALUE) {
      store.selectExecutionLocation('server');
      return;
    }
    // 生成入口选连接=立即用它执行：连接、执行位置与模型作为同一次受检
    // overlay 更新原子落盘（DESK-AIP-003.3）。
    store.activateConnection(value);
  };

  const effectiveModelId = target.modelId;
  const effectiveModelMissing =
    profile !== null &&
    effectiveModelId !== null &&
    !target.availableModelIds.includes(effectiveModelId);
  const modelOptions: AiProviderSelectOption[] = target.availableModelIds.map((id) => ({
    value: id,
    label: id,
    description: profile !== null && id === profile.modelId ? '默认模型' : '自定义模型',
    kind: 'model',
  }));
  if (effectiveModelMissing && effectiveModelId !== null) {
    modelOptions.unshift({
      value: effectiveModelId,
      label: effectiveModelId,
      disabled: true,
      disabledReason: '该模型已从列表移除，请重新选择',
    });
  }
  const selectedModelIsCustom =
    profile !== null && effectiveModelId !== null && effectiveModelId !== profile.modelId;
  const modelActions: AiProviderSelectAction[] = selectedModelIsCustom
    ? [{ id: 'remove-model', label: `移除模型「${effectiveModelId}」` }]
    : [];

  const handleModelAction = (actionId: string) => {
    if (actionId === 'remove-model' && profile !== null && effectiveModelId !== null) {
      store.removeCustomModel(profile.id, effectiveModelId);
    }
  };

  const addModel = () => {
    if (profile === null) return;
    try {
      store.addCustomModel(profile.id, modelDraft);
      setModelError(null);
      setModelDraft('');
    } catch (cause) {
      setModelError(cause instanceof Error ? cause.message : '模型 ID 无效');
    }
  };

  const targetCapabilities = clientReady
    ? getModelGenerationCapabilities(profile.id, target.modelId ?? profile.modelId)
    : undefined;

  return (
    <>
      <AiExecutionLocationField
        value={target.location}
        client={{ enabled: true }}
        server={{ enabled: true }}
        onChange={(location) => store.selectExecutionLocation(location)}
      />

      {controlsSlot}

      <div className="flex flex-col gap-1">
        <span>AI 连接</span>
        <AiProviderCustomSelect
          options={providerOptions}
          value={providerValue}
          onChange={handleProviderChange}
          placeholder="未选择连接"
          actions={providerActions}
          onAction={handleProviderAction}
          disabled={blockedOverlay}
        />
      </div>

      {target.location === 'client' &&
        !profilesLoading &&
        state.profiles.length === 0 &&
        profilesError === null && (
          <p>
            请先在<Link to="/settings" search={{ section: 'generation' }} className="underline">
              设置
            </Link>
            中保存 Provider。{copy.emptyProfilesHint}
          </p>
        )}
      {target.location === 'server' && (
        <div className="rounded border border-(--app-border) p-3">
          <p>
            服务器 · 云端：由项目服务在服务器侧生成，
            {generationMode === 'stream' ? copy.serverOutput.stream : copy.serverOutput.nonStream}。
          </p>
          <p>{copy.serverFootnote}</p>
        </div>
      )}
      {target.location === 'client' && target.unavailableReason !== null && (
        <p role="status">{target.unavailableReason}</p>
      )}
      {clientReady && (
        <div className="rounded border border-(--app-border) p-3">
          <p>
            {mode === 'direct-local'
              ? '客户端 · 本机：发送到本机模型服务'
              : '客户端 · 远端：发送到你指定的外部模型服务'}
          </p>
          <p className="break-all">接收方：{profile.baseUrl}</p>
          <p>
            模型：{effectiveModelId ?? profile.modelId}
            。点击生成会发送{copy.payloadNoun}；结果不带官方签名。
          </p>
        </div>
      )}

      {clientReady && (
        <div className="flex flex-col gap-1">
          <span>生效模型</span>
          <AiProviderCustomSelect
            options={modelOptions}
            value={effectiveModelId ?? ''}
            onChange={(id) => store.selectModel(profile.id, id)}
            placeholder="选择模型"
            actions={modelActions}
            onAction={handleModelAction}
            disabled={blockedOverlay}
          />
          <div className="flex gap-2">
            <input
              value={modelDraft}
              onChange={(event) => {
                setModelDraft(event.target.value);
                setModelError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addModel();
                }
              }}
              className="input-field flex-1 px-2.5 py-1.5 text-xs"
              placeholder="添加自定义模型 ID，如 glm-4.6"
              aria-label="自定义模型 ID"
            />
            <button
              type="button"
              className="rounded-lg border border-(--app-border-strong) px-3 py-1.5 text-xs"
              disabled={blockedOverlay}
              onClick={addModel}
            >
              添加
            </button>
          </div>
          <p className="text-xs text-(--app-text-muted)">
            {modelError ?? `模型 ID 只保存在本机设置中。凭据：${secretStatusLabel(state.secretStatus[profile.id], profile.apiKeyRef !== undefined)}`}
          </p>
        </div>
      )}

      {/* 高级参数只随 direct 通路下发（hosted 在服务器侧解析）：仅客户端执行时展示，
          未实现 adapter 的连接同样不显示无实际发送效果的控件。 */}
      {clientReady && (
        <AdvancedGenerationSettings
          value={target.generationOverrides}
          onChange={(next) =>
            store.setGenerationOverrides(profile.id, target.modelId ?? profile.modelId, next)
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

      {clientReady && <ConnectionTestSection target={target} />}

      {editing !== null && (
        <ConnectionEditor
          editing={editing}
          existingSecretKnown={state.secretStatus[editing.draft.id] === 'present'}
          saving={state.savingConnection}
          saveLabel={editing.isExisting ? '保存连接' : '保存并使用'}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            // 新建连接保存后即作为当前连接启用（DESK-AIP-003.4）；
            // 编辑既有连接不改动激活状态。Profile+凭据持久化与激活分阶段
            // 失败时由 saveConnectionDraft 投影「已保存但未启用」。
            await saveConnectionDraft(store, draft, { activate: !editing.isExisting });
            setEditing(null);
          }}
        />
      )}
    </>
  );
};
