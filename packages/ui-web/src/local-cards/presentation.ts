import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';

export type LocalCardType = LocalCardRecordV1['cardType'];

export const LOCAL_CARD_TYPE_LABELS: Readonly<Record<LocalCardType, string>> = {
  character: '角色',
  scenario: '情景',
  history: '叙事历史',
  questionnaire: '问卷',
};

const EXECUTION_LABELS: Readonly<Record<NonNullable<LocalCardRecordV1['provenance']['execution']>, string>> = {
  downloaded: '从线上复制',
  'direct-local': '本机模型生成',
  'direct-remote': '远程模型生成',
  imported: '导入',
  edited: '编辑',
};

/**
 * 只陈述记录字段里的事实，不做可信判断。
 *
 * 带签名字段的记录在本机**没有**被验签（`DESK-PROD-012`），因此即便 `kind` 是 `official-signed`
 * 也只能说“含签名字段”，不能说“官方认证”。
 */
export const describeLocalCardProvenance = (record: LocalCardRecordV1): string => {
  const { provenance } = record;
  const signature = provenance.kind === 'unsigned'
    ? '无签名'
    : provenance.kind === 'official-signed'
      ? '含签名字段（本机未验证）'
      : '签名无效';
  return provenance.execution === undefined ? signature : `${signature} · ${EXECUTION_LABELS[provenance.execution]}`;
};

export interface LocalCardFilter {
  readonly query: string;
  readonly cardType: LocalCardType | '';
}

/** 标题、类型与 id 的子串匹配；不检索正文，正文全文检索不是本切片的问题。 */
export const filterLocalCards = (
  records: readonly LocalCardRecordV1[],
  filter: LocalCardFilter,
): LocalCardRecordV1[] => {
  const keyword = filter.query.trim().toLowerCase();
  return records.filter((record) => {
    if (filter.cardType !== '' && record.cardType !== filter.cardType) return false;
    if (keyword === '') return true;
    return `${record.title}\n${LOCAL_CARD_TYPE_LABELS[record.cardType]}\n${record.id}`.toLowerCase().includes(keyword);
  });
};

export const LOCAL_CARD_JSON_PREVIEW_LIMIT = 20_000;

/** 详情里展示的正文。超长时截断展示，避免一张大卡把整个页面撑到不可用。 */
export const previewLocalCardData = (record: LocalCardRecordV1): { text: string; truncated: boolean } => {
  const text = JSON.stringify(record.data, null, 2);
  return text.length > LOCAL_CARD_JSON_PREVIEW_LIMIT
    ? { text: text.slice(0, LOCAL_CARD_JSON_PREVIEW_LIMIT), truncated: true }
    : { text, truncated: false };
};
