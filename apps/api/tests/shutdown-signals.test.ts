import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { isExpectedClientDisconnect } from '@mahoshojo/hosted-runtime/node-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wireGracefulShutdownSignals } from '#/runtime/execution-context';

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('graceful shutdown signal wiring', () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it.each<readonly [NodeJS.Signals, NodeJS.Signals]>([
    ['SIGTERM', 'SIGTERM'],
    ['SIGINT', 'SIGINT'],
    ['SIGTERM', 'SIGINT'],
  ])('收到 %s 后 cleanup 中再收到 %s 会强制失败退出', async (first, second) => {
    const signalSource = new EventEmitter();
    const deferred = createDeferred();
    const shutdown = vi.fn(() => deferred.promise);
    const exit = vi.fn();
    const forceExitLogger = vi.fn();
    disposers.push(wireGracefulShutdownSignals({
      exit,
      forceExitLogger,
      shutdown,
      signalSource,
    }));

    signalSource.emit(first);
    signalSource.emit(second);
    await Promise.resolve();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith(first);
    expect(forceExitLogger).toHaveBeenCalledWith(
      `[hono] 优雅退出期间再次收到 ${second}，立即强制退出`,
    );
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);

    deferred.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(exit).toHaveBeenCalledTimes(1);

    signalSource.emit(first);
    signalSource.emit(second);
    await Promise.resolve();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('shutdown rejection 只触发一次失败退出', async () => {
    const signalSource = new EventEmitter();
    const shutdownError = new Error('redis-close-url-secret-canary');
    const shutdown = vi.fn(async () => {
      throw shutdownError;
    });
    const exit = vi.fn();
    const errorLogger = vi.fn();
    disposers.push(wireGracefulShutdownSignals({
      errorLogger,
      exit,
      shutdown,
      signalSource,
    }));

    signalSource.emit('SIGTERM');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(errorLogger).toHaveBeenCalledWith('[hono] 优雅退出失败', {
      errorClass: 'shutdown_failed',
    });
    expect(JSON.stringify(errorLogger.mock.calls)).not.toContain('redis-close-url-secret-canary');
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('预期的 Hono 客户端断连只记录请求取消，不触发 shutdown 或退出', async () => {
    const signalSource = new EventEmitter();
    const shutdown = vi.fn(async () => undefined);
    const exit = vi.fn();
    const expectedRejectionLogger = vi.fn();
    const wiringOptions = {
      exit,
      expectedRejectionLogger,
      isExpectedUnhandledRejection: isExpectedClientDisconnect,
      shutdown,
      signalSource,
    };
    disposers.push(wireGracefulShutdownSignals(wiringOptions));

    signalSource.emit(
      'unhandledRejection',
      new Error('Client connection prematurely closed.'),
      Promise.resolve(),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(expectedRejectionLogger).toHaveBeenCalledWith(
      '[hono] 客户端提前断开连接，已按请求取消处理',
    );
    expect(shutdown).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(isExpectedClientDisconnect(
      new Error('database failure after client connection prematurely closed'),
    )).toBe(false);
  });

  it('未知 unhandled rejection 完成既有 cleanup 后以失败码退出', async () => {
    const signalSource = new EventEmitter();
    const deferred = createDeferred();
    const shutdown = vi.fn(() => deferred.promise);
    const exit = vi.fn();
    const errorLogger = vi.fn();
    const wiringOptions = {
      errorLogger,
      exit,
      isExpectedUnhandledRejection: () => false,
      shutdown,
      signalSource,
    };
    disposers.push(wireGracefulShutdownSignals(wiringOptions));

    signalSource.emit(
      'unhandledRejection',
      new Error('fatal-secret-canary'),
      Promise.resolve(),
    );
    await Promise.resolve();

    expect(shutdown).toHaveBeenCalledWith('UNHANDLED_REJECTION');
    expect(errorLogger).toHaveBeenCalledWith('[hono] 未处理的 Promise rejection', {
      errorClass: 'unhandled_rejection',
    });
    expect(JSON.stringify(errorLogger.mock.calls)).not.toContain('fatal-secret-canary');
    expect(exit).not.toHaveBeenCalled();

    deferred.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('cleanup 期间重复未知 rejection 复用同一次 shutdown，不提前退出', async () => {
    const signalSource = new EventEmitter();
    const deferred = createDeferred();
    const shutdown = vi.fn(() => deferred.promise);
    const exit = vi.fn();
    disposers.push(wireGracefulShutdownSignals({
      exit,
      isExpectedUnhandledRejection: () => false,
      shutdown,
      signalSource,
    }));

    signalSource.emit('unhandledRejection', new Error('first fatal'), Promise.resolve());
    await Promise.resolve();
    signalSource.emit('unhandledRejection', new Error('second fatal'), Promise.resolve());
    await Promise.resolve();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith('UNHANDLED_REJECTION');
    expect(exit).not.toHaveBeenCalled();

    deferred.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('signal cleanup 期间出现未知 rejection 时保留 cleanup 并升级为失败退出', async () => {
    const signalSource = new EventEmitter();
    const deferred = createDeferred();
    const shutdown = vi.fn(() => deferred.promise);
    const exit = vi.fn();
    disposers.push(wireGracefulShutdownSignals({
      exit,
      isExpectedUnhandledRejection: () => false,
      shutdown,
      signalSource,
    }));

    signalSource.emit('SIGTERM');
    await Promise.resolve();
    signalSource.emit('unhandledRejection', new Error('fatal during cleanup'), Promise.resolve());
    await Promise.resolve();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith('SIGTERM');
    expect(exit).not.toHaveBeenCalled();

    deferred.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('异步 error logger rejection 被吸收且仍只失败退出一次', async () => {
    const signalSource = new EventEmitter();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    const errorLogger = vi.fn(() => Promise.reject(new Error('log sink unavailable')));
    const exit = vi.fn();
    disposers.push(wireGracefulShutdownSignals({
      errorLogger,
      exit,
      shutdown: vi.fn(async () => {
        throw new Error('shutdown failed');
      }),
      signalSource,
    }));

    process.on('unhandledRejection', onUnhandledRejection);
    try {
      signalSource.emit('SIGTERM');
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }

    expect(process.listeners('unhandledRejection')).not.toContain(onUnhandledRejection);
    expect(unhandledRejections).toEqual([]);
    expect(errorLogger).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('disposer 可重复调用并精确移除 signal 与 unhandledRejection listener', async () => {
    const signalSource = new EventEmitter();
    const sigintSentinel = vi.fn();
    const sigtermSentinel = vi.fn();
    const rejectionSentinel = vi.fn();
    signalSource.on('SIGINT', sigintSentinel);
    signalSource.on('SIGTERM', sigtermSentinel);
    signalSource.on('unhandledRejection', rejectionSentinel);
    const shutdown = vi.fn(async () => undefined);
    const dispose = wireGracefulShutdownSignals({
      exit: vi.fn(),
      shutdown,
      signalSource,
    });

    expect(signalSource.listenerCount('SIGINT')).toBe(2);
    expect(signalSource.listenerCount('SIGTERM')).toBe(2);
    expect(signalSource.listenerCount('unhandledRejection')).toBe(2);
    dispose();
    dispose();
    expect(signalSource.listenerCount('SIGINT')).toBe(1);
    expect(signalSource.listenerCount('SIGTERM')).toBe(1);
    expect(signalSource.listenerCount('unhandledRejection')).toBe(1);

    signalSource.emit('SIGINT');
    signalSource.emit('SIGTERM');
    signalSource.emit('unhandledRejection', new Error('sentinel'), Promise.resolve());
    await Promise.resolve();
    expect(sigintSentinel).toHaveBeenCalledTimes(1);
    expect(sigtermSentinel).toHaveBeenCalledTimes(1);
    expect(rejectionSentinel).toHaveBeenCalledTimes(1);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('disposer 不会取消已经开始的 shutdown lifecycle', async () => {
    const signalSource = new EventEmitter();
    const deferred = createDeferred();
    const shutdown = vi.fn(() => deferred.promise);
    const exit = vi.fn();
    const dispose = wireGracefulShutdownSignals({ exit, shutdown, signalSource });

    signalSource.emit('SIGTERM');
    dispose();
    deferred.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

const readMarkers = async (markerPath: string): Promise<string> => {
  try {
    return await readFile(markerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
};

const waitForMarker = async (
  child: ChildProcess,
  markerPath: string,
  marker: string,
  minimumCount = 1,
): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const markers = await readMarkers(markerPath);
    if (markers.split(marker).length - 1 >= minimumCount) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `子进程在写入 ${marker} 前退出：code=${String(child.exitCode)} `
        + `signal=${String(child.signalCode)}\n${markers}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`等待子进程 marker 超时：${marker}\n${await readMarkers(markerPath)}`);
};

const waitForReadyPort = async (
  child: ChildProcess,
  markerPath: string,
  readStderr: () => string,
): Promise<number> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const markers = await readMarkers(markerPath);
    const match = /^ready:(\d+)$/mu.exec(markers);
    if (match) return Number(match[1]);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `子进程在 HTTP server ready 前退出：code=${String(child.exitCode)} `
        + `signal=${String(child.signalCode)}\n${markers}\n${readStderr()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`等待 HTTP server ready 超时\n${await readMarkers(markerPath)}`);
};

const abortStreamAfterFirstChunk = (port: number): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write('GET /stream HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
    });
    socket.setTimeout(2_000);
    socket.once('data', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', (error) => {
      reject(error);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('等待流首个 chunk 超时'));
    });
  });

describe('graceful shutdown real Node signals', () => {
  it('第二个 SIGTERM 会中断已开始的 cleanup 并失败退出', async () => {
    const fixture = path.join(import.meta.dirname, 'fixtures/shutdown-signal-child.ts');
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'mahoshojo-shutdown-'));
    const bundledFixture = path.join(temporaryDirectory, 'shutdown-signal-child.mjs');
    const markerPath = path.join(temporaryDirectory, 'markers.txt');

    try {
      await build({
        bundle: true,
        entryPoints: [fixture],
        format: 'esm',
        logLevel: 'silent',
        outfile: bundledFixture,
        platform: 'node',
        target: 'node20',
      });
      const child = spawn(process.execPath, [bundledFixture], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: { ...process.env, SHUTDOWN_MARKER_PATH: markerPath },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      try {
        await waitForMarker(child, markerPath, 'ready\n');
        expect(child.kill('SIGTERM')).toBe(true);
        await waitForMarker(child, markerPath, 'shutdown-started:SIGTERM\n');
        expect(child.kill('SIGTERM')).toBe(true);

        const [code, signal] = await once(child, 'close') as [
          number | null,
          NodeJS.Signals | null,
        ];
        expect(signal).toBeNull();
        expect(code).toBe(1);
        const markers = await readMarkers(markerPath);
        expect(markers).not.toContain('cleanup-marker\n');
        expect(stderr).toContain('立即强制退出');
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const childExited = once(child, 'exit');
          child.kill('SIGKILL');
          await childExited;
        }
      }
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }, 10_000);

  it('客户端反复中断流后服务进程仍存活且 health 正常', async () => {
    const fixture = path.join(import.meta.dirname, 'fixtures/client-disconnect-child.ts');
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'mahoshojo-disconnect-'));
    const bundledFixture = path.join(temporaryDirectory, 'client-disconnect-child.mjs');
    const markerPath = path.join(temporaryDirectory, 'markers.txt');

    try {
      await build({
        bundle: true,
        entryPoints: [fixture],
        format: 'esm',
        logLevel: 'silent',
        outfile: bundledFixture,
        platform: 'node',
        target: 'node20',
      });
      const child = spawn(process.execPath, [bundledFixture], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: { ...process.env, SHUTDOWN_MARKER_PATH: markerPath },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      try {
        const port = await waitForReadyPort(child, markerPath, () => stderr);
        for (let index = 0; index < 10; index += 1) {
          await abortStreamAfterFirstChunk(port);
        }
        await waitForMarker(child, markerPath, 'disconnect-handled\n', 10);

        const response = await fetch(`http://127.0.0.1:${port}/health`);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
        expect(child.exitCode).toBeNull();
        expect(child.signalCode).toBeNull();
        expect(stderr).toBe('');
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const childExited = once(child, 'exit');
          child.kill('SIGKILL');
          await childExited;
        }
      }
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }, 15_000);
});
