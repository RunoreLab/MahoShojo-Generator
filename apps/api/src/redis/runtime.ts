import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createClient } from 'redis';
import type { GenerationReplayStore } from '@mahoshojo/hosted-api/arena-generation/service';
import {
  createRedisGenerationReplayStore,
  type RedisGenerationClient,
} from './generation-replay-store';
import {
  createRedisRoomStore,
  type RedisRoomClient,
  type RedisRoomStore,
} from '../arena-room/redis-room-store';

const DEFAULT_REDIS_COMMAND_TIMEOUT_MS = 4_000;

export type RedisRuntimeOperation = 'connect' | 'ping' | 'rate-limit' | 'generation' | 'info';

export type RedisRuntimeOperationOutcome = 'ok' | 'error' | 'unavailable';

export type RedisRuntimeOperationObservation = {
  operation: RedisRuntimeOperation;
  outcome: RedisRuntimeOperationOutcome;
  durationMs: number;
};

export type RedisServerStatsObservation = {
  usedMemoryBytes: number | null;
  evictedKeys: number | null;
  keyspaceHits: number | null;
  keyspaceMisses: number | null;
};

export interface RedisRuntimeObserver {
  observeRedisOperation(_observation: RedisRuntimeOperationObservation): void;
  observeRedisServerStats(_observation: RedisServerStatsObservation): void;
}

const noopRedisRuntimeObserver: RedisRuntimeObserver = Object.freeze({
  observeRedisOperation: () => undefined,
  observeRedisServerStats: () => undefined,
});

export type RedisRuntimeStatus = {
  configured: boolean;
  connected: boolean;
  ready: boolean;
  lastError: string | null;
};

export type FixedWindowRateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export interface RedisService {
  connect(): Promise<void>;
  getStatus(): RedisRuntimeStatus;
  ping(): Promise<boolean>;
  consumeFixedWindow(input: {
    namespace: string;
    identity: string;
    limit: number;
    windowSeconds: number;
  }): Promise<FixedWindowRateLimitResult | null>;
  close(): Promise<void>;
}

const FIXED_WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

const createRedisOperationError = (code: string): Error => new Error(code);

const hashKeyPart = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);

const createRedisClient = (redisUrl: string) => createClient({
  url: redisUrl,
  socket: {
    connectTimeout: 5_000,
    reconnectStrategy: (retries) => Math.min(100 + retries * 200, 3_000),
  },
  commandsQueueMaxLength: 1_000,
});

type NodeRedisClient = ReturnType<typeof createRedisClient>;

const normalizeMetricInteger = (value: number): number | null => {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
};

const readInfoMetric = (payload: string | null, key: string): number | null => {
  if (!payload) return null;
  const prefix = `${key}:`;
  const line = payload.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
  if (!line) return null;
  return normalizeMetricInteger(Number(line.slice(prefix.length).trim()));
};

const executeWithTimeout = <T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (callback: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    callback();
  };
  const timeout = setTimeout(
    () => finish(() => reject(new Error('REDIS_COMMAND_TIMEOUT'))),
    timeoutMs,
  );
  timeout.unref();
  void Promise.resolve()
    .then(operation)
    .then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
});

export class RedisRuntime implements RedisService {
  private client: NodeRedisClient | null = null;
  private lastError: string | null = null;
  private generationReplayStore: GenerationReplayStore | null = null;
  private roomStore: RedisRoomStore | null = null;

  constructor(
    private readonly redisUrl: string | null,
    private readonly required: boolean,
    private readonly observer: RedisRuntimeObserver = noopRedisRuntimeObserver,
    private readonly commandTimeoutMs: number = DEFAULT_REDIS_COMMAND_TIMEOUT_MS,
    private readonly keyPrefix: string = '',
  ) {
    if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs < 1) {
      throw new Error('commandTimeoutMs 必须是正有限数字');
    }
    if (keyPrefix && !/^[a-z0-9_-]{1,32}$/u.test(keyPrefix)) {
      throw new Error('keyPrefix 必须是安全的环境标识');
    }
  }

  private observeOperation(observation: RedisRuntimeOperationObservation): void {
    try {
      this.observer.observeRedisOperation(observation);
    } catch {
      // Telemetry observer 失败不得改变 Redis 行为。
    }
  }

  private observeServerStats(observation: RedisServerStatsObservation): void {
    try {
      this.observer.observeRedisServerStats(observation);
    } catch {
      // Telemetry observer 失败不得改变 Redis 行为。
    }
  }

  private async executeGenerationCommand<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.client?.isReady) {
      this.observeOperation({ operation: 'generation', outcome: 'unavailable', durationMs: 0 });
      throw createRedisOperationError('REDIS_GENERATION_REPLAY_UNAVAILABLE');
    }
    const startedAt = performance.now();
    try {
      const result = await executeWithTimeout(operation, this.commandTimeoutMs);
      this.observeOperation({
        operation: 'generation',
        outcome: 'ok',
        durationMs: Math.max(0, performance.now() - startedAt),
      });
      return result;
    } catch (error) {
      this.lastError = error instanceof Error && error.message === 'REDIS_COMMAND_TIMEOUT'
        ? 'REDIS_GENERATION_COMMAND_TIMEOUT'
        : 'REDIS_GENERATION_COMMAND_FAILED';
      this.observeOperation({
        operation: 'generation',
        outcome: 'error',
        durationMs: Math.max(0, performance.now() - startedAt),
      });
      throw createRedisOperationError(this.lastError);
    }
  }

  private async executeRoomCommand<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.client?.isReady) {
      throw createRedisOperationError('REDIS_ROOM_CHECKPOINT_UNAVAILABLE');
    }
    try {
      return await executeWithTimeout(operation, this.commandTimeoutMs);
    } catch (error) {
      this.lastError = error instanceof Error && error.message === 'REDIS_COMMAND_TIMEOUT'
        ? 'REDIS_ROOM_COMMAND_TIMEOUT'
        : 'REDIS_ROOM_COMMAND_FAILED';
      throw createRedisOperationError(this.lastError);
    }
  }

  async connect(): Promise<void> {
    if (!this.redisUrl || this.client) return;

    const client = createRedisClient(this.redisUrl);

    client.on('error', (_error: unknown) => {
      this.lastError = 'REDIS_CONNECTION_ERROR';
      console.error('[hono][redis] 连接异常', {
        errorClass: 'connection_error',
      });
    });
    client.on('ready', () => {
      this.lastError = null;
      console.info('[hono][redis] 已连接');
    });

    this.client = client;
    const startedAt = performance.now();
    let outcome: RedisRuntimeOperationOutcome = 'ok';
    try {
      await client.connect();
    } catch {
      outcome = 'error';
      this.lastError = 'REDIS_CONNECT_FAILED';
      if (this.required) throw createRedisOperationError(this.lastError);
      console.warn('[hono][redis] Redis 非必需，服务将以降级模式启动');
    } finally {
      this.observeOperation({
        operation: 'connect',
        outcome,
        durationMs: Math.max(0, performance.now() - startedAt),
      });
    }
  }

  getStatus(): RedisRuntimeStatus {
    return {
      configured: Boolean(this.redisUrl),
      connected: Boolean(this.client?.isOpen),
      ready: Boolean(this.client?.isReady),
      lastError: this.lastError,
    };
  }

  getGenerationReplayStore(): GenerationReplayStore {
    this.generationReplayStore ??= createRedisGenerationReplayStore({
      keyPrefix: this.keyPrefix,
      getClient: () => ({
        eval: (script, options) => this.executeGenerationCommand(async () => {
          const client = this.client;
          if (!client?.isReady) throw new Error('REDIS_GENERATION_REPLAY_UNAVAILABLE');
          return client.eval(script, options);
        }),
        get: (key) => this.executeGenerationCommand(async () => {
          const client = this.client;
          if (!client?.isReady) throw new Error('REDIS_GENERATION_REPLAY_UNAVAILABLE');
          return client.get(key);
        }),
        xRead: (streams, options) => this.executeGenerationCommand(async () => {
          const client = this.client;
          if (!client?.isReady) throw new Error('REDIS_GENERATION_REPLAY_UNAVAILABLE');
          return client.xRead(streams, options) as unknown as ReturnType<RedisGenerationClient['xRead']>;
        }),
      }),
    });
    return this.generationReplayStore;
  }

  getRoomStore(): RedisRoomStore {
    this.roomStore ??= createRedisRoomStore({
      keyPrefix: this.keyPrefix,
      getClient: () => ({
        eval: (script, options) => this.executeRoomCommand(async () => {
          const client = this.client;
          if (!client?.isReady) throw new Error('REDIS_ROOM_CHECKPOINT_UNAVAILABLE');
          return client.eval(script, options);
        }),
        get: (key) => this.executeRoomCommand(async () => {
          const client = this.client;
          if (!client?.isReady) throw new Error('REDIS_ROOM_CHECKPOINT_UNAVAILABLE');
          return client.get(key);
        }),
      } satisfies RedisRoomClient),
    });
    return this.roomStore;
  }

  async ping(): Promise<boolean> {
    if (!this.client?.isReady) {
      this.observeOperation({ operation: 'ping', outcome: 'unavailable', durationMs: 0 });
      return false;
    }
    const startedAt = performance.now();
    try {
      const ready = await this.client.ping() === 'PONG';
      this.observeOperation({
        operation: 'ping',
        outcome: ready ? 'ok' : 'error',
        durationMs: Math.max(0, performance.now() - startedAt),
      });
      return ready;
    } catch {
      this.lastError = 'REDIS_PING_FAILED';
      this.observeOperation({
        operation: 'ping',
        outcome: 'error',
        durationMs: Math.max(0, performance.now() - startedAt),
      });
      return false;
    }
  }

  async consumeFixedWindow(input: {
    namespace: string;
    identity: string;
    limit: number;
    windowSeconds: number;
  }): Promise<FixedWindowRateLimitResult | null> {
    if (!this.client?.isReady) {
      this.observeOperation({
        operation: 'rate-limit',
        outcome: 'unavailable',
        durationMs: 0,
      });
      return null;
    }

    const limit = Math.max(1, Math.floor(input.limit));
    const windowMs = Math.max(1_000, Math.floor(input.windowSeconds * 1_000));
    const namespacedNamespace = this.keyPrefix
      ? `${this.keyPrefix}:${input.namespace}`
      : input.namespace;
    const key = `mahoshojo:rate-limit:${namespacedNamespace}:${hashKeyPart(input.identity)}`;
    const startedAt = performance.now();
    try {
      const rawResult = await this.client.eval(FIXED_WINDOW_SCRIPT, {
        keys: [key],
        arguments: [String(windowMs)],
      });
      if (!Array.isArray(rawResult) || rawResult.length !== 2) {
        throw new Error('REDIS_RATE_LIMIT_RESPONSE_INVALID');
      }
      const [current, ttlMs] = rawResult;
      if (
        typeof current !== 'number'
        || !Number.isSafeInteger(current)
        || current < 1
        || typeof ttlMs !== 'number'
        || !Number.isSafeInteger(ttlMs)
        || ttlMs < 1
        || ttlMs > windowMs
      ) {
        throw new Error('REDIS_RATE_LIMIT_RESPONSE_INVALID');
      }
      this.observeOperation({
        operation: 'rate-limit',
        outcome: 'ok',
        durationMs: Math.max(0, performance.now() - startedAt),
      });
      return {
        allowed: current <= limit,
        limit,
        remaining: Math.max(0, limit - current),
        retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1_000)),
      };
    } catch (error) {
      const errorCode = error instanceof Error
        && error.message === 'REDIS_RATE_LIMIT_RESPONSE_INVALID'
        ? 'REDIS_RATE_LIMIT_RESPONSE_INVALID'
        : 'REDIS_RATE_LIMIT_COMMAND_FAILED';
      this.lastError = errorCode;
      this.observeOperation({
        operation: 'rate-limit',
        outcome: 'error',
        durationMs: Math.max(0, performance.now() - startedAt),
      });
      throw createRedisOperationError(errorCode);
    }
  }

  async sampleServerStats(): Promise<RedisServerStatsObservation | null> {
    const client = this.client;
    if (!client?.isReady) {
      this.observeOperation({ operation: 'info', outcome: 'unavailable', durationMs: 0 });
      return null;
    }

    const readInfo = async (section: 'memory' | 'stats'): Promise<string | null> => {
      const startedAt = performance.now();
      try {
        const payload = await executeWithTimeout(
          () => client.info(section),
          this.commandTimeoutMs,
        );
        this.observeOperation({
          operation: 'info',
          outcome: 'ok',
          durationMs: Math.max(0, performance.now() - startedAt),
        });
        return payload;
      } catch {
        this.lastError = 'REDIS_INFO_FAILED';
        this.observeOperation({
          operation: 'info',
          outcome: 'error',
          durationMs: Math.max(0, performance.now() - startedAt),
        });
        return null;
      }
    };

    const [memoryInfo, statsInfo] = await Promise.all([
      readInfo('memory'),
      readInfo('stats'),
    ]);
    if (memoryInfo === null && statsInfo === null) return null;

    return {
      usedMemoryBytes: readInfoMetric(memoryInfo, 'used_memory'),
      evictedKeys: readInfoMetric(statsInfo, 'evicted_keys'),
      keyspaceHits: readInfoMetric(statsInfo, 'keyspace_hits'),
      keyspaceMisses: readInfoMetric(statsInfo, 'keyspace_misses'),
    };
  }

  async close(): Promise<void> {
    this.forceClose();
  }

  forceClose(): void {
    const client = this.client;
    this.client = null;
    if (client?.isOpen) client.destroy();
  }
}
