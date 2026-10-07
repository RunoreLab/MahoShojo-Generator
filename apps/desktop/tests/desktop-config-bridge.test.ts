/**
 * `config-bridge` 的契约复核与错误投影（D5.1-S2，DESK-SET-005）。
 *
 * 桥只做两件事：发对命令（窄面，没有路径参数）、把 native 的返回/异常
 * 按 `desktop-ipc` schema 复核或翻译。不符合契约的载荷与未登记的错误码
 * 都归为 fail-closed，不猜。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DesktopConfigError,
  readDesktopConfig,
  writeDesktopConfig,
} from '../src/platform/config-bridge';
import type { InvokeFn } from '../src/platform/config-bridge';

const REV = `sha256:${'a'.repeat(64)}`;

describe('desktop config bridge', () => {
  it('read issues the fixed command and accepts the contract-shaped result', async () => {
    const invoke: InvokeFn = vi.fn(async () => ({
      path: 'C:\\cfg\\config.json',
      directory: 'C:\\cfg',
      backupPresent: true,
      file: { status: 'ok', revision: REV, content: '{"version":1}' },
    }));

    const result = await readDesktopConfig(invoke);

    expect(invoke).toHaveBeenCalledWith('desktop_config_read');
    expect(result.file).toMatchObject({ status: 'ok', revision: REV });
    expect(result.backupPresent).toBe(true);
  });

  it('write sends {request} envelope with expectedRevision and returns the new revision', async () => {
    const invoke: InvokeFn = vi.fn(async () => ({ revision: REV }));

    const result = await writeDesktopConfig(invoke, {
      expectedRevision: null,
      content: '{"version":1}',
    });

    expect(invoke).toHaveBeenCalledWith('desktop_config_write', {
      request: { expectedRevision: null, content: '{"version":1}' },
    });
    expect(result.revision).toBe(REV);
  });

  it('malformed native payloads become bridge-invalid, not silently trusted', async () => {
    const badShapes: InvokeFn = vi.fn(async () => ({ path: 42, file: { status: 'maybe' } }));
    await expect(readDesktopConfig(badShapes)).rejects.toMatchObject({
      name: 'DesktopConfigError',
      code: 'bridge-invalid',
    });

    const badRevision: InvokeFn = vi.fn(async () => ({ revision: 'not-a-revision' }));
    await expect(
      writeDesktopConfig(badRevision, { expectedRevision: null, content: '{}' }),
    ).rejects.toMatchObject({ code: 'bridge-invalid' });
  });

  it('structured native errors keep their code (conflict stays distinguishable)', async () => {
    const invoke: InvokeFn = vi.fn(async () => {
      throw { code: 'config-conflict', message: '配置文件已被外部修改' };
    });

    const error = await writeDesktopConfig(invoke, {
      expectedRevision: REV,
      content: '{"version":1}',
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DesktopConfigError);
    expect((error as DesktopConfigError).code).toBe('config-conflict');
  });

  it('unknown error codes and unstructured rejections fall back to internal-error', async () => {
    const weird: InvokeFn = vi.fn(async () => {
      throw { code: 'something-else', message: 'x' };
    });
    await expect(readDesktopConfig(weird)).rejects.toMatchObject({ code: 'internal-error' });

    const plain: InvokeFn = vi.fn(async () => {
      throw new Error('panic');
    });
    await expect(readDesktopConfig(plain)).rejects.toMatchObject({
      code: 'internal-error',
      message: 'panic',
    });
  });
});
