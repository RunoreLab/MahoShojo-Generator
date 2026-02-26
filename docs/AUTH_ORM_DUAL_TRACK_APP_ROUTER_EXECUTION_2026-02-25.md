# Auth + ORM 双轨渐进重构执行方案（App Router 终态，2026-02-25）

> 决策确认日期：2026-02-25  
> 适用项目：`MahoShojo-Generator`（当前 Pages Router + Edge API，目标 App Router + Better Auth 原生 + Drizzle）  
> 关联文档：`docs/BETTER_AUTH_DRIZZLE_IMPLEMENTATION_PLAYBOOK_2026-02-25.md`

## 1. 结论（本次正式决策）

在“无需抢修止血、优先长期稳定与架构质量”的前提下，本项目采用以下路线：

1. 终态直接对齐官方推荐：**App Router + Better Auth 原生实现 + Drizzle ORM**。  
2. 迁移方式采用**双轨并行**：`pages` 与 `app` 同仓共存，逐步切换，不做暴力全量重写。  
3. 用户与业务关系保持稳定：继续保留现有 `users.id (INTEGER)` 作为业务主键，通过 Auth 子域并行表映射实现兼容迁移。  

---

## 2. 目标架构（终态）

### 2.1 路由与鉴权

1. 认证主入口迁移到 `app/api/auth/[...all]/route.ts`。  
2. 所有受保护 API 最终统一走新鉴权中间层（Session Cookie 优先，legacy Bearer 在迁移窗口期兜底）。  
3. 旧 `pages/api/auth/*` 逐步下线，最终仅保留兼容跳转或删除。  

### 2.2 数据访问层

1. 新增 `lib/db/` 作为 Drizzle 基础设施目录。  
2. 结构分层为：
   - `schema`：表定义（Auth 域与业务域明确分区）
   - `repositories`：仓储接口与实现
   - `migrations`：版本化 SQL 迁移
3. 新功能禁止直接 `queryFromD1`；旧功能按批次迁移。  

### 2.3 用户与 Auth 子域

推荐模型维持“并行域”：

1. 业务主资料继续在 `users`（INTEGER 主键）  
2. Better Auth 新增表使用前缀（如 `ba_user`、`ba_session`、`ba_account`、`ba_verification`）  
3. 新增 `user_auth_links`，关联 `ba_user.id (TEXT)` 与 `users.id (INTEGER)`  

---

## 3. 执行原则

1. **先建新房，再搬家具**：优先把新链路完整跑通，再迁移业务。  
2. **一次只迁一个闭环**：每次迁移必须满足“代码 + 测试 + 可回滚”三件套。  
3. **以运行稳定为第一约束**：任何阶段都允许回退到 legacy 鉴权。  
4. **避免大爆炸发布**：采用灰度开关与可观测性验证。  

---

## 4. 分阶段实施（建议）

## 阶段 A1：App Router Auth 基建（当前优先）

目标：建立 App Router 认证主入口与统一鉴权新骨架。

1. 建立 `app/api/auth/[...all]/route.ts`（Better Auth 原生 handler）。  
2. 将 `register/login/verify/recover` 从 `pages/api/auth/*` 迁到 `app/api/auth/*`。  
3. 提供统一 `requireAuthUser`（先 Session，再 legacy Bearer）。  
4. 对前端保持 API 路径不变，避免 UI 侧联动成本。  

验收：

1. `npm run lint` 通过  
2. `npm run build` 通过  
3. 登录、验证、登出（或会话探测）行为与迁移前一致  

## 阶段 A2：Drizzle 基建与迁移机制

目标：建立可持续演进的数据库访问层。

1. 新建 `lib/db/drizzle.ts`、`lib/db/schema/*`、`lib/db/repositories/*`。  
2. 新增 `drizzle.config.ts` 与迁移目录。  
3. 先落 Auth 子域表 + `user_auth_links`。  
4. 确立迁移执行策略（本地/远端、回滚、审计）。  

验收：

1. Drizzle schema 可生成迁移  
2. 迁移可在测试环境重复执行  
3. Auth 子域表结构与代码定义一致  

## 阶段 B：受保护业务 API 批次迁移

按风险与价值迁移：

1. 批次 1：`data-cards*`、`decks*`、`favorites*`  
2. 批次 2：`badges/*`、`redeem-code`、`user-capacity`  
3. 批次 3：`arena/generate*`、`generate-battle-story`  

每批要求：

1. 鉴权统一接入  
2. 仓储层替代散落 SQL（新增逻辑必须 Drizzle）  
3. 行为回归测试通过  

## 阶段 C：前端会话化与 legacy 下线

1. `useAuth` 底层切换为服务端会话探测。  
2. 移除 `localStorage` 中主凭证持久化。  
3. legacy `auth_key` 改为迁移兜底，最终下线。  

---

## 5. 风险与回滚

### 5.1 主要风险

1. App Router 与 Pages Router 路由冲突  
2. Better Auth 与当前部署链路（Cloudflare + Edge）运行时差异  
3. 迁移窗口期双链路行为不一致（401/403、封禁、会话过期）  

### 5.2 回滚策略

1. 保留 legacy 鉴权开关至少 1~2 个版本。  
2. 新接口灰度失败时，切回 legacy 入口。  
3. 所有迁移脚本具备“可重放 + 可追溯 + 可回退说明”。  

---

## 6. 可观测与验收指标

1. 认证相关接口 401/403 比例稳定，无异常陡增  
2. 登录成功率、会话有效率、重试率满足既有基线  
3. 关键路径延迟无明显回退  
4. 路由迁移后权限行为与历史一致（尤其封禁与越权）  

---

## 7. 当前执行状态（2026-02-25）

已完成：

1. 新增 `app/api/auth/[...all]/route.ts`，并接入 Better Auth 原生 `toNextJsHandler` 入口。  
2. 旧 `pages/api/auth/*` 已迁移到 `app/api/auth/*`（`register/login/recover/verify`），避免路由冲突。  
3. `app/api/auth/verify` 已实现“Session 优先、legacy Bearer 兜底”鉴权链路。  
4. 前端登录态探测改为“请求 `/api/auth/verify` + Cookie 优先、legacy Header 兜底”。  
5. 新增 Drizzle 基建骨架：`lib/db/schema/*`、`lib/db/drizzle.ts`、`lib/db/repositories/*`、`drizzle.config.ts`。  
6. 新增 Auth 子域初始化迁移草案：`drizzle/0000_auth_domain_bootstrap.sql`。  
7. Better Auth 已改为 `drizzleAdapter` 挂载，Auth 子域显式映射到 `ba_user/ba_session/ba_account/ba_verification`。  
8. 新增 Cloudflare Request Context 下的 D1 绑定解析与运行时 Drizzle 获取能力（`lib/db/drizzle.ts`）。  
9. 新增 `user_auth_links` 自动建链闭环：Better Auth `databaseHooks.user.create.after` 会自动建立 `ba_user -> users` 映射，必要时创建业务用户（含 legacy `auth_key`）。  
10. `lib/auth/server-app.ts` 已升级为“映射表优先 + 自愈补链 + legacy 查询兜底”解析路径。  
11. `app/api/auth/[...all]` 增加 D1 绑定可用性检查，缺失时返回 `BETTER_AUTH_DB_UNAVAILABLE`（503），便于定位部署配置问题。  
12. 本轮改造已通过 `bun run lint` 与 `bun run build`。  
13. `app/api/auth/login`、`app/api/auth/register` 已接入 Better Auth 原生 `sign-in/sign-up` 桥接（保留 Turnstile 校验与 legacy 密钥兜底）。  
14. 前端认证交互已升级为“密码登录（Better Auth）/旧密钥登录（legacy）”双模式，并保留 legacy 兼容展示层（`AuthModal` + `useAuth` + `lib/auth.ts`）。  
15. 新增 `scripts/backfill-user-auth-links.ts`，按“email 优先、username 兜底”规则回填 `user_auth_links`，支持 dry-run/断点续跑。  
16. 已完成首批受保护 Pages API 统一鉴权迁移：`decks`、`deck-cards`、`deck-favorites`、`favorites`、`public-decks`、`user-capacity`、`redeem-code`、`badges/user`、`badges/equip`、`data-cards`、`data-card-recycle`、`data-card-tags`、`data-card-meta`、`data-card-meta-batch`、`arena/strict-preflight` 全部改为复用 `lib/auth/server` 的统一鉴权入口。  
17. 增补回填脚本命令：`package.json` 新增 `backfill:user-auth-links:dry` / `backfill:user-auth-links:write`，便于测试库演练与生产执行。  
18. 已完成第二批大型生成接口统一鉴权改造：`pages/api/arena/generate.ts`、`pages/api/arena/generate-stream.ts`、`pages/api/generate-battle-story.ts` 改为复用 `createRequestAuthUserResolver`（请求级缓存，统一走“`/api/auth/verify` 会话链路 + legacy Bearer 兜底”）并消除三处以上重复手写 Bearer 解析片段。  
19. `lib/auth/server-app.ts` 新增 `getAuthUserForApp`，用于复用 App Router 统一鉴权链路（`requireAuthUserForApp` 改为在其基础上做封禁判定）。  
20. 本轮改造已在当前仓库通过 `bun run lint`、`bun run build` 与 `bun test`。  
21. 补齐 Better Auth 登录/注册兼容闭环：当业务用户 `users.auth_key` 为空时，登录/注册桥接会自动补写兼容密钥并返回，避免“密码登录成功但 legacy 兼容链路断裂”的灰度期故障（`app/api/auth/login`、`app/api/auth/register`、`lib/auth/user-auth-linking.ts`、`lib/db/repositories/business-users.ts`）。  
22. 已完成高频受保护接口 ORM 化（首轮）：`pages/api/data-card-meta.ts` 与 `pages/api/data-card-meta-batch.ts` 改为优先走 `lib/db/repositories/data-card-meta.ts`（Drizzle），并补齐 `data_cards / data_card_metrics / arena_ratings` 业务域 schema 映射。  
23. `app/api/auth/recover` 已从“重置并回发 legacy key”升级为“一次性重置令牌”流程：新增 `auth_password_reset_tokens`（`drizzle/0002_auth_password_reset_tokens.sql`）、`app/api/auth/recover/reset` 消费接口与 `pages/password-recovery.tsx` 二段式重置 UI。  
24. 已完成第二轮受保护接口 ORM 化：`pages/api/me/profile-card.ts` 与 `pages/api/arena/strict-preflight.ts` 已移除接口内全部 `queryFromD1` 直连，改为走 `lib/db/repositories/*`（新增 `arena-strict-preflight` 仓储，并补齐 `arena_rating_events` schema 映射）。  
25. 已完成 `pages/api/data-cards.ts` 余留直连 SQL 清理：`getDataCardUpdatedAt` 与“更新 data 字段”改为走 Drizzle 仓储（新增 `data-cards-write` 仓储）。  
26. 已完成剩余公开排行与统计接口 ORM 化：`pages/api/arena/leaderboard.ts`、`pages/api/arena/leaderboard/search.ts`、`pages/api/arena/generation-ranking.ts`、`pages/api/arena/entity-rating.ts`、`pages/api/arena/preset-meta.ts`、`pages/api/get-stats.ts` 均移除接口内 `queryFromD1` 直连。  
27. 新增 `lib/db/repositories/arena-read.ts`，统一承载公开榜单、搜索、局内排位事件读取与统计聚合查询；并补齐 `lib/db/schema/business.ts` 的 `data_card_tags / characters / battles` 与 `arena_rating_events` 字段映射。  
28. 当前 `pages/api` 中直接 `queryFromD1` 调用点已从 `17` 处下降至 `0` 处。  
29. 修复用户资料相关“假成功”问题：`lib/database/users.ts` 的 `updateUserSignature`、`updateUserAvatarWebpBase64`、`increaseUserSlotCount` 现已按实际受影响行数返回结果，避免 0 行更新仍返回成功。  
30. 补充 Auth 基础单测：新增 `tests/auth-recovery-and-cookie.test.ts`，覆盖恢复令牌格式/哈希稳定性与 Better Auth 会话 Cookie 识别。  

受限项（当前本地环境）：

1. `backfill:user-auth-links:dry` / `backfill:user-auth-links:write` 在当前环境仍无法执行：`bun` 已可用，但缺少 `CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID`。  
2. 密码登录/注册与 legacy 密钥并行联调未能在本地完成：当前环境同时缺少可用的 D1 访问凭据与 Turnstile 可用配置。  

待继续：

1. 在测试库补齐凭据后执行 `backfill:user-auth-links:dry` → `backfill:user-auth-links:write`，并沉淀真实冲突样例（`skip-ambiguous-email`、`skip-ambiguous-username`、`skip-business-already-linked`）。  
2. 完成端到端联调：密码登录/注册（Cookie 会话）与 legacy 密钥路径并行验证，并补录请求/响应样例。  
3. 对齐部署侧 D1 Binding 与 migration 执行规范（`wrangler` 配置、local/remote 流程）。  
4. 继续推进业务域深层 SQL 迁移（`lib/database/*`、`lib/review/*`、`lib/arena/*` 等模块）到 Drizzle 仓储，降低后续 App Router 切换与测试成本。  
