// Desktop 生成页共用的 AI Provider 面板（D5.1-AIP-4 / r1）。
//
// 五个生成页（scenario/free/details/canshou/creator）此前各自复制同一段
// 「执行位置 + 连接选择 + 提示/信息框 + 高级参数」UI，已出现漂移。本面板
// 收敛为单一实现，并消费共源 `AiProviderSelectorForm` 骨架（DESK-AIP-009.1：
// Web 由 useAiProviderSelection 驱动，Desktop 由 DesktopAiConfigStore 驱动，
// 表单自身不产生持久化副作用）：
//
// - 执行位置经共源 `AiExecutionLocationField` 切换（与设置页同一份 overlay）；
// - Provider 下拉与 Web 同语义：「使用系统默认配置」hosted 项 + 内置 Direct
//   预设（选预设=打开带默认值的连接编辑器，即「预设直配」旅程）+ 我的连接；
// - 服务器位置生效时模型行给出「默认策略」及 GLM 5.3 Flash 等系统模型
//   （经 hosted `systemConfig` 非秘密偏好下发，与 Web 同一目录事实源）；
// - 客户端连接生效时模型行为该连接的默认+自定义模型，自填 modelId 入列；
// - 凭据区只表达「已配置/缺失/失败」三态与编辑入口，永不明文回显；
// - 内嵌 `ConnectionEditor` 新建/编辑连接（凭据经 SecretStore 保存）。
//
// 页面差异（生成方式切换器、服务器/客户端文案、载荷名词）通过 props/槽位
// 注入；overlay/profile 状态一律经 `useDesktopAiConfig` 读同一份 store。

import { useState, type ReactNode } from 'react';
import { Link, useRouter } from '@tanstack/react-router';

import { getModelGenerationCapabilities } from '@mahoshojo/ai-core/generation-settings';
import { SYSTEM_PROVIDER_OPTION } from '@mahoshojo/ai-core/provider-catalog';
import {
  AdvancedGenerationSettings,
  AiExecutionLocationField,
  AiProviderCustomSelect,
  AiProviderSelectorForm,
  describeAiDirectUnsupportedReason,
} from '@mahoshojo/ui-web/ai-provider';
import type {
  AiProviderSelectAction,
  AiProviderSelectOption,
} from '@mahoshojo/ui-web/ai-provider';

import { navigateByProductHref } from '../../app/hash-history-fragment';
import { useDesktopAiConfig } from './use-desktop-ai-config';
import {
  DESKTOP_SYSTEM_OVERRIDES_SCOPE,
  listDesktopPresetEntries,
  resolveDesktopAiTarget,
  type DesktopPresetEntry,
} from './desktop-ai-config';
import { secretStatusLabel } from './AiConnectionsPanel';
import {
  ConnectionEditor,
  draftFromProfile,
  newConnectionId,
  saveConnectionDraft,
  type EditingState,
} from './connection-editor';
import { ConnectionTestSection } from './connection-test';

/**
 * 「使用系统默认配置」在选择器中的取值。
 * `system` 与 `preset:*` 前缀是宿主保留值：连接 ID 恒为 `conn_*` 生成且
 * store 显式拒绝 `system` 草稿 ID，取值空间不冲突（DESK-ONLINE-002/004）。
 */
const SYSTEM_OPTION_VALUE = 'system';
const presetOptionValue = (presetId: string) => `preset:${presetId}`;

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
   * 渲染在执行位置之后、Provider 选择之前——保持各页既有的控件顺序。
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
  const presetEntries = listDesktopPresetEntries(state.hiddenPresetIds);

  const openConnectionEditor = (editingState: EditingState) => setEditing(editingState);
  const openNewConnection = () =>
    openConnectionEditor({
      draft: { id: newConnectionId(), name: '', baseUrl: '', modelId: '' },
      presetModels: null,
      isExisting: false,
      hasKeyRef: false,
    });
  const openEditConnection = (targetProfile: NonNullable<typeof profile>) =>
    openConnectionEditor({
      draft: draftFromProfile(targetProfile),
      presetModels: null,
      isExisting: true,
      hasKeyRef: targetProfile.apiKeyRef !== undefined,
    });
  const openPresetEditor = (entry: DesktopPresetEntry) => {
    const firstCapable = entry.directCapableModels[0]?.value;
    if (firstCapable === undefined) return;
    // 「预设即选即配」：预设值不进入激活语义，只作为编辑器草稿种子；
    // 「保存并使用」才真正落盘并激活（DESK-AIP-003.4）。
    openConnectionEditor({
      draft: {
        id: newConnectionId(),
        name: entry.preset.name,
        baseUrl: entry.preset.baseUrl,
        modelId: firstCapable,
      },
      presetModels: entry.directCapableModels,
      isExisting: false,
      hasKeyRef: false,
    });
  };

  const providerOptions: AiProviderSelectOption[] = [
    {
      // 与 Web 同一目录事实源：label = 「使用系统默认配置」。
      value: SYSTEM_OPTION_VALUE,
      label: SYSTEM_PROVIDER_OPTION.name,
      description: SYSTEM_PROVIDER_OPTION.description,
      kind: 'builtin',
    },
    ...presetEntries
      .filter((entry) => !entry.hidden)
      .map((entry): AiProviderSelectOption => {
        const selectable = entry.directCapableModels.length > 0;
        const reason = entry.presetSupport.supported
          ? '该端点暂无可直连的收录模型'
          : describeAiDirectUnsupportedReason(entry.presetSupport.reason);
        return {
          value: presetOptionValue(entry.preset.id),
          label: entry.preset.name,
          description: entry.preset.description,
          group: '内置供应商',
          kind: 'preset',
          ...(selectable ? {} : { disabled: true, disabledReason: reason }),
        };
      }),
    ...state.profiles.map((item) => ({
      value: item.id,
      label: item.name,
      description: `默认模型 ${item.modelId}`,
      group: '我的连接',
      kind: 'connection',
    })),
  ];
  const providerValue =
    target.location === 'server' ? SYSTEM_OPTION_VALUE : (state.selection.clientConnectionId ?? '');

  const providerActions: AiProviderSelectAction[] = [
    { id: 'new-connection', label: '＋ 新建自定义连接' },
    ...(profile !== null ? [{ id: 'edit-current', label: `编辑「${profile.name}」` }] : []),
    { id: 'manage', label: '管理连接（打开设置）' },
  ];

  const handleProviderAction = (actionId: string) => {
    if (actionId === 'new-connection') {
      openNewConnection();
    } else if (actionId === 'edit-current' && profile !== null) {
      openEditConnection(profile);
    } else if (actionId === 'manage') {
      navigateByProductHref(router, '/settings?section=generation');
    }
  };

  const handleProviderChange = (value: string) => {
    if (value === SYSTEM_OPTION_VALUE) {
      store.selectExecutionLocation('server');
      return;
    }
    if (value.startsWith('preset:')) {
      const entry = presetEntries.find(
        (candidate) => presetOptionValue(candidate.preset.id) === value,
      );
      if (entry) openPresetEditor(entry);
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

  const isServer = target.location === 'server';
  // 服务器：系统模型目录（含「默认策略」= 服务端默认顺序）；客户端：连接模型清单。
  const resolvedModelOptions: AiProviderSelectOption[] = isServer
    ? SYSTEM_PROVIDER_OPTION.models.map((model) => ({
        value: model.value,
        label: model.label,
        description: model.description,
        kind: 'model',
      }))
    : modelOptions;
  // 系统模型悬空（曾选、后被目录移除）：保留原值作 disabled 诊断项，
  // 不静默回落「默认策略」——与客户端连接模型的悬空语义一致。
  if (
    isServer &&
    state.selection.systemModelId !== undefined &&
    !SYSTEM_PROVIDER_OPTION.models.some((model) => model.value === state.selection.systemModelId)
  ) {
    resolvedModelOptions.unshift({
      value: state.selection.systemModelId,
      label: state.selection.systemModelId,
      disabled: true,
      disabledReason: '该系统模型已不在支持列表中，请重新选择',
    });
  }
  const resolvedModelValue = isServer
    ? (state.selection.systemModelId ?? 'default')
    : (effectiveModelId ?? '');
  const handleModelChange = (id: string) => {
    if (isServer) {
      store.selectSystemModel(id);
    } else if (profile !== null) {
      store.selectModel(profile.id, id);
    }
  };
  const overridesScope = isServer ? DESKTOP_SYSTEM_OVERRIDES_SCOPE : profile?.id;
  const overridesModelId = isServer
    ? resolvedModelValue
    : profile !== null
      ? (target.modelId ?? profile.modelId)
      : null;
  const targetCapabilities =
    overridesScope !== undefined && overridesModelId !== null
      ? getModelGenerationCapabilities(overridesScope, overridesModelId)
      : undefined;
  const showAdvancedSettings = isServer || mode !== null;

  return (
    <>
      <AiExecutionLocationField
        value={target.location}
        client={{ enabled: true }}
        server={{ enabled: true }}
        onChange={(location) => store.selectExecutionLocation(location)}
      />

      {controlsSlot}

      <AiProviderSelectorForm
        label="AI 提供商"
        providerSelect={
          <AiProviderCustomSelect
            options={providerOptions}
            value={providerValue}
            onChange={handleProviderChange}
            placeholder="未选择连接"
            actions={providerActions}
            onAction={handleProviderAction}
            disabled={blockedOverlay}
          />
        }
        providerFootnote={
          isServer
            ? '系统通道由项目服务端解析；使用自己的连接与 Key 请切换到「客户端」。'
            : '预设选择后进入配置编辑器；API Key 只写入操作系统凭据存储。'
        }
        providerExtra={
          isServer ? (
            <div className="rounded border border-(--app-border) p-3">
              <p>
                服务器 · 云端：由项目服务在服务器侧生成，
                {generationMode === 'stream' ? copy.serverOutput.stream : copy.serverOutput.nonStream}
                。
              </p>
              <p>{copy.serverFootnote}</p>
            </div>
          ) : clientReady ? (
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
          ) : null
        }
        modelSelect={
          <AiProviderCustomSelect
            options={resolvedModelOptions}
            value={resolvedModelValue}
            onChange={handleModelChange}
            placeholder="选择模型"
            actions={isServer ? [] : modelActions}
            onAction={isServer ? undefined : handleModelAction}
            disabled={blockedOverlay || (!isServer && profile === null)}
          />
        }
        customModelId={
          !isServer && profile !== null
            ? {
                label: '添加自定义模型',
                input: (
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
                ),
                hint: modelError ?? '模型 ID 只保存在本机设置中；同一连接可登记多个模型。',
              }
            : undefined
        }
        apiKey={
          profile !== null
            ? {
                content: (
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      {secretStatusLabel(
                        state.secretStatus[profile.id],
                        profile.apiKeyRef !== undefined,
                      )}
                    </span>
                    <button
                      type="button"
                      className="battle-lite-link underline"
                      disabled={blockedOverlay}
                      onClick={() => openEditConnection(profile)}
                    >
                      更新凭据
                    </button>
                  </div>
                ),
                hint: 'API Key 只写入操作系统凭据存储，界面不回显明文。',
              }
            : undefined
        }
        advancedSettings={
          showAdvancedSettings ? (
            // 高级参数只随 direct / hosted-systemConfig 通路下发；未实现
            // adapter 的连接不显示无实际发送效果的控件（DESK-ONLINE-004）。
            <AdvancedGenerationSettings
              value={target.generationOverrides}
              onChange={(next) => {
                if (overridesScope === undefined || overridesModelId === null) return;
                store.setGenerationOverrides(overridesScope, overridesModelId, next);
              }}
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
          ) : undefined
        }
        advancedFootnote={
          isServer
            ? '高级设置按「系统模型」分别保存，随服务器请求作为非秘密偏好下发；留空表示跟随服务端默认。'
            : '高级设置按「连接 + 模型」分别保存；留空表示跟随模型 / 供应商默认。'
        }
      >
        {clientReady && <ConnectionTestSection target={target} />}
      </AiProviderSelectorForm>

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
      {target.location === 'client' && target.unavailableReason !== null && (
        <p role="status">{target.unavailableReason}</p>
      )}

      {editing !== null && (
        <ConnectionEditor
          editing={editing}
          existingSecretKnown={state.secretStatus[editing.draft.id] === 'present'}
          saving={state.savingConnection}
          saveLabel={editing.isExisting ? '保存连接' : '保存并使用'}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            // 新建连接（含预设直配）保存后即作为当前连接启用（DESK-AIP-003.4）；
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
