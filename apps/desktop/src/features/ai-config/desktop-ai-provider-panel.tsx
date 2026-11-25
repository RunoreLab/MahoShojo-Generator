// Web / Desktop 共用展示骨架；执行位置与稳定目标身份独立，预设不创建 Profile。
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from '@tanstack/react-router';
import { getDesktopGenerationCapabilities } from '../providers/protocol-capabilities';
import {
  resolveAiPresetModelDirectBaseUrl,
  SYSTEM_PROVIDER_OPTION,
} from '@mahoshojo/ai-core/provider-catalog';
import {
  AdvancedGenerationSettings, AiExecutionLocationField, AiProviderCustomSelect,
  AiProviderSelectorForm, AiProviderModelIdInput, describeAiDirectUnsupportedReason,
  type AiProviderSelectOption,
} from '@mahoshojo/ui-web/ai-provider';
import { navigateByProductHref } from '../../app/hash-history-fragment';
import { useDesktopAiConfig } from './use-desktop-ai-config';
import { DESKTOP_SYSTEM_OVERRIDES_SCOPE, listDesktopPresetEntries, resolveDesktopAiTargetForState, selectedProviderTarget } from './desktop-ai-config';
import { ConnectionEditor, draftFromProfile, newConnectionId, saveConnectionDraft, type EditingState } from './connection-editor';
import { ConnectionTestSection } from './connection-test';
import { useExternalLinks } from '../external-links/external-links-provider';

export interface DesktopAiProviderPanelCopy {
  serverOutput: { stream: string; nonStream: string };
  emptyProfilesHint: string;
  serverFootnote: string;
  payloadNoun: string;
}
export interface DesktopAiProviderPanelProps {
  generationMode: 'stream' | 'non-stream';
  copy: DesktopAiProviderPanelCopy;
  controlsSlot?: ReactNode;
  /** 设置与生成页使用相同供应商/模型/凭据控件。 */
  management?: boolean;
  /** Optional page owner hook; the panel never installs a second native close guard. */
  onDirtyChange?: (dirty: boolean) => void;
  showConnectionTest?: boolean;
  /** 只约束本页服务器能力，不改其他页的供应商/模型偏好。 */
  serverPolicy?: 'fixed-default';
  /** Page capability only: preserve the selected location until an explicit user change. */
  serverUnavailableReason?: string;
  /** Temporary page-owned lock; ordinary configuration remains untouched. */
  executionConstraint?: { location: 'server'; reason: string };
}

export const DesktopAiProviderPanel = ({ controlsSlot, management = false, onDirtyChange, showConnectionTest = true, executionConstraint, serverPolicy, serverUnavailableReason }: DesktopAiProviderPanelProps) => {
  const { state, store } = useDesktopAiConfig();
  const router = useRouter();
  const { openFixed } = useExternalLinks();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState(false);
  const selection = executionConstraint ? { ...state.selection, executionPreference: executionConstraint.location } : state.selection;
  const target = resolveDesktopAiTargetForState(state, selection, serverPolicy);
  const fixedServer = serverPolicy === 'fixed-default' && target.location === 'server';
  const identity = fixedServer ? target.providerTarget : selectedProviderTarget(selection);
  const preset = target.preset;
  const profile = target.profile;
  const isSystem = identity?.kind === 'system';
  const isChatgptPlan = identity?.kind === 'chatgpt-plan';
  const chatgpt = state.chatgptPlan;
  const disabled = !!executionConstraint || state.overlayState !== 'ready' || state.generationActive || state.savingCredential || state.savingConnection || state.deletingConnection;
  const presetId = identity?.kind === 'preset' ? identity.providerId : null;
  const keyDraft = presetId ? store.getPresetKeyDraft(presetId) : '';
  const identityKey = JSON.stringify(identity);
  const hasCredentialDraft = listDesktopPresetEntries(new Set()).some(({ preset }) => !!store.getPresetKeyDraft(preset.id));
  useEffect(() => { onDirtyChange?.(editorDirty || hasCredentialDraft); return () => onDirtyChange?.(false); }, [editorDirty, hasCredentialDraft, onDirtyChange]);
  useEffect(() => { setCustomModel(false); setError(null); }, [identityKey, target.location]);
  useEffect(() => { if (presetId) void store.refreshPresetSecret(presetId); }, [presetId, store]);

  const act = (fn: () => void) => { if (disabled) return; try { fn(); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : '配置更新失败'); } };
  const closeEditing = () => { setEditing(null); setEditorDirty(false); };
  const confirmDiscardEditing = () => !editorDirty || window.confirm('连接配置有未保存的更改（包括已输入的 API Key），确认放弃？');
  const openEditor = (next: EditingState) => { if (confirmDiscardEditing()) setEditing(next); };
  const openNew = () => openEditor({ draft: { id: newConnectionId(), name: '', baseUrl: '', modelId: '' }, presetModels: null, isExisting: false, hasKeyRef: false });
  const openEdit = () => { if (profile) openEditor({ draft: draftFromProfile(profile), presetModels: null, isExisting: true, hasKeyRef: !!profile.apiKeyRef }); };
  // 复制预设作编辑器草稿时必须落到该模型已核验 Direct wire 的端点
  // （可能与 preset.baseUrl 分属同一供应商的不同协议面，如 Google OpenAI-compat）。
  const copyPreset = () => { if (preset && target.modelId) openEditor({ draft: { id: newConnectionId(), name: preset.name, baseUrl: resolveAiPresetModelDirectBaseUrl(preset, target.modelId) ?? preset.baseUrl, modelId: target.modelId }, presetModels: preset.models, isExisting: false, hasKeyRef: false }); };

  const providerOptions: AiProviderSelectOption[] = [
    ...(target.location === 'server' ? [{ value: 'system', label: SYSTEM_PROVIDER_OPTION.name, description: SYSTEM_PROVIDER_OPTION.description, kind: 'builtin' }] : []),
    ...(target.location === 'client' && (chatgpt?.supported || isChatgptPlan) ? [{
      value: 'chatgpt-plan', label: 'ChatGPT 订阅', group: '我的连接', kind: 'connection',
      disabled: !chatgpt?.connected, disabledReason: '在 AI 连接设置中连接 ChatGPT 订阅。',
    }] : []),
    // 候选只展示当前执行位置可用的预设：服务器 BYOK 列出全部（含项目转发端点），
    // 客户端只留已核验可直连项——不可用选项不再显示一个「不能点」的占位。
    // 例外：当前已选中的旧预设即使现已不可用也保留条目，交由下方诊断层说明，
    // 而不是让下拉静默显示成别的供应商。
    ...listDesktopPresetEntries(state.hiddenPresetIds)
      .filter((entry) => !fixedServer && !entry.hidden)
      .filter((entry) => target.location === 'server' || entry.directCapableModels.length > 0 || entry.preset.id === presetId)
      .map((entry) => {
        const enabled = target.location === 'server' || entry.directCapableModels.length > 0;
        return { value: `preset:${entry.preset.id}`, label: entry.preset.name, description: entry.preset.description, group: '内置供应商', kind: 'preset', ...(!enabled ? { disabled: true, disabledReason: entry.presetSupport.supported ? '暂无可直连的收录模型' : describeAiDirectUnsupportedReason(entry.presetSupport.reason) } : {}) };
      }),
    ...(target.location === 'client' ? state.profiles.map((item) => ({ value: `custom:${item.id}`, label: item.name, description: `默认模型 ${item.modelId}`, group: '我的连接', kind: 'connection' })) : []),
  ];
  const providerValue = identity?.kind === 'system' ? 'system' : identity?.kind === 'preset' ? `preset:${identity.providerId}` : identity?.kind === 'custom' ? `custom:${identity.profileId}` : isChatgptPlan ? 'chatgpt-plan' : '';
  const modelOptions: AiProviderSelectOption[] = target.availableModelIds.map((id) => {
    if (isChatgptPlan) return { value: id, label: chatgpt?.models.find((model) => model.id === id)?.label ?? id, kind: 'model' };
    const model = (isSystem ? SYSTEM_PROVIDER_OPTION.models : preset?.models)?.find((entry) => entry.value === id);
    return { value: id, label: model?.label ?? id, description: model?.description ?? (id === profile?.modelId ? '默认模型' : '自定义模型'), kind: 'model' };
  });
  if (target.modelId && !target.availableModelIds.includes(target.modelId)) modelOptions.unshift({ value: target.modelId, label: target.modelId, disabled: true, disabledReason: isSystem ? '该系统模型已不在支持列表中，请重新选择' : '模型已从列表移除，请重新选择' });
  const changeModel = (id: string) => act(() => {
    if (fixedServer) return;
    if (isChatgptPlan) store.selectChatgptPlanModel(id);
    else if (presetId) store.selectPresetModel(presetId, id);
    else if (profile) store.selectModel(profile.id, id);
    else store.selectSystemModel(id);
    setCustomModel(false);
  });
  const scope = preset?.id ?? (isSystem ? DESKTOP_SYSTEM_OVERRIDES_SCOPE : profile?.id);
  const capabilities = scope && target.modelId ? getDesktopGenerationCapabilities(scope, target.modelId, target.location === 'client' ? profile?.adapter : undefined) : undefined;
  const status = presetId ? state.presetSecretStatus[presetId] : profile ? state.secretStatus[profile.id] : undefined;
  const statusLabel = status === 'present' ? '已配置 API Key' : status === 'error' ? '凭据状态读取失败' : status === 'absent' ? '尚未配置 API Key' : '正在确认凭据状态';
  const asyncAct = (fn: () => Promise<void>) => { if (disabled) return; void fn().then(() => setError(null)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '凭据操作失败')); };

  return <fieldset disabled={disabled} className="min-w-0 border-0 p-0">
    <AiExecutionLocationField value={target.location} client={{ enabled: !disabled }} server={{ enabled: !disabled && !serverUnavailableReason, reason: serverUnavailableReason }} onChange={(location) => act(() => {
      if ((location === 'server' && serverUnavailableReason) || !confirmDiscardEditing()) return;
      // 易失 Key 按预设身份保留，切换位置或供应商不会转移给另一目标。
      store.selectExecutionLocation(location);
      closeEditing();
    })} />
    {executionConstraint ? <p role="status" className="text-xs">{executionConstraint.reason} 退出当前受限玩法后可调整 AI 配置。</p> : null}
    {controlsSlot}
    <fieldset disabled={!!serverUnavailableReason && target.location === 'server'} className="min-w-0 border-0 p-0">
    <AiProviderSelectorForm
      label="AI 提供商"
      providerSelect={<AiProviderCustomSelect options={providerOptions} value={providerValue} placeholder="选择供应商" disabled={disabled || fixedServer || (!!serverUnavailableReason && target.location === 'server')}
        onChange={(value) => act(() => {
          if (fixedServer || !confirmDiscardEditing()) return;
          if (value === 'system') store.selectProviderTarget({ kind: 'system' });
          else if (value === 'chatgpt-plan') store.activateChatgptPlan();
          else if (value.startsWith('preset:')) store.selectProviderTarget({ kind: 'preset', providerId: value.slice(7) });
          else if (value.startsWith('custom:')) store.selectProviderTarget({ kind: 'custom', profileId: value.slice(7) });
          else return;
          closeEditing();
        })}
        actions={[
          ...(target.location === 'client' ? [{ id: 'new', label: '＋ 新建自定义连接' }] : []),
          ...(profile ? [{ id: 'edit', label: `编辑「${profile.name}」` }] : []),
          ...(preset && target.location === 'client' ? [{ id: 'copy', label: '复制为自定义连接' }] : []),
          ...(!management ? [{ id: 'manage', label: '管理连接（打开设置）' }] : []),
        ]}
        onAction={(id) => {
          if (disabled) return;
          if (id === 'new') openNew();
          if (id === 'edit') openEdit();
          if (id === 'copy') copyPreset();
          if (id === 'manage' && confirmDiscardEditing()) navigateByProductHref(router, '/settings?section=generation');
        }} />}
      providerExtra={isChatgptPlan ? <p className="flex flex-wrap items-center gap-2 text-xs">
        <span>{target.unavailableReason ? 'ChatGPT 订阅' : '正在使用 ChatGPT 订阅'}</span>
        <button type="button" className="battle-lite-link underline" onClick={() => openFixed('https://chatgpt.com/settings/usage')}>管理用量</button>
      </p> : profile ? <p className="break-all text-xs">接收方：{profile.baseUrl} · 模型：{target.modelId ?? profile.modelId}</p> : undefined}
      modelSelect={<AiProviderCustomSelect options={modelOptions} value={target.modelId ?? ''} onChange={changeModel} placeholder="选择模型" disabled={disabled || fixedServer || !identity || (!!serverUnavailableReason && target.location === 'server')}
        actions={!isSystem && !isChatgptPlan && identity ? [{ id: 'custom-model', label: '自定义模型 ID' }, ...(profile && target.modelId && (state.modelsByProfileId[profile.id]?.customModelIds.includes(target.modelId) || state.modelsByProfileId[profile.id]?.inlineModelId === target.modelId) ? [{ id: 'remove-model', label: `移除模型「${target.modelId}」` }] : [])] : []}
        onAction={(id) => { if (id === 'remove-model' && profile && target.modelId) act(() => store.removeCustomModel(profile.id, target.modelId!)); else setCustomModel(true); }} />}
      customModelId={!isSystem && !isChatgptPlan && identity && customModel ? {
        label: '自定义模型 ID',
        input: <AiProviderModelIdInput defaultValue={target.modelId ?? ''} key={identityKey} disabled={disabled}
          onValueChange={(value) => act(() => store.useInlineModel(value))} />,
        hint: state.modelInputError ?? '直接使用此模型 ID，无需先在设置中登记；新输入最多 200 字符。',
      } : undefined}
      apiKey={presetId ? {
        content: <div className="space-y-2">
          <input type="password" autoComplete="off" aria-label="API Key" className="input-field font-mono" value={keyDraft} disabled={disabled}
            onChange={(event) => act(() => store.setPresetKeyDraft(presetId, event.target.value))} placeholder={status === 'present' ? '已保存；留空沿用，填写以更换' : '填写 API Key'} />
          <p className="text-xs">{statusLabel}{keyDraft ? ' · 新 Key 将在生成前保存' : ''}</p>
          {management && <div className="flex gap-3 text-xs">
            <button type="button" className="battle-lite-link underline" disabled={disabled || !keyDraft.trim()} onClick={() => asyncAct(() => store.savePresetKey(presetId))}>保存凭据</button>
            <button type="button" className="battle-lite-link underline" disabled={disabled || status !== 'present'} onClick={() => { if (window.confirm('确认清除此供应商的已保存 API Key？')) asyncAct(() => store.clearPresetKey(presetId)); }}>清除凭据</button>
          </div>}
        </div>,
        hint: target.location === 'server'
          ? 'API Key 安全保存在本机；生成时由项目服务器转交给所选内置供应商。未保存的输入仅保留在本次会话。'
          : 'API Key 保存在本机安全存储中，生成时直接发送给所选供应商。未保存的输入仅保留在本次会话。',
      } : profile ? { content: <div className="flex items-center gap-2 text-xs"><span>{statusLabel}</span><button type="button" className="battle-lite-link underline" disabled={disabled} onClick={openEdit}>更新凭据</button></div> } : undefined}
      advancedSettings={!fixedServer && !isChatgptPlan && identity && (target.location === 'server' || target.mode !== null) && <AdvancedGenerationSettings value={target.generationOverrides} onChange={(next) => act(() => {
        if (!target.modelId) return;
        if (presetId) store.setPresetGenerationOverrides(presetId, target.modelId, next);
        else if (scope) store.setGenerationOverrides(scope, target.modelId, next);
      })} temperatureSupported={capabilities ? capabilities.temperature.support !== 'unsupported' : true} temperatureMax={capabilities?.temperature.max} temperatureDisabled={capabilities?.temperature.disabled} temperatureHint={capabilities?.temperature.hint} maxOutputTokensHint={capabilities?.maxOutputTokens.hint} thinkingHint={capabilities?.thinking.hint} maxOutputTokensMax={capabilities?.maxOutputTokens.max} thinkingSupport={capabilities?.thinking.support ?? 'unknown'} thinkingEfforts={capabilities?.thinking.efforts} canDisableThinking={capabilities ? capabilities.thinking.support === 'supported' && capabilities.thinking.canDisable !== false : true} />}
    >
      {showConnectionTest && profile && target.mode && <ConnectionTestSection target={target} />}
    </AiProviderSelectorForm>
    </fieldset>
    {fixedServer && <p role="status" className="text-xs">本页服务器使用固定系统默认配置；不支持选择模型、BYOK 或高级生成覆盖。</p>}
    {(error || (!executionConstraint && !fixedServer && state.modelInputError)) && <p role="alert">{error ?? state.modelInputError}</p>}
    {target.unavailableReason && <p role="status">{target.unavailableReason}</p>}
    {editing && <ConnectionEditor editing={editing} existingSecretKnown={state.secretStatus[editing.draft.id] === 'present'} saving={state.savingConnection || state.generationActive} saveLabel={editing.isExisting ? '保存连接' : '保存并使用'} onCancel={closeEditing} onDirtyChange={setEditorDirty} onSave={async (draft) => { if (disabled) throw new Error('当前 AI 配置已锁定，请先退出严格排位准备或等待当前操作完成。'); await saveConnectionDraft(store, draft, { activate: !editing.isExisting }); closeEditing(); }} />}
  </fieldset>;
};
