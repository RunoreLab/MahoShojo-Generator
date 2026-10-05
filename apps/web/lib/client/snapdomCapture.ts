// 结果卡截图已上移至 @mahoshojo/ui-web/client（canonical 实现）。
// Web 侧注入 WEB_SNAPDOM_MEDIA（/api/media-proxy + 站外媒体白名单），
// 保持与原实现完全一致的行为。

import {
  capturePngBlob as capturePngBlobShared,
  getSafeDpr,
  getSnapdomProxyUrl,
  WEB_SNAPDOM_MEDIA,
} from '@mahoshojo/ui-web/client';

export { getSafeDpr, getSnapdomProxyUrl };

export function capturePngBlob(
  element: HTMLElement,
  options?: Parameters<typeof capturePngBlobShared>[1]
): Promise<Blob> {
  return capturePngBlobShared(element, { ...options, mediaAdapter: WEB_SNAPDOM_MEDIA });
}
