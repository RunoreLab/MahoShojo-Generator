import { readFileSync, readdirSync } from 'node:fs';
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

  it('keeps fetch, XHR and websocket out of every platform bridge module', () => {
    // renderer 不得获得任意出站能力：所有 HTTP 由 Rust 侧依据已保存的 Profile 发起。
    // 这条断言是结构性门禁，任何新增直接网络调用都会让它失败。
    //
    // 扫描范围是 `src/platform/` 下的**全部**模块，而不是逐个手列文件。逐个列举有一个已发作过的
    // 后果：新增的归档 adapter 没有被覆盖，于是「零网络」这条门禁在它上面静默失效——门禁看起来还在，
    // 实际已经不再管那个文件。按目录枚举让新增模块默认进入范围。
    const platformDirectory = path.join(appDirectory, 'src', 'platform');
    const offenders: string[] = [];

    for (const entry of readdirSync(platformDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) continue;
      const relativePath = `src/platform/${entry.name}`;
      const source = readFileSync(path.join(platformDirectory, entry.name), 'utf8');
      for (const forbidden of [/\bfetch\s*\(/u, /XMLHttpRequest/u, /new\s+WebSocket/u, /\bnavigator\.sendBeacon\b/u]) {
        if (forbidden.test(source)) offenders.push(`${relativePath}: ${forbidden.source}`);
      }
    }

    expect(offenders).toEqual([]);
    // 至少要真的扫到了文件，否则上面那条断言会因为目录路径写错而恒真。
    expect(readdirSync(platformDirectory).some((name) => name.endsWith('.ts'))).toBe(true);
  });

  it('keeps the archive import and export path free of any outbound request', () => {
    // DESK-052 要求导入全程零网络，并由**可执行断言**证明，不靠代码审查声称。归档路径是这条要求
    // 最容易失守的地方：它读文件、解 ZIP、遍历条目，任何一处顺手加的进度上报或"顺便同步一下"
    // 都会引入出站请求。因此这里对归档两个模块单独再断言一次，让失败信息直接指向它们。
    const archiveModules = ['src/platform/desktop-archive-host.ts', 'src/platform/local-archive-import.ts'];

    for (const relativePath of archiveModules) {
      const source = readFileSync(path.join(appDirectory, relativePath), 'utf8');
      expect(source, `${relativePath} 不得发起网络请求`).not.toMatch(/\bfetch\s*\(/u);
      expect(source, `${relativePath} 不得发起网络请求`).not.toMatch(/XMLHttpRequest/u);
      expect(source, `${relativePath} 不得发起网络请求`).not.toMatch(/https?:\/\//u);
    }
  });
});
