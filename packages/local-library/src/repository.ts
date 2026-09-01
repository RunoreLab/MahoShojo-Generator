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
  /** Creates one tombstone; missing IDs and already-deleted records are no-ops. */
  delete(_id: z.infer<typeof LocalCardIdSchema>): Promise<void>;
  /** Explicitly removes a tombstone; missing IDs and active records are no-ops. */
  restore(_id: z.infer<typeof LocalCardIdSchema>): Promise<void>;
}
