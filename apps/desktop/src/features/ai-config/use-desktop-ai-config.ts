// `DesktopAiConfigStore` 的 React 入口与进程级单例。
//
// 单例是必须的：设置页与问卷生成入口必须消费**同一份**连接/执行位置状态；
// 如果各自 new 一个 store，两边就会持有两份 overlay 与两份 profile 缓存，
// 「设置里选了连接、详情页没变」这类分叉就是这么来的。

import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';

import {
  DesktopAiConfigStore,
  type DesktopAiConfigState,
} from './desktop-ai-config-store';

let sharedStore: DesktopAiConfigStore | null = null;

const defaultStorage = {
  getItem: (key: string) =>
    typeof window === 'undefined' ? null : window.localStorage.getItem(key),
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  },
};

/** 返回共享 store（测试可注入替代实例后重置此单例）。 */
export const getDesktopAiConfigStore = (): DesktopAiConfigStore => {
  sharedStore ??= new DesktopAiConfigStore({ storage: defaultStorage, invoke });
  return sharedStore;
};

/** 仅供测试：重置共享 store，下一次访问重新构造。 */
export const resetDesktopAiConfigStoreForTests = (): void => {
  sharedStore = null;
};

export interface UseDesktopAiConfigResult {
  state: DesktopAiConfigState;
  store: DesktopAiConfigStore;
}

export const useDesktopAiConfig = (
  store: DesktopAiConfigStore = getDesktopAiConfigStore(),
): UseDesktopAiConfigResult => {
  useEffect(() => {
    store.init();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { state, store };
};
