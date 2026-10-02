import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { LocalArchivePanel } from './LocalArchivePanel';
import { createLocalArchiveController, type LocalArchiveHost } from './controller';
import type { LocalArchiveView } from './contract';

/**
 * 把归档控制器接进 React。
 *
 * ## 为什么用 `useSyncExternalStore` 而不是 `useState` + 手写订阅
 *
 * 控制器是外部可变状态源（两端各自持有一份，跨组件共享），`useSyncExternalStore` 正是为这种形状
 * 存在的。用 `useState` 配一个手写 `setState` 订阅会在并发渲染与 StrictMode 下丢更新，症状是
 * 「点了确认按钮界面没反应」这类极难定位的问题。
 *
 * ## 为什么控制器用 `useMemo` 而不是 `useRef`
 *
 * `host` 由宿主在组件外构造并保持稳定，因此 `useMemo([host, maxArchiveBytes])` 不会在每次渲染时
 * 重建控制器。若重建，用户已预检的字节与 plan 会丢失，症状是「刚选好的文件又变回未选择」。
 */
export const useLocalArchiveView = (
  host: LocalArchiveHost,
  limits: LocalArchiveView['limits'],
): LocalArchiveView => {
  const controller = useMemo(() => createLocalArchiveController(host), [host]);

  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const getSnapshot = useCallback(() => controller.model, [controller]);
  const model = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // 存储可用性只需探测一次。它是页面挂载时的前置条件而不是轮询项：Storage API 的可用性在一次会话
  // 内不会因为用户操作而改变，反复探测只会带来无谓的 IO 与界面抖动。
  useEffect(() => {
    controller.actions.probeStorage();
  }, [controller]);

  return { model, actions: controller.actions, limits };
};

export interface LocalArchiveSectionProps {
  readonly host: LocalArchiveHost;
  readonly maxArchiveBytes: number;
}

/**
 * 共源归档区块。
 *
 * 宿主只需要提供 `host` 与长度上限，其余全部共用：状态机、预检门槛、进度语义、错误通道分离，
 * 以及「先展示摘要再让用户决定」这条 `DESK-052` 的要求。
 */
export const LocalArchiveSection = ({ host, maxArchiveBytes }: LocalArchiveSectionProps) => {
  const view = useLocalArchiveView(host, { maxArchiveBytes });
  return <LocalArchivePanel {...view} />;
};