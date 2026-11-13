import {
  DesktopMainWindowZoomRequestSchema,
  DesktopMainWindowZoomResponseSchema,
} from '@mahoshojo/contracts/desktop-ipc';
import type { DesktopZoomPercent } from '@mahoshojo/contracts/desktop-config';
import type { InvokeFn } from './config-bridge';

export const SET_MAIN_WINDOW_ZOOM_COMMAND = 'set_main_window_zoom' as const;

/** 固定主窗口的窄桥；请求和回执都经共同契约校验。 */
export async function setMainWindowZoom(invoke: InvokeFn, zoomPercent: DesktopZoomPercent): Promise<DesktopZoomPercent> {
  const request = DesktopMainWindowZoomRequestSchema.parse({ zoomPercent });
  let raw: unknown;
  try {
    raw = await invoke(SET_MAIN_WINDOW_ZOOM_COMMAND, request);
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error(typeof cause === 'string' ? cause : '无法应用主窗口页面缩放');
  }
  const response = DesktopMainWindowZoomResponseSchema.parse(raw);
  if (response.zoomPercent !== zoomPercent) throw new Error('主窗口返回了不同的缩放倍率');
  return zoomPercent;
}
