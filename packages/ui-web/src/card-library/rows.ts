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
