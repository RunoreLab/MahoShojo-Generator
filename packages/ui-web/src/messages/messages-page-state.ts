/**
 * 消息中心页面的纯状态函数（自 `apps/web` MessagesPage 上移）。
 *
 * 这些函数描述「消息页面状态机的产品语义」：未登录只能看全站、降级要清
 * 私有数据、游标分页的归属判定——与宿主取数方式无关，因此放在共源层，
 * Web 的 fetch 控制器与 Desktop 的窄通道控制器各自只做 IO。
 */
import type {
  MessageFilter,
  MessageListDto,
  MessagePreviewDto,
  MessageSummaryDto,
} from '@mahoshojo/contracts/messages';

export type MessagesPageState = {
  isAuthenticated: boolean;
  filter: MessageFilter;
  appliedFilter: MessageFilter;
  messages: MessagePreviewDto[];
  nextCursor: string | null;
  loading: boolean;
  summary: MessageSummaryDto | null;
  error?: string | null;
};

export const createMessagesPageState = (isAuthenticated: boolean): MessagesPageState => ({
  isAuthenticated,
  filter: 'all',
  appliedFilter: isAuthenticated ? 'all' : 'site',
  messages: [],
  nextCursor: null,
  loading: true,
  summary: null,
  error: null,
});

export const getMessagesPageRequestFilter = (filter: MessageFilter, isAuthenticated: boolean): MessageFilter => {
  if (isAuthenticated) {
    return filter;
  }
  return filter === 'direct' || filter === 'unread' ? 'site' : filter;
};

export const reconcileMessagesPageStateForAuth = (
  current: MessagesPageState,
  isAuthenticated: boolean,
  forceViewStateReset = false,
): MessagesPageState => {
  if (isAuthenticated) {
    return {
      ...current,
      isAuthenticated: true,
      messages: forceViewStateReset ? [] : current.messages,
      nextCursor: forceViewStateReset ? null : current.nextCursor,
      summary: forceViewStateReset ? null : current.summary,
      error: forceViewStateReset ? null : current.error,
    };
  }

  const filter = getMessagesPageRequestFilter(current.filter, false);
  return {
    ...current,
    isAuthenticated: false,
    filter,
    appliedFilter: filter === 'all' ? 'site' : filter,
    messages: current.isAuthenticated ? [] : current.messages,
    nextCursor: current.isAuthenticated ? null : current.nextCursor,
    summary: null,
    error: null,
  };
};

export const shouldApplyMessagesLoadMore = (
  current: MessagesPageState,
  request: { filter: MessageFilter; cursor: string },
): boolean => current.filter === request.filter && current.nextCursor === request.cursor;

export const isMessagesPageStateForViewer = (
  stateOwnerUserId: number | null,
  effectiveUserId: number | null,
): boolean => stateOwnerUserId === effectiveUserId;

export const resolveMessagesPageDataRequests = ({
  isAuthenticated,
  listResult,
  summaryResult,
}: {
  isAuthenticated: boolean;
  listResult: PromiseSettledResult<MessageListDto>;
  summaryResult: PromiseSettledResult<MessageSummaryDto | null>;
}): { listPayload: MessageListDto; summaryPayload: MessageSummaryDto | null } => {
  if (listResult.status !== 'fulfilled') {
    throw listResult.reason;
  }

  if (!isAuthenticated || summaryResult.status !== 'fulfilled') {
    return {
      listPayload: listResult.value,
      summaryPayload: null,
    };
  }

  return {
    listPayload: listResult.value,
    summaryPayload: summaryResult.value,
  };
};

export const getMessagesPageEmptyStateCopy = (filter: MessageFilter, isAuthenticated: boolean): string => {
  if (!isAuthenticated) {
    return '暂无全站通知';
  }
  if (filter === 'unread') {
    return '没有未读消息';
  }
  if (filter === 'site') {
    return '暂无全站通知';
  }
  if (filter === 'direct') {
    return '暂无定向消息';
  }
  return '暂无消息';
};
