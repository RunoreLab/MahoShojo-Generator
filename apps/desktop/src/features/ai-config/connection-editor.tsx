// 连接编辑器与「保存/激活」共享件（D5.1-AIP-3/4）。
//
// 由 `AiConnectionsPanel`（设置页）与 `DesktopAiProviderPanel`（生成页内嵌
// 「新建自定义连接」）共同消费——编辑器只有这一份实现，设置页和生成页不得
// 再各长一套仅外观相似的表单（DESK-AIP-009.3/10）。

import { useEffect, useMemo, useState } from 'react';

import { requiresExplicitPublicHttpConfirmation } from '@mahoshojo/contracts/provider-profile';
import type { DirectProviderProfileV1 } from '@mahoshojo/contracts/provider-profile';
import type { AIModelOption } from '@mahoshojo/ai-core/provider-catalog';

import { ProfileDraftError, type ProfileDraft } from '../providers/profile-draft';
import {
  DesktopSaveConnectionCommitError,
  type DesktopAiConfigStore,
  type DesktopSaveConnectionResult,
} from './desktop-ai-config-store';

export const newConnectionId = () => `conn_${Math.random().toString(36).slice(2, 12)}`;

export interface EditingState {
  draft: ProfileDraft;
  /** 从预设复制时带入的直连模型清单（供 modelId datalist）；自由连接为 null。 */
  presetModels: readonly AIModelOption[] | null;
  isExisting: boolean;
  /** 被编辑 Profile 是否携带 apiKeyRef（决定是否提供「清除凭据」选项）。 */
  hasKeyRef: boolean;
}

export const draftFromProfile = (profile: DirectProviderProfileV1): ProfileDraft => ({
  id: profile.id,
  name: profile.name,
  baseUrl: profile.baseUrl,
  modelId: profile.modelId,
  allowPublicHttp: profile.transport?.allowPublicHttp === true,
});

/**
 * 连接保存的「已保存但未启用」投影（DESK-AIP-003.5/007.2）。
 *
 * Profile+凭据持久化与 overlay 激活可能落在不同的跨介质阶段：保存成功但
 * 激活/列表刷新失败时如实区分——错误文案告诉用户去「设为当前」重试，
 * 重试沿用同一 `draft.id`，不产生第二条 Profile。
 */
export const saveConnectionDraft = async (
  store: DesktopAiConfigStore,
  draft: ProfileDraft,
  options: { activate?: boolean } = {},
): Promise<void> => {
  // 阶段一：native 提交事务。只有提交阶段的失败才需要核验候选是否已落盘
  // （DesktopSaveConnectionCommitError 携带本次候选文档）；草稿校验、单飞
  // 互斥拒绝等从未触达持久化的错误原样透传。
  let result: DesktopSaveConnectionResult;
  try {
    result = await store.saveConnection(draft);
  } catch (cause) {
    if (cause instanceof DesktopSaveConnectionCommitError) {
      // 「同 ID 记录存在」不等于「本次修改已保存」——编辑既有连接失败时旧
      // 版本仍在。按完整候选文档核验落盘版本；核验不到才按失败上报。
      const persisted = await store
        .isSubmittedProfilePersisted(cause.candidate)
        .catch(() => false);
      if (persisted) {
        // 已落盘但响应回程失败——如实呈现部分成功；重试沿用同一
        // draft.id，不产生第二条 Profile。
        throw new Error(
          options.activate === true
            ? `连接已保存，但启用为当前连接失败：${cause.message}。可在连接列表中对该连接「设为当前」。`
            : `连接已保存，但保存结果返回失败：${cause.message}。连接内容已生效，可关闭编辑器。`,
        );
      }
    }
    throw cause;
  }

  // 阶段二：提交返回后的核验与激活。Profile 本体已确认提交——失败如实
  // 呈现为「已保存但未启用/核验」，不回退成「保存失败」。
  if (!result.persisted) {
    // 保存主流程返回但 native 记录核验失败——不声称已保存，也不假装全失败。
    throw new Error(
      '连接保存结果无法核验：本地存储未返回该连接记录，请检查系统凭据/存储后重试',
    );
  }
  if (options.activate === true) {
    try {
      store.activateConnection(draft.id);
    } catch (cause) {
      throw new Error(
        `连接已保存，但启用为当前连接失败：${
          cause instanceof Error ? cause.message : '配置写入失败'
        }。可在连接列表中对该连接「设为当前」。`,
      );
    }
    // 激活是显式操作但不抛出内部细节（未知 Profile/无效模型静默 no-op）；
    // 这里做结果核验——选择没真正切过去就按「已保存但未启用」处理。
    const selection = store.getSnapshot().selection;
    if (
      selection.executionPreference !== 'client' ||
      selection.clientConnectionId !== draft.id
    ) {
      throw new Error(
        '连接已保存，但启用为当前连接失败：配置写入未生效。可在连接列表中对该连接「设为当前」。',
      );
    }
  }
};

export const ConnectionEditor = ({
  editing,
  existingSecretKnown,
  saving,
  saveLabel,
  onCancel,
  onSave,
  onDirtyChange,
}: {
  editing: EditingState;
  existingSecretKnown: boolean;
  saving: boolean;
  /** 提交按钮文案：新建流程传「保存并使用」，编辑既有连接传「保存连接」。 */
  saveLabel: string;
  onCancel: () => void;
  onSave: (draft: ProfileDraft) => Promise<void>;
  /**
   * 未保存修改状态上抛（含易失 Key 输入）：父级据此在切换编辑对象、
   * 切换供应商、跳转管理页等路径上统一做离开确认（r1 草稿竞态收口）。
   */
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const [draft, setDraft] = useState<ProfileDraft>(editing.draft);
  const [error, setError] = useState<string | null>(null);
  // P1 草稿竞态：连续编辑 A、B 且组件未卸载时，残留草稿会被当成新对象提交。
  // 按连接身份在渲染期同步重置（React「render 期间调整 state」模式）；
  // 调用方同时以 key={draft.id} 强制重挂载获得完整重置，两者互为冗余。
  const [seenDraftId, setSeenDraftId] = useState(editing.draft.id);
  if (seenDraftId !== editing.draft.id) {
    setSeenDraftId(editing.draft.id);
    setDraft(editing.draft);
    setError(null);
  }
  const needsHttpConfirm = useMemo(
    () => requiresExplicitPublicHttpConfirmation(draft.baseUrl.trim()),
    [draft.baseUrl],
  );

  const patch = (changes: Partial<ProfileDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setError(null);
  };

  // DESK-AIP-003.7：存在未保存修改（含易失 Key 输入）时关闭表单需显式确认；
  // 确认放弃后明文只随 React state 丢弃，不进入任何持久化草稿。
  const isDirty =
    draft.name !== editing.draft.name ||
    draft.baseUrl !== editing.draft.baseUrl ||
    draft.modelId !== editing.draft.modelId ||
    (draft.apiKey ?? '') !== '' ||
    draft.allowPublicHttp !== editing.draft.allowPublicHttp ||
    draft.clearApiKey === true;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
  const cancelEditing = () => {
    if (
      isDirty &&
      typeof window !== 'undefined' &&
      !window.confirm('连接配置有未保存的更改（包括已输入的 API Key），确认放弃？')
    ) {
      return;
    }
    onCancel();
  };

  const submit = async () => {
    setError(null);
    try {
      // 用户明确勾选过 allowPublicHttp 才写入；非 loopback http 未勾选时让 schema 拒绝。
      let payload: ProfileDraft = needsHttpConfirm
        ? draft
        : { ...draft, allowPublicHttp: undefined };
      // 清除凭据时丢弃录入框内容，避免与「更换」语义撞车（store 也会拒）。
      if (payload.clearApiKey === true) {
        payload = { ...payload, apiKey: undefined };
      }
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
        <span className="battle-lite-muted-text">默认模型 id</span>
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
          disabled={draft.clearApiKey === true}
          placeholder={
            draft.clearApiKey === true
              ? '保存时清除已存凭据'
              : editing.isExisting && existingSecretKnown
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
      {editing.isExisting && editing.hasKeyRef && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={draft.clearApiKey === true}
            onChange={(event) => patch({ clearApiKey: event.target.checked })}
          />
          <span className="battle-lite-muted-text">
            清除已保存的 API Key（保存后该连接不再携带凭据）
          </span>
        </label>
      )}
      {error && <p className="battle-lite-subtle-text text-xs">保存失败：{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg bg-(--app-accent) px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? '保存中…' : saveLabel}
        </button>
        <button
          type="button"
          className="rounded-lg border border-(--app-border-strong) px-3 py-1.5 text-xs disabled:opacity-50"
          // 保存进行中禁止关闭编辑器：取消=「放弃未提交的表单」，不是撤销已
          // 发起的保存事务——此时关闭会让迟到的成功看起来像「取消后仍保存」。
          disabled={saving}
          onClick={cancelEditing}
        >
          取消
        </button>
      </div>
    </div>
  );
};
