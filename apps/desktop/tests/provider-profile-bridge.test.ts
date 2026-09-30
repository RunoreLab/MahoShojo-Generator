import { toDirectProviderExecutionProfile, type DirectProviderProfileV1 } from '@mahoshojo/contracts/provider-profile';
import { describe, expect, it, vi } from 'vitest';

import {
  DELETE_PROVIDER_PROFILE_COMMAND,
  GET_PROVIDER_PROFILE_COMMAND,
  LIST_PROVIDER_PROFILE_IDS_COMMAND,
  SAVE_PROVIDER_PROFILE_COMMAND,
  VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND,
  DesktopProviderProfileError,
  deleteProviderProfile,
  getProviderProfile,
  listProviderProfileIds,
  saveProviderProfile,
} from '../src/platform/provider-profile-bridge';

const profile: DirectProviderProfileV1 = {
  version: 1,
  id: 'profile-fixture',
  name: 'Ollama',
  adapter: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:11434/v1',
  modelId: 'qwen3:8b',
  apiKeyRef: 'provider:profile-fixture:api-key',
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z',
};

const nativeAccepting = () =>
  vi.fn(async (command: string) => {
    if (command === VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND) {
      return toDirectProviderExecutionProfile(profile);
    }
    return undefined;
  });

describe('provider profile bridge', () => {
  it('validates on both sides before persisting', async () => {
    const invoke = nativeAccepting();

    await saveProviderProfile(invoke, profile);

    expect(invoke).toHaveBeenCalledWith(VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND, {
      document: toDirectProviderExecutionProfile(profile),
    });
    expect(invoke).toHaveBeenCalledWith(SAVE_PROVIDER_PROFILE_COMMAND, {
      document: profile,
      updatedAt: profile.updatedAt,
    });
  });

  it('persists the full profile rather than the narrow projection', async () => {
    // native 侧执行时要自己从完整文档解析 endpoint 与 secret 引用，因此落盘的必须是完整文档。
    const invoke = nativeAccepting();
    await saveProviderProfile(invoke, profile);

    const [, savedArgs] = invoke.mock.calls.find(
      (call) => call[0] === SAVE_PROVIDER_PROFILE_COMMAND,
    ) as [string, Record<string, unknown>];
    expect(savedArgs.document).toEqual(profile);
  });

  it('refuses to persist when client-side validation fails', async () => {
    const invoke = nativeAccepting();

    await expect(
      saveProviderProfile(invoke, { ...profile, baseUrl: 'http://api.example.com/v1' }),
    ).rejects.toThrow(/client-side validation/u);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('surfaces a native-side refusal instead of persisting anyway', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND) {
        throw {
          code: 'provider-profile-insecure-base-url',
          message: 'cleartext HTTP requires an explicit user confirmation',
        };
      }
      return undefined;
    });

    await expect(saveProviderProfile(invoke, profile)).rejects.toMatchObject({
      name: 'DesktopProviderProfileError',
      code: 'provider-profile-insecure-base-url',
    });
    expect(invoke).not.toHaveBeenCalledWith(SAVE_PROVIDER_PROFILE_COMMAND, expect.anything());
  });

  it('fails closed when the native projection does not round-trip', async () => {
    // 两侧对同一份文档的理解必须一致；不一致时宁可失败也不要落盘一份 native 读不懂的文档。
    const invoke = vi.fn(async (command: string) => {
      if (command === VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND) {
        return { ...toDirectProviderExecutionProfile(profile), baseUrl: 'https://evil.example/v1' };
      }
      return undefined;
    });

    await expect(saveProviderProfile(invoke, profile)).rejects.toMatchObject({
      code: 'provider-profile-mismatch',
    });
    expect(invoke).not.toHaveBeenCalledWith(SAVE_PROVIDER_PROFILE_COMMAND, expect.anything());
  });

  it('fails closed when the native projection cannot be parsed back', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND) return { id: 'only-an-id' };
      return undefined;
    });

    await expect(saveProviderProfile(invoke, profile)).rejects.toBeInstanceOf(
      DesktopProviderProfileError,
    );
  });

  it('reads ids as a strict string array', async () => {
    await expect(listProviderProfileIds(vi.fn().mockResolvedValue(['a', 'b']))).resolves.toEqual([
      'a',
      'b',
    ]);
    await expect(listProviderProfileIds(vi.fn().mockResolvedValue(['a', 1]))).rejects.toThrow(
      /array of strings/u,
    );
  });

  it('reports a missing profile as null rather than an error', async () => {
    await expect(getProviderProfile(vi.fn().mockResolvedValue(null), 'missing')).resolves.toBeNull();
    await expect(
      getProviderProfile(vi.fn().mockResolvedValue(profile), 'profile-fixture'),
    ).resolves.toEqual(profile);
  });

  it('validates a stored document on the way out', async () => {
    const corrupted = { ...profile, baseUrl: 'not-a-url' };
    await expect(getProviderProfile(vi.fn().mockResolvedValue(corrupted), 'p')).rejects.toThrow(
      /client-side validation/u,
    );
  });

  it('keeps delete free of any path or SQL parameters', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    await deleteProviderProfile(invoke, 'profile-fixture');
    expect(invoke).toHaveBeenCalledWith(DELETE_PROVIDER_PROFILE_COMMAND, {
      profileId: 'profile-fixture',
    });
  });

  it('fails closed on an unrecognized backend failure shape', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('raw driver panic text'));
    const failure = await listProviderProfileIds(invoke).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DesktopProviderProfileError);
    expect(failure).toMatchObject({ code: 'store-failure' });
    expect((failure as Error).message).not.toContain('raw driver panic');
  });

  it('uses command names that carry no endpoint or secret material', () => {
    for (const command of [
      SAVE_PROVIDER_PROFILE_COMMAND,
      LIST_PROVIDER_PROFILE_IDS_COMMAND,
      GET_PROVIDER_PROFILE_COMMAND,
      DELETE_PROVIDER_PROFILE_COMMAND,
      VALIDATE_PROVIDER_EXECUTION_PROFILE_COMMAND,
    ]) {
      expect(command).not.toMatch(/https?:|sk-|bearer/iu);
    }
  });
});
