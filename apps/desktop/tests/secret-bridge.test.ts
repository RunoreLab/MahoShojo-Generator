import { MAX_DESKTOP_SECRET_VALUE_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { describe, expect, it, vi } from 'vitest';

import {
  DELETE_PROVIDER_SECRET_COMMAND,
  HAS_PROVIDER_SECRET_COMMAND,
  SET_PROVIDER_SECRET_COMMAND,
  DesktopSecretBridgeError,
  deleteProviderSecret,
  hasProviderSecret,
  setProviderSecret,
} from '../src/platform/secret-bridge';

const validRef = 'provider:p_01:api-key';

describe('secret bridge', () => {
  it('exposes only write and existence operations', async () => {
    // 已持久化的 secret 不得由 renderer 可达接口读回。这条断言在接口层拦住"顺手加个
    // get"的回归，而不是依赖评审纪律。
    const surface = await import('../src/platform/secret-bridge');
    for (const forbidden of ['getProviderSecret', 'readProviderSecret', 'revealSecret']) {
      expect(Object.keys(surface), `${forbidden} must not be exported`).not.toContain(forbidden);
    }
  });

  it('rejects an invalid reference before touching the IPC boundary', async () => {
    const invoke = vi.fn();

    for (const invalid of ['', 'provider:p 01:api-key', 'provider:p_01:api key', '../escape']) {
      await expect(setProviderSecret(invoke, invalid, 'value')).rejects.toThrow();
      await expect(hasProviderSecret(invoke, invalid)).rejects.toThrow();
      await expect(deleteProviderSecret(invoke, invalid)).rejects.toThrow();
    }

    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects an oversized secret value before touching the IPC boundary', async () => {
    const invoke = vi.fn();
    const oversized = 'S3CRET'.repeat(MAX_DESKTOP_SECRET_VALUE_BYTES);

    await expect(setProviderSecret(invoke, validRef, oversized)).rejects.toThrow(
      /UTF-8 byte ceiling/u,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('forwards set, exists and delete with the reference as the only selector', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    await setProviderSecret(invoke, validRef, 'secret-value');
    expect(invoke).toHaveBeenCalledWith(SET_PROVIDER_SECRET_COMMAND, {
      secretRef: validRef,
      value: 'secret-value',
    });

    await deleteProviderSecret(invoke, validRef);
    expect(invoke).toHaveBeenCalledWith(DELETE_PROVIDER_SECRET_COMMAND, { secretRef: validRef });
  });

  it('reads the existence flag as a strict boolean', async () => {
    const invoke = vi.fn().mockResolvedValue(true);

    await expect(hasProviderSecret(invoke, validRef)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith(HAS_PROVIDER_SECRET_COMMAND, { secretRef: validRef });

    await expect(hasProviderSecret(vi.fn().mockResolvedValue(false), validRef)).resolves.toBe(
      false,
    );
    await expect(hasProviderSecret(vi.fn().mockResolvedValue('true'), validRef)).rejects.toThrow(
      /must be a boolean/u,
    );
  });

  it('normalizes a backend failure into a stable public code', async () => {
    const invoke = vi.fn().mockRejectedValue({
      code: 'secret-store-unavailable',
      message: 'operating system credential store is unavailable',
    });

    await expect(setProviderSecret(invoke, validRef, 'v')).rejects.toMatchObject({
      name: 'DesktopSecretBridgeError',
      command: SET_PROVIDER_SECRET_COMMAND,
      code: 'secret-store-unavailable',
    });
  });

  it('fails closed when the backend returns an unknown error shape', async () => {
    const invoke = vi.fn().mockRejectedValue({
      code: 'weird',
      message: 'sk-live-should-never-be-logged',
    });

    const failure = await setProviderSecret(invoke, validRef, 'v').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DesktopSecretBridgeError);
    expect(failure).toMatchObject({ code: 'secret-store-failure' });
    expect((failure as Error).message).not.toContain('sk-live');
  });
});
