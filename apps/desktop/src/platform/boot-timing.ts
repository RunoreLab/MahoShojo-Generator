/**
 * 启动时间观测（D5.2）。
 *
 * 标记只写 `performance.mark`——它们沉淀在 Performance buffer 里，DevTools 的
 * Performance 面板可直接读；`reportBootTimeline` 在 dev 构建下把标记串成一行
 * 打到 console，配合 native 侧 `MAHOSHOJO_BOOT_TIMING=1` 的 eprintln 标记，
 * 就能知道「白屏」究竟花在 native setup、WebView 初始化还是 React 上。
 *
 * 全部调用都不允许影响启动本身：API 不可用时静默跳过，不抛错、不等待。
 */

const BOOT_MARK_PREFIX = 'mahoshojo:boot:';

/** 记录一个启动时间点；name 建议用 `js-module-eval` 这类 kebab-case。 */
export const markBootPoint = (name: string): void => {
  try {
    performance.mark(`${BOOT_MARK_PREFIX}${name}`);
  } catch {
    // Performance API 缺失或被禁用时，观测自身绝不能成为启动失败源。
  }
};

/** dev 构建下把已有标记按时间序打成一行日志；release 下什么都不做。 */
export const reportBootTimeline = (): void => {
  if (!import.meta.env.DEV) return;
  try {
    const marks = performance
      .getEntriesByType('mark')
      .filter((mark) => mark.name.startsWith(BOOT_MARK_PREFIX))
      .sort((a, b) => a.startTime - b.startTime);
    if (marks.length === 0) return;
    const summary = marks
      .map((mark) => `${mark.name.slice(BOOT_MARK_PREFIX.length)} +${mark.startTime.toFixed(0)}ms`)
      .join(' → ');
    console.info(`[desktop-boot] ${summary}`);
  } catch {
    // 同上：诊断路径不产生启动期故障。
  }
};
