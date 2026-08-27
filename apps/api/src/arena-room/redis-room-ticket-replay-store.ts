import { createHash } from 'node:crypto';

const DEFAULT_MAX_TICKET_TTL_MS = 60_000;
const KEY_PREFIX = 'mahoshojo:room-ticket:v1';

const CONSUME_SCRIPT = `
-- ROOM_TICKET_REPLAY_CONSUME_V1
local consumed = redis.call('SET', KEYS[1], '1', 'PX', ARGV[1], 'NX')
if consumed then return 'consumed' end
return 'replayed'
`;

export interface RedisRoomTicketReplayClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

export type RedisRoomTicketReplayStore = {
  consume(input: {
    readonly jti: string;
    readonly nowMs: number;
    readonly expiresAtMs: number;
  }): Promise<{ readonly kind: 'consumed' | 'replayed' }>;
};

export type RedisRoomTicketReplayStoreOptions = {
  readonly getClient: () => RedisRoomTicketReplayClient;
  readonly keyPrefix?: string;
  readonly maxTicketTtlMs?: number;
};

const safePositiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} 必须是正安全整数`);
  }
  return value;
};

export const createRedisRoomTicketReplayStore = (
  options: RedisRoomTicketReplayStoreOptions,
): RedisRoomTicketReplayStore => {
  const environmentPrefix = options.keyPrefix?.trim();
  if (environmentPrefix && !/^[a-z0-9_-]{1,32}$/u.test(environmentPrefix)) {
    throw new Error('keyPrefix 必须是安全的环境标识');
  }
  const keyPrefix = environmentPrefix ? `${KEY_PREFIX}:${environmentPrefix}` : KEY_PREFIX;
  const maxTicketTtlMs = safePositiveInteger(
    options.maxTicketTtlMs ?? DEFAULT_MAX_TICKET_TTL_MS,
    'maxTicketTtlMs',
  );

  return Object.freeze({
    async consume(input) {
      if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(input.jti)) {
        throw new Error('REDIS_ROOM_TICKET_INPUT_INVALID');
      }
      if (
        !Number.isSafeInteger(input.nowMs)
        || input.nowMs < 0
        || !Number.isSafeInteger(input.expiresAtMs)
        || input.expiresAtMs < 0
      ) {
        throw new Error('REDIS_ROOM_TICKET_INPUT_INVALID');
      }
      const ttlMs = input.expiresAtMs - input.nowMs;
      if (ttlMs <= 0) throw new Error('REDIS_ROOM_TICKET_EXPIRED');
      if (ttlMs > maxTicketTtlMs) throw new Error('REDIS_ROOM_TICKET_TTL_INVALID');
      const jtiHash = createHash('sha256').update(input.jti).digest('hex');
      const raw = await options.getClient().eval(CONSUME_SCRIPT, {
        keys: [`${keyPrefix}:${jtiHash}`],
        arguments: [String(ttlMs)],
      });
      if (raw !== 'consumed' && raw !== 'replayed') {
        throw new Error('REDIS_ROOM_TICKET_RESPONSE_INVALID');
      }
      return { kind: raw };
    },
  });
};
