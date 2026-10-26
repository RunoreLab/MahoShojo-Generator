import { getDesktopRelease } from '@/lib/desktop-release-server';

export const revalidate = 300;

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
