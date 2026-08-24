import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createClient } from 'redis';

export type RedisRuntimeOperation = 'connect' | 'ping' | 'rate-limit' | 'info';

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

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error || 'unknown redis error');
};

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

export class RedisRuntime implements RedisService {
  private client: NodeRedisClient | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly redisUrl: string | null,
    private readonly required: boolean,
    private readonly observer: RedisRuntimeObserver = noopRedisRuntimeObserver,
  ) {}

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

  async connect(): Promise<void> {
    if (!this.redisUrl || this.client) return;

    const client = createRedisClient(this.redisUrl);

    client.on('error', (error: unknown) => {
      this.lastError = toErrorMessage(error);
      console.error('[hono][redis] 连接异常：', this.lastError);
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
    } catch (error) {
      outcome = 'error';
      this.lastError = toErrorMessage(error);
      if (this.required) throw error;
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
    } catch (error) {
      this.lastError = toErrorMessage(error);
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
    const key = `mahoshojo:rate-limit:${input.namespace}:${hashKeyPart(input.identity)}`;
    let rawResult: unknown;
    const startedAt = performance.now();
    try {
      rawResult = await this.client.eval(FIXED_WINDOW_SCRIPT, {
        keys: [key],
        arguments: [String(windowMs)],
      });
      this.observeOperation({
        operation: 'rate-limit',
        outcome: 'ok',
        durationMs: Math.max(0, performance.now() - startedAt),
      });
    } catch (error) {
      this.lastError = toErrorMessage(error);
      this.observeOperation({
        operation: 'rate-limit',
        outcome: 'error',
        durationMs: Math.max(0, performance.now() - startedAt),
      });
      throw error;
    }
    const values = Array.isArray(rawResult) ? rawResult : [];
    const current = Number(values[0] ?? 0);
    const ttlMs = Math.max(1, Number(values[1] ?? windowMs));

    return {
      allowed: current <= limit,
      limit,
      remaining: Math.max(0, limit - current),
      retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1_000)),
    };
  }

  async sampleServerStats(): Promise<void> {
    const client = this.client;
    if (!client?.isReady) {
      this.observeOperation({ operation: 'info', outcome: 'unavailable', durationMs: 0 });
      return;
    }

    const readInfo = async (section: 'memory' | 'stats'): Promise<string | null> => {
      const startedAt = performance.now();
      try {
        const payload = await client.info(section);
        this.observeOperation({
          operation: 'info',
          outcome: 'ok',
          durationMs: Math.max(0, performance.now() - startedAt),
        });
        return payload;
      } catch (error) {
        this.lastError = toErrorMessage(error);
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
    if (memoryInfo === null && statsInfo === null) return;

    this.observeServerStats({
      usedMemoryBytes: readInfoMetric(memoryInfo, 'used_memory'),
      evictedKeys: readInfoMetric(statsInfo, 'evicted_keys'),
      keyspaceHits: readInfoMetric(statsInfo, 'keyspace_hits'),
      keyspaceMisses: readInfoMetric(statsInfo, 'keyspace_misses'),
    });
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
