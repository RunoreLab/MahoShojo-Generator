import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseAnnouncementList, type Announcement } from '@mahoshojo/contracts/announcements';

import {
  DesktopAnnouncementsStore,
  type DesktopAnnouncementsState,
} from './desktop-announcements-store';

/**
 * `DesktopAnnouncementsStore` 的 React 入口与进程级单例。
 *
 * 单例的理由与 cloud session 一致：公告 ticker 挂在壳上，手动刷新入口在弹窗里——
 * 两处消费同一份快照与同一次在途刷新，各自 new 一份会得到两个互不认识的状态。
 *
 * 生产装载走同源 `fetch('/announcements.json')`：Tauri 自定义协议伺服 `dist/`
 * 里的内置快照，是本地文件读，不是网络请求；`credentials:'omit'` 与
 * `redirect:'error'` 是问卷加载同款的硬化参数。
 */

const loadBundledAnnouncements = async (): Promise<Announcement[] | null> => {
  const response = await fetch('/announcements.json', {
    credentials: 'omit',
    redirect: 'error',
  });
  if (!response.ok) return null;
  // fail-closed：内置快照结构不合法时整体不展示，而不是截断出半截列表。
  return parseAnnouncementList(await response.json());
};

let sharedStore: DesktopAnnouncementsStore | null = null;

export const getDesktopAnnouncementsStore = (): DesktopAnnouncementsStore => {
  sharedStore ??= new DesktopAnnouncementsStore({ invoke, loadBundled: loadBundledAnnouncements });
  return sharedStore;
};

/** 仅供测试：重置共享 store。 */
export const resetDesktopAnnouncementsStoreForTests = (): void => {
  sharedStore = null;
};

export interface UseDesktopAnnouncementsResult {
  readonly state: DesktopAnnouncementsState;
  readonly store: DesktopAnnouncementsStore;
  readonly refresh: () => Promise<void>;
}

export const useDesktopAnnouncements = (
  store: DesktopAnnouncementsStore = getDesktopAnnouncementsStore(),
): UseDesktopAnnouncementsResult => {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // 挂载即装载本地快照；on-launch 策略下随后触发一次后台刷新。
  // 两者都不阻塞首屏——公告是装饰内容，不进入交互关键路径。
  useEffect(() => {
    void store.bootstrap().then(() => store.launchCheck());
  }, [store]);

  return { state, store, refresh: () => store.refresh() };
};
