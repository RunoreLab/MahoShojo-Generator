import { describe, expect, it, vi } from 'vitest';

import { MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES } from '@mahoshojo/contracts/desktop-ipc';
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

const okHandlers = (receivedBytes = true) => {
  // 回执是逐文件累计量：native 返回"该文件已收字节数"，不是"本块字节数"。
  const received = new Map<string, number>();
  return {
    structured: (command: string) => {
      if (command === BEGIN_WEB_PACKAGE_INSTANCE_COMMAND) return { instanceId: 'wpk-7' };
      if (command === OPEN_WEB_PACKAGE_INSTANCE_COMMAND) return { label: 'webpkg-wpk-7' };
      throw new Error(`unexpected structured command: ${command}`);
    },
    raw: (command: string, body: Uint8Array, headers: Record<string, string>) => {
      if (command === APPEND_WEB_PACKAGE_RESOURCE_COMMAND) {
        const path = headers['x-webpkg-path'] ?? '';
        const offset = Number(headers['x-webpkg-offset']);
        if (offset !== (received.get(path) ?? 0)) {
          return { receivedByteLength: -1 };
        }
        const next = offset + body.byteLength;
        received.set(path, next);
        return { receivedByteLength: receivedBytes ? next : next + 1 };
      }
      throw new Error(`unexpected raw command: ${command}`);
    },
  };
};

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

    // 每个文件按 offset 升序分块投递（小文件恰一块），instance/路径/偏移走 header，
    // 字节是整个 raw body。
    expect(ipc.rawCalls).toHaveLength(2);
    for (const [index, path] of ['index.html', 'assets/app.js'].entries()) {
      const call = ipc.rawCalls[index];
      expect(call?.command).toBe(APPEND_WEB_PACKAGE_RESOURCE_COMMAND);
      expect(call?.headers['x-webpkg-instance']).toBe('wpk-7');
      expect(call?.headers['x-webpkg-path']).toBe(path);
      expect(call?.headers['x-webpkg-offset']).toBe('0');
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

  it('大文件按 4 MiB 块与升序 offset 分块投递，零长文件也发一个空块', async () => {
    const chunk = MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES;
    // 4 MiB + 3：边界跨一块，验证第二块 offset 接在第一块末尾。
    const big = new Uint8Array(chunk + 3).fill(7);
    const snapshot = makeSnapshot([
      ['index.html', 'text/html', encode('<html></html>')],
      ['assets/video.bin', 'application/octet-stream', big],
      ['empty.bin', 'application/octet-stream', new Uint8Array(0)],
    ]);
    const ipc = makeIpc(okHandlers());

    await openWebPackageInstanceInIsolatedWebview(ipc.invoke, ipc.rawInvoke, snapshot, 't');

    // index.html 1 块 + video 2 块 + empty 1 空块。
    expect(ipc.rawCalls).toHaveLength(4);
    const videoCalls = ipc.rawCalls.filter(
      (call) => call.headers['x-webpkg-path'] === 'assets/video.bin',
    );
    expect(videoCalls.map((call) => call.headers['x-webpkg-offset'])).toEqual(['0', String(chunk)]);
    expect(videoCalls[0]?.bytes.byteLength).toBe(chunk);
    expect(videoCalls[1]?.bytes.byteLength).toBe(3);
    // 分块只切视图不复制：第二块仍是同一份快照字节的尾段。
    expect(videoCalls[1]?.bytes).toEqual(big.subarray(chunk));
    const emptyCall = ipc.rawCalls.find(
      (call) => call.headers['x-webpkg-path'] === 'empty.bin',
    );
    expect(emptyCall?.headers['x-webpkg-offset']).toBe('0');
    expect(emptyCall?.bytes.byteLength).toBe(0);
    // 任何一块都不超过契约上限。
    for (const call of ipc.rawCalls) {
      expect(call.bytes.byteLength).toBeLessThanOrEqual(chunk);
    }
  });

  it('append 回执按累计偏移验收，错序块的错位回执按 resource-mismatch 失败', async () => {
    const snapshot = makeSnapshot([
      ['index.html', 'text/html', encode('<html></html>')],
    ]);
    const ipc = makeIpc({
      structured: (command) => {
        if (command === BEGIN_WEB_PACKAGE_INSTANCE_COMMAND) return { instanceId: 'wpk-7' };
        throw new Error(`unexpected structured command: ${command}`);
      },
      // native 回执声称收到了与本块偏移不符的累计量。
      raw: () => ({ receivedByteLength: 9999 }),
    });

    const failure = await openWebPackageInstanceInIsolatedWebview(
      ipc.invoke,
      ipc.rawInvoke,
      snapshot,
      't',
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DesktopWebPackageInstanceError);
    expect((failure as DesktopWebPackageInstanceError).code).toBe('webpkg-resource-mismatch');
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('Web Package bridge owner lifecycle', () => {
  const snapshot = () => makeSnapshot([
    ['index.html', 'text/html', encode('<html></html>')],
    ['data.bin', 'application/octet-stream', new Uint8Array(MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES + 3)],
  ]);

  it('does not begin for an already expired owner', async () => {
    const ipc = makeIpc(okHandlers());
    const outcome = await openWebPackageInstanceInIsolatedWebview(ipc.invoke, ipc.rawInvoke, snapshot(), 't', () => false).catch((error: unknown) => error);
    expect(outcome).toMatchObject({ name: 'AbortError' });
    expect(ipc.structuredCalls).toHaveLength(0);
    expect(ipc.rawCalls).toHaveLength(0);
  });

  it('does not append or open after a late begin response', async () => {
    const begin = deferred<{ instanceId: string }>();
    let current = true;
    const ok = okHandlers();
    const ipc = makeIpc({ ...ok, structured: (command) => command === BEGIN_WEB_PACKAGE_INSTANCE_COMMAND ? begin.promise : ok.structured(command) });
    const result = openWebPackageInstanceInIsolatedWebview(ipc.invoke, ipc.rawInvoke, snapshot(), 't', () => current).catch((error: unknown) => error);
    expect(ipc.structuredCalls).toHaveLength(1);
    current = false; begin.resolve({ instanceId: 'wpk-7' });
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(ipc.rawCalls).toHaveLength(0);
    expect(ipc.structuredCalls.map(({ command }) => command)).toEqual([BEGIN_WEB_PACKAGE_INSTANCE_COMMAND]);
  });

  it('does not send the next chunk or open after owner expires during append', async () => {
    const append = deferred<{ receivedByteLength: number }>();
    let current = true;
    const ok = okHandlers();
    const ipc = makeIpc({ ...ok, raw: (command, bytes, headers) => headers['x-webpkg-path'] === 'data.bin' && headers['x-webpkg-offset'] === '0' ? append.promise : ok.raw(command, bytes, headers) });
    const result = openWebPackageInstanceInIsolatedWebview(ipc.invoke, ipc.rawInvoke, snapshot(), 't', () => current).catch((error: unknown) => error);
    await vi.waitFor(() => expect(ipc.rawCalls).toHaveLength(2));
    current = false; append.resolve({ receivedByteLength: MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES });
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(ipc.rawCalls).toHaveLength(2);
    expect(ipc.structuredCalls.map(({ command }) => command)).toEqual([BEGIN_WEB_PACKAGE_INSTANCE_COMMAND]);
  });

  it('discards a late open receipt without claiming that its window was revoked', async () => {
    const open = deferred<{ label: string }>();
    let current = true;
    const ok = okHandlers();
    const ipc = makeIpc({ ...ok, structured: (command) => command === OPEN_WEB_PACKAGE_INSTANCE_COMMAND ? open.promise : ok.structured(command) });
    const result = openWebPackageInstanceInIsolatedWebview(ipc.invoke, ipc.rawInvoke, snapshot(), 't', () => current).catch((error: unknown) => error);
    await vi.waitFor(() => expect(ipc.structuredCalls).toHaveLength(2));
    current = false; open.resolve({ label: 'webpkg-wpk-7' });
    expect(await result).toMatchObject({ name: 'AbortError', message: expect.stringContaining('窗口可能已建立') });
    expect(ipc.structuredCalls.map(({ command }) => command)).toEqual([BEGIN_WEB_PACKAGE_INSTANCE_COMMAND, OPEN_WEB_PACKAGE_INSTANCE_COMMAND]);
  });

  it('does not surface stale native failure details after ownership changes', async () => {
    const begin = deferred<unknown>();
    let current = true;
    const ipc = makeIpc({ structured: () => begin.promise });
    const result = openWebPackageInstanceInIsolatedWebview(ipc.invoke, ipc.rawInvoke, snapshot(), 't', () => current).catch((error: unknown) => error);
    current = false; begin.reject({ code: 'webpkg-window-unavailable', message: 'stale native failure' });
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(ipc.rawCalls).toHaveLength(0);
  });
});
