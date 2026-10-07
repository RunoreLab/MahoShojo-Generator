import {
  DesktopPublicCacheClearResultSchema,
  DesktopPublicCacheErrorCodeSchema,
  DesktopPublicCachePolicySchema,
  DesktopPublicCacheStatsSchema,
} from '@mahoshojo/contracts/desktop-ipc';
import type {
  DesktopPublicCacheClearResult,
  DesktopPublicCacheErrorCode,
  DesktopPublicCachePolicy,
  DesktopPublicCacheStats,
} from '@mahoshojo/contracts/desktop-ipc';

/**
 * 公开资料持久只读缓存的 renderer 薄桥（D5.1-K1，`DESK-CACHE-006`/`008`）。
 *
 * 三条窄命令：策略推送、统计、清空。缓存记录本身**没有** renderer 可见的
 * 读取通道——它是 native 拥有的派生存储，K2 离线降级才开放读取通路。
 * 返回值一律过 `desktop-ipc` 契约 schema；非法载荷投影为
 * `bridge-invalid`，不把脏响应喂给设置页。
 */

export const PUBLIC_READ_CACHE_APPLY_POLICY_COMMAND = 'public_read_cache_apply_policy' as const;
export const PUBLIC_READ_CACHE_STATS_COMMAND = 'public_read_cache_stats' as const;
export const PUBLIC_READ_CACHE_CLEAR_COMMAND = 'public_read_cache_clear' as const;

export interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export class DesktopPublicCacheError extends Error {
  readonly command: string;
  readonly code: DesktopPublicCacheErrorCode | 'bridge-invalid';

  constructor(
    command: string,
    code: DesktopPublicCacheErrorCode | 'bridge-invalid',
    message: string,
  ) {
    super(message);
    this.name = 'DesktopPublicCacheError';
    this.command = command;
    this.code = code;
  }
}

const toPublicCacheError = (command: string, cause: unknown): DesktopPublicCacheError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    const parsedCode = DesktopPublicCacheErrorCodeSchema.safeParse(code);
    return new DesktopPublicCacheError(
      command,
      parsedCode.success ? parsedCode.data : 'internal-error',
      message,
    );
  }
  if (cause instanceof Error) {
    return new DesktopPublicCacheError(command, 'internal-error', cause.message);
  }
  return new DesktopPublicCacheError(command, 'internal-error', 'public cache command failed');
};

const parseResult = <T>(
  command: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  raw: unknown,
): T => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    throw new DesktopPublicCacheError(
      command,
      'bridge-invalid',
      `native 返回不符合 desktop-ipc 契约的载荷（${command}）`,
    );
  }
  return parsed.data;
};

/**
 * 把归一后的生效策略推给 native。推送前过 `DesktopPublicCachePolicySchema`——
 * `maxBytes` 的非法域（`0`、负数、未知字符串）在 IPC 发出前就被拦下。
 */
export const applyPublicCachePolicy = async (
  invoke: InvokeFn,
  policy: DesktopPublicCachePolicy,
): Promise<void> => {
  const parsed = DesktopPublicCachePolicySchema.safeParse(policy);
  if (!parsed.success) {
    throw new DesktopPublicCacheError(
      PUBLIC_READ_CACHE_APPLY_POLICY_COMMAND,
      'invalid-request',
      '公开缓存策略不符合 desktop-ipc 契约',
    );
  }
  try {
    await invoke(PUBLIC_READ_CACHE_APPLY_POLICY_COMMAND, { policy: parsed.data });
  } catch (cause) {
    throw toPublicCacheError(PUBLIC_READ_CACHE_APPLY_POLICY_COMMAND, cause);
  }
};

/** 读取缓存统计与真实状态；`status` 如实报告 `empty/unavailable/unsupported-schema`。 */
export const readPublicCacheStats = async (
  invoke: InvokeFn,
): Promise<DesktopPublicCacheStats> => {
  let raw: unknown;
  try {
    raw = await invoke(PUBLIC_READ_CACHE_STATS_COMMAND);
  } catch (cause) {
    throw toPublicCacheError(PUBLIC_READ_CACHE_STATS_COMMAND, cause);
  }
  return parseResult(PUBLIC_READ_CACHE_STATS_COMMAND, DesktopPublicCacheStatsSchema, raw);
};

/** 清空公开缓存：在途响应随后按 stale 丢弃，不会回填。幂等。 */
export const clearPublicCache = async (
  invoke: InvokeFn,
): Promise<DesktopPublicCacheClearResult> => {
  let raw: unknown;
  try {
    raw = await invoke(PUBLIC_READ_CACHE_CLEAR_COMMAND);
  } catch (cause) {
    throw toPublicCacheError(PUBLIC_READ_CACHE_CLEAR_COMMAND, cause);
  }
  return parseResult(
    PUBLIC_READ_CACHE_CLEAR_COMMAND,
    DesktopPublicCacheClearResultSchema,
    raw,
  );
};
