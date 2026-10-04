// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopArchiveHost } from '../src/platform/desktop-archive-host';

/**
 * Desktop 归档 host 的接线断言。
 *
 * 这些不是对真实 Tauri 的调用——那需要真机。这里断言的是**接线形状**：host 暴露了共享契约要求的六个
 * 方法，且导入侧确实不碰网络。真实调用路径由 `local-archive-bridge.test.ts` 与 Rust 侧测试覆盖。
 */
describe('desktop archive host wiring', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('exposes exactly the shared host surface', () => {
    const host = createDesktopArchiveHost();

    for (const method of [
      'probeStorage',
      'runExport',
      'pickArchiveBytes',
      'inspectArchive',
      'applyArchive',
      'describeError',
    ] as const) {
      expect(typeof host[method], `host 缺少 ${method}`).toBe('function');
    }
  });

  it('describes both archive error families with their message', () => {
    const host = createDesktopArchiveHost();

    expect(host.describeError(new Error('导出已送完全部字节，但 native 未确认完成'))).toBe(
      '导出已送完全部字节，但 native 未确认完成',
    );
    expect(host.describeError('非 Error 的失败')).toBe('归档操作失败');
  });

  it('does not add a file-picker capability to the main UI', async () => {
    // 导入走 `<input type="file">`，它是 WebView 内建能力而不是 Tauri command，因此不需要任何
    // capability；反过来，**也绝不能**为了它引入 dialog/fs 插件——那是一次真实的授权面扩张，而
    // D2.3d 明确「不因接 UI 新增通用文件权限」（DESK-071b）。
    //
    // 这条断言读的是真实 capability 文件，因此改错文件会被立刻抓到，而不是等到一次安全评审。
    const capability = JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, '..', 'src-tauri', 'capabilities', 'main-ui.json'),
        'utf8',
      ),
    ) as { permissions: string[]; webviews: string[]; windows?: string[] };

    // onCloseRequested 放行时由 Tauri JS 调用 destroy；D4a 后 core 只保留显式最小集，
    // 不得回退到 core:default 大集合。
    expect(capability.permissions).toContain('core:window:allow-destroy');
    expect(capability.permissions).not.toContain('core:default');
    expect(capability.webviews).toEqual(['main-ui']);
    expect(capability.windows).toBeUndefined();

    for (const permission of capability.permissions) {
      expect(permission).not.toMatch(/^(dialog|fs|shell|opener):/u);
    }
  });

  it('window focus does not cancel a picker before its selected-file change event', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const host = createDesktopArchiveHost();
    const pending = host.pickArchiveBytes();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error('file picker input was not created');

    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(settled).toBe(false);

    const file = new File([new Uint8Array([1, 2, 3])], 'synthetic.zip');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));

    await expect(pending).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(input.isConnected).toBe(false);
  });

  it('uses the picker cancel event to resolve a user cancellation', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const host = createDesktopArchiveHost();
    const pending = host.pickArchiveBytes();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error('file picker input was not created');

    input.dispatchEvent(new Event('cancel'));

    await expect(pending).resolves.toBeNull();
    expect(input.isConnected).toBe(false);
  });

  it('eventually resolves cancellation when the host omits the cancel event', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const host = createDesktopArchiveHost();
    const pending = host.pickArchiveBytes();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error('file picker input was not created');

    window.dispatchEvent(new Event('focus'));

    await expect(pending).resolves.toBeNull();
    expect(input.isConnected).toBe(false);
  });
});
