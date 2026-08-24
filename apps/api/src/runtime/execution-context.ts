import { writeSync } from 'node:fs';
import type { NodeExecutionContext } from '#/routes/types';

export const DEFAULT_WAIT_UNTIL_DRAIN_TIMEOUT_MS = 10_000;
export const DEFAULT_SERVER_CLOSE_GRACE_TIMEOUT_MS = 10_000;
export const DEFAULT_DEPENDENCY_CLOSE_GRACE_TIMEOUT_MS = 10_000;

type ErrorLogger = (message: string, error: unknown) => void | PromiseLike<void>;
type MessageLogger = (message: string) => void | PromiseLike<void>;

const writeForceExitMessage = (message: string): void => {
  writeSync(process.stderr.fd, `${message}\n`);
};

type CoordinatorOptions = {
  errorLogger?: ErrorLogger;
};

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

type ShutdownSignalSource = {
  off: (signal: ShutdownSignal, listener: () => void) => unknown;
  on: (signal: ShutdownSignal, listener: () => void) => unknown;
};

export type WaitUntilDrainResult = {
  pendingTaskCount: number;
  timedOut: boolean;
};

export type ShutdownDrainResult = WaitUntilDrainResult & {
  dependencyCloseTimedOut: boolean;
};

export class ShutdownCleanupError extends Error {
  readonly errors: readonly unknown[];

  constructor(errors: readonly unknown[]) {
    super('停止接流或 drain 与依赖关闭均失败');
    this.name = 'ShutdownCleanupError';
    this.errors = errors;
  }
}

type HttpServerShutdownControls = {
  close: (callback: () => void) => unknown;
  closeAllConnections?: () => unknown;
  closeIdleConnections?: () => unknown;
};

export const stopAcceptingRequestsWithGrace = (
  server: HttpServerShutdownControls,
  { timeoutMs }: { timeoutMs: number },
): Promise<{ timedOut: boolean }> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('server close grace timeoutMs 必须是非负有限数');
  }

  return new Promise<{ timedOut: boolean }>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        server.closeAllConnections?.();
      } catch {
        console.error('[hono][shutdown] 强制关闭 HTTP 连接失败', {
          errorClass: 'force_close_failed',
        });
      }
      resolve({ timedOut: true });
    }, timeoutMs);

    try {
      server.close(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false });
      });
      if (!settled) server.closeIdleConnections?.();
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
};

export const createSingleRunShutdown = <Trigger>(
  executeShutdown: (trigger: Trigger) => Promise<void>,
): ((trigger: Trigger) => Promise<void>) => {
  let shutdownPromise: Promise<void> | undefined;
  return (trigger) => {
    shutdownPromise ??= Promise.resolve().then(() => executeShutdown(trigger));
    return shutdownPromise;
  };
};

export const closeDependenciesWithGrace = (
  closeDependencies: () => Promise<void>,
  forceCloseDependencies: () => void,
  { timeoutMs }: { timeoutMs: number },
): Promise<{ timedOut: boolean }> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('dependency close grace timeoutMs 必须是非负有限数');
  }

  const closePromise = Promise.resolve().then(closeDependencies);
  return new Promise<{ timedOut: boolean }>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        forceCloseDependencies();
        resolve({ timedOut: true });
      } catch (error) {
        reject(error);
      }
    }, timeoutMs);

    void closePromise.then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

export const wireGracefulShutdownSignals = ({
  errorLogger = console.error,
  exit = (code) => process.exit(code),
  forceExitLogger = writeForceExitMessage,
  shutdown,
  signalSource = process,
}: {
  errorLogger?: ErrorLogger;
  exit?: (code: number) => void;
  forceExitLogger?: MessageLogger;
  shutdown: (signal: ShutdownSignal) => Promise<void>;
  signalSource?: ShutdownSignalSource;
}): (() => void) => {
  let exitCompletion: Promise<void> | undefined;
  let exitRequested = false;
  const listeners = new Map<ShutdownSignal, () => void>();

  const exitOnce = (code: number): void => {
    if (exitRequested) return;
    exitRequested = true;
    exit(code);
  };

  const beginShutdown = (signal: ShutdownSignal): void => {
    if (exitCompletion) {
      if (exitRequested) return;
      try {
        const logging = forceExitLogger(`[hono] 优雅退出期间再次收到 ${signal}，立即强制退出`);
        void Promise.resolve(logging).catch(() => undefined);
      } catch {
        // 日志 sink 失败不能阻止第二次 termination signal 强制退出。
      }
      exitOnce(1);
      return;
    }
    exitCompletion = Promise.resolve()
      .then(() => shutdown(signal))
      .then(
        () => exitOnce(0),
        (_error: unknown) => {
          try {
            const logging = errorLogger('[hono] 优雅退出失败', {
              errorClass: 'shutdown_failed',
            });
            void Promise.resolve(logging).catch(() => undefined);
          } catch {
            // 日志 sink 失败不能阻止进程按失败状态退出。
          }
          exitOnce(1);
        },
      );
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const listener = () => beginShutdown(signal);
    listeners.set(signal, listener);
    signalSource.on(signal, listener);
  }

  return () => {
    for (const [signal, listener] of listeners) {
      signalSource.off(signal, listener);
    }
  };
};

export class NodeExecutionContextCoordinator {
  readonly #errorLogger: ErrorLogger;
  readonly #pendingTasks = new Set<Promise<void>>();

  constructor(options: CoordinatorOptions = {}) {
    this.#errorLogger = options.errorLogger ?? console.error;
  }

  get pendingTaskCount(): number {
    return this.#pendingTasks.size;
  }

  createExecutionContext(routeId: string): NodeExecutionContext {
    return {
      waitUntil: (promise) => this.#track(promise, routeId),
    };
  }

  async drain({ timeoutMs }: { timeoutMs: number }): Promise<WaitUntilDrainResult> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error('waitUntil drain timeoutMs 必须是非负有限数');
    }

    const deadline = Date.now() + timeoutMs;
    while (this.#pendingTasks.size > 0) {
      const remainingMs = Math.max(0, deadline - Date.now());
      const completed = await this.#waitForPendingSnapshot(remainingMs);
      if (!completed) {
        return {
          pendingTaskCount: this.#pendingTasks.size,
          timedOut: true,
        };
      }
    }

    return {
      pendingTaskCount: 0,
      timedOut: false,
    };
  }

  #track(promise: Promise<unknown>, routeId: string): void {
    const tracked = Promise.resolve(promise).then(
      () => undefined,
      (_error: unknown) => {
        try {
          const logging = this.#errorLogger(
            `[hono][waitUntil][${routeId}] 后台任务失败`,
            { errorClass: 'background_task_failed' },
          );
          void Promise.resolve(logging).catch(() => undefined);
        } catch {
          // 日志 sink 失败不能把已吸收的后台任务 rejection 重新抛回事件循环。
        }
      },
    );

    this.#pendingTasks.add(tracked);
    void tracked.then(() => {
      this.#pendingTasks.delete(tracked);
    });
  }

  async #waitForPendingSnapshot(timeoutMs: number): Promise<boolean> {
    const snapshot = [...this.#pendingTasks];
    if (snapshot.length === 0) return true;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(completed);
      };

      const timer = setTimeout(() => finish(false), timeoutMs);
      void Promise.allSettled(snapshot).then(() => finish(true));
    });
  }
}

export const nodeExecutionContextCoordinator = new NodeExecutionContextCoordinator();

export const shutdownWithWaitUntilDrain = async ({
  closeDependencies,
  coordinator,
  dependencyCloseTimeoutMs,
  drainTimeoutMs,
  forceCloseDependencies,
  stopAcceptingRequests,
}: {
  closeDependencies: () => Promise<void>;
  coordinator: NodeExecutionContextCoordinator;
  dependencyCloseTimeoutMs: number;
  drainTimeoutMs: number;
  forceCloseDependencies: () => void;
  stopAcceptingRequests: () => Promise<void>;
}): Promise<ShutdownDrainResult> => {
  let drainResult: WaitUntilDrainResult | undefined;
  let lifecycleFailure: { error: unknown } | undefined;
  try {
    await stopAcceptingRequests();
    drainResult = await coordinator.drain({ timeoutMs: drainTimeoutMs });
  } catch (error) {
    lifecycleFailure = { error };
  }

  let dependencyCloseResult: { timedOut: boolean };
  try {
    dependencyCloseResult = await closeDependenciesWithGrace(
      closeDependencies,
      forceCloseDependencies,
      { timeoutMs: dependencyCloseTimeoutMs },
    );
  } catch (error) {
    if (lifecycleFailure) {
      throw new ShutdownCleanupError([lifecycleFailure.error, error]);
    }
    throw error;
  }

  if (lifecycleFailure) throw lifecycleFailure.error;
  if (!drainResult) throw new Error('shutdown drain 未返回结果');
  return {
    ...drainResult,
    dependencyCloseTimedOut: dependencyCloseResult.timedOut,
  };
};
