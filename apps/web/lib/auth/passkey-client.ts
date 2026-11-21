import { useEffect, useState } from 'react';
import {
  PASSKEY_API_PREFIX, PASSKEY_ROUTES, PasskeyAssertionSchema,
  type PasskeyAssertion, type PasskeyConfirmation, type PasskeyCreationOptions,
  type PasskeyManagementAction, type PasskeyRequestOptions, type PasskeySummary,
} from '@/lib/auth/passkey-contract';

export class PasskeyClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

const errors: Record<string, string> = {
  PASSKEY_UNAVAILABLE: '通行密钥服务暂不可用。',
  PASSKEY_NOT_VERIFIED: '未能验证通行密钥，请重试或使用密码。',
  PASSKEY_WRONG_PASSWORD: '当前密码不正确。',
  PASSKEY_PASSWORD_REQUIRED: '这项操作需要确认当前密码。',
  PASSKEY_ACCOUNT_UNAVAILABLE: '当前账号无法管理通行密钥。',
  PASSKEY_STATE_CHANGED: '通行密钥列表或会话已变化，请刷新后重试。',
  PASSKEY_LIMIT: '通行密钥数量已达上限。',
  PASSKEY_RATE_LIMITED: '操作太频繁，请稍后重试。',
  UNAUTHORIZED: '登录状态已失效，请重新登录。',
};

async function request<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(PASSKEY_API_PREFIX + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    const code = typeof payload?.code === 'string' ? payload.code : '';
    const fallback = response.status === 429 ? errors.PASSKEY_RATE_LIMITED : '通行密钥操作未完成，请重试。';
    throw new PasskeyClientError(code, Object.prototype.hasOwnProperty.call(errors, code) ? errors[code] : fallback);
  }
  return payload as T;
}

export function supportsPasskeys() {
  return typeof window !== 'undefined' && window.isSecureContext && window.self === window.top
    && typeof window.PublicKeyCredential?.parseCreationOptionsFromJSON === 'function'
    && typeof window.PublicKeyCredential?.parseRequestOptionsFromJSON === 'function'
    && typeof window.PublicKeyCredential?.prototype.toJSON === 'function';
}

export function usePasskeysEnabled(active: boolean) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!active || !window.isSecureContext || window.self !== window.top) return;
    const controller = new AbortController();
    request<{ enabled: boolean }>(PASSKEY_ROUTES.status, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setEnabled(result.enabled === true); },
      () => { if (!controller.signal.aborted) setEnabled(false); },
    );
    return () => controller.abort();
  }, [active]);
  return active && enabled;
}

async function webauthn(signal: AbortSignal, run: () => Promise<Credential | null>) {
  if (!supportsPasskeys()) throw new PasskeyClientError('UNSUPPORTED', '当前浏览器无法使用通行密钥。');
  signal.throwIfAborted();
  try {
    const credential = await run();
    if (!(credential instanceof PublicKeyCredential)) throw new Error('Missing public key credential');
    return credential.toJSON();
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof DOMException) {
      if (error.name === 'InvalidStateError') {
        throw new PasskeyClientError(error.name, '此验证器已保存该账号的通行密钥，可改用另一台设备或安全密钥。');
      }
      if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
        throw new PasskeyClientError(error.name, '操作已取消、超时，或没有可用的通行密钥。');
      }
    }
    throw new PasskeyClientError('BROWSER_ERROR', '浏览器未能完成通行密钥操作，请重试或使用密码。');
  }
}

async function authenticate({ flowId, options }: PasskeyRequestOptions, signal: AbortSignal): Promise<PasskeyAssertion> {
  const response = await webauthn(signal, () => navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
    signal,
  }));
  const parsed = PasskeyAssertionSchema.safeParse({ flowId, response });
  if (!parsed.success) throw new PasskeyClientError('BROWSER_ERROR', '浏览器未能返回有效的通行密钥证明。');
  return parsed.data;
}

export async function requestPasskeyLoginAssertion(signal: AbortSignal): Promise<PasskeyAssertion> {
  const challenge = await request<PasskeyRequestOptions>(PASSKEY_ROUTES.loginOptions, signal, {});
  return authenticate(challenge, signal);
}

export const completePasskeyLogin = (assertion: PasskeyAssertion, signal: AbortSignal) =>
  request<{ success: true; userId: number }>(PASSKEY_ROUTES.login, signal, assertion);

export const getPasskeys = (signal: AbortSignal) =>
  request<{ passkeys: PasskeySummary[]; limit: number }>(PASSKEY_ROUTES.list, signal);

export async function confirmWithPasskey(action: PasskeyManagementAction, signal: AbortSignal): Promise<PasskeyConfirmation> {
  const challenge = await request<PasskeyRequestOptions>(PASSKEY_ROUTES.confirmOptions, signal, action);
  return { method: 'passkey', ...await authenticate(challenge, signal) };
}

export async function addAccountPasskey(name: string, confirmation: PasskeyConfirmation, signal: AbortSignal) {
  const { flowId, options } = await request<PasskeyCreationOptions>(PASSKEY_ROUTES.registerOptions, signal, { confirmation });
  const response = await webauthn(signal, () => navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
    signal,
  }));
  signal.throwIfAborted();
  return request<{ passkey: PasskeySummary }>(PASSKEY_ROUTES.register, signal, { flowId, response, name: name || undefined });
}

export const renameAccountPasskey = (id: string, name: string, signal: AbortSignal) =>
  request<{ success: true }>(PASSKEY_ROUTES.rename, signal, { id, name });

export const deleteAccountPasskey = (id: string, confirmation: PasskeyConfirmation, signal: AbortSignal) =>
  request<{ success: true }>(PASSKEY_ROUTES.delete, signal, { id, confirmation });
