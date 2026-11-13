import { useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getDesktopConfigStore } from '../config/use-desktop-config';
import { setMainWindowZoom } from '../../platform/zoom-bridge';
import { DesktopZoomController, installDesktopZoomGestures } from './desktop-zoom-controller';

let shared: DesktopZoomController | null = null;
let releaseGestures: (() => void) | null = null;
export const getDesktopZoomController = (): DesktopZoomController => {
  shared ??= new DesktopZoomController(getDesktopConfigStore(), (percent) => setMainWindowZoom(invoke, percent));
  return shared;
};

/** 启动于产品挂载前；读取/应用是异步本地操作，不阻塞首页可用。 */
export const initializeDesktopZoom = (): void => {
  if (!isTauri() || releaseGestures !== null) return;
  const controller = getDesktopZoomController();
  releaseGestures = installDesktopZoomGestures(window, controller);
  void controller.start();
};

export const useDesktopZoom = () => {
  const controller = getDesktopZoomController();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { controller, state };
};
