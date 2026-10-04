import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { createLocalCardsController, type LocalCardsController, type LocalCardsHost, type LocalCardsModel } from './controller';

/**
 * 把本地数据卡控制器接进 React，并在挂载时读取一次活动列表。
 *
 * `host` 必须由宿主保持稳定：控制器随它重建，重建会丢掉当前视图与在途写操作的单飞状态。
 */
export const useLocalCardsController = (host: LocalCardsHost): { controller: LocalCardsController; model: LocalCardsModel } => {
  const controller = useMemo(() => createLocalCardsController(host), [host]);
  const model = useSyncExternalStore(controller.subscribe, () => controller.model, () => controller.model);
  useEffect(() => {
    controller.actions.reload();
  }, [controller]);
  return { controller, model };
};
