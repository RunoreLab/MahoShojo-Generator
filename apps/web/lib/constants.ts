// 热门阈值与桌面展示共享；热门卡减免一个基础槽位，并非任意大小都免费。
export { HOT_CARD_FAVORITE_THRESHOLD, HOT_CARD_USAGE_THRESHOLD, isHotCard } from '@mahoshojo/domain/data-card-size';

export function formatDateTime(value?: string | number | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate()
    .toString()
    .padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes()
    .toString()
    .padStart(2, '0')}`;
}
