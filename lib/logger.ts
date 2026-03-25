import pino from 'pino';

// 创建 Pino 日志器配置
const createLogger = () => {
  const isDev = process.env.NODE_ENV === 'development';
  const level = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');
  const isEdge = process.env.NEXT_RUNTIME === 'edge';

  // Edge Runtime 环境配置
  if (isEdge) {
    return pino({
      level,
      browser: {
        write: {
          info: (o: any) => console.info(JSON.stringify(o)),
          warn: (o: any) => console.warn(JSON.stringify(o)),
          error: (o: any) => console.error(JSON.stringify(o)),
          debug: (o: any) => console.debug(JSON.stringify(o)),
        },
      }
    });
  }

  // Node.js 环境配置
  // 说明：不要默认启用 pino-pretty transport。
  // 这个仓库的 logger 还会被客户端 hook/Edge 相关链路间接引用，
  // 在 Next.js/Turbopack 下让运行时再去解析 "pino-pretty" 容易直接触发 SSR 500。
  return pino({
    level,
    formatters: {
      level: (label: string) => {
        return { level: label };
      }
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
};

// 创建日志器实例
const logger = createLogger();

// 创建带有文件名的日志实例
export const getLogger = (fileName: string) => ({
  info: (msg: string, ...args: any[]) => {
    if (args.length > 0) {
      // 如果有额外参数，将它们合并到对象中
      const [firstArg, ...restArgs] = args;
      if (typeof firstArg === 'object' && firstArg !== null) {
        logger.info({ caller: fileName, ...firstArg }, msg, ...restArgs);
      } else {
        logger.info({ caller: fileName, data: firstArg }, msg, ...restArgs);
      }
    } else {
      logger.info({ caller: fileName }, msg);
    }
  },
  error: (msg: string, ...args: any[]) => {
    if (args.length > 0) {
      const [firstArg, ...restArgs] = args;
      if (typeof firstArg === 'object' && firstArg !== null) {
        logger.error({ caller: fileName, ...firstArg }, msg, ...restArgs);
      } else {
        logger.error({ caller: fileName, data: firstArg }, msg, ...restArgs);
      }
    } else {
      logger.error({ caller: fileName }, msg);
    }
  },
  warn: (msg: string, ...args: any[]) => {
    if (args.length > 0) {
      const [firstArg, ...restArgs] = args;
      if (typeof firstArg === 'object' && firstArg !== null) {
        logger.warn({ caller: fileName, ...firstArg }, msg, ...restArgs);
      } else {
        logger.warn({ caller: fileName, data: firstArg }, msg, ...restArgs);
      }
    } else {
      logger.warn({ caller: fileName }, msg);
    }
  },
  debug: (msg: string, ...args: any[]) => {
    if (args.length > 0) {
      const [firstArg, ...restArgs] = args;
      if (typeof firstArg === 'object' && firstArg !== null) {
        logger.debug({ caller: fileName, ...firstArg }, msg, ...restArgs);
      } else {
        logger.debug({ caller: fileName, data: firstArg }, msg, ...restArgs);
      }
    } else {
      logger.debug({ caller: fileName }, msg);
    }
  }
});

// 默认日志方法（无文件名）
export const log = {
  info: (msg: string, ...args: any[]) => {
    logger.info(msg, ...args);
  },
  error: (msg: string, ...args: any[]) => {
    logger.error(msg, ...args);
  },
  warn: (msg: string, ...args: any[]) => {
    logger.warn(msg, ...args);
  },
  debug: (msg: string, ...args: any[]) => {
    logger.debug(msg, ...args);
  }
};
