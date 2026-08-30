// 全局常量与通用判定函数
// 热门卡片阈值：收藏数 > 10 且使用数 > 30 时视为热门卡片，不占用槽位
export const HOT_CARD_FAVORITE_THRESHOLD = 10;
export const HOT_CARD_USAGE_THRESHOLD = 30;

export function isHotCard(record: { favorite_count?: number; usage_count?: number }): boolean {
  const favorites = record.favorite_count ?? 0;
  const usage = record.usage_count ?? 0;
  return favorites > HOT_CARD_FAVORITE_THRESHOLD && usage > HOT_CARD_USAGE_THRESHOLD;
}

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
