import { and, desc, eq, type SQL } from 'drizzle-orm';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { siteMessages, userMessages } from '@/lib/db/schema';
import { createSiteMessageEntry, createUserMessageEntry, expireSiteMessageNowEntry } from '@/lib/messages/service';
import { renderMessageTemplate } from '@/lib/messages/templates';
import type { MessagePriority } from '@/lib/messages/types';

export type AdminMessageScope = 'all' | 'site' | 'direct';

export type AdminSiteMessageDto = {
  id: number;
  messageType: string;
  templateKey: string;
  title: string;
  body: string;
  actionUrl: string | null;
  priority: MessagePriority;
  expiresAt: string | null;
  createdAt: string;
  createdByUserId: number | null;
  isExpired: boolean;
};

export type AdminDirectMessageDto = {
  id: number;
  recipientUserId: number;
  actorUserId: number | null;
  channel: string;
  messageType: string;
  templateKey: string;
  title: string;
  body: string;
  actionUrl: string | null;
  priority: MessagePriority;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  readAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  isExpired: boolean;
};

export type AdminMessageListDto = {
  siteMessages: AdminSiteMessageDto[];
  directMessages: AdminDirectMessageDto[];
  fetchedAt: string;
};

type ListAdminMessagesInput = {
  db: AppDrizzleDb | null;
  scope?: AdminMessageScope;
  templateKey?: string;
  messageType?: string;
  recipientUserId?: number;
  limit?: number;
  now?: string;
};

type CreateAdminSiteMessageInput = {
  db: AppDrizzleDb | null;
  actorUserId?: number | null;
  messageType: string;
  templateKey: string;
  payload: Record<string, unknown>;
  titleText?: string | null;
  bodyText?: string | null;
  actionUrl?: string | null;
  priority?: MessagePriority;
  expiresAt?: string | null;
};

type CreateAdminDirectMessagesInput = {
  db: AppDrizzleDb | null;
  actorUserId?: number | null;
  recipientUserIds: number[];
  channel?: 'system' | 'admin';
  messageType: string;
  templateKey: string;
  payload: Record<string, unknown>;
  titleText?: string | null;
  bodyText?: string | null;
  actionUrl?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  priority?: MessagePriority;
  expiresAt?: string | null;
};

export type DataCardModerationTarget = {
  recipientUserId: number;
  dataCardId: string;
  dataCardName: string;
  reasonKey: string;
};

const requireDb = (db: AppDrizzleDb | null): AppDrizzleDb => {
  if (!db) {
    throw new Error('数据库不可用');
  }
  return db;
};

const parsePayload = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const clampLimit = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(value)));
};

const isExpired = (expiresAt: string | null, now: string): boolean => {
  return typeof expiresAt === 'string' && expiresAt.trim().length > 0 && expiresAt <= now;
};

export async function listAdminMessages(input: ListAdminMessagesInput): Promise<AdminMessageListDto> {
  const db = requireDb(input.db);
  const now = input.now ?? new Date().toISOString();
  const limit = clampLimit(input.limit);
  const scope = input.scope ?? 'all';

  const siteWhere: SQL<unknown>[] = [];
  if (input.templateKey) siteWhere.push(eq(siteMessages.templateKey, input.templateKey));
  if (input.messageType) siteWhere.push(eq(siteMessages.messageType, input.messageType as never));

  const directWhere: SQL<unknown>[] = [];
  if (input.templateKey) directWhere.push(eq(userMessages.templateKey, input.templateKey));
  if (input.messageType) directWhere.push(eq(userMessages.messageType, input.messageType as never));
  if (typeof input.recipientUserId === 'number') {
    directWhere.push(eq(userMessages.recipientUserId, input.recipientUserId));
  }

  const siteRows =
    scope === 'direct'
      ? []
      : await db
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
            createdByUserId: siteMessages.createdByUserId,
          })
          .from(siteMessages)
          .where(siteWhere.length > 0 ? and(...siteWhere) : undefined)
          .orderBy(desc(siteMessages.createdAt), desc(siteMessages.id))
          .limit(limit);

  const directRows =
    scope === 'site'
      ? []
      : await db
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
            priority: userMessages.priority,
            sourceEntityType: userMessages.sourceEntityType,
            sourceEntityId: userMessages.sourceEntityId,
            readAt: userMessages.readAt,
            archivedAt: userMessages.archivedAt,
            expiresAt: userMessages.expiresAt,
            createdAt: userMessages.createdAt,
          })
          .from(userMessages)
          .where(directWhere.length > 0 ? and(...directWhere) : undefined)
          .orderBy(desc(userMessages.createdAt), desc(userMessages.id))
          .limit(limit);

  return {
    siteMessages: siteRows.map((row) => {
      const rendered = renderMessageTemplate({
        templateKey: row.templateKey,
        payload: parsePayload(row.payloadJson),
        titleText: row.titleText,
        bodyText: row.bodyText,
      });
      return {
        id: row.id,
        messageType: row.messageType,
        templateKey: row.templateKey,
        title: rendered.title,
        body: rendered.body,
        actionUrl: row.actionUrl,
        priority: row.priority,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        createdByUserId: row.createdByUserId,
        isExpired: isExpired(row.expiresAt, now),
      };
    }),
    directMessages: directRows.map((row) => {
      const rendered = renderMessageTemplate({
        templateKey: row.templateKey,
        payload: parsePayload(row.payloadJson),
        titleText: row.titleText,
        bodyText: row.bodyText,
      });
      return {
        id: row.id,
        recipientUserId: row.recipientUserId,
        actorUserId: row.actorUserId,
        channel: row.channel,
        messageType: row.messageType,
        templateKey: row.templateKey,
        title: rendered.title,
        body: rendered.body,
        actionUrl: row.actionUrl,
        priority: row.priority,
        sourceEntityType: row.sourceEntityType,
        sourceEntityId: row.sourceEntityId,
        readAt: row.readAt,
        archivedAt: row.archivedAt,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        isExpired: isExpired(row.expiresAt, now),
      };
    }),
    fetchedAt: now,
  };
}

export async function createAdminSiteMessage(input: CreateAdminSiteMessageInput): Promise<{ id: number | null }> {
  const result = await createSiteMessageEntry({
    db: requireDb(input.db),
    actorUserId: input.actorUserId ?? null,
    messageType: input.messageType,
    templateKey: input.templateKey,
    payload: input.payload,
    titleText: input.titleText ?? null,
    bodyText: input.bodyText ?? null,
    actionUrl: input.actionUrl ?? null,
    priority: input.priority ?? 'normal',
    expiresAt: input.expiresAt ?? null,
  });
  return { id: typeof result.id === 'number' ? result.id : null };
}

export async function createAdminDirectMessages(
  input: CreateAdminDirectMessagesInput,
): Promise<{ createdCount: number; messageIds: number[] }> {
  const db = requireDb(input.db);
  const recipientUserIds = Array.from(new Set(input.recipientUserIds.filter((item) => Number.isInteger(item) && item > 0)));
  const messageIds: number[] = [];

  for (const recipientUserId of recipientUserIds) {
    const result = await createUserMessageEntry({
      db,
      recipientUserId,
      actorUserId: input.actorUserId ?? null,
      channel: input.channel ?? 'admin',
      messageType: input.messageType,
      templateKey: input.templateKey,
      payload: input.payload,
      titleText: input.titleText ?? null,
      bodyText: input.bodyText ?? null,
      actionUrl: input.actionUrl ?? null,
      sourceEntityType: input.sourceEntityType ?? null,
      sourceEntityId: input.sourceEntityId ?? null,
      priority: input.priority ?? 'normal',
      expiresAt: input.expiresAt ?? null,
    });
    if (typeof result.id === 'number') {
      messageIds.push(result.id);
    }
  }

  return {
    createdCount: messageIds.length,
    messageIds,
  };
}

export async function expireAdminSiteMessageNow(input: {
  db: AppDrizzleDb | null;
  id: number;
}): Promise<boolean> {
  const result = await expireSiteMessageNowEntry({
    db: requireDb(input.db),
    id: input.id,
  });
  return result.updated;
}

export async function sendDataCardModerationMessages(input: {
  db: AppDrizzleDb | null;
  actorUserId?: number | null;
  templateKey: 'user.moderation.data_card_rejected' | 'user.moderation.data_card_banned';
  targets: DataCardModerationTarget[];
  defaultReason?: string | null;
  reasonByTargetKey?: Record<string, string>;
}): Promise<{ createdCount: number; messageIds: number[] }> {
  const db = requireDb(input.db);
  const messageIds: number[] = [];
  const uniqueTargets = new Map<string, DataCardModerationTarget>();

  for (const target of input.targets) {
    uniqueTargets.set(`${target.recipientUserId}:${target.reasonKey}`, target);
  }

  for (const target of uniqueTargets.values()) {
    const reason = input.reasonByTargetKey?.[target.reasonKey]?.trim() || input.defaultReason?.trim() || null;
    const result = await createUserMessageEntry({
      db,
      recipientUserId: target.recipientUserId,
      actorUserId: input.actorUserId ?? null,
      channel: 'admin',
      messageType: 'moderation',
      templateKey: input.templateKey,
      payload: {
        dataCardId: target.dataCardId,
        dataCardName: target.dataCardName,
        reason,
      },
      actionUrl: `/character-manager?dataCardId=${encodeURIComponent(target.dataCardId)}`,
      sourceEntityType: 'data_card',
      sourceEntityId: target.dataCardId,
      priority: 'high',
    });
    if (typeof result.id === 'number') {
      messageIds.push(result.id);
    }
  }

  return {
    createdCount: messageIds.length,
    messageIds,
  };
}
