import { invoke } from '@tauri-apps/api/core';

import { readDesktopRuntimeInfo, type DesktopRuntimeInfo } from './desktop-bridge';

export type { DesktopRuntimeInfo } from './desktop-bridge';
export { DesktopBridgeError } from './desktop-bridge';

export const loadDesktopRuntimeInfo = (): Promise<DesktopRuntimeInfo> =>
  readDesktopRuntimeInfo((command, args) => invoke(command, args));
