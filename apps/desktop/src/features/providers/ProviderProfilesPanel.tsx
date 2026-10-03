import { useCallback, useEffect, useMemo, useState } from 'react';

import { invoke } from '@tauri-apps/api/core';

import {
  createDesktopAiExecutionPort,
  type DesktopAiExecutionOptions,
} from '../../platform/desktop-ai-execution';
import { DesktopAiError } from '../../platform/direct-ai-bridge';

import {
  PROVIDER_PRESETS,
  ProfileDraftError,
  loadProfileIds,
  profileHasStoredSecret,
  removeProfile,
  saveProfileDraft,
  type ProfileDraft,
} from './profile-draft';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; profileIds: string[] }
  | { status: 'failed'; message: string };

type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'failed'; message: string };

type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; text: string }
  | { status: 'cancelled' }
  | { status: 'failed'; code: string; message: string };

const newId = () => `p_${Math.random().toString(36).slice(2, 10)}`;

/**
 * D1 的最小 Provider Profile 面板。
 *
 * 只做三件事：保存 Profile、显示已保存列表、跑一次生成测试。它刻意不含完整设置页——
 * 业务迁移必须等 Direct 通路与本地库各自通过门禁之后再开始。
 */
export const ProviderProfilesPanel = () => {
  const [draft, setDraft] = useState<ProfileDraft>(() => ({
    id: newId(),
    name: PROVIDER_PRESETS[0].name,
    baseUrl: PROVIDER_PRESETS[0].baseUrl,
    modelId: '',
  }));
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [testState, setTestState] = useState<TestState>({ status: 'idle' });
  const [secretHint, setSecretHint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoadState({ status: 'ready', profileIds: await loadProfileIds() });
    } catch (cause) {
      setLoadState({
        status: 'failed',
        message: cause instanceof Error ? cause.message : 'cannot list profiles',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patch = (changes: Partial<ProfileDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setSaveState({ status: 'idle' });
    setTestState({ status: 'idle' });
  };

  const onSave = async () => {
    setSaveState({ status: 'saving' });
    setSecretHint(null);
    try {
      const outcome = await saveProfileDraft(draft);
      setSecretHint(
        outcome.secretWritten
          ? '凭据已写入操作系统凭据存储，本页面不会再显示它。'
          : '未填写 API Key：若此前已保存凭据则保持不变。',
      );
      // 明文用完即弃：不写进任何状态，避免随组件生命周期延长暴露窗口。
      setDraft((current) => ({ ...current, apiKey: undefined }));
      setSaveState({ status: 'idle' });
      await refresh();
    } catch (cause) {
      setSaveState({
        status: 'failed',
        message:
          cause instanceof ProfileDraftError
            ? `${cause.field}: ${cause.message}`
            : cause instanceof Error
              ? cause.message
              : 'cannot save the profile',
      });
    }
  };

  const onTest = async () => {
    if (testState.status === 'running') return;
    setTestState({ status: 'running' });

    const controller = new AbortController();
    const options: DesktopAiExecutionOptions = { invoke, profileId: draft.id };
    const port = createDesktopAiExecutionPort(options);

    // 直接用 execute()：它已经把流收集与协议归约做完，这里不需要再维护第二套判断。
    const pending = port.execute(
      {
        requestId: newId(),
        contractVersion: 1,
        mode: 'direct-local',
        messages: [{ role: 'user', content: '用一句话介绍你自己。' }],
      },
      controller.signal,
    );
    const abort = () => controller.abort();
    window.addEventListener('beforeunload', abort);

    try {
      const result = await pending;
      setTestState(
        result.status === 'completed'
          ? { status: 'done', text: result.output.text ?? '' }
          : result.status === 'cancelled'
            ? { status: 'cancelled' }
            : {
                status: 'failed',
                code: result.error.code,
                message: result.error.message ?? 'Direct AI failed',
              },
      );
    } catch (cause: unknown) {
      setTestState({
        status: 'failed',
        code: cause instanceof DesktopAiError ? cause.code : 'internal-error',
        message: cause instanceof Error ? cause.message : 'Direct AI failed',
      });
    } finally {
      window.removeEventListener('beforeunload', abort);
    }
  };

  const onDelete = async (profileId: string) => {
    await removeProfile(profileId).catch(() => undefined);
    await refresh();
  };

  const canRunTest = useMemo(
    () => draft.id.trim().length > 0 && draft.modelId.trim().length > 0,
    [draft.id, draft.modelId],
  );

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-white/10 bg-(--color-surface-raised) p-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-(--color-ink-muted)">Direct Provider Profile</h2>
        <p className="text-xs text-(--color-ink-muted)">
          凭据只写入操作系统凭据存储，保存后本页无法再读回。Endpoint 由 native 侧从本地库解析。
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-(--color-ink-muted)">Profile id</span>
          <input
            className="rounded border border-white/15 bg-black/20 px-2 py-1 text-sm"
            value={draft.id}
            onChange={(event) => patch({ id: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-(--color-ink-muted)">显示名</span>
          <input
            className="rounded border border-white/15 bg-black/20 px-2 py-1 text-sm"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">
          <span className="text-(--color-ink-muted)">Endpoint（OpenAI-compatible 根路径）</span>
          <input
            className="rounded border border-white/15 bg-black/20 px-2 py-1 font-mono text-sm"
            value={draft.baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-(--color-ink-muted)">模型 id</span>
          <input
            className="rounded border border-white/15 bg-black/20 px-2 py-1 font-mono text-sm"
            placeholder="例如 qwen3:8b"
            value={draft.modelId}
            onChange={(event) => patch({ modelId: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-(--color-ink-muted)">API Key（可留空）</span>
          <input
            className="rounded border border-white/15 bg-black/20 px-2 py-1 text-sm"
            type="password"
            autoComplete="off"
            value={draft.apiKey ?? ''}
            onChange={(event) => patch({ apiKey: event.target.value })}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {PROVIDER_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className="rounded border border-white/15 px-2 py-1 text-xs"
            onClick={() =>
              patch({ name: preset.name, baseUrl: preset.baseUrl })
            }
          >
            套用 {preset.name}
          </button>
        ))}
        <button
          type="button"
          className="rounded bg-(--color-accent) px-3 py-1 text-xs font-medium text-black"
          onClick={() => void onSave()}
          disabled={saveState.status === 'saving'}
        >
          {saveState.status === 'saving' ? '保存中…' : '保存 Profile'}
        </button>
        <button
          type="button"
          className="rounded border border-white/20 px-3 py-1 text-xs"
          onClick={() => void onTest()}
          disabled={!canRunTest || testState.status === 'running'}
        >
          {testState.status === 'running' ? '生成中…' : '生成测试'}
        </button>
      </div>

      {secretHint && <p className="text-xs text-(--color-ink-muted)">{secretHint}</p>}
      {saveState.status === 'failed' && (
        <p className="text-xs text-(--color-accent)">保存失败：{saveState.message}</p>
      )}
      {testState.status === 'done' && (
        <p className="text-xs whitespace-pre-wrap">测试输出：{testState.text}</p>
      )}
      {testState.status === 'cancelled' && <p className="text-xs">已取消。</p>}
      {testState.status === 'failed' && (
        <p className="text-xs text-(--color-accent)">
          测试失败（{testState.code}）：{testState.message}
        </p>
      )}

      <div className="flex flex-col gap-1 border-t border-white/10 pt-3">
        <span className="text-xs text-(--color-ink-muted)">已保存</span>
        {loadState.status === 'loading' && <span className="text-xs">读取中…</span>}
        {loadState.status === 'failed' && (
          <span className="text-xs text-(--color-accent)">{loadState.message}</span>
        )}
        {loadState.status === 'ready' && loadState.profileIds.length === 0 && (
          <span className="text-xs">尚未保存任何 Profile。</span>
        )}
        {loadState.status === 'ready' &&
          loadState.profileIds.map((profileId) => (
            <ProfileRow
              key={profileId}
              profileId={profileId}
              onUse={() => patch({ id: profileId })}
              onDelete={() => void onDelete(profileId)}
            />
          ))}
      </div>
    </section>
  );
};

interface ProfileRowProps {
  profileId: string;
  onUse: () => void;
  onDelete: () => void;
}

const ProfileRow = ({ profileId, onUse, onDelete }: ProfileRowProps) => {
  const [hasSecret, setHasSecret] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    profileHasStoredSecret(profileId)
      .then((value) => {
        if (!cancelled) setHasSecret(value);
      })
      .catch(() => {
        if (!cancelled) setHasSecret(null);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-mono">{profileId}</span>
      <span className="text-(--color-ink-muted)">
        {hasSecret === null ? '凭据状态未知' : hasSecret ? '已存凭据' : '无凭据，请重新录入 API Key'}
      </span>
      <button type="button" className="ml-auto underline" onClick={onUse}>
        载入
      </button>
      <button type="button" className="underline" onClick={onDelete}>
        删除
      </button>
    </div>
  );
};
