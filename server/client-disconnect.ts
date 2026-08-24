const CLIENT_CONNECTION_PREMATURELY_CLOSED = 'client connection prematurely closed';

const readErrorMessage = (reason: unknown): string => {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  if (!reason || typeof reason !== 'object') return '';

  const message = (reason as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
};

/**
 * @hono/node-server 在客户端提前断开请求时使用的标准错误。
 * 该错误属于请求级取消，不应升级为进程级故障。
 */
export const isExpectedClientDisconnect = (reason: unknown): boolean =>
  readErrorMessage(reason).trim().toLowerCase().includes(CLIENT_CONNECTION_PREMATURELY_CLOSED);

type UnhandledRejectionActions = {
  logExpected: (reason: unknown) => void;
  logFatal: (reason: unknown) => void;
  terminate: (exitCode: number) => void;
};

export const handleUnhandledRejection = (
  reason: unknown,
  actions: UnhandledRejectionActions,
): 'ignored-client-disconnect' | 'fatal' => {
  if (isExpectedClientDisconnect(reason)) {
    actions.logExpected(reason);
    return 'ignored-client-disconnect';
  }

  actions.logFatal(reason);
  actions.terminate(1);
  return 'fatal';
};

export const installUnhandledRejectionGuard = (): void => {
  process.on('unhandledRejection', (reason) => {
    handleUnhandledRejection(reason, {
      logExpected: () => {
        console.info('[hono] 客户端提前断开连接，已按请求取消处理');
      },
      logFatal: (fatalReason) => {
        console.error('[hono] 未处理的 Promise rejection，进程即将退出', fatalReason);
      },
      terminate: (exitCode) => process.exit(exitCode),
    });
  });
};
