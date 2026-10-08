/**
 * /free 页面口径的字节量展示（KB/MB，两位小数内动态精度）。
 * Web `FreePage` 与 Desktop `free-page` 此前各存一份逐字相同实现；
 * 注意与 Desktop `platform/format-bytes`（KiB 制）不是同一文案，勿混用。
 */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
};
