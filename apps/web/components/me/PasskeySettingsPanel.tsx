'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import type { AuthSessionSource } from '@/lib/auth';
import { captureAuthIdentity } from '@/lib/auth-identity';
import {
  addAccountPasskey, confirmWithPasskey, deleteAccountPasskey, getPasskeys, PasskeyClientError,
  renameAccountPasskey, supportsPasskeys, usePasskeysEnabled,
} from '@/lib/auth/passkey-client';
import {
  PASSKEY_MAX_NAME_LENGTH, type PasskeyManagementAction, type PasskeySummary,
} from '@/lib/auth/passkey-contract';

type Action = { kind: 'register' } | { kind: 'rename' | 'delete'; key: PasskeySummary };
type Notice = { kind: 'error' | 'success'; text: string };
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-(--app-border-strong) bg-(--app-surface) px-3 py-2 text-sm font-medium text-(--app-text) focus-visible:outline-2 focus-visible:outline-(--app-accent-strong) disabled:opacity-50';
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

export function PasskeySettingsPanel({ userId, authSource, identityEpoch }: {
  userId: number;
  authSource: AuthSessionSource | null;
  identityEpoch: number;
}) {
  const enabled = usePasskeysEnabled(true);
  const supported = supportsPasskeys();
  const headingId = useId();
  const query = useQuery({
    queryKey: ['account-passkeys', userId, identityEpoch],
    queryFn: ({ signal }) => getPasskeys(signal),
    enabled: enabled && authSource === 'better-auth-session',
    retry: false,
    gcTime: 0,
  });
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [method, setMethod] = useState<'passkey' | 'password'>('password');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const flight = useRef<AbortController | null>(null);
  useEffect(() => () => flight.current?.abort(), []);

  const keys = query.data?.passkeys ?? [];
  const canConfirmWithKey = (kind: Action['kind']) => supported && keys.length > (kind === 'delete' ? 1 : 0);
  const passwordOnly = action !== null && !canConfirmWithKey(action.kind);
  const confirmationMethod = passwordOnly ? 'password' : method;

  const open = (next: Action) => {
    setNotice(null);
    setPassword('');
    setName(next.kind === 'rename' ? next.key.name : '');
    setMethod(canConfirmWithKey(next.kind) ? 'passkey' : 'password');
    setAction(next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action || flight.current) return;
    const identity = captureAuthIdentity();
    if (!identity.isCurrent()) return;
    const controller = new AbortController();
    flight.current = controller;
    const { signal } = controller;
    setBusy(true);
    setNotice(null);
    const currentPassword = password;
    setPassword('');
    try {
      if (action.kind === 'rename') {
        await renameAccountPasskey(action.key.id, name.trim(), signal);
      } else {
        const intent: PasskeyManagementAction = action.kind === 'delete'
          ? { kind: 'delete', id: action.key.id }
          : { kind: 'register' };
        const confirmation = confirmationMethod === 'passkey'
          ? await confirmWithPasskey(intent, signal)
          : { method: 'password' as const, password: currentPassword };
        if (!identity.isCurrent() || signal.aborted) return;
        if (action.kind === 'register') {
          await addAccountPasskey(name.trim(), confirmation, signal);
        } else {
          await deleteAccountPasskey(action.key.id, confirmation, signal);
        }
      }
      if (!identity.isCurrent() || signal.aborted) return;
      setAction(null);
      setNotice({ kind: 'success', text: action.kind === 'register' ? '已添加通行密钥。'
        : action.kind === 'rename' ? '已更新通行密钥名称。' : '已删除通行密钥。' });
      await query.refetch();
    } catch (error) {
      if (!identity.isCurrent() || signal.aborted) return;
      if (error instanceof PasskeyClientError && ['PASSKEY_STATE_CHANGED', 'PASSKEY_PASSWORD_REQUIRED', 'PASSKEY_LIMIT'].includes(error.code)) {
        setAction(null);
        await query.refetch();
      }
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '通行密钥操作未完成。' });
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        if (!signal.aborted && identity.isCurrent()) setBusy(false);
      }
    }
  };

  if (!enabled) return null;
  return (
    <section aria-labelledby={headingId} className="mt-4 space-y-3 rounded-lg border border-(--app-border-strong) bg-(--app-surface) p-3 text-(--app-text)">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="flex items-center gap-2 font-semibold">
          <KeyRound size={16} aria-hidden="true" />
          通行密钥
        </h3>
        {query.data && supported && keys.length < query.data.limit ? (
          <button type="button" className={button} onClick={() => open({ kind: 'register' })} disabled={busy || !!action}>
            <Plus size={16} aria-hidden="true" /> 添加通行密钥
          </button>
        ) : null}
      </div>
      {authSource !== 'better-auth-session' ? (
        <p className="text-sm text-(--app-text-muted)">请先完成账号迁移并使用密码登录，然后添加通行密钥。</p>
      ) : null}
      {authSource === 'better-auth-session' && query.isPending ? (
        <p role="status" className="text-sm text-(--app-text-muted)">正在读取通行密钥…</p>
      ) : null}
      {query.isError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm">{query.error.message}</p>
          <button type="button" className={button} onClick={() => void query.refetch()}>重试</button>
        </div>
      ) : null}
      {query.data && !keys.length ? (
        <p className="text-sm text-(--app-text-muted)">尚未添加通行密钥。</p>
      ) : null}
      {query.data && keys.length >= query.data.limit ? (
        <p className="text-sm text-(--app-text-muted)">通行密钥已达上限（{query.data.limit} 把）。</p>
      ) : null}
      {!supported && authSource === 'better-auth-session' ? (
        <p className="text-sm text-(--app-text-muted)">请使用支持通行密钥的浏览器添加新凭据。可在这里用密码删除已绑定的凭据。</p>
      ) : null}
      {keys.length > 0 ? (
        <ul className="divide-y divide-(--app-border-strong)">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="break-all text-sm font-medium">{key.name}</div>
                <div className="text-xs text-(--app-text-muted)">
                  创建于 {dateFormat.format(key.createdAt)} · 最近使用 {key.lastUsedAt ? dateFormat.format(key.lastUsedAt) : '从未'}
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className={button} aria-label={`改名 ${key.name}`}
                  disabled={busy || !!action} onClick={() => open({ kind: 'rename', key })}>
                  <Pencil size={16} aria-hidden="true" /> 改名
                </button>
                <button type="button" className={button} aria-label={`删除 ${key.name}`}
                  disabled={busy || !!action} onClick={() => open({ kind: 'delete', key })}>
                  <Trash2 size={16} aria-hidden="true" /> 删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {action ? (
        <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded-lg border border-(--app-border-strong) p-3">
          {action.kind !== 'delete' ? (
            <label className="block text-sm font-medium">
              {action.kind === 'register' ? '通行密钥名称（可选）' : '新名称'}
              <input className="input-field mt-1" value={name} maxLength={PASSKEY_MAX_NAME_LENGTH}
                onChange={(event) => setName(event.target.value)} required={action.kind === 'rename'} disabled={busy} />
            </label>
          ) : (
            <p className="break-all text-sm">
              删除「{action.key.name}」后将无法再用它登录。设备上的副本可以在密码管理器中删除。
            </p>
          )}
          {action.kind !== 'rename' ? (
            <fieldset disabled={busy} className="space-y-2">
              <legend className="text-sm font-medium">确认身份</legend>
              {!passwordOnly ? (
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="passkey-confirmation" checked={method === 'passkey'} onChange={() => setMethod('passkey')} />
                    已绑定的通行密钥
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="passkey-confirmation" checked={method === 'password'} onChange={() => setMethod('password')} />
                    密码
                  </label>
                </div>
              ) : null}
              {confirmationMethod === 'password' ? (
                <label className="block text-sm">
                  当前密码
                  <input type="password" autoComplete="current-password" className="input-field mt-1"
                    value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} />
                </label>
              ) : null}
            </fieldset>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={button}
              disabled={busy || (action.kind === 'rename' && !name.trim()) || (action.kind !== 'rename' && confirmationMethod === 'password' && !password)}>
              {busy ? '处理中…' : action.kind === 'register' ? '确认添加' : action.kind === 'delete' ? '确认删除' : '保存名称'}
            </button>
            <button type="button" disabled={busy} className={button} onClick={() => { setAction(null); setPassword(''); }}>取消</button>
          </div>
        </form>
      ) : null}
      {notice ? <p role={notice.kind === 'error' ? 'alert' : 'status'} className="text-sm">{notice.text}</p> : null}
    </section>
  );
}
