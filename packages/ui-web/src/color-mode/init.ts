/**
 * 共源亮暗偏好：存储键与首屏前初始化脚本。
 *
 * ## 为什么它是独立 entrypoint
 *
 * `apps/web/app/layout.tsx` 是 Server Component，它在首屏前注入这段脚本以避免主题闪烁；
 * Desktop 的 `index.html` 以同样形状内联同一段脚本。两者消费的都只能是**无 React hook 的
 * 纯数据模块**——preference hook 住在同目录的 `index.ts`，经 `./color-mode` 暴露给客户端。
 *
 * 存储键是产品级契约：同一产品在两个宿主间共享同一偏好语义，改键必须两端同步迁移，
 * 由本文件作为唯一来源防止漂移。
 */

export const COLOR_MODE_STORAGE_KEY = 'mahoshojo.color-mode';

export const getColorModeInitScript = (): string => `(() => {
  try {
    var stored = window.localStorage.getItem(${JSON.stringify(COLOR_MODE_STORAGE_KEY)});
    var preference = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
    document.documentElement.dataset.colorMode = resolved;
  } catch (e) {}
})();`;
