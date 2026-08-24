import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
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
    const shutdownError = new Error('redis close failed');
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
    expect(errorLogger).toHaveBeenCalledWith('[hono] 优雅退出失败', shutdownError);
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

  it('disposer 可重复调用并精确移除两个 signal listener', async () => {
    const signalSource = new EventEmitter();
    const sigintSentinel = vi.fn();
    const sigtermSentinel = vi.fn();
    signalSource.on('SIGINT', sigintSentinel);
    signalSource.on('SIGTERM', sigtermSentinel);
    const shutdown = vi.fn(async () => undefined);
    const dispose = wireGracefulShutdownSignals({
      exit: vi.fn(),
      shutdown,
      signalSource,
    });

    expect(signalSource.listenerCount('SIGINT')).toBe(2);
    expect(signalSource.listenerCount('SIGTERM')).toBe(2);
    dispose();
    dispose();
    expect(signalSource.listenerCount('SIGINT')).toBe(1);
    expect(signalSource.listenerCount('SIGTERM')).toBe(1);

    signalSource.emit('SIGINT');
    signalSource.emit('SIGTERM');
    await Promise.resolve();
    expect(sigintSentinel).toHaveBeenCalledTimes(1);
    expect(sigtermSentinel).toHaveBeenCalledTimes(1);
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
): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const markers = await readMarkers(markerPath);
    if (markers.includes(marker)) return;
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

        const [code, signal] = await once(child, 'exit') as [
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
});
