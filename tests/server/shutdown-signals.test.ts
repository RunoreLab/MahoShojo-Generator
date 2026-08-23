import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wireGracefulShutdownSignals } from '@/server/runtime/execution-context';

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
  ])('收到 %s 后 cleanup 中再收到 %s 仍只完成一条退出链', async (first, second) => {
    const signalSource = new EventEmitter();
    const deferred = createDeferred();
    const shutdown = vi.fn(() => deferred.promise);
    const exit = vi.fn();
    disposers.push(wireGracefulShutdownSignals({ exit, shutdown, signalSource }));

    signalSource.emit(first);
    signalSource.emit(second);
    await Promise.resolve();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith(first);
    expect(exit).not.toHaveBeenCalled();

    deferred.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);

    signalSource.emit(first);
    signalSource.emit(second);
    await Promise.resolve();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
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
  it('第二个 SIGTERM 不会中断已开始的 cleanup', async () => {
    const fixture = path.join(
      process.cwd(),
      'tests/server/fixtures/shutdown-signal-child.ts',
    );
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
        cwd: process.cwd(),
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
        expect(code).toBe(0);
        const markers = await readMarkers(markerPath);
        expect(markers).toContain('cleanup-marker\n');
        expect(markers.match(/cleanup-marker/g)).toHaveLength(1);
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
  }, 10_000);
});
