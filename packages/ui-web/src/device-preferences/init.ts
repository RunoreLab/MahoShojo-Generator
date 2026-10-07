/**
 * 共源设备偏好：存储键与首屏前初始化脚本。
 *
 * ## 为什么它是独立 entrypoint
 *
 * 与 `color-mode/init.ts` 同一理由：`apps/web/app/layout.tsx` 是 Server Component，
 * Desktop `index.html` 内联同一段脚本——两者消费的只能是**无 React hook 的纯数据
 * 模块**。偏好 hook 住在同目录的 `index.ts`，经 `./device-preferences` 暴露。
 *
 * 存储键是产品级契约：同一产品在两个宿主间共享同一偏好语义，改键必须两端同步
 * 迁移，由本文件作为唯一来源防止漂移。
 *
 * `data-motion` 是解析后的**生效状态**（`reduce` | `no-preference`），不是用户选择
 * 本身：`reduce` 偏好恒为 `reduce`；`system` 则解析 `prefers-reduced-motion`。
 * 共享 CSS 与动画 hook 只认这一个根节点标记（DESK-SET-007），不提供强于系统
 * 设置的「始终完整动效」——偏好表里因此没有 `full` 一档。
 *
 * 脚本自身订阅媒体查询变化：`system` 档用户在会话中途切换系统偏好时，标记必须
 * 跟着系统走——设置页不是常驻挂载点，不能依赖 React hook 来维持这份新鲜度。
 */
export const MOTION_PREFERENCE_STORAGE_KEY = 'mahoshojo.motion-preference';

export const getMotionPreferenceInitScript = (): string => `(() => {
  var media;
  try {
    media = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch (e) {
    media = undefined;
  }
  var apply = function () {
    try {
      var stored = window.localStorage.getItem(${JSON.stringify(MOTION_PREFERENCE_STORAGE_KEY)});
      var preference = stored === 'reduce' || stored === 'system' ? stored : 'system';
      var resolved = preference === 'reduce' || (preference === 'system' && media && media.matches) ? 'reduce' : 'no-preference';
      document.documentElement.dataset.motion = resolved;
    } catch (e) {}
  };
  apply();
  try {
    if (media && media.addEventListener) {
      media.addEventListener('change', apply);
    } else if (media && media.addListener) {
      media.addListener(apply);
    }
  } catch (e) {}
})();`;
