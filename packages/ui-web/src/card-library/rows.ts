import type { OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { DataCardDetailsModalCard } from './read-mappers';

/**
 * 本地库数据卡在选择弹窗里使用的行形状。
 *
 * 刻意与 `DataCardSummary` 对齐，好让 `DataCard`、`displayCards` 与详情弹窗复用同一条
 * 渲染路径；`storageLocation: 'local'` 是唯一新增维度，UI 据此把点赞/收藏/分享
 * 换成删除/下载/详情。
 */
export interface LocalDataCardRow {
  id: string;
  storageLocation: 'local';
  name: string;
  description: string;
  type: OnlineDataCardType;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  content_digest: string;
}

const readDescription = (record: LocalCardRecordV1): string => {
  const description = (record.data as { description?: unknown }).description;
  return typeof description === 'string' ? description : '';
};

export const mapLocalCardRecordToRow = (record: LocalCardRecordV1): LocalDataCardRow => ({
  id: record.id,
  storageLocation: 'local',
  name: record.title,
  description: readDescription(record),
  type: record.cardType,
  data: record.data as Record<string, unknown>,
  created_at: record.createdAt,
  updated_at: record.updatedAt,
  content_digest: record.contentDigest,
});

export const isLocalDataCardRow = (row: unknown): row is LocalDataCardRow =>
  typeof row === 'object' && row !== null && (row as { storageLocation?: unknown }).storageLocation === 'local';

export const mapLocalCardRecordToDetailsCard = (record: LocalCardRecordV1): DataCardDetailsModalCard => ({
  id: record.id,
  name: record.title,
  description: readDescription(record),
  type: record.cardType,
  data: JSON.stringify(record.data, null, 2),
  // 详情卡同样可被 `isLocalDataCardRow` 识别——「存到本地库」与 cloudRef
  // 出处写入都靠它区分本地行与云端行。
  storageLocation: 'local',
  isPublic: false,
  author: '本机',
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

/* ── 公开缓存快照行（D5.1-K2，DESK-CACHE-004/007）──────────────────────── */

/**
 * 一条缓存命中在行上附带的快照事实。
 *
 * `storageLocation: 'cache'` 与 `'local'` 是不同维度：缓存行仍是公开/
 * 线上派生数据（不是设备拥有的正式本地资产），但它也不是「本次已验证的
 * 线上引用」——下游把它的选择语义折叠到 local/upload 一侧（Strict/多人/
 * 权威写入必须由服务器重新物化），而不是冒充 cloud 身份。
 */
export interface CachedDataCardRowMeta {
  /** 缓存里是否有完整正文快照；false 时正文/使用入口一律不可执行。 */
  hasBody: boolean;
  /** 该投影最近一次被线上成功确认的 UTC 时刻；null = 无记录。 */
  lastSuccessAt: string | null;
}

const CACHED_ROW_META_KEY = '_cacheMeta' as const;

/**
 * 给一条公开摘要行打上「本机缓存快照」标记。返回新对象，不改原行；
 * `_cacheMeta` 以下划线键与数据字段区隔（与 `_cardId` 等来源键同约定）。
 */
export const markCachedDataCardRow = <T extends Record<string, unknown>>(
  card: T,
  meta: CachedDataCardRowMeta,
): T & { storageLocation: 'cache'; [CACHED_ROW_META_KEY]: CachedDataCardRowMeta } => ({
  ...card,
  storageLocation: 'cache',
  [CACHED_ROW_META_KEY]: { hasBody: meta.hasBody, lastSuccessAt: meta.lastSuccessAt },
});

export const isCachedDataCardRow = (row: unknown): boolean =>
  typeof row === 'object' && row !== null && (row as { storageLocation?: unknown }).storageLocation === 'cache';

/** 读一条缓存行的快照事实；非缓存行返回 null（不猜默认值）。 */
export const getCachedDataCardRowMeta = (row: unknown): CachedDataCardRowMeta | null => {
  if (!isCachedDataCardRow(row)) return null;
  const meta = (row as Record<string, unknown>)[CACHED_ROW_META_KEY];
  if (typeof meta !== 'object' || meta === null) return null;
  const record = meta as { hasBody?: unknown; lastSuccessAt?: unknown };
  return {
    hasBody: record.hasBody === true,
    lastSuccessAt: typeof record.lastSuccessAt === 'string' ? record.lastSuccessAt : null,
  };
};
