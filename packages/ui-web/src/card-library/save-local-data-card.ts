import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import {
  deriveLocalDataCardIdV1,
  digestLocalCardPayloadV1,
} from '@mahoshojo/local-library/digest';

export interface SaveLocalDataCardInput {
  cardType: OnlineDataCardType;
  title: string;
  payload: unknown;
  execution?: 'imported' | 'downloaded' | 'direct-local' | 'edited';
  cloudRef?: { cardId?: string; cloudRevision?: string };
}

export interface SaveLocalDataCardResult {
  record: LocalCardRecordV1;
  /** 命中的既有记录被整卡替换，而不是新增一行。 */
  updated: boolean;
  /**
   * 同内容记录在回收站中，本次**没有写入**。用户删掉之后再导入同一份内容需要显式恢复，
   * 不能隐式复活（`SPEC-local-library-web-landing-v1` §2.3）；`record` 此时是那条墓碑。
   */
  inRecycleBin: boolean;
}

/**
 * 写入本地库并按内容摘要去重。
 *
 * 摘要命中时**整卡替换**：字段级合并会造出用户从未写过的第三态，本地库一旦开始
 * 累积「似曾相识」的卡就再也分不清哪张是真的。
 *
 * 摘要算法本身不在这里——canonicalization 与 ID 派生是 V1 语义的唯一权威实现，位于
 * `@mahoshojo/local-library/digest`。Web 与 Desktop 都必须消费那一份；本模块只负责
 * "用摘要当身份去存"这条用例。
 */
export const saveLocalDataCard = async (
  repository: { get: (id: string) => Promise<LocalCardRecordV1 | null>; put: (record: LocalCardRecordV1) => Promise<void> },
  input: SaveLocalDataCardInput,
  now: () => string = () => new Date().toISOString(),
): Promise<SaveLocalDataCardResult> => {
  const contentDigest = await digestLocalCardPayloadV1(input.payload);
  const id = deriveLocalDataCardIdV1(contentDigest);
  const timestamp = now();
  const existing = await repository.get(id);
  if (existing?.deletedAt !== undefined) return { record: existing, updated: false, inRecycleBin: true };
  const record: LocalCardRecordV1 = {
    id,
    schemaVersion: 1,
    storageLocation: 'local',
    cardType: input.cardType,
    title: input.title.trim() || '未命名数据卡',
    data: input.payload as LocalCardRecordV1['data'],
    contentDigest,
    provenance: { kind: 'unsigned', execution: input.execution ?? 'imported' },
    ...(input.cloudRef?.cardId
      ? { cloudRef: { cardId: input.cloudRef.cardId, cloudRevision: input.cloudRef.cloudRevision, copiedAt: timestamp } }
      : {}),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await repository.put(record);
  return { record, updated: existing !== null, inRecycleBin: false };
};
