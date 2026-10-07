/**
 * 消息中心的共源呈现层（D5.1d-1）。
 *
 * 内容自 `apps/web/components/messages/*` 上移，DOM/文案逐字保留；唯一差别是
 * 链接从 `next/link` 换成「真实 `<a href>` + 宿主回调」（与顶栏/百科同一
 * 契约）：Web 注入 router.push，Desktop 注入 hash-history navigate 与
 * `openContent` 外链确认。
 *
 * 边界：本区段只做展示与纯状态函数——取数（fetch / cloud_messages_request
 * 窄通道）、已读分发与账号真相全部留在宿主。
 */
export { MessageCard } from './MessageCard';
export { MessageFilters } from './MessageFilters';
export { CrowdReviewPromptCard } from './CrowdReviewPromptCard';
export { MessageActionLink } from './MessageActionLink';
export { MessagesPageView } from './MessagesPageView';
export {
  classifyMessageActionUrl,
  formatMessageTime,
  getMessagePriorityClassName,
  getMessagePriorityLabel,
  getMessageScopeLabel,
  type MessageActionTarget,
  type MessageLinkHandlers,
  type MessageNavigate,
} from './message-ui';
export {
  createMessagesPageState,
  getMessagesPageEmptyStateCopy,
  getMessagesPageRequestFilter,
  isMessagesPageStateForViewer,
  reconcileMessagesPageStateForAuth,
  resolveMessagesPageDataRequests,
  shouldApplyMessagesLoadMore,
  type MessagesPageState,
} from './messages-page-state';
