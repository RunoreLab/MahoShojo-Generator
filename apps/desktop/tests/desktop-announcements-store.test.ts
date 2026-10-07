/**
 * `DesktopAnnouncementsStore` 的合并与失败语义（D5.1-P1，DESK-PARITY-003）。
 *
 * 这组测试钉住四条产品口径：
 *
 * 1. 冷启动显示「内置或缓存里较新的那一份」——离线可用，不靠远端到场；
 * 2. 刷新成功无条件接受远端快照（native 已校验），并按远端来源标注快照时间；
 * 3. 刷新失败**保留旧公告**并把状态标成 `failed`——不伪装空公告、不自动重试；
 * 4. 启动检查默认 `on-launch` 一次且 single-flight，`manual` 策略什么都不发。
 */

import { describe, expect, it, vi } from 'vitest';

import type { Announcement } from '@mahoshojo/contracts/announcements';

import {
  DesktopAnnouncementsStore,
  type DesktopAnnouncementsState,
} from '../src/features/announcements/desktop-announcements-store';

const makeAnnouncement = (id: string, date: string, pinned = false): Announcement => ({
  id,
  title: `标题-${id}`,
  date,
  content: `正文-${id}`,
  pinned,
});

const remoteSnapshot = (announcements: Announcement[], fetchedAt = '2026-10-11T08:00:00Z') => ({
  fetchedAt,
  announcements,
});

// 返回值不注解为 InvokeFn——注解会把 vi.fn 的 Mock 类型擦成纯函数签名，
// 断言处的 .mock.calls 就不可用（dev tsconfig 对 tests 的既有报错）。
const makeInvoke = (impl: (command: string) => Promise<unknown>) =>
  vi.fn((command: string) => impl(command));

const stateOf = (store: DesktopAnnouncementsStore): DesktopAnnouncementsState =>
  store.getSnapshot();

describe('desktop announcements store', () => {
  it('shows the bundled snapshot when there is no valid cache', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'announcements_get_cached') return null;
      return undefined;
    });
    const store = new DesktopAnnouncementsStore({
      invoke,
      loadBundled: async () => [makeAnnouncement('a1', '2026-01-05')],
    });

    await store.bootstrap();

    expect(stateOf(store).source).toBe('bundled');
    expect(stateOf(store).announcements.map((a) => a.id)).toEqual(['a1']);
    expect(stateOf(store).fetchedAt).toBeNull();
  });

  it('prefers the cached remote snapshot when it is newer than the bundled one', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'announcements_get_cached') {
        return remoteSnapshot([makeAnnouncement('b1', '2026-09-01')], '2026-10-01T00:00:00Z');
      }
      return undefined;
    });
    const store = new DesktopAnnouncementsStore({
      invoke,
      loadBundled: async () => [makeAnnouncement('a1', '2026-01-05')],
    });

    await store.bootstrap();

    expect(stateOf(store).source).toBe('cached-remote');
    expect(stateOf(store).announcements.map((a) => a.id)).toEqual(['b1']);
    expect(stateOf(store).fetchedAt).toBe('2026-10-01T00:00:00Z');
  });

  it('keeps the bundled snapshot when the app bundle is newer than the stale cache', async () => {
    // 应用升级后内置快照反超缓存的可能真实存在——按最新公告日期合并，而不是
    // 按「远端一定更新」的来源偏见，两个方向才都对。
    const invoke = makeInvoke(async (command) => {
      if (command === 'announcements_get_cached') {
        return remoteSnapshot([makeAnnouncement('old', '2026-01-01')], '2026-02-01T00:00:00Z');
      }
      return undefined;
    });
    const store = new DesktopAnnouncementsStore({
      invoke,
      loadBundled: async () => [makeAnnouncement('new', '2026-10-05')],
    });

    await store.bootstrap();

    expect(stateOf(store).source).toBe('bundled');
    expect(stateOf(store).announcements.map((a) => a.id)).toEqual(['new']);
  });

  it('renders an honest empty state when neither bundled nor cached exists', async () => {
    const invoke = makeInvoke(async () => null);
    const store = new DesktopAnnouncementsStore({
      invoke,
      loadBundled: async () => null,
    });

    await store.bootstrap();

    expect(stateOf(store).source).toBe('none');
    expect(stateOf(store).announcements).toEqual([]);
  });

  it('adopts the remote snapshot on refresh and marks it remote', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'announcements_get_cached') return null;
      if (command === 'announcements_refresh') {
        return {
          status: 'updated',
          snapshot: remoteSnapshot([makeAnnouncement('r1', '2026-10-10')], '2026-10-11T08:00:00Z'),
        };
      }
      return undefined;
    });
    const store = new DesktopAnnouncementsStore({
      invoke,
      loadBundled: async () => [makeAnnouncement('a1', '2026-01-05')],
    });

    await store.bootstrap();
    await store.refresh();

    expect(stateOf(store).source).toBe('remote');
    expect(stateOf(store).announcements.map((a) => a.id)).toEqual(['r1']);
    expect(stateOf(store).fetchedAt).toBe('2026-10-11T08:00:00Z');
    expect(stateOf(store).refresh).toBe('idle');
  });

  it('keeps the previous announcements on refresh failure and marks refresh failed', async () => {
    const invoke = makeInvoke(async (command) => {
      if (command === 'announcements_get_cached') return null;
      if (command === 'announcements_refresh') {
        throw { code: 'network-error', message: '远端不可达' };
      }
      return undefined;
    });
    const store = new DesktopAnnouncementsStore({
      invoke,
      loadBundled: async () => [makeAnnouncement('a1', '2026-01-05')],
    });

    await store.bootstrap();
    await store.refresh();

    // 失败语义就两条：内容原样保留，状态如实标 failed——既不伪装空公告，
    // 也不把内置快照说成远端数据。
    expect(stateOf(store).announcements.map((a) => a.id)).toEqual(['a1']);
    expect(stateOf(store).source).toBe('bundled');
    expect(stateOf(store).refresh).toBe('failed');
    expect(stateOf(store).lastError).toContain('远端不可达');
  });

  it('launchCheck refreshes once under on-launch and stays quiet under manual', async () => {
    const onLaunchInvoke = makeInvoke(async (command) => {
      if (command === 'announcements_get_cached') return null;
      if (command === 'announcements_refresh') {
        return {
          status: 'not-modified',
          snapshot: remoteSnapshot([], '2026-10-11T08:00:00Z'),
        };
      }
      return undefined;
    });
    const onLaunchStore = new DesktopAnnouncementsStore({
      invoke: onLaunchInvoke,
      loadBundled: async () => [],
      checkPolicy: 'on-launch',
    });
    await onLaunchStore.bootstrap();

    onLaunchStore.launchCheck();
    onLaunchStore.launchCheck(); // 幂等：一次启动只检查一次
    await Promise.resolve();
    await Promise.resolve();

    expect(
      onLaunchInvoke.mock.calls.filter((call) => call[0] === 'announcements_refresh'),
    ).toHaveLength(1);

    const manualInvoke = makeInvoke(async () => null);
    const manualStore = new DesktopAnnouncementsStore({
      invoke: manualInvoke,
      loadBundled: async () => [],
      checkPolicy: 'manual',
    });
    await manualStore.bootstrap();
    manualStore.launchCheck();

    expect(
      manualInvoke.mock.calls.filter((call) => call[0] === 'announcements_refresh'),
    ).toHaveLength(0);
  });

  it('evaluates a checkPolicy getter at launchCheck time, not at construction', async () => {
    // S2 的形状：config.json 在 bootstrap 之后才读完；getter 形态让
    // launchCheck 判定那一刻才取策略，而不是在构造时钉死。
    let policy: 'on-launch' | 'manual' = 'manual';
    const invoke = makeInvoke(async (command) => {
      if (command === 'announcements_refresh') {
        return {
          status: 'not-modified',
          snapshot: remoteSnapshot([], '2026-10-11T08:00:00Z'),
        };
      }
      return null;
    });
    const store = new DesktopAnnouncementsStore({
      invoke,
      loadBundled: async () => [],
      checkPolicy: () => policy,
    });
    await store.bootstrap();

    // 构造时是 manual，launchCheck 前 config 读出了 on-launch → 按后者判定。
    policy = 'on-launch';
    store.launchCheck();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      invoke.mock.calls.filter((call) => call[0] === 'announcements_refresh'),
    ).toHaveLength(1);
  });
});
