import {
  DesktopPublicCacheCardRequestSchema,
  DesktopPublicCacheCardResultSchema,
  DesktopPublicCacheClearResultSchema,
  DesktopPublicCacheErrorCodeSchema,
  DesktopPublicCachePolicySchema,
  DesktopPublicCacheQueryRequestSchema,
  DesktopPublicCacheQueryResultSchema,
  DesktopPublicCacheStatsSchema,
} from '@mahoshojo/contracts/desktop-ipc';
import type {
  DesktopPublicCacheCardResult,
  DesktopPublicCacheClearResult,
  DesktopPublicCacheErrorCode,
  DesktopPublicCachePolicy,
  DesktopPublicCacheQueryRequest,
  DesktopPublicCacheQueryResult,
  DesktopPublicCacheStats,
} from '@mahoshojo/contracts/desktop-ipc';

/**
 * 公开资料持久只读缓存的 renderer 薄桥（D5.1-K1/K2，`DESK-CACHE-004`~`008`）。
 *
 * 五条窄命令：策略推送、统计、清空（K1）+ 摘要查询、单卡正文读取（K2）。
 * 全部是业务级只读/受控写面——没有泛型 SQL/文件代理。返回值一律过
 * `desktop-ipc` 契约 schema；非法载荷投影为 `bridge-invalid`，不把脏响应
 * 喂给设置页或选择弹窗。
 */

export const PUBLIC_READ_CACHE_APPLY_POLICY_COMMAND = 'public_read_cache_apply_policy' as const;
export const PUBLIC_READ_CACHE_STATS_COMMAND = 'public_read_cache_stats' as const;
export const PUBLIC_READ_CACHE_CLEAR_COMMAND = 'public_read_cache_clear' as const;
export const PUBLIC_READ_CACHE_QUERY_COMMAND = 'public_read_cache_query' as const;
export const PUBLIC_READ_CACHE_CARD_COMMAND = 'public_read_cache_card' as const;

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

/* ── K2 读取通路（DESK-CACHE-004/005）────────────────────────────────── */

/**
 * 在本机已捕获集合上做摘要搜索/筛选/排序/分页。
 *
 * `total` 是匹配缓存的行数而不是线上 total；`status` 非 `ready` 时调用方
 * 必须如实报告「缓存不可用/尚未建立」，不得说成「缓存里没有这张卡」。
 * 请求先过契约 schema——筛选字段的非法形态在 IPC 发出前即被拦下。
 */
export const queryPublicReadCache = async (
  invoke: InvokeFn,
  query: DesktopPublicCacheQueryRequest,
): Promise<DesktopPublicCacheQueryResult> => {
  const parsed = DesktopPublicCacheQueryRequestSchema.safeParse(query);
  if (!parsed.success) {
    throw new DesktopPublicCacheError(
      PUBLIC_READ_CACHE_QUERY_COMMAND,
      'invalid-request',
      '公开缓存查询参数不符合 desktop-ipc 契约',
    );
  }
  let raw: unknown;
  try {
    raw = await invoke(PUBLIC_READ_CACHE_QUERY_COMMAND, { query: parsed.data });
  } catch (cause) {
    throw toPublicCacheError(PUBLIC_READ_CACHE_QUERY_COMMAND, cause);
  }
  return parseResult(PUBLIC_READ_CACHE_QUERY_COMMAND, DesktopPublicCacheQueryResultSchema, raw);
};

/**
 * 按 cardId 取单卡缓存投影。`availability` 如实区分
 * `full`（有正文快照）/`summary-only`（仅摘要）/`absent`（无记录）/
 * `withdrawn`（已确认撤回——绝不返回正文）。
 */
export const readPublicCacheCard = async (
  invoke: InvokeFn,
  cardId: string,
): Promise<DesktopPublicCacheCardResult> => {
  const parsed = DesktopPublicCacheCardRequestSchema.safeParse({ cardId });
  if (!parsed.success) {
    throw new DesktopPublicCacheError(
      PUBLIC_READ_CACHE_CARD_COMMAND,
      'invalid-request',
      '公开缓存单卡查询参数不符合 desktop-ipc 契约',
    );
  }
  let raw: unknown;
  try {
    raw = await invoke(PUBLIC_READ_CACHE_CARD_COMMAND, { cardId: parsed.data.cardId });
  } catch (cause) {
    throw toPublicCacheError(PUBLIC_READ_CACHE_CARD_COMMAND, cause);
  }
  return parseResult(PUBLIC_READ_CACHE_CARD_COMMAND, DesktopPublicCacheCardResultSchema, raw);
};
