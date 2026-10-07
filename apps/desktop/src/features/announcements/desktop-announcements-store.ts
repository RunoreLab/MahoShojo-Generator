import type { Announcement } from '@mahoshojo/contracts/announcements';
import type { AnnouncementsCheckPolicy } from '@mahoshojo/contracts/desktop-config';
import { sortAnnouncements } from '@mahoshojo/ui-web/announcement';

import type { DesktopAnnouncementsRefreshResult } from '@mahoshojo/contracts/desktop-ipc';
import {
  readCachedAnnouncements,
  refreshAnnouncements,
  type InvokeFn,
} from '../../platform/announcements-bridge';

/**
 * Desktop 公告源 store（D5.1-P1，`DESK-PARITY-003`）。
 *
 * 三份候选按同一规则合并成一份展示数据：
 *
 * - `bundled`：内置快照（`dist/announcements.json`，同源本地文件）；
 * - `cached`：上次成功刷新的 native 落盘快照；
 * - `remote`：本次进程内刚刷新到的快照。
 *
 * 合并规则只看「最新公告日期谁更新」——远端快照通常更新，但应用升级后内置快照
 * 也可能反超；按日期比而不是按来源硬排，两种方向都对。同日期时偏好远端快照
 * （它的 fetchedAt 证明它曾被成功校验过）。
 *
 * 刷新失败**不改写**展示数据，只把 `refresh` 标成 `failed` 并留下诊断信息——
 * 「失败保留旧公告并在公告区标注」是这里唯一的失败语义：不重试、不降级成空、
 * 不把内置快照说成远端数据。
 */

export interface DesktopAnnouncementsState {
  readonly announcements: readonly Announcement[];
  readonly source: 'bundled' | 'cached-remote' | 'remote' | 'none';
  /** 远端快照的取回时刻（来源为远端时才有）。 */
  readonly fetchedAt: string | null;
  readonly refresh: 'idle' | 'refreshing' | 'failed';
  readonly lastError: string | null;
}

const INITIAL_STATE: DesktopAnnouncementsState = {
  announcements: [],
  source: 'none',
  fetchedAt: null,
  refresh: 'idle',
  lastError: null,
};

export type { AnnouncementsCheckPolicy };

export interface DesktopAnnouncementsDeps {
  readonly invoke: InvokeFn;
  /** 读取内置快照：生产是 `fetch('/announcements.json')`，测试注入假实现。 */
  readonly loadBundled: () => Promise<Announcement[] | null>;
  /**
   * `announcements.checkPolicy`（S2 起经 config.json）。传 getter 时
   * `launchCheck` 在调用时刻取值——启动检查要等配置读完才判定，但
   * store 本体不感知 config store 的存在。
   */
  readonly checkPolicy?: AnnouncementsCheckPolicy | (() => AnnouncementsCheckPolicy);
}

const newestDate = (list: readonly Announcement[]): string =>
  list.reduce((max, item) => (item.date > max ? item.date : max), '');

interface Candidate {
  readonly source: 'bundled' | 'cached-remote';
  readonly announcements: readonly Announcement[];
  readonly fetchedAt: string | null;
}

export class DesktopAnnouncementsStore {
  private state: DesktopAnnouncementsState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private bootstrapPromise: Promise<void> | null = null;
  private refreshPromise: Promise<void> | null = null;
  private launchCheckDone = false;
  private readonly deps: DesktopAnnouncementsDeps;

  constructor(deps: DesktopAnnouncementsDeps) {
    this.deps = deps;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): DesktopAnnouncementsState => this.state;

  private publish(next: Partial<DesktopAnnouncementsState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  /** 启动装载：内置快照与 native 缓存并行，谁更新取谁。只跑一次，失败各自落空。 */
  bootstrap(): Promise<void> {
    this.bootstrapPromise ??= this.doBootstrap();
    return this.bootstrapPromise;
  }

  private async doBootstrap(): Promise<void> {
    const [bundledResult, cachedResult] = await Promise.allSettled([
      this.deps.loadBundled(),
      readCachedAnnouncements(this.deps.invoke),
    ]);

    const candidates: Candidate[] = [];
    if (bundledResult.status === 'fulfilled' && bundledResult.value && bundledResult.value.length > 0) {
      candidates.push({
        source: 'bundled',
        announcements: bundledResult.value,
        fetchedAt: null,
      });
    }
    if (cachedResult.status === 'fulfilled' && cachedResult.value && cachedResult.value.announcements.length > 0) {
      candidates.push({
        source: 'cached-remote',
        announcements: cachedResult.value.announcements,
        fetchedAt: cachedResult.value.fetchedAt,
      });
    }

    if (candidates.length === 0) {
      this.publish({ announcements: [], source: 'none', fetchedAt: null });
      return;
    }

    const chosen = candidates.reduce((best, candidate) => {
      const candidateDate = newestDate(candidate.announcements);
      const bestDate = newestDate(best.announcements);
      if (candidateDate > bestDate) return candidate;
      // 日期并列时远端快照优先：它经过 native 校验且带快照时间。
      if (candidateDate === bestDate && candidate.source !== 'bundled') return candidate;
      return best;
    });

    this.publish({
      announcements: chosen.announcements,
      source: chosen.source,
      fetchedAt: chosen.fetchedAt,
    });
  }

  /**
   * 启动检查：`announcements.checkPolicy="on-launch"` 时每次进程启动刷新一次。
   * fire-and-forget——公告是装饰内容，结果晚到几秒无所谓，启动不在这里等它；
   * `manual` 策略下什么都不发。
   */
  launchCheck(): void {
    if (this.launchCheckDone) return;
    this.launchCheckDone = true;
    const policy =
      typeof this.deps.checkPolicy === 'function'
        ? this.deps.checkPolicy()
        : (this.deps.checkPolicy ?? 'on-launch');
    if (policy !== 'on-launch') return;
    void this.refresh();
  }

  /** 手动/启动刷新共用路径。single-flight：在途刷新未完成时重复调用复用同一个 Promise。 */
  refresh(): Promise<void> {
    this.refreshPromise ??= this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    this.publish({ refresh: 'refreshing', lastError: null });
    let result: DesktopAnnouncementsRefreshResult;
    try {
      result = await refreshAnnouncements(this.deps.invoke);
    } catch (cause) {
      this.publish({
        refresh: 'failed',
        lastError: cause instanceof Error ? cause.message : '公告刷新失败',
      });
      return;
    }

    // 远端快照被无条件接受：native 已经做过整条校验与原子写缓存。
    // `not-modified` 回显的仍是缓存快照——同样按远端来源标注快照时间。
    this.publish({
      announcements: sortAnnouncements(result.snapshot.announcements),
      source: 'remote',
      fetchedAt: result.snapshot.fetchedAt,
      refresh: 'idle',
    });
  }
}
