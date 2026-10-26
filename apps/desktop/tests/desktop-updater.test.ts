import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopUpdater, normalizeDesktopUpdateCheck, normalizeDesktopUpdateProgress } from '../src/platform/desktop-updater';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: native.invoke,
  Channel: class { onmessage?: (value: unknown) => void; },
}));
beforeEach(() => { vi.clearAllMocks(); });

describe('Desktop updater IPC', () => {
  it('uses only the three narrow commands and passes the cached version, never a URL', async () => {
    native.invoke.mockResolvedValueOnce({ currentVersion: '0.1.0', available: { version: '0.1.1', notes: '更新说明' } });
    expect(await desktopUpdater.check()).toEqual({ currentVersion: '0.1.0', available: { version: '0.1.1', notes: '更新说明' } });
    expect(native.invoke).toHaveBeenCalledWith('check_desktop_update');
    const progress = vi.fn();
    native.invoke.mockImplementationOnce(async (_name, args) => {
      expect(Object.keys(args).sort()).toEqual(['onEvent', 'version']);
      expect(args.version).toBe('0.1.1');
      args.onEvent.onmessage({ phase: 'downloading', downloadedBytes: 10, totalBytes: 20 });
      args.onEvent.onmessage({ phase: 'installing', downloadedBytes: 20, totalBytes: 20 });
    });
    await desktopUpdater.install('0.1.1', progress);
    expect(native.invoke.mock.calls[1][0]).toBe('install_desktop_update');
    expect(progress).toHaveBeenLastCalledWith({ phase: 'installing', downloadedBytes: 20, totalBytes: 20 });
    native.invoke.mockResolvedValueOnce(true);
    expect(await desktopUpdater.cancel()).toBe(true);
    expect(native.invoke).toHaveBeenLastCalledWith('cancel_desktop_update');
  });

  it.each([
    null, {}, { currentVersion: '', available: null }, { currentVersion: '0.1.0' },
    { currentVersion: '0.1.0', available: { version: '0.1.1' } },
    { currentVersion: '0.1.0', available: { version: '0.1.1', notes: {} } },
  ])('rejects malformed check results without reporting up to date: %j', (value) => {
    expect(() => normalizeDesktopUpdateCheck(value)).toThrow('更新信息格式');
  });

  it('accepts explicit no-update and unknown download length', () => {
    expect(normalizeDesktopUpdateCheck({ currentVersion: '0.1.0', available: null }).available).toBeNull();
    expect(normalizeDesktopUpdateProgress({ phase: 'downloading', downloadedBytes: 1024, totalBytes: null }).totalBytes).toBeNull();
  });

  it.each([
    { phase: 'installed', downloadedBytes: 0, totalBytes: null },
    { phase: 'downloading', downloadedBytes: -1, totalBytes: null },
    { phase: 'downloading', downloadedBytes: 0, totalBytes: NaN },
  ])('rejects malformed progress %j', (value) => {
    expect(() => normalizeDesktopUpdateProgress(value)).toThrow('进度格式');
  });

  it('retains native cancellation and refuses non-boolean cancellation responses', async () => {
    native.invoke.mockRejectedValueOnce({ code: 'cancelled', message: 'cancelled' });
    await expect(desktopUpdater.install('0.1.1', () => {})).rejects.toMatchObject({ code: 'cancelled' });
    native.invoke.mockResolvedValueOnce({ cancelled: true });
    await expect(desktopUpdater.cancel()).rejects.toThrow('取消状态');
  });
});
