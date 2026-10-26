/** Desktop-only additive IPC contract; URLs, signing keys and update handles stay in Native. */
export interface DesktopUpdateCheck {
  readonly currentVersion: string;
  readonly available: { readonly version: string; readonly notes: string | null } | null;
}

export interface DesktopUpdateProgress {
  readonly phase: 'downloading' | 'installing';
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
}

export type DesktopUpdateErrorCode = 'busy' | 'cancelled' | 'not-checked' | 'check-failed'
  | 'download-failed' | 'install-failed' | 'unsupported';

export class DesktopUpdateError extends Error {
  constructor(readonly code: DesktopUpdateErrorCode, message: string) {
    super(message);
    this.name = 'DesktopUpdateError';
  }
}

const object = (raw: unknown): Record<string, unknown> | null =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
const nonBlank = (raw: unknown): raw is string => typeof raw === 'string' && raw.trim().length > 0;
const byteCount = (raw: unknown): raw is number => typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0;

export function normalizeDesktopUpdateCheck(raw: unknown): DesktopUpdateCheck {
  const data = object(raw);
  const available = object(data?.available);
  if (!data || !nonBlank(data.currentVersion)
    || (data.available !== null && (!available || !nonBlank(available.version)
      || !(available.notes === null || typeof available.notes === 'string')))) {
    throw new DesktopUpdateError('check-failed', '更新信息格式不正确，请稍后重新检查。');
  }
  return {
    currentVersion: data.currentVersion,
    available: available ? { version: available.version as string, notes: available.notes as string | null } : null,
  };
}

export function normalizeDesktopUpdateProgress(raw: unknown): DesktopUpdateProgress {
  const data = object(raw);
  if (!data || (data.phase !== 'downloading' && data.phase !== 'installing')
    || !byteCount(data.downloadedBytes) || !(data.totalBytes === null || byteCount(data.totalBytes))) {
    throw new DesktopUpdateError('download-failed', '更新进度格式不正确。');
  }
  return { phase: data.phase, downloadedBytes: data.downloadedBytes, totalBytes: data.totalBytes };
}

export function normalizeDesktopUpdateError(raw: unknown, fallback: DesktopUpdateErrorCode): DesktopUpdateError {
  if (raw instanceof DesktopUpdateError) return raw;
  const data = object(raw);
  const codes: readonly string[] = ['busy', 'cancelled', 'not-checked', 'check-failed', 'download-failed', 'install-failed', 'unsupported'];
  const code = typeof data?.code === 'string' && codes.includes(data.code) ? data.code as DesktopUpdateErrorCode : fallback;
  const message = nonBlank(data?.message) ? data.message : raw instanceof Error ? raw.message : '更新操作未完成，请稍后重试。';
  return new DesktopUpdateError(code, message);
}

export interface DesktopUpdaterClient {
  check(): Promise<DesktopUpdateCheck>;
  install(version: string, onProgress: (progress: DesktopUpdateProgress) => void): Promise<void>;
  cancel(): Promise<boolean>;
}

export const desktopUpdater: DesktopUpdaterClient = {
  async check() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return normalizeDesktopUpdateCheck(await invoke('check_desktop_update'));
    } catch (error) { throw normalizeDesktopUpdateError(error, 'check-failed'); }
  },
  async install(version, onProgress) {
    try {
      const { Channel, invoke } = await import('@tauri-apps/api/core');
      const onEvent = new Channel<unknown>();
      onEvent.onmessage = (raw) => {
        let event: DesktopUpdateProgress;
        try { event = normalizeDesktopUpdateProgress(raw); }
        // Invalid progress must not become a success state; the command still determines completion.
        catch { return; }
        onProgress(event);
      };
      await invoke('install_desktop_update', { version, onEvent });
    } catch (error) { throw normalizeDesktopUpdateError(error, 'install-failed'); }
  },
  async cancel() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const cancelled = await invoke('cancel_desktop_update');
      if (typeof cancelled !== 'boolean') throw new Error('无法确认下载取消状态。');
      return cancelled;
    } catch (error) { throw normalizeDesktopUpdateError(error, 'download-failed'); }
  },
};
