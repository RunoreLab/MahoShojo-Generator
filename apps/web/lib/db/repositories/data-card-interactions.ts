import { and, eq } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  dataCardInteractions,
  type DataCardInteractionActorScope,
  type DataCardInteractionEventType,
} from '@/lib/db/schema';

export type DataCardInteractionInput = {
  dataCardId: string;
  eventType: DataCardInteractionEventType;
  actorScope: DataCardInteractionActorScope;
  actorKeyHash: string;
  nowIso: string;
};

export const insertDataCardInteractionIgnore = async (
  db: AppDrizzleDb,
  input: DataCardInteractionInput,
): Promise<boolean> => {
  const inserted = await db
    .insert(dataCardInteractions)
    .values({
      id: crypto.randomUUID(),
      dataCardId: input.dataCardId,
      eventType: input.eventType,
      actorScope: input.actorScope,
      actorKeyHash: input.actorKeyHash,
      createdAt: input.nowIso,
    })
    .onConflictDoNothing()
    .returning({ id: dataCardInteractions.id });

  return inserted.length > 0;
};

export const deleteDataCardInteraction = async (
  db: AppDrizzleDb,
  input: DataCardInteractionInput,
): Promise<void> => {
  await db
    .delete(dataCardInteractions)
    .where(
      and(
        eq(dataCardInteractions.dataCardId, input.dataCardId),
        eq(dataCardInteractions.eventType, input.eventType),
        eq(dataCardInteractions.actorScope, input.actorScope),
        eq(dataCardInteractions.actorKeyHash, input.actorKeyHash),
      ),
    );
};
