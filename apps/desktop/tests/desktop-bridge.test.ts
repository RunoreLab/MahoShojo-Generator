import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DESKTOP_RUNTIME_INFO_COMMAND,
  DesktopBridgeError,
  normalizeDesktopRuntimeInfo,
  readDesktopRuntimeInfo,
} from '../src/platform/desktop-bridge';

const validInfo = {
  appVersion: '0.0.0',
  tauriVersion: '2.12.0',
  os: 'windows',
  arch: 'x86_64',
  packaged: false,
} as const;

describe('desktop runtime info bridge', () => {
  it('normalizes a well-formed runtime payload', () => {
    expect(normalizeDesktopRuntimeInfo(validInfo)).toEqual(validInfo);
  });

  it('fails closed instead of defaulting when a field is missing or blank', () => {
    for (const broken of [
      { ...validInfo, appVersion: '' },
      { ...validInfo, tauriVersion: '   ' },
      { ...validInfo, os: 1 },
      { ...validInfo, packaged: 'false' },
    ]) {
      expect(() => normalizeDesktopRuntimeInfo(broken)).toThrow(DesktopBridgeError);
    }

    const { arch: _arch, ...missingField } = validInfo;
    expect(() => normalizeDesktopRuntimeInfo(missingField)).toThrow(DesktopBridgeError);
  });

  it('fails closed on non-object payloads', () => {
    for (const broken of [null, undefined, 'windows', 42, []]) {
      expect(() => normalizeDesktopRuntimeInfo(broken)).toThrow(DesktopBridgeError);
    }
  });

  it('reports the command name when the invoke call fails', async () => {
    await expect(
      readDesktopRuntimeInfo(async () => {
        throw new Error('ipc unavailable');
      }),
    ).rejects.toThrow(/ipc unavailable/u);

    await expect(
      readDesktopRuntimeInfo(async () => {
        throw new Error('ipc unavailable');
      }),
    ).rejects.toMatchObject({ command: DESKTOP_RUNTIME_INFO_COMMAND });
  });

  it('uses an application command name rather than a plugin namespace', () => {
    // V1 不引入任何 Tauri 插件；使用 plugin:<name>| 前缀会让授权面与实际依赖脱节。
    expect(DESKTOP_RUNTIME_INFO_COMMAND).not.toMatch(/^plugin:/u);
  });
});

describe('renderer network surface', () => {
  const appDirectory = path.resolve(import.meta.dirname, '..');

  it('keeps fetch, XHR and websocket out of the renderer source', () => {
    // renderer 不得获得任意出站能力：所有 HTTP 由 Rust 侧依据已保存的 Profile 发起。
    // 这条断言是结构性门禁，任何新增直接网络调用都会让它失败。
    const offenders: string[] = [];

    for (const relativePath of ['src/platform/index.ts', 'src/platform/desktop-bridge.ts']) {
      const source = readFileSync(path.join(appDirectory, relativePath), 'utf8');
      for (const forbidden of [/\bfetch\s*\(/u, /XMLHttpRequest/u, /new\s+WebSocket/u, /\bnavigator\.sendBeacon\b/u]) {
        if (forbidden.test(source)) offenders.push(`${relativePath}: ${forbidden.source}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
