// `DesktopCloudSessionStore` 的 React 入口与进程级单例。
//
// 与 `use-desktop-ai-config` 同一个理由：顶栏账号区与设置页账号面板必须
// 消费**同一份**会话投影与同一个授权流程；各自 new 一份 store 就会得到
// 两个互不认识的 `authenticating` 状态与两份独立的 `checking` 在途查询。

import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';

import {
  DesktopCloudSessionStore,
  type DesktopCloudSessionState,
} from './cloud-session-store';

let sharedStore: DesktopCloudSessionStore | null = null;

/** 返回共享 store（测试可注入替代实例后重置此单例）。 */
export const getDesktopCloudSessionStore = (): DesktopCloudSessionStore => {
  sharedStore ??= new DesktopCloudSessionStore({ invoke });
  return sharedStore;
};

/** 仅供测试：重置共享 store，下一次访问重新构造。 */
export const resetDesktopCloudSessionStoreForTests = (): void => {
  sharedStore = null;
};

export interface UseDesktopCloudSessionResult {
  state: DesktopCloudSessionState;
  store: DesktopCloudSessionStore;
}

export const useDesktopCloudSession = (
  store: DesktopCloudSessionStore = getDesktopCloudSessionStore(),
): UseDesktopCloudSessionResult => {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // 首个挂载的消费者触发 cached-first 装载：本机凭据→立即身份投影→后台
  // cloud_auth_status 验证。重挂载只搭上同一个 bootstrapPromise，不发重复请求。
  useEffect(() => {
    void store.bootstrap();
  }, [store]);
  return { state, store };
};
