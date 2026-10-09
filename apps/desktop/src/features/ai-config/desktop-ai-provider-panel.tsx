// Web / Desktop 共用展示骨架；执行位置与稳定目标身份独立，预设不创建 Profile。
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from '@tanstack/react-router';
import { getModelGenerationCapabilities } from '@mahoshojo/ai-core/generation-settings';
import { SYSTEM_PROVIDER_OPTION } from '@mahoshojo/ai-core/provider-catalog';
import {
  AdvancedGenerationSettings, AiExecutionLocationField, AiProviderCustomSelect,
  AiProviderSelectorForm, AiProviderModelIdInput, describeAiDirectUnsupportedReason,
  type AiProviderSelectOption,
} from '@mahoshojo/ui-web/ai-provider';
import { navigateByProductHref } from '../../app/hash-history-fragment';
import { useDesktopAiConfig } from './use-desktop-ai-config';
import { DESKTOP_SYSTEM_OVERRIDES_SCOPE, listDesktopPresetEntries, resolveDesktopAiTarget, selectedProviderTarget } from './desktop-ai-config';
import { ConnectionEditor, draftFromProfile, newConnectionId, saveConnectionDraft, type EditingState } from './connection-editor';
import { ConnectionTestSection } from './connection-test';

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
}

export const DesktopAiProviderPanel = ({ controlsSlot, management = false }: DesktopAiProviderPanelProps) => {
  const { state, store } = useDesktopAiConfig();
  const router = useRouter();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState(false);
  const target = resolveDesktopAiTarget(state.selection, state.profiles, state.generationOverrides, state.modelsByProfileId, state.presetsByProviderId);
  const identity = selectedProviderTarget(state.selection);
  const preset = target.preset;
  const profile = target.profile;
  const isSystem = identity?.kind === 'system';
  const disabled = state.overlayState !== 'ready' || state.generationActive || state.savingCredential || state.savingConnection || state.deletingConnection;
  const presetId = identity?.kind === 'preset' ? identity.providerId : null;
  const keyDraft = presetId ? store.getPresetKeyDraft(presetId) : '';
  const identityKey = JSON.stringify(identity);
  useEffect(() => { setCustomModel(false); setError(null); }, [identityKey, target.location]);
  useEffect(() => { if (presetId) void store.refreshPresetSecret(presetId); }, [presetId, store]);

  const act = (fn: () => void) => { try { fn(); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : '配置更新失败'); } };
  const closeEditing = () => { setEditing(null); setEditorDirty(false); };
  const confirmDiscardEditing = () => !editorDirty || window.confirm('连接配置有未保存的更改（包括已输入的 API Key），确认放弃？');
  const openEditor = (next: EditingState) => { if (confirmDiscardEditing()) setEditing(next); };
  const openNew = () => openEditor({ draft: { id: newConnectionId(), name: '', baseUrl: '', modelId: '' }, presetModels: null, isExisting: false, hasKeyRef: false });
  const openEdit = () => { if (profile) openEditor({ draft: draftFromProfile(profile), presetModels: null, isExisting: true, hasKeyRef: !!profile.apiKeyRef }); };
  const copyPreset = () => { if (preset && target.modelId) openEditor({ draft: { id: newConnectionId(), name: preset.name, baseUrl: preset.baseUrl, modelId: target.modelId }, presetModels: preset.models, isExisting: false, hasKeyRef: false }); };

  const providerOptions: AiProviderSelectOption[] = [
    ...(target.location === 'server' ? [{ value: 'system', label: SYSTEM_PROVIDER_OPTION.name, description: SYSTEM_PROVIDER_OPTION.description, kind: 'builtin' }] : []),
    ...listDesktopPresetEntries(state.hiddenPresetIds).filter((entry) => !entry.hidden).map((entry) => {
      const enabled = target.location === 'server' || entry.directCapableModels.length > 0;
      return { value: `preset:${entry.preset.id}`, label: entry.preset.name, description: entry.preset.description, group: '内置供应商', kind: 'preset', ...(!enabled ? { disabled: true, disabledReason: entry.presetSupport.supported ? '暂无可直连的收录模型' : describeAiDirectUnsupportedReason(entry.presetSupport.reason) } : {}) };
    }),
    ...(target.location === 'client' ? state.profiles.map((item) => ({ value: `custom:${item.id}`, label: item.name, description: `默认模型 ${item.modelId}`, group: '我的连接', kind: 'connection' })) : []),
  ];
  const providerValue = identity?.kind === 'system' ? 'system' : identity?.kind === 'preset' ? `preset:${identity.providerId}` : identity?.kind === 'custom' ? `custom:${identity.profileId}` : '';
  const modelOptions: AiProviderSelectOption[] = target.availableModelIds.map((id) => {
    const model = (isSystem ? SYSTEM_PROVIDER_OPTION.models : preset?.models)?.find((entry) => entry.value === id);
    return { value: id, label: model?.label ?? id, description: model?.description ?? (id === profile?.modelId ? '默认模型' : '自定义模型'), kind: 'model' };
  });
  if (target.modelId && !target.availableModelIds.includes(target.modelId)) modelOptions.unshift({ value: target.modelId, label: target.modelId, disabled: true, disabledReason: isSystem ? '该系统模型已不在支持列表中，请重新选择' : '模型已从列表移除，请重新选择' });
  const changeModel = (id: string) => act(() => {
    if (presetId) store.selectPresetModel(presetId, id);
    else if (profile) store.selectModel(profile.id, id);
    else store.selectSystemModel(id);
    setCustomModel(false);
  });
  const scope = preset?.id ?? (isSystem ? DESKTOP_SYSTEM_OVERRIDES_SCOPE : profile?.id);
  const capabilities = scope && target.modelId ? getModelGenerationCapabilities(scope, target.modelId) : undefined;
  const status = presetId ? state.presetSecretStatus[presetId] : profile ? state.secretStatus[profile.id] : undefined;
  const statusLabel = status === 'present' ? '已配置 API Key' : status === 'error' ? '凭据状态读取失败' : status === 'absent' ? '尚未配置 API Key' : '正在确认凭据状态';
  const asyncAct = (fn: () => Promise<void>) => { void fn().then(() => setError(null)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '凭据操作失败')); };

  return <>
    <AiExecutionLocationField value={target.location} client={{ enabled: !disabled }} server={{ enabled: !disabled }} onChange={(location) => act(() => {
      if (!confirmDiscardEditing()) return;
      // 易失 Key 按预设身份保留，切换位置或供应商不会转移给另一目标。
      store.selectExecutionLocation(location);
      closeEditing();
    })} />
    {controlsSlot}
    <AiProviderSelectorForm
      label="AI 提供商"
      providerSelect={<AiProviderCustomSelect options={providerOptions} value={providerValue} placeholder="选择供应商" disabled={disabled}
        onChange={(value) => act(() => {
          if (!confirmDiscardEditing()) return;
          if (value === 'system') store.selectProviderTarget({ kind: 'system' });
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
          if (id === 'new') openNew();
          if (id === 'edit') openEdit();
          if (id === 'copy') copyPreset();
          if (id === 'manage' && confirmDiscardEditing()) navigateByProductHref(router, '/settings?section=generation');
        }} />}
      providerExtra={profile ? <p className="break-all text-xs">接收方：{profile.baseUrl} · 模型：{target.modelId ?? profile.modelId}</p> : undefined}
      modelSelect={<AiProviderCustomSelect options={modelOptions} value={target.modelId ?? ''} onChange={changeModel} placeholder="选择模型" disabled={disabled || !identity}
        actions={!isSystem && identity ? [{ id: 'custom-model', label: '自定义模型 ID' }, ...(profile && target.modelId && (state.modelsByProfileId[profile.id]?.customModelIds.includes(target.modelId) || state.modelsByProfileId[profile.id]?.inlineModelId === target.modelId) ? [{ id: 'remove-model', label: `移除模型「${target.modelId}」` }] : [])] : []}
        onAction={(id) => { if (id === 'remove-model' && profile && target.modelId) act(() => store.removeCustomModel(profile.id, target.modelId!)); else setCustomModel(true); }} />}
      customModelId={!isSystem && identity && customModel ? {
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
      advancedSettings={identity && (target.location === 'server' || target.mode !== null) && <AdvancedGenerationSettings value={target.generationOverrides} onChange={(next) => act(() => {
        if (!target.modelId) return;
        if (presetId) store.setPresetGenerationOverrides(presetId, target.modelId, next);
        else if (scope) store.setGenerationOverrides(scope, target.modelId, next);
      })} temperatureSupported={capabilities ? capabilities.temperature.support !== 'unsupported' : true} temperatureMax={capabilities?.temperature.max} maxOutputTokensMax={capabilities?.maxOutputTokens.max} thinkingSupport={capabilities?.thinking.support ?? 'unknown'} thinkingEfforts={capabilities?.thinking.efforts} canDisableThinking={capabilities ? capabilities.thinking.support === 'supported' && capabilities.thinking.canDisable !== false : true} />}
    >
      {profile && target.mode && <ConnectionTestSection target={target} />}
    </AiProviderSelectorForm>
    {(error || state.modelInputError) && <p role="alert">{error ?? state.modelInputError}</p>}
    {target.unavailableReason && <p role="status">{target.unavailableReason}</p>}
    {editing && <ConnectionEditor editing={editing} existingSecretKnown={state.secretStatus[editing.draft.id] === 'present'} saving={state.savingConnection || state.generationActive} saveLabel={editing.isExisting ? '保存连接' : '保存并使用'} onCancel={closeEditing} onDirtyChange={setEditorDirty} onSave={async (draft) => { await saveConnectionDraft(store, draft, { activate: !editing.isExisting }); closeEditing(); }} />}
  </>;
};
