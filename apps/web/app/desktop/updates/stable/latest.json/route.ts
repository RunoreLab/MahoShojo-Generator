import { getDesktopRelease } from '@/lib/desktop-release-server';

// 204 无响应体，不能交给 Next 的 ISR 响应重建（空字符串 body + 204 会抛错）。
// 仅动态生成这层响应；getDesktopRelease 中显式设置的 fetch 缓存仍为五分钟。
export const revalidate = 0;

/** 固定官网入口，清单和安装包仍由同一个手动发布的 GitHub Release 提供。 */
export async function GET() {
  const release = await getDesktopRelease();
  if (release.status === 'published') {
    return new Response(null, { status: 307, headers: { Location: release.manifestUrl, 'Cache-Control': 'public, max-age=300' } });
  }
  // Tauri 将 204 解释为没有新版本；网络故障保留为可重试失败。
  return new Response(null, {
    status: release.status === 'preparing' ? 204 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
