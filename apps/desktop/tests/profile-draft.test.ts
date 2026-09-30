import { DirectProviderProfileV1Schema } from '@mahoshojo/contracts/provider-profile';
import { describe, expect, it, vi } from 'vitest';

import {
  buildProfile,
  deriveApiKeyRef,
  PRESET_LM_STUDIO,
  PRESET_OLLAMA,
  ProfileDraftError,
  removeProfile,
  saveProfileDraft,
  type ProfileDraft,
} from '../src/features/providers/profile-draft';
import {
  DELETE_PROVIDER_PROFILE_COMMAND,
  DELETE_PROVIDER_SECRET_COMMAND,
  SET_PROVIDER_SECRET_COMMAND,
} from '../src/platform';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
  Channel: class {
    onmessage?: (event: unknown) => void;
  },
}));

const { invoke } = await import('@tauri-apps/api/core');
const invokeMock = vi.mocked(invoke);

/**
 * 模拟 native 的真实行为：`validate_provider_execution_profile` 会**回显**它解析出的投影，
 * 客户端据此比对两侧理解是否一致。返回 undefined 会让保存流程 fail closed，那正是被测的
 * 不变量之一。
 */
const installNativeStub = () => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'validate_provider_execution_profile') {
      return (args as { document: unknown }).document;
    }
    if (command === 'list_provider_profile_ids') return [];
    return undefined;
  });
};

const now = () => '2026-09-30T00:00:00.000Z';

const draft = (overrides: Partial<ProfileDraft> = {}): ProfileDraft => ({
  id: 'p_test',
  name: 'Ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  modelId: 'qwen3:8b',
  apiKey: 'sk-local',
  ...overrides,
});

describe('buildProfile', () => {
  it('produces a schema-valid profile with a derived secret reference', () => {
    const profile = buildProfile(draft(), now);

    expect(DirectProviderProfileV1Schema.safeParse(profile).success).toBe(true);
    expect(profile.apiKeyRef).toBe('provider:p_test:api-key');
    expect(profile.adapter).toBe('openai-compatible');
    expect(profile.createdAt).toBe(now());
    expect(profile.updatedAt).toBe(now());
  });

  it('omits the secret reference when no API key is provided', () => {
    const profile = buildProfile(draft({ apiKey: undefined }), now);
    expect(profile.apiKeyRef).toBeUndefined();
    expect(profile).not.toHaveProperty('apiKey');
  });

  it('never carries the plaintext anywhere in the profile', () => {
    const profile = buildProfile(draft(), now);
    expect(JSON.stringify(profile)).not.toContain('sk-local');
  });

  it('refuses a profile id that cannot become a credential target name', () => {
    for (const id of ['', 'has space', 'has/slash', 'a'.repeat(257)]) {
      expect(() => buildProfile(draft({ id }), now)).toThrow(ProfileDraftError);
    }
    // 引用派生规则与 profile id 规则必须一致，否则会出现"能建 Profile 但写不进凭据"。
    expect(isValidSecretRefFor(deriveApiKeyRef('p_test'))).toBe(true);
  });

  it('surfaces the offending field for a rejected endpoint', () => {
    expect(() => buildProfile(draft({ baseUrl: 'not-a-url' }), now)).toThrow(ProfileDraftError);
    expect(() => buildProfile(draft({ baseUrl: 'http://api.example.com/v1' }), now)).toThrow(
      ProfileDraftError,
    );
  });

  it('accepts loopback plaintext HTTP without extra confirmation', () => {
    expect(() => buildProfile(draft({ baseUrl: PRESET_OLLAMA.baseUrl }), now)).not.toThrow();
    expect(() => buildProfile(draft({ baseUrl: PRESET_LM_STUDIO.baseUrl }), now)).not.toThrow();
  });
});

const isValidSecretRefFor = (ref: string): boolean =>
  ref.length > 0 && ref.length <= 256 && /^[A-Za-z0-9._:-]+$/u.test(ref);

describe('saveProfileDraft', () => {
  it('writes the credential before the profile', async () => {
    installNativeStub();
    const outcome = await saveProfileDraft(draft(), now);

    expect(outcome.secretWritten).toBe(true);
    const commands = invokeMock.mock.calls.map((call) => call[0]);
    expect(commands[0]).toBe(SET_PROVIDER_SECRET_COMMAND);
    expect(commands).toContain('validate_provider_execution_profile');
    expect(commands).toContain('save_provider_profile');
    // 先凭据后 Profile：反过来的话崩溃会留下"引用存在但取不到值"的 Profile。
    expect(commands.indexOf(SET_PROVIDER_SECRET_COMMAND)).toBeLessThan(
      commands.indexOf('save_provider_profile'),
    );
  });

  it('skips the credential write when no key is provided', async () => {
    installNativeStub();
    const outcome = await saveProfileDraft(draft({ apiKey: undefined }), now);

    expect(outcome.secretWritten).toBe(false);
    expect(invokeMock.mock.calls.map((call) => call[0])).not.toContain(SET_PROVIDER_SECRET_COMMAND);
  });
});

describe('removeProfile', () => {
  it('removes the profile first and then the orphaned credential', async () => {
    installNativeStub();
    await removeProfile('p_test');

    const commands = invokeMock.mock.calls.map((call) => call[0]);
    expect(commands).toEqual([DELETE_PROVIDER_PROFILE_COMMAND, DELETE_PROVIDER_SECRET_COMMAND]);
  });

  it('does not fail when the credential is already gone', async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === DELETE_PROVIDER_SECRET_COMMAND) throw new Error('no such credential');
      return undefined;
    });

    await expect(removeProfile('p_test')).resolves.toBeUndefined();
  });
});
