import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';

import type { DesktopConfigValues } from '@mahoshojo/contracts/desktop-config';
import type { InvokeFn } from '../../platform/config-bridge';

import { DesktopConfigStore, type DesktopConfigState } from './desktop-config-store';

export { DesktopConfigStore } from './desktop-config-store';
export type { DesktopConfigState } from './desktop-config-store';

/**
 * Desktop 人工配置的进程内单例与 React 接线。
 *
 * `DesktopConfigStore` 被公告策略、外链确认和设置页共享——三处读的是同一份
 * snapshot（DESK-SET-005 的单一路径约束）。测试可注入独立实例。
 */

let sharedStore: DesktopConfigStore | null = null;

export const getDesktopConfigStore = (deps?: {
  readonly invoke: InvokeFn;
}): DesktopConfigStore => {
  sharedStore ??= new DesktopConfigStore(deps ?? { invoke });
  return sharedStore;
};

export const resetDesktopConfigStoreForTests = (): void => {
  sharedStore = null;
};

export interface UseDesktopConfigResult {
  readonly state: DesktopConfigState;
  /** 当前文件是否可作为编辑基底（ready 且无 fatal）。 */
  readonly editable: boolean;
  readonly setField: <K extends keyof DesktopConfigValues>(
    key: K,
    value: DesktopConfigValues[K],
  ) => void;
  /** 显式重载（手工编辑文件后）。 */
  readonly reload: () => void;
  /** 显式恢复默认并写盘（原文件由 native .bak 保留）。 */
  readonly resetToDefaults: () => void;
  readonly openDirectory: () => void;
}

export const useDesktopConfig = (
  store: DesktopConfigStore = getDesktopConfigStore(),
): UseDesktopConfigResult => {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.ready();
  }, [store]);
  return {
    state,
    editable: store.editable(),
    setField: (key, value) => store.setField(key, value),
    reload: () => void store.reload(),
    resetToDefaults: () => store.resetToDefaults(),
    openDirectory: () => void store.openDirectory(),
  };
};
