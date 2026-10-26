/**
 * Web 桌面版下载入口的发布真值。此文件只描述已公开发布的产物；
 * RC/内部构建和开发包不得提前作为正式版下载提供给普通用户。
 *
 * 正式 GitHub Release 及 SHA256 清单均可公开访问、安装包经过验收之后，
 * 在同一变更中改为 published 并填入两个真实 URL。
 */
export type DesktopRelease =
  | { readonly status: 'preparing'; readonly version: string }
  | {
      readonly status: 'published';
      readonly version: string;
      readonly installerUrl: string;
      readonly sha256Url: string;
    };

export const DESKTOP_RELEASE: DesktopRelease = {
  status: 'preparing',
  version: '0.1.0',
};

export function getPublishedDesktopRelease(
  release: DesktopRelease,
): Extract<DesktopRelease, { status: 'published' }> | null {
  return release.status === 'published' ? release : null;
}
