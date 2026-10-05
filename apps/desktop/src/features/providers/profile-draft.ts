import { invoke } from '@tauri-apps/api/core';

import {
  DirectProviderProfileV1Schema,
  MAX_DIRECT_PROVIDER_PROFILE_BYTES,
  type DirectProviderProfileV1,
} from '@mahoshojo/contracts/provider-profile';
import { isDesktopSecretRef } from '@mahoshojo/contracts/desktop-ipc';

import {
  deleteProviderProfile,
  getProviderProfile,
  listProviderProfileIds,
  saveProviderProfile,
  validateProviderExecutionProfile,
} from '../../platform/provider-profile-bridge';
import {
  deleteProviderSecret,
  hasProviderSecret,
  setProviderSecret,
} from '../../platform/secret-bridge';

/**
 * Provider Profile 的用户级流程编排。
 *
 * 这里承担 UI 不该重复的那部分不变式：
 *
 * - secret 引用在保存前就按凭据目标名规则校验，避免写进库才发现不可用；
 * - 明文只在录入那一刻经过这里，随后立即交给 native 写入操作系统凭据存储，**永不**回读；
 * - 保存走 staged secretRef：先把候选 Profile（指向一次性 ref）过 native 校验，
 *   再写凭据、最后落盘；任一失败删除 staged ref 回滚，不留孤儿引用或半成品凭据。
 */

export const PRESET_OLLAMA = {
  name: 'Ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  modelId: '',
} as const;

export const PRESET_LM_STUDIO = {
  name: 'LM Studio',
  baseUrl: 'http://127.0.0.1:1234/v1',
  modelId: '',
} as const;

export const PROVIDER_PRESETS = [PRESET_OLLAMA, PRESET_LM_STUDIO] as const;
export const profileIdPattern = /^[A-Za-z0-9._:-]{1,256}$/u;

/** 与平台桥一致的 invoke 形状：只做转发，不携带任何能力。 */
type InvokeFn = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const tauriInvoke: InvokeFn = (command, args) => invoke(command, args);

export interface ProfileDraft {
  id: string;
  name: string;
  baseUrl: string;
  modelId: string;
  /**
   * 非 loopback 明文 HTTP 的显式用户确认（`transport.allowPublicHttp`）。
   * loopback 地址不需要；缺省按 schema 规则拒绝。
   */
  allowPublicHttp?: boolean;
  /** 明文。只在保存那一刻使用，不进入任何状态之外的持久化路径。 */
  apiKey?: string;
}

export class ProfileDraftError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ProfileDraftError';
    this.field = field;
  }
}

/** 派生 secret 引用。它同时是凭据存储的目标名，因此必须满足同一套字符集。 */
export const deriveApiKeyRef = (profileId: string): string => `provider:${profileId}:api-key`;

/**
 * 把草稿装配成完整 Profile。
 *
 * 刻意不接受 `endpoint` 以外的任何出站参数，也不接受 secret header：V1 只支持
 * OpenAI-compatible + 单个 API Key。多一个字段就多一条能影响出站请求的通道。
 */
export const buildProfile = (
  draft: ProfileDraft,
  now: () => string = () => new Date().toISOString(),
): DirectProviderProfileV1 => {
  if (!profileIdPattern.test(draft.id)) {
    throw new ProfileDraftError(
      'id',
      'profile id must only contain ASCII letters, digits, dot, underscore, colon or hyphen',
    );
  }
  if (!isDesktopSecretRef(deriveApiKeyRef(draft.id))) {
    throw new ProfileDraftError('id', 'derived secret reference is not a valid credential target');
  }

  const timestamp = now();
  const candidate = {
    version: 1 as const,
    id: draft.id,
    name: draft.name.trim() || '未命名 Endpoint',
    adapter: 'openai-compatible' as const,
    baseUrl: draft.baseUrl.trim(),
    modelId: draft.modelId.trim(),
    ...(draft.allowPublicHttp === true ? { transport: { allowPublicHttp: true as const } } : {}),
    ...(draft.apiKey !== undefined && draft.apiKey.length > 0
      ? { apiKeyRef: deriveApiKeyRef(draft.id) }
      : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const parsed = DirectProviderProfileV1Schema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ProfileDraftError(
      first?.path.join('.') || 'baseUrl',
      first?.message || 'provider profile failed validation',
    );
  }
  return parsed.data;
};

export interface SaveProfileOutcome {
  profile: DirectProviderProfileV1;
  /** 是否写入了新的凭据。false 表示这次没有提供明文，保留既有凭据。 */
  secretWritten: boolean;
}

export const saveProfileDraft = async (
  draft: ProfileDraft,
  now?: () => string,
): Promise<SaveProfileOutcome> => {
  const built = buildProfile(draft, now);
  const secretWritten = draft.apiKey !== undefined && draft.apiKey.length > 0;
  // staged secretRef：候选 Profile 指向一次性凭据名，校验、写凭据、落盘依次进行；
  // save_provider_profile 失败时删掉 staged ref，旧 Profile + 旧凭据原样不动。
  // ref 不带长 profileId，避免撞凭据目标名的 256 字符上限。
  const stagedRef = secretWritten ? `provider-key:${crypto.randomUUID()}` : undefined;
  const profile = stagedRef !== undefined ? { ...built, apiKeyRef: stagedRef } : built;

  try {
    await validateProviderExecutionProfile(tauriInvoke, profile);
    if (stagedRef !== undefined) {
      await setProviderSecret(tauriInvoke, stagedRef, draft.apiKey as string);
    }
    await saveProviderProfile(tauriInvoke, profile);
  } catch (cause) {
    if (stagedRef !== undefined) {
      await deleteProviderSecret(tauriInvoke, stagedRef).catch(() => undefined);
    }
    throw cause;
  }
  return { profile, secretWritten };
};

export const loadProfile = async (profileId: string): Promise<DirectProviderProfileV1 | null> =>
  getProviderProfile(tauriInvoke, profileId);

export const loadProfileIds = async (): Promise<string[]> =>
  listProviderProfileIds(tauriInvoke);

/**
 * 删除 Profile 及其凭据。
 *
 * 先删 Profile 再删凭据：Profile 是索引，凭据是内容。保留孤儿凭据比保留悬空 Profile 安全，
 * 因为前者不会让任何执行路径误用一个已删除的配置。凭据按被删 Profile 实际记录的
 * `apiKeyRef` 删除；读不到 Profile 时才退回派生 ref 做一次清理尝试。
 */
export const removeProfile = async (profileId: string): Promise<void> => {
  const existing = await getProviderProfile(tauriInvoke, profileId).catch(() => null);
  await deleteProviderProfile(tauriInvoke, profileId);
  await deleteProviderSecret(
    tauriInvoke,
    existing?.apiKeyRef ?? deriveApiKeyRef(profileId),
  ).catch(() => undefined);
};

export const profileHasStoredSecret = async (profileId: string): Promise<boolean> => {
  const profile = await getProviderProfile(tauriInvoke, profileId).catch(() => null);
  if (profile?.apiKeyRef === undefined) return false;
  return hasProviderSecret(tauriInvoke, profile.apiKeyRef);
};

export { MAX_DIRECT_PROVIDER_PROFILE_BYTES };
