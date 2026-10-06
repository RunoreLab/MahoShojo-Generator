import {
  DesktopAnnouncementsErrorCodeSchema,
  DesktopAnnouncementsRefreshResultSchema,
  DesktopAnnouncementsSnapshotSchema,
} from '@mahoshojo/contracts/desktop-ipc';
import type {
  DesktopAnnouncementsErrorCode,
  DesktopAnnouncementsRefreshResult,
  DesktopAnnouncementsSnapshot,
} from '@mahoshojo/contracts/desktop-ipc';

/**
 * 公告 native 快照的 renderer 侧薄桥（D5.1-P1，`DESK-PARITY-003`）。
 *
 * 只暴露两条窄命令：读上次成功刷新的落盘快照、发起一次条件刷新。
 * 公告内容本身的 schema 在 `contracts/announcements`——这里只校验快照信封；
 * 快照信封合法但公告内容非法的情况由内容 schema 在上游拦截，两个边界各管一段。
 */

export const ANNOUNCEMENTS_GET_CACHED_COMMAND = 'announcements_get_cached' as const;
export const ANNOUNCEMENTS_REFRESH_COMMAND = 'announcements_refresh' as const;

export interface InvokeFn {
  (command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export class DesktopAnnouncementsError extends Error {
  readonly command: string;
  readonly code: DesktopAnnouncementsErrorCode | 'bridge-invalid';

  constructor(command: string, code: DesktopAnnouncementsErrorCode | 'bridge-invalid', message: string) {
    super(message);
    this.name = 'DesktopAnnouncementsError';
    this.command = command;
    this.code = code;
  }
}

const toAnnouncementsError = (command: string, cause: unknown): DesktopAnnouncementsError => {
  if (
    cause !== null
    && typeof cause === 'object'
    && typeof (cause as { code?: unknown }).code === 'string'
    && typeof (cause as { message?: unknown }).message === 'string'
  ) {
    const { code, message } = cause as { code: string; message: string };
    const parsedCode = DesktopAnnouncementsErrorCodeSchema.safeParse(code);
    return new DesktopAnnouncementsError(
      command,
      parsedCode.success ? parsedCode.data : 'internal-error',
      message,
    );
  }
  if (cause instanceof Error) {
    return new DesktopAnnouncementsError(command, 'internal-error', cause.message);
  }
  return new DesktopAnnouncementsError(command, 'internal-error', 'announcements command failed');
};

const parseResult = <T>(
  command: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  raw: unknown,
): T => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    throw new DesktopAnnouncementsError(
      command,
      'bridge-invalid',
      `native 返回不符合 desktop-ipc 契约的载荷（${command}）`,
    );
  }
  return parsed.data;
};

/** 上次成功刷新的公告快照；没有或已损坏返回 `null`（回退内置快照的判定由调用方做）。 */
export const readCachedAnnouncements = async (
  invoke: InvokeFn,
): Promise<DesktopAnnouncementsSnapshot | null> => {
  let raw: unknown;
  try {
    raw = await invoke(ANNOUNCEMENTS_GET_CACHED_COMMAND);
  } catch (cause) {
    throw toAnnouncementsError(ANNOUNCEMENTS_GET_CACHED_COMMAND, cause);
  }
  if (raw === null || raw === undefined) return null;
  return parseResult(ANNOUNCEMENTS_GET_CACHED_COMMAND, DesktopAnnouncementsSnapshotSchema, raw);
};

/**
 * 发起一次条件刷新。成功返回新快照或既有快照（304）；任何失败都抛
 * `DesktopAnnouncementsError`——调用方据此保留旧快照并标注，不重试、不覆盖。
 */
export const refreshAnnouncements = async (
  invoke: InvokeFn,
): Promise<DesktopAnnouncementsRefreshResult> => {
  let raw: unknown;
  try {
    raw = await invoke(ANNOUNCEMENTS_REFRESH_COMMAND);
  } catch (cause) {
    throw toAnnouncementsError(ANNOUNCEMENTS_REFRESH_COMMAND, cause);
  }
  return parseResult(ANNOUNCEMENTS_REFRESH_COMMAND, DesktopAnnouncementsRefreshResultSchema, raw);
};
