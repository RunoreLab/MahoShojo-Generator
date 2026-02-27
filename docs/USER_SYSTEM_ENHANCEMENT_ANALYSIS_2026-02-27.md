# 用户系统增强审阅与设计草案（2026-02-27）

## 1. 目标与范围

本次目标是在现有 Auth + ORM 改造基础上，评估并设计下一阶段用户系统增强能力，重点包括：

1. 用户资料增强：修改用户名（含冷却）、修改邮箱（需验证）。
2. 社交能力：关注用户，并在其发布/更新公开数据卡时获得提示。
3. 成长体系：用户等级与权限能力（如自动增加卡槽）。
4. 资格问答：通过问答授予发布公开内容等权限。

本文件先给出架构评估与方案设计，不直接改动业务逻辑。

---

## 2. 当前系统现状（与增强功能直接相关）

### 2.1 认证与用户主数据处于双轨兼容期

1. Better Auth 子域已落地：`ba_user` / `ba_session` / `ba_account` / `user_auth_links`。
2. 业务主用户表仍是 `users`，且大量业务逻辑依赖 `users.id`、`users.username`。
3. 登录链路仍兼容 legacy `auth_key`，前端仍保留 `Authorization: Bearer` 回退能力。

结论：增强功能必须优先以 `users` 为业务事实源，并与 Better Auth 维持一致。

### 2.2 账号设置 UI 已有入口但能力未实现

个人页设置区当前为“预留状态”，尚未提供改名/改邮箱等操作流程。

### 2.3 用户名在系统中同时存在“实时值”和“历史快照值”

1. 实时值：大量列表与查询依赖 `users.username`。
2. 快照值：
   - 数据卡 JSON 中存在 `_author/_authorId` 历史写入。
   - PVP 与战报有独立 `username/sender_username` 快照列。

结论：一旦支持改名，必须先定义“哪些场景跟随最新名、哪些场景保留历史名”。

### 2.4 权限系统已有雏形但仍分散

现有权限来源包括：

1. `users.is_admin`、`users.is_review_exempt`
2. 勋章（`badges` / `user_badges`）
3. 统计门槛（公开卡数量、收藏/使用等）
4. `slot_count`（卡槽）

结论：后续建议统一到“能力（capability）”层，避免条件散落在多个模块。

---

## 3. 关键影响面评估

## 3.1 修改用户名的影响

### 3.1.1 数据卡作者显示与筛选

1. 创建卡片时会写 `_author` 快照。
2. 公开列表/详情又会 join `users.username`。
3. 多处前端读取 `_author` 作为展示回退。

风险：改名后用户可能同时看到旧名与新名，作者筛选与展示不一致。

### 3.1.2 PVP 与战报历史记录

以下字段属于历史快照语义，不建议全量追溯更新：

1. `pvp_match_players.username`
2. `pvp_room_chat_messages.sender_username`
3. `battle_report_generations.username`

风险：若强制回写历史快照，成本高且可能破坏审计语义。

### 3.1.3 认证上下文与缓存

改名后，进行中的会话、前端缓存、活动 token 可能暂时持有旧用户名，需要统一刷新策略。

---

## 3.2 修改邮箱的影响

邮箱目前在两个域内均存在：

1. Better Auth：`ba_user.email`
2. 业务用户：`users.email`

风险：如果只改一处，会造成登录识别与业务展示分叉。

结论：邮箱改绑必须做“事务化双写 + 验证后生效”，并有回滚兜底。

---

## 3.3 关注与通知能力的影响

当前仓库无关注/通知基础表与 API，需从 0 建设：

1. 关系模型（谁关注谁）
2. 事件模型（什么时候触发消息）
3. 收件箱模型（未读、已读、聚合）

建议先做站内消息，不直接上外部推送。

---

## 3.4 等级/资格能力的影响

当前已有“条件判断能力”的可复用模块（徽章 + 公开卡统计 + beta 准入规则），可以抽象成统一 capability 体系，避免重复造轮子。

---

## 4. 功能候选与优先级建议

## P0（优先上线）

1. 资料增强：
   - 显示名修改（推荐先做）
   - 邮箱改绑（验证后生效）
   - 变更审计日志与冷却
2. 一致性治理：
   - 作者显示统一策略
   - 改名后的缓存刷新策略

## P1

1. 关注用户
2. 数据卡发布/更新通知（站内）

## P2

1. 用户等级与 capability 授予
2. 自动卡槽奖励策略

## P3

1. 资格问答（含重试规则、版本化题库）
2. 基于问答结果授予发布权限

---

## 5. 设计方案对比（改名语义）

## 方案 A：先做“显示名（displayName）可改”（推荐）

1. `username` 继续作为稳定账号名（登录/引用标识）。
2. 新增 `display_name` 用于 UI 展示。
3. 冷却限制作用在 `display_name` 上。

优点：

1. 对现有业务侵入最小。
2. 不破坏历史快照语义。
3. 可快速上线验证流程与风控。

缺点：

1. 不是“真正改账号名”。

## 方案 B：直接允许 `username` 变更

优点：

1. 用户感知一致（账号名即展示名）。

缺点：

1. 影响面极广（查询、筛选、快照、审计）。
2. 需要别名/历史名/冲突处理机制，研发与回归成本高。

建议：先 A 后 B。先稳定资料系统，再评估是否开放真实用户名迁移。

---

## 6. 数据模型建议（增量）

## 6.1 资料变更与验证

建议新增表：

1. `user_profile_change_logs`
   - `id`, `user_id`, `change_type`, `old_value`, `new_value`, `status`, `created_at`, `applied_at`
2. `user_email_change_requests`
   - `id`, `user_id`, `new_email`, `token_hash`, `expires_at`, `consumed_at`, `created_at`

建议新增字段（`users`）：

1. `display_name`
2. `display_name_changed_at`
3. `username_changed_at`（若后续启用真实改名）

## 6.2 关注与通知

建议新增表：

1. `user_follows`
   - `follower_user_id`, `followee_user_id`, `created_at`
   - 唯一键：`(follower_user_id, followee_user_id)`
2. `user_notifications`
   - `id`, `user_id`, `type`, `payload_json`, `is_read`, `created_at`, `read_at`
   - 索引：`(user_id, is_read, created_at desc)`

## 6.3 capability（权限能力）

建议新增表：

1. `user_capabilities`
   - `user_id`, `capability`, `source`, `expires_at`, `created_at`
2. `user_capability_grants_log`
   - `id`, `user_id`, `capability`, `action(grant/revoke)`, `reason`, `created_at`

示例 capability：

1. `publish.public`
2. `slot.auto_bonus`
3. `questionnaire.editor`

---

## 7. API 草案（Pages Router 兼容风格）

## 7.1 资料增强

1. `GET /api/me/profile/identity`
2. `PATCH /api/me/profile/display-name`
3. `POST /api/me/profile/email/change-request`
4. `POST /api/me/profile/email/confirm`

若后续启用真实改名：

1. `POST /api/me/profile/username/change-request`
2. `POST /api/me/profile/username/confirm`（可选）

## 7.2 关注与通知

1. `POST /api/users/[userId]/follow`
2. `DELETE /api/users/[userId]/follow`
3. `GET /api/me/follows`
4. `GET /api/me/notifications`
5. `POST /api/me/notifications/read`（批量）

## 7.3 capability 与资格

1. `GET /api/me/capabilities`
2. `POST /api/me/qualification/submit`
3. `GET /api/me/qualification/status`

---

## 8. 一致性策略（必须先定）

## 8.1 作者名显示策略

建议统一规则：

1. 业务归属一律用 `user_id` 判断。
2. 展示优先用实时资料（`display_name || username`）。
3. 快照字段（`_author` / `sender_username` / `battle_report username`）只用于历史回溯场景。

## 8.2 历史快照策略

1. PVP 聊天、对局参与者、战报：保留创建时快照，不追溯改写。
2. 公开卡详情页、排行榜、作者筛选：使用实时资料名。

---

## 9. 分阶段落地建议

## 阶段 A：基础能力与一致性（1~2 周）

1. 增加 profile 变更表与 API。
2. 上线 `display_name` 修改 + 冷却 + 审计。
3. 邮箱改绑（验证后生效）双写到 `ba_user` 与 `users`。
4. 统一作者展示来源（减少 `_author` 直接依赖）。

## 阶段 B：关注与站内通知（1~2 周）

1. 落地 `user_follows`、`user_notifications`。
2. 绑定数据卡公开发布/更新事件触发通知。
3. 个人页新增“关注更新”入口。

## 阶段 C：capability 与资格问答（2 周+）

1. capability 基础设施落地。
2. 等级/奖励策略配置化。
3. 资格问答授予发布权限。

---

## 10. 测试与风控清单

1. 并发改名冲突（唯一约束 + 冷却）。
2. 邮箱改绑 token 重放攻击（单次消费）。
3. 关注通知幂等与去重。
4. 改名后多端会话显示刷新一致性。
5. 历史快照不被误修改。
6. 关键 API 限流（改名/改邮箱/关注操作）。

---

## 11. 待确认决策（进入实现前）

1. 是否先采用“display_name 可改”而不是直接开放 `username` 修改？
2. 历史记录是否明确保持快照，不做追溯改写？
3. 关注通知首期仅做站内消息，是否接受？
4. capability 是否作为权限统一抽象层纳入本期？

---

## 12. 本文档输出物

1. 当前增强功能的影响面清单
2. 分阶段功能优先级建议
3. 可执行的数据模型与 API 草案
4. 进入开发前必须对齐的关键决策

