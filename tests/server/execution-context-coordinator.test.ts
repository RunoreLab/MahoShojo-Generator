import { describe, expect, it, vi } from 'vitest';
import {
  createSingleRunShutdown,
  NodeExecutionContextCoordinator,
  shutdownWithWaitUntilDrain,
  stopAcceptingRequestsWithGrace,
} from '@/server/runtime/execution-context';

const createDeferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe('Node waitUntil execution context coordinator', () => {
  it('重复 shutdown 调用复用同一生命周期且第二次不会提前完成', async () => {
    const deferred = createDeferred();
    const events: string[] = [];
    const executeShutdown = vi.fn(async (signal: string) => {
      events.push(`started:${signal}`);
      await deferred.promise;
      events.push('completed');
    });
    const shutdown = createSingleRunShutdown(executeShutdown);

    const first = shutdown('SIGTERM');
    const second = shutdown('SIGINT');
    let secondCompleted = false;
    void second.then(() => {
      secondCompleted = true;
    });
    await Promise.resolve();

    expect(second).toBe(first);
    expect(executeShutdown).toHaveBeenCalledTimes(1);
    expect(executeShutdown).toHaveBeenCalledWith('SIGTERM');
    expect(secondCompleted).toBe(false);
    expect(events).toEqual(['started:SIGTERM']);

    deferred.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(events).toEqual(['started:SIGTERM', 'completed']);
  });

  it('stop-accepting 在活动请求令 close callback 不返回时有界强制关闭连接', async () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      let closeCallback: (() => void) | undefined;
      const server = {
        close: vi.fn((callback: () => void) => {
          events.push('close-started');
          closeCallback = callback;
        }),
        closeAllConnections: vi.fn(() => {
          events.push('all-connections-closed');
        }),
        closeIdleConnections: vi.fn(() => {
          events.push('idle-connections-closed');
        }),
      };

      const stopping = stopAcceptingRequestsWithGrace(server, { timeoutMs: 1_000 });
      let completed = false;
      void stopping.then(() => {
        completed = true;
      });

      expect(events).toEqual(['close-started', 'idle-connections-closed']);
      await vi.advanceTimersByTimeAsync(999);
      expect(completed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(stopping).resolves.toEqual({ timedOut: true });
      expect(events).toEqual([
        'close-started',
        'idle-connections-closed',
        'all-connections-closed',
      ]);

      closeCallback?.();
      await Promise.resolve();
      expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('在后台任务完成前保持 pending，并由 drain 等待其完成', async () => {
    const coordinator = new NodeExecutionContextCoordinator();
    const deferred = createDeferred();
    coordinator.createExecutionContext('generate-free').waitUntil(deferred.promise);

    let drainCompleted = false;
    const drainPromise = coordinator.drain({ timeoutMs: 1_000 }).then((result) => {
      drainCompleted = true;
      return result;
    });
    await Promise.resolve();

    expect(coordinator.pendingTaskCount).toBe(1);
    expect(drainCompleted).toBe(false);

    deferred.resolve();
    await expect(drainPromise).resolves.toEqual({
      pendingTaskCount: 0,
      timedOut: false,
    });
    expect(coordinator.pendingTaskCount).toBe(0);
  });

  it('drain 到达明确 timeout 后返回，不被永久未完成任务卡住', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new NodeExecutionContextCoordinator();
      coordinator.createExecutionContext('generate-scenario').waitUntil(new Promise(() => {}));

      const drainPromise = coordinator.drain({ timeoutMs: 2_000 });
      await vi.advanceTimersByTimeAsync(1_999);
      let completed = false;
      void drainPromise.then(() => {
        completed = true;
      });
      await Promise.resolve();
      expect(completed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(drainPromise).resolves.toEqual({
        pendingTaskCount: 1,
        timedOut: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('吸收 waitUntil rejection、记录 route，且 drain 仍正常完成', async () => {
    const errorLogger = vi.fn();
    const coordinator = new NodeExecutionContextCoordinator({ errorLogger });
    const backgroundError = new Error('activity write failed');

    coordinator
      .createExecutionContext('creator/generate')
      .waitUntil(Promise.reject(backgroundError));

    await expect(coordinator.drain({ timeoutMs: 1_000 })).resolves.toEqual({
      pendingTaskCount: 0,
      timedOut: false,
    });
    expect(errorLogger).toHaveBeenCalledWith(
      '[hono][waitUntil][creator/generate] 后台任务失败',
      backgroundError,
    );
  });

  it('异步 error logger 自身 rejection 时不产生 unhandled rejection', async () => {
    const loggerFailure = Promise.reject(new Error('log sink unavailable'));
    void loggerFailure.then(undefined, () => undefined);
    const catchSpy = vi.spyOn(loggerFailure, 'catch');
    const errorLogger = vi.fn(() => loggerFailure);
    const coordinator = new NodeExecutionContextCoordinator({ errorLogger });
    coordinator
      .createExecutionContext('generate-free')
      .waitUntil(Promise.reject(new Error('activity write failed')));

    await expect(coordinator.drain({ timeoutMs: 1_000 })).resolves.toMatchObject({
      timedOut: false,
    });
    await Promise.resolve();

    expect(errorLogger).toHaveBeenCalledTimes(1);
    expect(catchSpy).toHaveBeenCalledTimes(1);
  });

  it('shutdown 先停止接流，再等待 waitUntil，最后关闭依赖', async () => {
    const coordinator = new NodeExecutionContextCoordinator();
    const deferred = createDeferred();
    const events: string[] = [];
    coordinator.createExecutionContext('generate-game-card').waitUntil(
      deferred.promise.then(() => {
        events.push('background-completed');
      }),
    );

    const shutdownPromise = shutdownWithWaitUntilDrain({
      closeDependencies: async () => {
        events.push('dependencies-closed');
      },
      coordinator,
      drainTimeoutMs: 1_000,
      stopAcceptingRequests: async () => {
        events.push('accepting-stopped');
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['accepting-stopped']);
    deferred.resolve();
    await expect(shutdownPromise).resolves.toEqual({
      pendingTaskCount: 0,
      timedOut: false,
    });
    expect(events).toEqual([
      'accepting-stopped',
      'background-completed',
      'dependencies-closed',
    ]);
  });

  it('shutdown 即使 drain 超时也会继续关闭依赖', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new NodeExecutionContextCoordinator();
      coordinator.createExecutionContext('generate-canshou').waitUntil(new Promise(() => {}));
      const closeDependencies = vi.fn(async () => undefined);

      const shutdownPromise = shutdownWithWaitUntilDrain({
        closeDependencies,
        coordinator,
        drainTimeoutMs: 500,
        stopAcceptingRequests: vi.fn(async () => undefined),
      });
      await vi.advanceTimersByTimeAsync(500);

      await expect(shutdownPromise).resolves.toEqual({
        pendingTaskCount: 1,
        timedOut: true,
      });
      expect(closeDependencies).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
