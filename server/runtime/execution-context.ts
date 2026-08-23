import type { NodeExecutionContext } from '@/server/routes/types';

export const DEFAULT_WAIT_UNTIL_DRAIN_TIMEOUT_MS = 10_000;
export const DEFAULT_SERVER_CLOSE_GRACE_TIMEOUT_MS = 10_000;

type ErrorLogger = (message: string, error: unknown) => void | PromiseLike<void>;

type CoordinatorOptions = {
  errorLogger?: ErrorLogger;
};

export type WaitUntilDrainResult = {
  pendingTaskCount: number;
  timedOut: boolean;
};

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
      } catch (error) {
        console.error('[hono][shutdown] 强制关闭 HTTP 连接失败', error);
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
      (error: unknown) => {
        try {
          const logging = this.#errorLogger(
            `[hono][waitUntil][${routeId}] 后台任务失败`,
            error,
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
  drainTimeoutMs,
  stopAcceptingRequests,
}: {
  closeDependencies: () => Promise<void>;
  coordinator: NodeExecutionContextCoordinator;
  drainTimeoutMs: number;
  stopAcceptingRequests: () => Promise<void>;
}): Promise<WaitUntilDrainResult> => {
  await stopAcceptingRequests();
  const drainResult = await coordinator.drain({ timeoutMs: drainTimeoutMs });
  await closeDependencies();
  return drainResult;
};
