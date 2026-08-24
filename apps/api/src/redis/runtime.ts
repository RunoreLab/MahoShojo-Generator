import { createHash } from 'node:crypto';
import { createClient } from 'redis';

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

export class RedisRuntime implements RedisService {
  private client: NodeRedisClient | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly redisUrl: string | null,
    private readonly required: boolean,
  ) {}

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
    try {
      await client.connect();
    } catch (error) {
      this.lastError = toErrorMessage(error);
      if (this.required) throw error;
      console.warn('[hono][redis] Redis 非必需，服务将以降级模式启动');
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
    if (!this.client?.isReady) return false;
    try {
      return await this.client.ping() === 'PONG';
    } catch (error) {
      this.lastError = toErrorMessage(error);
      return false;
    }
  }

  async consumeFixedWindow(input: {
    namespace: string;
    identity: string;
    limit: number;
    windowSeconds: number;
  }): Promise<FixedWindowRateLimitResult | null> {
    if (!this.client?.isReady) return null;

    const limit = Math.max(1, Math.floor(input.limit));
    const windowMs = Math.max(1_000, Math.floor(input.windowSeconds * 1_000));
    const key = `mahoshojo:rate-limit:${input.namespace}:${hashKeyPart(input.identity)}`;
    let rawResult: unknown;
    try {
      rawResult = await this.client.eval(FIXED_WINDOW_SCRIPT, {
        keys: [key],
        arguments: [String(windowMs)],
      });
    } catch (error) {
      this.lastError = toErrorMessage(error);
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

  async close(): Promise<void> {
    this.forceClose();
  }

  forceClose(): void {
    const client = this.client;
    this.client = null;
    if (client?.isOpen) client.destroy();
  }
}
