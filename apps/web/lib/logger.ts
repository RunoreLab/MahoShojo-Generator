type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_VALUES: Record<LogLevel | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

const normalizeLevel = (value: string | undefined): LogLevel | 'silent' => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error' || normalized === 'silent') {
    return normalized;
  }
  return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
};

const activeLevel = normalizeLevel(process.env.LOG_LEVEL);

const shouldLog = (level: LogLevel): boolean => LEVEL_VALUES[level] >= LEVEL_VALUES[activeLevel];

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const buildPayload = (caller: string | undefined, args: unknown[]): Record<string, unknown> | undefined => {
  const [firstArg, ...restArgs] = args;
  const firstRecord = toRecord(firstArg);
  const payload: Record<string, unknown> = {
    ...(caller ? { caller } : {}),
    ...(firstRecord ?? (typeof firstArg === 'undefined' ? {} : { data: firstArg })),
  };

  if (restArgs.length > 0) {
    payload.args = restArgs;
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
};

const writeLog = (level: LogLevel, caller: string | undefined, msg: string, args: unknown[]): void => {
  if (!shouldLog(level)) return;

  const payload = buildPayload(caller, args);
  const writer = console[level] ?? console.log;

  if (payload) {
    writer(JSON.stringify(payload), msg);
    return;
  }

  writer(msg);
};

export const getLogger = (fileName: string) => ({
  info: (msg: string, ...args: unknown[]) => writeLog('info', fileName, msg, args),
  error: (msg: string, ...args: unknown[]) => writeLog('error', fileName, msg, args),
  warn: (msg: string, ...args: unknown[]) => writeLog('warn', fileName, msg, args),
  debug: (msg: string, ...args: unknown[]) => writeLog('debug', fileName, msg, args),
});

export const log = {
  info: (msg: string, ...args: unknown[]) => writeLog('info', undefined, msg, args),
  error: (msg: string, ...args: unknown[]) => writeLog('error', undefined, msg, args),
  warn: (msg: string, ...args: unknown[]) => writeLog('warn', undefined, msg, args),
  debug: (msg: string, ...args: unknown[]) => writeLog('debug', undefined, msg, args),
};
