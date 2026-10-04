import { describe, expect, it, vi } from 'vitest';

import type { WebPackageResourceSnapshot } from '@mahoshojo/web-package';

import type { RawInvokeFn, StructuredInvokeFn } from '../src/platform/local-archive-bridge';
import {
  APPEND_WEB_PACKAGE_RESOURCE_COMMAND,
  BEGIN_WEB_PACKAGE_INSTANCE_COMMAND,
  DesktopWebPackageInstanceError,
  OPEN_WEB_PACKAGE_INSTANCE_COMMAND,
  openWebPackageInstanceInIsolatedWebview,
} from '../src/platform/webpkg-instance-bridge';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const DIGEST = `sha256:${'d'.repeat(64)}`;

/**
 * 快照字面量而不是 `createWebPackageResourceSnapshot`：桥只消费合并完成的 `entry`/`files`，
 * 物化语义的断言归 `packages/web-package` 自己的测试。`instanceId` 刻意取一个与 native
 * 形态不同的值——它是物化命名空间，桥 MUST NOT 把它发出去（native 的 `wpk-N` 才是
 * instance id）。
 */
const makeSnapshot = (files: Array<[string, string, Uint8Array]>): WebPackageResourceSnapshot => ({
  instanceId: 'desktop-materialization',
  packageRef: { id: 'a', version: '1.0.0', digest: DIGEST },
  entry: files[0]?.[0] ?? 'index.html',
  files: new Map(files.map(([path, mediaType, bytes]) => [path, Object.freeze({ mediaType, bytes })])),
});

interface StructuredCall {
  readonly command: string;
  readonly args: Record<string, unknown> | undefined;
}

interface RawCall {
  readonly command: string;
  readonly bytes: Uint8Array;
  readonly headers: Record<string, string>;
}

/** 记录双侧调用并可按 command 脚本化响应的假 IPC。 */
const makeIpc = (handlers: {
  structured?: (command: string, args: Record<string, unknown> | undefined) => unknown;
  raw?: (command: string, body: Uint8Array, headers: Record<string, string>) => unknown;
}) => {
  const structuredCalls: StructuredCall[] = [];
  const rawCalls: RawCall[] = [];
  const invoke: StructuredInvokeFn = vi.fn(async (command, args) => {
    structuredCalls.push({ command, args });
    return handlers.structured?.(command, args);
  });
  const rawInvoke: RawInvokeFn = vi.fn(async (command, body, options) => {
    rawCalls.push({ command, bytes: body, headers: options.headers });
    return handlers.raw?.(command, body, options.headers);
  });
  return { invoke, rawInvoke, structuredCalls, rawCalls };
};

const okHandlers = (receivedBytes = true) => ({
  structured: (command: string) => {
    if (command === BEGIN_WEB_PACKAGE_INSTANCE_COMMAND) return { instanceId: 'wpk-7' };
    if (command === OPEN_WEB_PACKAGE_INSTANCE_COMMAND) return { label: 'webpkg-wpk-7' };
    throw new Error(`unexpected structured command: ${command}`);
  },
  raw: (command: string, body: Uint8Array) => {
    if (command === APPEND_WEB_PACKAGE_RESOURCE_COMMAND) {
      return { receivedByteLength: receivedBytes ? body.byteLength : body.byteLength + 1 };
    }
    throw new Error(`unexpected raw command: ${command}`);
  },
});

describe('Web Package 受限 webview 桥接（D4b）', () => {
  it('按 begin → 逐文件 append → open 的顺序完成三段流程', async () => {
    const snapshot = makeSnapshot([
      ['index.html', 'text/html', encode('<html></html>')],
      ['assets/app.js', 'application/javascript', encode('let x = 1')],
    ]);
    const ipc = makeIpc(okHandlers());

    const opened = await openWebPackageInstanceInIsolatedWebview(
      ipc.invoke,
      ipc.rawInvoke,
      snapshot,
      '示例包',
    );

    // begin 的声明表与 snapshot 逐文件对齐。
    expect(ipc.structuredCalls[0]?.command).toBe(BEGIN_WEB_PACKAGE_INSTANCE_COMMAND);
    expect(ipc.structuredCalls[0]?.args).toEqual({
      request: {
        entry: 'index.html',
        title: '示例包',
        files: [
          { path: 'index.html', mediaType: 'text/html', byteLength: '<html></html>'.length },
          { path: 'assets/app.js', mediaType: 'application/javascript', byteLength: 9 },
        ],
      },
    });

    // 每个文件恰好投递一次，instance 与编码路径走 header，字节是整个 raw body。
    expect(ipc.rawCalls).toHaveLength(2);
    for (const [index, path] of ['index.html', 'assets/app.js'].entries()) {
      const call = ipc.rawCalls[index];
      expect(call?.command).toBe(APPEND_WEB_PACKAGE_RESOURCE_COMMAND);
      expect(call?.headers['x-webpkg-instance']).toBe('wpk-7');
      expect(call?.headers['x-webpkg-path']).toBe(path);
      expect(call?.bytes).toEqual(snapshot.files.get(path)?.bytes);
    }

    // open 只带 instanceId；label 是 native 回显而不是桥拼出来的。
    expect(ipc.structuredCalls[1]?.command).toBe(OPEN_WEB_PACKAGE_INSTANCE_COMMAND);
    expect(ipc.structuredCalls[1]?.args).toEqual({ request: { instanceId: 'wpk-7' } });
    expect(opened).toEqual({ instanceId: 'wpk-7', webviewLabel: 'webpkg-wpk-7' });
  });

  it('资源路径按 encodeURIComponent 逐段编码进 header', async () => {
    const snapshot = makeSnapshot([
      ['index.html', 'text/html', encode('<html></html>')],
      ['notes/report#1.js', 'application/javascript', encode('x')],
      ['my file.css', 'text/css', encode('y')],
    ]);
    const ipc = makeIpc(okHandlers());

    await openWebPackageInstanceInIsolatedWebview(ipc.invoke, ipc.rawInvoke, snapshot, 't');

    const headers = ipc.rawCalls.map((call) => call.headers['x-webpkg-path']);
    // '#' 必须被编进路径段——裸写会变成 URL fragment 分隔符，resolver 收到的就是另一条路径。
    expect(headers).toEqual(['index.html', 'notes/report%231.js', 'my%20file.css']);
  });

  it('native 的 webpkg-* 失败按 code 归一成类型化错误', async () => {
    const snapshot = makeSnapshot([['index.html', 'text/html', encode('<html></html>')]]);
    const ipc = makeIpc({
      structured: () => {
        throw { code: 'webpkg-too-many-files', message: 'files limit' };
      },
    });

    const failure = await openWebPackageInstanceInIsolatedWebview(
      ipc.invoke,
      ipc.rawInvoke,
      snapshot,
      't',
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DesktopWebPackageInstanceError);
    expect((failure as DesktopWebPackageInstanceError).code).toBe('webpkg-too-many-files');
    expect(ipc.rawCalls).toHaveLength(0);
  });

  it('native 回执与送达字节不符时按 resource-mismatch 失败且不再 open', async () => {
    const snapshot = makeSnapshot([
      ['index.html', 'text/html', encode('<html></html>')],
      ['app.js', 'application/javascript', encode('let')],
    ]);
    const ipc = makeIpc(okHandlers(false));

    const failure = await openWebPackageInstanceInIsolatedWebview(
      ipc.invoke,
      ipc.rawInvoke,
      snapshot,
      't',
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DesktopWebPackageInstanceError);
    expect((failure as DesktopWebPackageInstanceError).code).toBe('webpkg-resource-mismatch');
    // 中断的会话没有 abort——孤儿 Collecting 由 native TTL 回收；桥只做"不再继续"。
    expect(ipc.rawCalls).toHaveLength(1);
    expect(ipc.structuredCalls.map((call) => call.command)).toEqual([
      BEGIN_WEB_PACKAGE_INSTANCE_COMMAND,
    ]);
  });

  it('native 返回无法识别的失败形状时归一成 webpkg-failure', async () => {
    const snapshot = makeSnapshot([['index.html', 'text/html', encode('<html></html>')]]);
    const ipc = makeIpc({
      structured: () => {
        throw new Error('transport exploded');
      },
    });

    const failure = await openWebPackageInstanceInIsolatedWebview(
      ipc.invoke,
      ipc.rawInvoke,
      snapshot,
      't',
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DesktopWebPackageInstanceError);
    expect((failure as DesktopWebPackageInstanceError).code).toBe('webpkg-failure');
  });

  it('native 响应形状漂移时在 schema 边界失败而不是静默接受', async () => {
    const snapshot = makeSnapshot([['index.html', 'text/html', encode('<html></html>')]]);
    const ipc = makeIpc({
      structured: (command) => {
        if (command === BEGIN_WEB_PACKAGE_INSTANCE_COMMAND) return { instanceId: 'not-an-id' };
        throw new Error('unreachable');
      },
    });

    await expect(
      openWebPackageInstanceInIsolatedWebview(ipc.invoke, ipc.rawInvoke, snapshot, 't'),
    ).rejects.toBeInstanceOf(DesktopWebPackageInstanceError);
    // `not-an-id` 不是合法 instance id：begin 响应在契约边界就被拒，一个 append 都不会发出。
    expect(ipc.rawCalls).toHaveLength(0);
  });
});
