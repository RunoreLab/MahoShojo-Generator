import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

import {
  getDesktopConfigStore,
  type DesktopConfigStore,
} from '../config/use-desktop-config';

import { createPublicCachePolicySync } from './public-cache-policy';

/**
 * 把 `publicLibraryCache.*` 的生效策略持续推到 native（D5.1-K1）。
 *
 * 挂在 Desktop 壳上而不是设置页：公开库读取发生在浏览路径上，策略不能等
 * 用户打开设置才生效。config 首读也由这里兜底触发——`useDesktopConfig`
 * 的其它消费者（外链确认、公告策略）同样挂在壳上，两者共用同一份 store。
 *
 * StrictMode 双挂载产生两份同步器：去重与串行在各自实例内部成立，重复
 * 推送同一策略对 native 是幂等操作——不需要进程级单例去防御。
 */
export const usePublicCachePolicySync = (
  store: DesktopConfigStore = getDesktopConfigStore(),
): void => {
  useEffect(() => {
    void store.ready();
    return createPublicCachePolicySync(store, { invoke });
  }, [store]);
};
