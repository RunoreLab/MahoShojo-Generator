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
  /** 显式恢复默认并写盘（原文件由 native .bak/.invalid 保留）。 */
  readonly resetToDefaults: () => void;
  /** 文件缺失时的显式恢复：创建一份默认 config.json（不触碰 `.invalid` 隔离残留）。 */
  readonly createDefaultConfig: () => void;
  /** 冲突草稿：基于最新磁盘内容重新应用刚才的修改。 */
  readonly reapplyConflictedDraft: () => void;
  /** 冲突草稿：放弃刚才未落盘的修改。 */
  readonly discardConflictedDraft: () => void;
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
    createDefaultConfig: () => store.createDefaultConfig(),
    reapplyConflictedDraft: () => store.reapplyConflictedDraft(),
    discardConflictedDraft: () => store.discardConflictedDraft(),
    openDirectory: () => void store.openDirectory(),
  };
};
