import { z } from 'zod';

/**
 * 消息中心的产品级 wire 契约（`/api/messages*`）。
 *
 * 这是「服务端 DTO」而不是某一端私有类型：Web `lib/messages/service.ts` 是
 * producer，`apps/web` 页面与 Desktop 的消息窄通道（`cloud_messages_request`
 * 的响应正文）都是 consumer。三端共读同一 schema——任何一侧增删字段，另一端
 * 的 strict 校验会立刻报错而不是静默漂移。
 *
 * Desktop 侧消费语义：native 透传「HTTP 状态 + JSON 正文」，renderer 适配层
 * 按本 schema 校验后使用；校验失败按契约/传输错误处理，不冒充业务失败。
 */

export const MessageScopeSchema = z.enum(['site', 'user']);
export type MessageScope = z.infer<typeof MessageScopeSchema>;

export const MessageFilterSchema = z.enum(['all', 'unread', 'site', 'direct']);
export type MessageFilter = z.infer<typeof MessageFilterSchema>;

export const MessagePrioritySchema = z.enum(['low', 'normal', 'high']);
export type MessagePriority = z.infer<typeof MessagePrioritySchema>;

/** 服务端游标分页的排序键（`createdAt`/`scope`/`numericId` 三元序）。 */
export const MessageSortKeySchema = z
  .object({
    createdAt: z.string(),
    scope: MessageScopeSchema,
    numericId: z.number(),
  })
  .strict();
export type MessageSortKey = z.infer<typeof MessageSortKeySchema>;

/**
 * 列表/摘要共用的消息条目投影。
 * - `id`：`site:<n>` / `user:<n>` 前缀分源；`mark read` 只受理 `user:*`；
 * - `isRead`：site 消息未登录时无法判定已读，回 `null`；登录后为布尔值。
 */
export const MessagePreviewSchema = MessageSortKeySchema.extend({
  id: z.string(),
  messageType: z.string(),
  templateKey: z.string(),
  title: z.string(),
  body: z.string(),
  actionUrl: z.string().nullable(),
  priority: MessagePrioritySchema,
  isRead: z.boolean().nullable(),
  readAt: z.string().nullable(),
}).strict();
export type MessagePreviewDto = z.infer<typeof MessagePreviewSchema>;

/** `GET /api/messages/summary` 的响应（未登录时 isAuthenticated=false、计数为 0）。 */
export const MessageSummarySchema = z
  .object({
    unreadTotal: z.number(),
    siteUnread: z.number(),
    directUnread: z.number(),
    latest: MessagePreviewSchema.nullable(),
    fetchedAt: z.string(),
    isAuthenticated: z.boolean(),
    hasCrowdReviewPending: z.boolean(),
    crowdReviewPrompt: z
      .object({
        title: z.string(),
        body: z.string(),
        actionUrl: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type MessageSummaryDto = z.infer<typeof MessageSummarySchema>;

/** `GET /api/messages` 的响应；`appliedFilter` 反映服务端实际套用的筛选。 */
export const MessageListSchema = z
  .object({
    messages: z.array(MessagePreviewSchema),
    nextCursor: z.string().nullable(),
    filter: MessageFilterSchema,
    appliedFilter: MessageFilterSchema,
    fetchedAt: z.string(),
    isAuthenticated: z.boolean(),
  })
  .strict();
export type MessageListDto = z.infer<typeof MessageListSchema>;

/** `POST /api/messages/read` 的请求体：定向消息按 id 标记已读。 */
export const MessageMarkReadRequestSchema = z
  .object({
    ids: z.array(z.string()),
  })
  .strict();
export type MessageMarkReadRequest = z.infer<typeof MessageMarkReadRequestSchema>;

/** `POST /api/messages/read` 的响应。 */
export const MessageMarkReadResultSchema = z
  .object({
    markedCount: z.number(),
    ignoredCount: z.number(),
  })
  .strict();
export type MessageMarkReadResult = z.infer<typeof MessageMarkReadResultSchema>;

/** `POST /api/messages/read-all` 的响应。 */
export const MessageMarkAllReadResultSchema = z
  .object({
    markedUserMessageCount: z.number(),
    advancedSiteCursorTo: z.number(),
  })
  .strict();
export type MessageMarkAllReadResult = z.infer<typeof MessageMarkAllReadResultSchema>;
