// 消息 DTO 的单一事实源在 `@mahoshojo/contracts/messages`：Web 服务端是
// producer，Web 页面与 Desktop 消息窄通道是 consumer，三端共读同一 schema。
// 这里只保留类型别名转发——字段增删改在 contracts 侧一次完成。
export type {
  MessageScope,
  MessageFilter,
  MessagePriority,
  MessageSortKey,
  MessagePreviewDto,
  MessageSummaryDto,
  MessageListDto,
} from '@mahoshojo/contracts/messages';
