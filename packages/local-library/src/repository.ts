import { OnlineDataCardTypeSchema } from '@mahoshojo/contracts/data-cards';
import { z } from './zod';

import { LocalCardIdSchema, LocalCardRecordV1Schema, type LocalCardRecordV1 } from './record';

export const MAX_LOCAL_CARD_PAGE_SIZE = 100 as const;

export const LocalCardQuerySchema = z
  .object({
    cardTypes: z.array(OnlineDataCardTypeSchema).max(4).optional(),
    includeDeleted: z.boolean().optional(),
    limit: z.number().int().min(1).max(MAX_LOCAL_CARD_PAGE_SIZE),
    cursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.cardTypes !== undefined && new Set(query.cardTypes).size !== query.cardTypes.length) {
      context.addIssue({
        code: 'custom',
        path: ['cardTypes'],
        message: 'cardTypes must not contain duplicates',
      });
    }
  });
export type LocalCardQuery = z.infer<typeof LocalCardQuerySchema>;

export const LocalCardPageSchema = z
  .object({
    items: z.array(LocalCardRecordV1Schema).max(MAX_LOCAL_CARD_PAGE_SIZE),
    nextCursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict();
export type LocalCardPage = z.infer<typeof LocalCardPageSchema>;

/**
 * Runtime-neutral local library port. Implementations own persistence details;
 * delete is an idempotent soft-delete/recycle-bin transition, never a cloud operation.
 */
/** `putIfAbsent` 的结果。两种结果对调用方是两种不同的用户动作，因此不做成 boolean。 */
export type CardWriteOutcome = Readonly<{ written: true }> | Readonly<{ alreadyPresent: true }>;

export interface CardRepository {
  /** Returns the record, including a tombstone, or null when the ID never existed. */
  get(_id: z.infer<typeof LocalCardIdSchema>): Promise<LocalCardRecordV1 | null>;
  /** Excludes tombstones unless includeDeleted is explicitly true. */
  list(_query: LocalCardQuery): Promise<LocalCardPage>;
  /**
   * Validates and defensively copies a local record; it never applies cloud slot policy.
   * A normal put must reject attempts to clear an existing tombstone.
   */
  put(_record: LocalCardRecordV1): Promise<void>;
  /**
   * 仅在 id **当前不存在**时写入；已存在则整条不动（含墓碑）并回报已存在。
   *
   * 与 `put` 的差别是**原子性**，不是"是否覆盖"：`put` 之前先 `get` 再 `put` 的组合在这两者之间留有
   * 窗口，因此"本地已存在的记录一律保留"只能是约定。导入侧的 existing-wins 因此必须走这里。
   */
  putIfAbsent(_record: LocalCardRecordV1): Promise<CardWriteOutcome>;
  /** Creates one tombstone; missing IDs and already-deleted records are no-ops. */
  delete(_id: z.infer<typeof LocalCardIdSchema>): Promise<void>;
  /** Explicitly removes a tombstone; missing IDs and active records are no-ops. */
  restore(_id: z.infer<typeof LocalCardIdSchema>): Promise<void>;
}
