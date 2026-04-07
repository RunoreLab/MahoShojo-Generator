export type MessageScope = 'site' | 'user';
export type MessageFilter = 'all' | 'unread' | 'site' | 'direct';
export type MessagePriority = 'low' | 'normal' | 'high';

export type MessageSortKey = {
  createdAt: string;
  scope: MessageScope;
  numericId: number;
};

export type MessagePreviewDto = MessageSortKey & {
  id: string;
  messageType: string;
  templateKey: string;
  title: string;
  body: string;
  actionUrl: string | null;
  priority: MessagePriority;
  isRead: boolean | null;
  readAt: string | null;
};

export type MessageSummaryDto = {
  unreadTotal: number;
  siteUnread: number;
  directUnread: number;
  latest: MessagePreviewDto | null;
  fetchedAt: string;
  isAuthenticated: boolean;
};

export type MessageListDto = {
  messages: MessagePreviewDto[];
  nextCursor: string | null;
  filter: MessageFilter;
  appliedFilter: Exclude<MessageFilter, 'unread'> | 'unread';
  fetchedAt: string;
  isAuthenticated: boolean;
};
