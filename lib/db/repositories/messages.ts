import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { siteMessages, userMessageState, userMessages } from '@/lib/db/schema';
import { MESSAGE_SCOPE_RANK } from '@/lib/messages/cursor';
import type { MessagePriority, MessageSortKey } from '@/lib/messages/types';

export type SiteMessageRow = {
  id: number;
  messageType: string;
  templateKey: string;
  payloadJson: string;
  titleText: string | null;
  bodyText: string | null;
  actionUrl: string | null;
  priority: MessagePriority;
  expiresAt: string | null;
  createdAt: string;
};

export type UserMessageRow = {
  id: number;
  recipientUserId: number;
  actorUserId: number | null;
  channel: string;
  messageType: string;
  templateKey: string;
  payloadJson: string;
  titleText: string | null;
  bodyText: string | null;
  actionUrl: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  priority: MessagePriority;
  readAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type UserMessageStateRow = {
  userId: number;
  lastReadSiteMessageId: number;
  lastSummaryReadAt: string | null;
};

export type ListSiteMessagesInput = {
  now: string;
  limit: number;
  cursor: MessageSortKey | null;
  unreadAfterId?: number;
};

export type ListUserMessagesInput = {
  userId: number;
  now: string;
  limit: number;
  cursor: MessageSortKey | null;
  unreadOnly?: boolean;
};

export type CreateSiteMessageInput = {
  messageType: string;
  templateKey: string;
  payloadJson: string;
  titleText: string | null;
  bodyText: string | null;
  actionUrl: string | null;
  priority: MessagePriority;
  expiresAt: string | null;
  createdByUserId: number | null;
  now: string;
};

export type CreateUserMessageInput = {
  recipientUserId: number;
  actorUserId: number | null;
  channel: string;
  messageType: string;
  templateKey: string;
  payloadJson: string;
  titleText: string | null;
  bodyText: string | null;
  actionUrl: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  priority: MessagePriority;
  expiresAt: string | null;
  now: string;
};

const countValue = (value: unknown): number => {
  const next =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(next) ? next : 0;
};

const visibleSiteMessagePredicate = (now: string) =>
  or(isNull(siteMessages.expiresAt), gt(siteMessages.expiresAt, now));

const visibleUserMessagePredicate = (now: string) =>
  and(isNull(userMessages.archivedAt), or(isNull(userMessages.expiresAt), gt(userMessages.expiresAt, now)));

const buildCursorPredicate = (
  createdAtColumn: typeof siteMessages.createdAt | typeof userMessages.createdAt,
  idColumn: typeof siteMessages.id | typeof userMessages.id,
  sourceScope: 'site' | 'user',
  cursor: MessageSortKey | null,
) => {
  if (!cursor) {
    return undefined;
  }

  const sourceRank = MESSAGE_SCOPE_RANK[sourceScope];
  const cursorRank = MESSAGE_SCOPE_RANK[cursor.scope];
  const earlierCreatedAt = lt(createdAtColumn, cursor.createdAt);

  if (sourceRank < cursorRank) {
    return or(earlierCreatedAt, eq(createdAtColumn, cursor.createdAt));
  }

  if (sourceRank === cursorRank) {
    return or(earlierCreatedAt, and(eq(createdAtColumn, cursor.createdAt), lt(idColumn, cursor.numericId)));
  }

  return earlierCreatedAt;
};

export const getUserMessageState = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<UserMessageStateRow | null> => {
  const row = await db.query.userMessageState.findFirst({
    where: eq(userMessageState.userId, userId),
  });

  if (!row) {
    return null;
  }

  return {
    userId: row.userId,
    lastReadSiteMessageId: row.lastReadSiteMessageId,
    lastSummaryReadAt: row.lastSummaryReadAt,
  };
};

export const ensureUserMessageState = async (db: AppDrizzleDb, userId: number): Promise<UserMessageStateRow> => {
  await db
    .insert(userMessageState)
    .values({
      userId,
      lastReadSiteMessageId: 0,
      lastSummaryReadAt: null,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .onConflictDoNothing();

  return (
    (await getUserMessageState(db, userId)) ?? {
      userId,
      lastReadSiteMessageId: 0,
      lastSummaryReadAt: null,
    }
  );
};

export const countUnreadSiteMessages = async (
  db: AppDrizzleDb,
  input: { lastReadSiteMessageId: number; now: string },
): Promise<number> => {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(siteMessages)
    .where(and(gt(siteMessages.id, input.lastReadSiteMessageId), visibleSiteMessagePredicate(input.now)));

  return countValue(rows[0]?.count);
};

export const countUnreadUserMessages = async (
  db: AppDrizzleDb,
  input: { userId: number; now: string },
): Promise<number> => {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(userMessages)
    .where(
      and(eq(userMessages.recipientUserId, input.userId), isNull(userMessages.readAt), visibleUserMessagePredicate(input.now)),
    );

  return countValue(rows[0]?.count);
};

export const listSiteMessages = async (db: AppDrizzleDb, input: ListSiteMessagesInput): Promise<SiteMessageRow[]> => {
  const filters = [visibleSiteMessagePredicate(input.now)];

  const cursorPredicate = buildCursorPredicate(siteMessages.createdAt, siteMessages.id, 'site', input.cursor);
  if (cursorPredicate) {
    filters.push(cursorPredicate);
  }

  if (typeof input.unreadAfterId === 'number') {
    filters.push(gt(siteMessages.id, input.unreadAfterId));
  }

  return await db
    .select({
      id: siteMessages.id,
      messageType: siteMessages.messageType,
      templateKey: siteMessages.templateKey,
      payloadJson: siteMessages.payloadJson,
      titleText: siteMessages.titleText,
      bodyText: siteMessages.bodyText,
      actionUrl: siteMessages.actionUrl,
      priority: siteMessages.priority,
      expiresAt: siteMessages.expiresAt,
      createdAt: siteMessages.createdAt,
    })
    .from(siteMessages)
    .where(and(...filters))
    .orderBy(desc(siteMessages.createdAt), desc(siteMessages.id))
    .limit(Math.max(1, input.limit));
};

export const listUserMessages = async (db: AppDrizzleDb, input: ListUserMessagesInput): Promise<UserMessageRow[]> => {
  const filters = [eq(userMessages.recipientUserId, input.userId), visibleUserMessagePredicate(input.now)];

  if (input.unreadOnly) {
    filters.push(isNull(userMessages.readAt));
  }

  const cursorPredicate = buildCursorPredicate(userMessages.createdAt, userMessages.id, 'user', input.cursor);
  if (cursorPredicate) {
    filters.push(cursorPredicate);
  }

  return await db
    .select({
      id: userMessages.id,
      recipientUserId: userMessages.recipientUserId,
      actorUserId: userMessages.actorUserId,
      channel: userMessages.channel,
      messageType: userMessages.messageType,
      templateKey: userMessages.templateKey,
      payloadJson: userMessages.payloadJson,
      titleText: userMessages.titleText,
      bodyText: userMessages.bodyText,
      actionUrl: userMessages.actionUrl,
      sourceEntityType: userMessages.sourceEntityType,
      sourceEntityId: userMessages.sourceEntityId,
      priority: userMessages.priority,
      readAt: userMessages.readAt,
      archivedAt: userMessages.archivedAt,
      expiresAt: userMessages.expiresAt,
      createdAt: userMessages.createdAt,
    })
    .from(userMessages)
    .where(and(...filters))
    .orderBy(desc(userMessages.createdAt), desc(userMessages.id))
    .limit(Math.max(1, input.limit));
};

export const markUserMessagesRead = async (
  db: AppDrizzleDb,
  input: { userId: number; ids: number[]; now: string },
): Promise<number> => {
  if (input.ids.length === 0) {
    return 0;
  }

  const updatedRows = await db
    .update(userMessages)
    .set({
      readAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(userMessages.recipientUserId, input.userId),
        inArray(userMessages.id, input.ids),
        isNull(userMessages.readAt),
        visibleUserMessagePredicate(input.now),
      ),
    )
    .returning({ id: userMessages.id });

  return updatedRows.length;
};

export const markAllUnreadUserMessagesRead = async (
  db: AppDrizzleDb,
  input: { userId: number; now: string },
): Promise<number> => {
  const updatedRows = await db
    .update(userMessages)
    .set({
      readAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(userMessages.recipientUserId, input.userId),
        isNull(userMessages.readAt),
        visibleUserMessagePredicate(input.now),
      ),
    )
    .returning({ id: userMessages.id });

  return updatedRows.length;
};

export const advanceSiteMessageCursor = async (
  db: AppDrizzleDb,
  input: { userId: number; lastReadSiteMessageId: number; now: string },
): Promise<number> => {
  const nextCursor = Math.max(0, Math.trunc(input.lastReadSiteMessageId));

  await db
    .insert(userMessageState)
    .values({
      userId: input.userId,
      lastReadSiteMessageId: nextCursor,
      lastSummaryReadAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: userMessageState.userId,
      set: {
        lastReadSiteMessageId: sql`max(${userMessageState.lastReadSiteMessageId}, ${nextCursor})`,
        updatedAt: input.now,
      },
    });

  const state = await ensureUserMessageState(db, input.userId);
  return state.lastReadSiteMessageId;
};

export const getMaxVisibleSiteMessageId = async (
  db: AppDrizzleDb,
  input: { now: string },
): Promise<number> => {
  const rows = await db
    .select({ maxId: sql<number>`coalesce(max(${siteMessages.id}), 0)` })
    .from(siteMessages)
    .where(visibleSiteMessagePredicate(input.now));

  return countValue(rows[0]?.maxId);
};

export const createSiteMessage = async (db: AppDrizzleDb, input: CreateSiteMessageInput): Promise<number | null> => {
  const rows = await db
    .insert(siteMessages)
    .values({
      messageType: input.messageType as never,
      templateKey: input.templateKey,
      payloadJson: input.payloadJson,
      titleText: input.titleText,
      bodyText: input.bodyText,
      actionUrl: input.actionUrl,
      priority: input.priority,
      expiresAt: input.expiresAt,
      createdByUserId: input.createdByUserId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: siteMessages.id });

  return rows[0]?.id ?? null;
};

export const createUserMessage = async (db: AppDrizzleDb, input: CreateUserMessageInput): Promise<number | null> => {
  const rows = await db
    .insert(userMessages)
    .values({
      recipientUserId: input.recipientUserId,
      actorUserId: input.actorUserId,
      channel: input.channel as never,
      messageType: input.messageType as never,
      templateKey: input.templateKey,
      payloadJson: input.payloadJson,
      titleText: input.titleText,
      bodyText: input.bodyText,
      actionUrl: input.actionUrl,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      priority: input.priority,
      expiresAt: input.expiresAt,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: userMessages.id });

  return rows[0]?.id ?? null;
};

export const updateSiteMessageExpiry = async (
  db: AppDrizzleDb,
  input: { id: number; expiresAt: string | null; now: string },
): Promise<boolean> => {
  const rows = await db
    .update(siteMessages)
    .set({
      expiresAt: input.expiresAt,
      updatedAt: input.now,
    })
    .where(eq(siteMessages.id, input.id))
    .returning({ id: siteMessages.id });

  return rows.length > 0;
};

export const expireSiteMessageNow = async (
  db: AppDrizzleDb,
  input: { id: number; now: string },
): Promise<boolean> => updateSiteMessageExpiry(db, { ...input, expiresAt: input.now });
