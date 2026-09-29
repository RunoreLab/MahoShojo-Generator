import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import { stripBattleSelectionTransportMeta } from '@/lib/data-card-read-mappers';

/**
 * 数据卡本地身份。
 *
 * 摘要**只覆盖卡内容**，不覆盖标题、作者、时间戳或云端 ID。理由很直接：
 * 如果把那些也算进摘要，用户改一次标题就会得到一张新卡，本地库会被同一张卡的
 * 每次微调填满——这正是「免得生成多个没多大差异的本地卡」要避免的结果。
 *
 * 签名同样排除：它每次保存都会变，而内容没变。
 */
const DIGEST_ALGORITHM = 'sha256';

const NON_SUBSTANTIVE_PAYLOAD_KEYS = new Set(['signature', 'signatureVersion', 'signatureKeyId']);

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !NON_SUBSTANTIVE_PAYLOAD_KEYS.has(key))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`;
};

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

export const digestLocalCardPayload = async (payload: unknown): Promise<string> => {
  const stripped = stripBattleSelectionTransportMeta(payload);
  const canonical = canonicalize(stripped);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `${DIGEST_ALGORITHM}:${toHex(digest)}`;
};

/** 与 `packages/web-package` 的 `deriveLocalId` 保持同一形状，便于两类本地对象互相辨认。 */
export const deriveLocalDataCardId = (contentDigest: string): string =>
  `lc_${contentDigest.replace(/^sha256:/u, '').slice(0, 32)}`;

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
}

/**
 * 写入本地库并按内容摘要去重。
 *
 * 摘要命中时**整卡替换**：字段级合并会造出用户从未写过的第三态，本地库一旦开始
 * 累积「似曾相识」的卡就再也分不清哪张是真的。
 */
export const saveLocalDataCard = async (
  repository: { get: (id: string) => Promise<LocalCardRecordV1 | null>; put: (record: LocalCardRecordV1) => Promise<void> },
  input: SaveLocalDataCardInput,
  now: () => string = () => new Date().toISOString(),
): Promise<SaveLocalDataCardResult> => {
  const contentDigest = await digestLocalCardPayload(input.payload);
  const id = deriveLocalDataCardId(contentDigest);
  const timestamp = now();
  const existing = await repository.get(id);
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
  return { record, updated: existing !== null };
};
