import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  type DataCardInteractionInput,
  deleteDataCardInteraction,
  insertDataCardInteractionIgnore,
} from '@/lib/db/repositories/data-card-interactions';
import {
  incrementPublicApprovedDataCardLikeCount,
  incrementPublicApprovedDataCardUsageCount,
} from '@/lib/db/repositories/data-cards-core';

export type RecordDataCardStatInteractionResult =
  | { success: true; alreadyExists: boolean }
  | { success: false; notFound: true };

export type RecordDataCardStatInteractionDeps = {
  insertInteractionIgnore?: (db: AppDrizzleDb, input: DataCardInteractionInput) => Promise<boolean>;
  deleteInteraction?: (db: AppDrizzleDb, input: DataCardInteractionInput) => Promise<void>;
  incrementLikeCount?: (db: AppDrizzleDb, cardId: string) => Promise<number>;
  incrementUsageCount?: (db: AppDrizzleDb, cardId: string) => Promise<number>;
};

const isValidInput = (input: DataCardInteractionInput): boolean =>
  Boolean(input.dataCardId.trim()) &&
  (input.eventType === 'like' || input.eventType === 'usage') &&
  (input.actorScope === 'auth_user' || input.actorScope === 'activity_user' || input.actorScope === 'anonymous') &&
  Boolean(input.actorKeyHash.trim()) &&
  Boolean(input.nowIso.trim());

export const recordDataCardStatInteraction = async (
  db: AppDrizzleDb,
  input: DataCardInteractionInput,
  deps: RecordDataCardStatInteractionDeps = {},
): Promise<RecordDataCardStatInteractionResult> => {
  if (!isValidInput(input)) return { success: false, notFound: true };

  const insertInteraction = deps.insertInteractionIgnore ?? insertDataCardInteractionIgnore;
  const deleteInteraction = deps.deleteInteraction ?? deleteDataCardInteraction;
  const incrementLikeCount = deps.incrementLikeCount ?? incrementPublicApprovedDataCardLikeCount;
  const incrementUsageCount = deps.incrementUsageCount ?? incrementPublicApprovedDataCardUsageCount;

  const inserted = await insertInteraction(db, input);
  if (!inserted) {
    return { success: true, alreadyExists: true };
  }

  let changed = 0;
  try {
    changed =
      input.eventType === 'like'
        ? await incrementLikeCount(db, input.dataCardId)
        : await incrementUsageCount(db, input.dataCardId);
  } catch (error) {
    await deleteInteraction(db, input);
    throw error;
  }

  if (changed > 0) {
    return { success: true, alreadyExists: false };
  }

  await deleteInteraction(db, input);
  return { success: false, notFound: true };
};
