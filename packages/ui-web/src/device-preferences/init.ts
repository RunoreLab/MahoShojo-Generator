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
 *
 * `apply` 内把「读 localStorage」与「写 DOM」拆成两段兜底（D5.1-S1-r1）：
 * 隐私模式/WebView 限制下 `localStorage.getItem` 会抛异常，若读与写同在一个
 * try 里，系统 `prefers-reduced-motion` 会被静默吞掉——无障碍属性不容许
 * fail-open。共享 CSS 另保留原生 `@media (prefers-reduced-motion: reduce)`
 * 规则作为 init 脚本完全失效时的安全网（语义同一：不存在「强制完整动效」档，
 * 媒体规则永远不会覆盖用户显式选择）。
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
    var preference = 'system';
    try {
      var stored = window.localStorage.getItem(${JSON.stringify(MOTION_PREFERENCE_STORAGE_KEY)});
      if (stored === 'reduce' || stored === 'system') {
        preference = stored;
      }
    } catch (e) {}
    var resolved = preference === 'reduce' || (media && media.matches) ? 'reduce' : 'no-preference';
    try {
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
