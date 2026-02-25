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
12. 本轮改造已通过 `npm run lint` 与 `npm run build`。  

待继续：

1. 前端登录/注册入口从 legacy `auth_key` 逐步切换到 Better Auth 原生 `sign-in/sign-up`（保留兼容窗口）。  
2. 批次迁移受保护业务 API（19 个 legacy Bearer 路由）到统一鉴权与仓储层。  
3. 完成 `user_auth_links` 回填脚本与灰度切流方案（覆盖存量用户）。  
4. 对齐部署侧 D1 Binding 与 migration 执行规范（`wrangler` 配置、local/remote 流程）。  
