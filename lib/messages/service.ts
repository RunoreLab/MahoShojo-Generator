import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as repo from '@/lib/db/repositories/messages';
import { compareMessageSortKeys, encodeMessageCursor } from '@/lib/messages/cursor';
import { renderMessageTemplate } from '@/lib/messages/templates';
import type {
  MessageFilter,
  MessageListDto,
  MessagePreviewDto,
  MessagePriority,
  MessageSortKey,
  MessageSummaryDto,
} from '@/lib/messages/types';

type ServiceSiteMessageRow = repo.SiteMessageRow;
type ServiceUserMessageRow = repo.UserMessageRow;
type ServiceUserMessageStateRow = repo.UserMessageStateRow;
type CrowdReviewPromptSummary = Pick<MessageSummaryDto, 'hasCrowdReviewPending' | 'crowdReviewPrompt'>;

type MessagesRepository = {
  getUserMessageState: (input: { userId: number }) => Promise<ServiceUserMessageStateRow | null>;
  countUnreadSiteMessages: (input: { lastReadSiteMessageId: number; now: string }) => Promise<number>;
  countUnreadUserMessages: (input: { userId: number; now: string }) => Promise<number>;
  listSiteMessages: (input: repo.ListSiteMessagesInput) => Promise<ServiceSiteMessageRow[]>;
  listUserMessages: (input: repo.ListUserMessagesInput) => Promise<ServiceUserMessageRow[]>;
  markUserMessagesRead: (input: { userId: number; ids: number[]; now: string }) => Promise<number>;
  markAllUnreadUserMessagesRead: (input: { userId: number; now: string }) => Promise<number>;
  advanceSiteMessageCursor: (input: { userId: number; lastReadSiteMessageId: number; now: string }) => Promise<number>;
  getMaxVisibleSiteMessageId: (input: { now: string }) => Promise<number>;
  createSiteMessage: (input: repo.CreateSiteMessageInput) => Promise<number | null>;
  createUserMessage: (input: repo.CreateUserMessageInput) => Promise<number | null>;
  updateSiteMessageExpiry: (input: { id: number; expiresAt: string | null; now: string }) => Promise<boolean>;
  expireSiteMessageNow: (input: { id: number; now: string }) => Promise<boolean>;
};

export type MessagesServiceDeps = {
  now: () => string;
  repo: MessagesRepository;
  getCrowdReviewPromptSummary?: (input: {
    db?: AppDrizzleDb | null;
    userId: number;
  }) => Promise<CrowdReviewPromptSummary>;
};

export type MessageServiceDb = AppDrizzleDb | null;

type MessagesService = ReturnType<typeof createMessagesService>;

const toRepo = (db: AppDrizzleDb): MessagesRepository => ({
  getUserMessageState: (input) => repo.getUserMessageState(db, input.userId),
  countUnreadSiteMessages: (input) => repo.countUnreadSiteMessages(db, input),
  countUnreadUserMessages: (input) => repo.countUnreadUserMessages(db, input),
  listSiteMessages: (input) => repo.listSiteMessages(db, input),
  listUserMessages: (input) => repo.listUserMessages(db, input),
  markUserMessagesRead: (input) => repo.markUserMessagesRead(db, input),
  markAllUnreadUserMessagesRead: (input) => repo.markAllUnreadUserMessagesRead(db, input),
  advanceSiteMessageCursor: (input) => repo.advanceSiteMessageCursor(db, input),
  getMaxVisibleSiteMessageId: (input) => repo.getMaxVisibleSiteMessageId(db, input),
  createSiteMessage: (input) => repo.createSiteMessage(db, input),
  createUserMessage: (input) => repo.createUserMessage(db, input),
  updateSiteMessageExpiry: (input) => repo.updateSiteMessageExpiry(db, input),
  expireSiteMessageNow: (input) => repo.expireSiteMessageNow(db, input),
});

const createUnavailableError = () => new MessagesServiceUnavailableError('消息服务当前不可用');

const normalizePriority = (value: string): MessagePriority =>
  value === 'low' || value === 'high' || value === 'normal' ? value : 'normal';

const parsePayloadJson = (payloadJson: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const buildPreviewFromSite = (
  row: ServiceSiteMessageRow,
  lastReadSiteMessageId: number | null,
): MessagePreviewDto => {
  const rendered = renderMessageTemplate({
    templateKey: row.templateKey,
    payload: parsePayloadJson(row.payloadJson),
    titleText: row.titleText,
    bodyText: row.bodyText,
  });
  const isRead = lastReadSiteMessageId === null ? null : row.id <= lastReadSiteMessageId;

  return {
    id: `site:${row.id}`,
    scope: 'site',
    numericId: row.id,
    messageType: row.messageType,
    templateKey: row.templateKey,
    title: rendered.title,
    body: rendered.body,
    actionUrl: row.actionUrl,
    priority: normalizePriority(row.priority),
    isRead,
    readAt: null,
    createdAt: row.createdAt,
  };
};

const buildPreviewFromUser = (row: ServiceUserMessageRow): MessagePreviewDto => {
  const rendered = renderMessageTemplate({
    templateKey: row.templateKey,
    payload: parsePayloadJson(row.payloadJson),
    titleText: row.titleText,
    bodyText: row.bodyText,
  });

  return {
    id: `user:${row.id}`,
    scope: 'user',
    numericId: row.id,
    messageType: row.messageType,
    templateKey: row.templateKey,
    title: rendered.title,
    body: rendered.body,
    actionUrl: row.actionUrl,
    priority: normalizePriority(row.priority),
    isRead: row.readAt == null ? false : true,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
};

const readCursorForMessage = (message: MessagePreviewDto): MessageSortKey => ({
  createdAt: message.createdAt,
  scope: message.scope,
  numericId: message.numericId,
});

const parseUserMessageId = (value: string): number => {
  const match = /^user:([1-9]\d*)$/.exec(value);
  if (!match) {
    throw new InvalidMessageReadRequestError('仅支持 user:* 消息 ID');
  }

  return Number.parseInt(match[1]!, 10);
};

export class MessagesServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessagesServiceUnavailableError';
  }
}

export class InvalidMessageReadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMessageReadRequestError';
  }
}

export class UnauthorizedMessagesFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedMessagesFilterError';
  }
}

const isCrowdReviewUnavailableError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'CrowdReviewServiceUnavailableError';

const createMessagesService = (deps: MessagesServiceDeps) => {
  const resolveState = async (userId: number): Promise<ServiceUserMessageStateRow> =>
    (await deps.repo.getUserMessageState({ userId })) ?? {
      userId,
      lastReadSiteMessageId: 0,
      lastSummaryReadAt: null,
    };

  return {
    async getSummary(input: { userId: number | null }): Promise<MessageSummaryDto> {
      const now = deps.now();
      if (input.userId == null) {
        return {
          unreadTotal: 0,
          siteUnread: 0,
          directUnread: 0,
          latest: null,
          fetchedAt: now,
          isAuthenticated: false,
          hasCrowdReviewPending: false,
          crowdReviewPrompt: null,
        };
      }

      const state = await resolveState(input.userId);
      const [siteUnread, directUnread, latestSiteRows, latestUserRows] = await Promise.all([
        deps.repo.countUnreadSiteMessages({ lastReadSiteMessageId: state.lastReadSiteMessageId, now }),
        deps.repo.countUnreadUserMessages({ userId: input.userId, now }),
        deps.repo.listSiteMessages({
          now,
          limit: 1,
          cursor: null,
          unreadAfterId: state.lastReadSiteMessageId,
        }),
        deps.repo.listUserMessages({
          userId: input.userId,
          now,
          limit: 1,
          cursor: null,
          unreadOnly: true,
        }),
      ]);

      const latestCandidates = [
        ...latestSiteRows.map((row) => buildPreviewFromSite(row, state.lastReadSiteMessageId)),
        ...latestUserRows.map(buildPreviewFromUser),
      ].sort(compareMessageSortKeys);

      const emptyCrowdReviewSummary: CrowdReviewPromptSummary = {
        hasCrowdReviewPending: false,
        crowdReviewPrompt: null,
      };
      let crowdReviewSummary: CrowdReviewPromptSummary = emptyCrowdReviewSummary;
      if (deps.getCrowdReviewPromptSummary) {
        try {
          crowdReviewSummary = await deps.getCrowdReviewPromptSummary({ userId: input.userId });
        } catch (error) {
          if (!isCrowdReviewUnavailableError(error)) {
            throw error;
          }
        }
      }

      return {
        unreadTotal: siteUnread + directUnread,
        siteUnread,
        directUnread,
        latest: latestCandidates[0] ?? null,
        fetchedAt: now,
        isAuthenticated: true,
        hasCrowdReviewPending: crowdReviewSummary.hasCrowdReviewPending,
        crowdReviewPrompt: crowdReviewSummary.crowdReviewPrompt,
      };
    },

    async listMessages(input: {
      userId: number | null;
      filter: MessageFilter;
      limit: number;
      cursor: MessageSortKey | null;
    }): Promise<MessageListDto> {
      const now = deps.now();
      const safeLimit = Math.max(1, Math.min(50, Math.trunc(input.limit)));
      const isAuthenticated = input.userId != null;
      const appliedFilter = !isAuthenticated && input.filter === 'all' ? 'site' : input.filter;

      if (!isAuthenticated && (input.filter === 'direct' || input.filter === 'unread')) {
        throw new UnauthorizedMessagesFilterError('登录后才能查看定向或未读消息');
      }

      const state =
        input.userId == null
          ? null
          : (await deps.repo.getUserMessageState({ userId: input.userId })) ?? {
              userId: input.userId,
              lastReadSiteMessageId: 0,
              lastSummaryReadAt: null,
            };

      const [siteRows, userRows] = await Promise.all([
        appliedFilter === 'direct'
          ? Promise.resolve([])
          : deps.repo.listSiteMessages({
              now,
              limit: safeLimit + 1,
              cursor: input.cursor,
              unreadAfterId: appliedFilter === 'unread' ? state?.lastReadSiteMessageId ?? 0 : undefined,
            }),
        !isAuthenticated || appliedFilter === 'site'
          ? Promise.resolve([])
          : deps.repo.listUserMessages({
              userId: input.userId!,
              now,
              limit: safeLimit + 1,
              cursor: input.cursor,
              unreadOnly: appliedFilter === 'unread',
            }),
      ]);

      const merged = [
        ...siteRows.map((row) => buildPreviewFromSite(row, state?.lastReadSiteMessageId ?? null)),
        ...userRows.map(buildPreviewFromUser),
      ].sort(compareMessageSortKeys);

      const hasMore = merged.length > safeLimit;
      const messages = merged.slice(0, safeLimit);

      return {
        messages,
        nextCursor: hasMore && messages.length > 0 ? encodeMessageCursor(readCursorForMessage(messages[messages.length - 1]!)) : null,
        filter: input.filter,
        appliedFilter,
        fetchedAt: now,
        isAuthenticated,
      };
    },

    async markMessagesRead(input: { userId: number; ids: string[] }) {
      const now = deps.now();
      const parsedIds = Array.from(new Set(input.ids.map(parseUserMessageId)));
      if (parsedIds.length === 0) {
        return { markedCount: 0, ignoredCount: 0 };
      }

      const markedCount = await deps.repo.markUserMessagesRead({
        userId: input.userId,
        ids: parsedIds,
        now,
      });

      return {
        markedCount,
        ignoredCount: parsedIds.length - markedCount,
      };
    },

    async markSiteMessagesRead(input: { userId: number; lastReadSiteMessageId: number }) {
      const now = deps.now();
      const maxVisibleSiteMessageId = await deps.repo.getMaxVisibleSiteMessageId({ now });
      const advancedSiteCursorTo = await deps.repo.advanceSiteMessageCursor({
        userId: input.userId,
        lastReadSiteMessageId: Math.min(input.lastReadSiteMessageId, maxVisibleSiteMessageId),
        now,
      });

      return { advancedSiteCursorTo };
    },

    async markAllRead(input: { userId: number }) {
      const now = deps.now();
      const [markedUserMessageCount, maxVisibleSiteMessageId] = await Promise.all([
        deps.repo.markAllUnreadUserMessagesRead({ userId: input.userId, now }),
        deps.repo.getMaxVisibleSiteMessageId({ now }),
      ]);
      const advancedSiteCursorTo = await deps.repo.advanceSiteMessageCursor({
        userId: input.userId,
        lastReadSiteMessageId: maxVisibleSiteMessageId,
        now,
      });

      return {
        markedUserMessageCount,
        advancedSiteCursorTo,
      };
    },

    async createSiteMessageEntry(input: {
      actorUserId?: number | null;
      messageType: string;
      templateKey: string;
      payload: Record<string, unknown>;
      titleText?: string | null;
      bodyText?: string | null;
      actionUrl?: string | null;
      priority?: MessagePriority;
      expiresAt?: string | null;
    }) {
      const id = await deps.repo.createSiteMessage({
        messageType: input.messageType,
        templateKey: input.templateKey,
        payloadJson: JSON.stringify(input.payload ?? {}),
        titleText: input.titleText ?? null,
        bodyText: input.bodyText ?? null,
        actionUrl: input.actionUrl ?? null,
        priority: input.priority ?? 'normal',
        expiresAt: input.expiresAt ?? null,
        createdByUserId: input.actorUserId ?? null,
        now: deps.now(),
      });

      return { id };
    },

    async createUserMessageEntry(input: {
      recipientUserId: number;
      actorUserId?: number | null;
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
    }) {
      const id = await deps.repo.createUserMessage({
        recipientUserId: input.recipientUserId,
        actorUserId: input.actorUserId ?? null,
        channel: input.channel ?? 'system',
        messageType: input.messageType,
        templateKey: input.templateKey,
        payloadJson: JSON.stringify(input.payload ?? {}),
        titleText: input.titleText ?? null,
        bodyText: input.bodyText ?? null,
        actionUrl: input.actionUrl ?? null,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        priority: input.priority ?? 'normal',
        expiresAt: input.expiresAt ?? null,
        now: deps.now(),
      });

      return { id };
    },

    async updateSiteMessageExpiryEntry(input: { id: number; expiresAt: string | null }) {
      const updated = await deps.repo.updateSiteMessageExpiry({
        id: input.id,
        expiresAt: input.expiresAt,
        now: deps.now(),
      });

      return { updated };
    },

    async expireSiteMessageNowEntry(input: { id: number }) {
      const updated = await deps.repo.expireSiteMessageNow({
        id: input.id,
        now: deps.now(),
      });

      return { updated };
    },
  };
};

const requireDb = (db: AppDrizzleDb | null): AppDrizzleDb => {
  if (!db) {
    throw createUnavailableError();
  }
  return db;
};

export function createMessagesServiceForTests(
  deps: {
    now?: () => string;
    repo?: Partial<MessagesRepository>;
    getCrowdReviewPromptSummary?: MessagesServiceDeps['getCrowdReviewPromptSummary'];
  },
): MessagesService {
  const now = deps.now ?? (() => new Date().toISOString());
  const testRepo = deps.repo as Partial<MessagesRepository> | undefined;

  const missing = (name: keyof MessagesRepository) => {
    throw new Error(`Missing test repository dependency: ${String(name)}`);
  };

  return createMessagesService({
    now,
    repo: {
      getUserMessageState: testRepo?.getUserMessageState ?? (() => missing('getUserMessageState')),
      countUnreadSiteMessages: testRepo?.countUnreadSiteMessages ?? (() => missing('countUnreadSiteMessages')),
      countUnreadUserMessages: testRepo?.countUnreadUserMessages ?? (() => missing('countUnreadUserMessages')),
      listSiteMessages: testRepo?.listSiteMessages ?? (() => missing('listSiteMessages')),
      listUserMessages: testRepo?.listUserMessages ?? (() => missing('listUserMessages')),
      markUserMessagesRead: testRepo?.markUserMessagesRead ?? (() => missing('markUserMessagesRead')),
      markAllUnreadUserMessagesRead:
        testRepo?.markAllUnreadUserMessagesRead ?? (() => missing('markAllUnreadUserMessagesRead')),
      advanceSiteMessageCursor: testRepo?.advanceSiteMessageCursor ?? (() => missing('advanceSiteMessageCursor')),
      getMaxVisibleSiteMessageId: testRepo?.getMaxVisibleSiteMessageId ?? (() => missing('getMaxVisibleSiteMessageId')),
      createSiteMessage: testRepo?.createSiteMessage ?? (() => missing('createSiteMessage')),
      createUserMessage: testRepo?.createUserMessage ?? (() => missing('createUserMessage')),
      updateSiteMessageExpiry: testRepo?.updateSiteMessageExpiry ?? (() => missing('updateSiteMessageExpiry')),
      expireSiteMessageNow: testRepo?.expireSiteMessageNow ?? (() => missing('expireSiteMessageNow')),
    },
    getCrowdReviewPromptSummary: deps.getCrowdReviewPromptSummary,
  });
}

export async function getMessageSummary(input: {
  db: MessageServiceDb;
  userId: number | null;
  now?: string;
}): Promise<MessageSummaryDto> {
  if (input.userId == null) {
    return createMessagesServiceForTests({
      now: () => input.now ?? new Date().toISOString(),
    }).getSummary({ userId: null });
  }

  return createMessagesService({
    now: () => input.now ?? new Date().toISOString(),
    repo: toRepo(requireDb(input.db)),
    getCrowdReviewPromptSummary: async ({ userId }) => {
      const { getCrowdReviewSummary } = await import('@/lib/crowd-review/service');
      const summary = await getCrowdReviewSummary({
        db: input.db,
        userId,
      });
      if (!summary.hasCrowdReviewPending) {
        return { hasCrowdReviewPending: false, crowdReviewPrompt: null };
      }

      return {
        hasCrowdReviewPending: true,
        crowdReviewPrompt: {
          title: '调查院有新的可处理案件',
          body: '你有新的众查案件待处理，前往调查院查看',
          actionUrl: '/investigation',
        },
      };
    },
  }).getSummary({ userId: input.userId });
}

export async function listMessages(input: {
  db: MessageServiceDb;
  userId: number | null;
  filter: MessageFilter;
  limit: number;
  cursor: MessageSortKey | null;
  now?: string;
}): Promise<MessageListDto> {
  return createMessagesService({
    now: () => input.now ?? new Date().toISOString(),
    repo: toRepo(requireDb(input.db)),
  }).listMessages({
    userId: input.userId,
    filter: input.filter,
    limit: input.limit,
    cursor: input.cursor,
  });
}

export async function markMessagesRead(input: {
  db: MessageServiceDb;
  userId: number;
  ids: string[];
  now?: string;
}) {
  return createMessagesService({
    now: () => input.now ?? new Date().toISOString(),
    repo: toRepo(requireDb(input.db)),
  }).markMessagesRead({
    userId: input.userId,
    ids: input.ids,
  });
}

export async function markSiteMessagesRead(input: {
  db: MessageServiceDb;
  userId: number;
  lastReadSiteMessageId: number;
  now?: string;
}) {
  return createMessagesService({
    now: () => input.now ?? new Date().toISOString(),
    repo: toRepo(requireDb(input.db)),
  }).markSiteMessagesRead({
    userId: input.userId,
    lastReadSiteMessageId: input.lastReadSiteMessageId,
  });
}

export async function markAllMessagesRead(input: {
  db: MessageServiceDb;
  userId: number;
  now?: string;
}) {
  return createMessagesService({
    now: () => input.now ?? new Date().toISOString(),
    repo: toRepo(requireDb(input.db)),
  }).markAllRead({
    userId: input.userId,
  });
}

export async function createSiteMessageEntry(input: {
  db: MessageServiceDb;
  actorUserId?: number | null;
  messageType: string;
  templateKey: string;
  payload: Record<string, unknown>;
  titleText?: string | null;
  bodyText?: string | null;
  actionUrl?: string | null;
  priority?: MessagePriority;
  expiresAt?: string | null;
  now?: string;
}) {
  return createMessagesService({
    now: () => input.now ?? new Date().toISOString(),
    repo: toRepo(requireDb(input.db)),
  }).createSiteMessageEntry(input);
}

export async function createUserMessageEntry(input: {
  db: MessageServiceDb;
  recipientUserId: number;
  actorUserId?: number | null;
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
  now?: string;
}) {
  return createMessagesService({
    now: () => input.now ?? new Date().toISOString(),
    repo: toRepo(requireDb(input.db)),
  }).createUserMessageEntry(input);
}

export async function updateSiteMessageExpiryEntry(input: {
  db: MessageServiceDb;
  id: number;
  expiresAt: string | null;
  now?: string;
}) {
  return createMessagesService({
    now: () => input.now ?? new Date().toISOString(),
    repo: toRepo(requireDb(input.db)),
  }).updateSiteMessageExpiryEntry(input);
}

export async function expireSiteMessageNowEntry(input: {
  db: MessageServiceDb;
  id: number;
  now?: string;
}) {
  return createMessagesService({
    now: () => input.now ?? new Date().toISOString(),
    repo: toRepo(requireDb(input.db)),
  }).expireSiteMessageNowEntry(input);
}
