# 用户系统正规化、数据库隔离与 Drizzle/认证方案研究（2026-02-25）

> 实施细化版请见：`docs/BETTER_AUTH_DRIZZLE_IMPLEMENTATION_PLAYBOOK_2026-02-25.md`

## 0. 结论先行

基于当前仓库实现，我的建议是：

1. **认证方向优先选 Better Auth + Drizzle**，并保留一段时间 `auth_key` 兼容层，做平滑迁移。  
2. **会话形态建议“服务端会话 + HttpOnly Cookie”为主**；JWT 仅作为短期/跨服务场景的补充，不建议作为前端长期主凭证。  
3. **数据库隔离建议先做“逻辑隔离 + 访问层隔离”**（同库分域、统一鉴权/仓储层），再评估是否做“物理隔离（拆库）”。  
4. **Drizzle 已定是正确方向**，但需要先收敛鉴权入口与 schema 漂移，再推进全量迁移，否则会把历史耦合原样搬进 ORM。

---

## 1. 审阅范围与方法

- 代码范围：`pages/api`、`lib/auth*`、`lib/pvp/server.ts`、`lib/database/*`、`lib/database/schema.sql`、`components/CharManager/AuthModal.tsx` 等。
- 审阅方式：静态代码审查 + 路由/调用点统计 + 官方文档交叉验证（Better Auth / Drizzle / Cloudflare / OWASP / MDN）。
- 注意：本结论不包含线上真实流量与攻击日志，仅基于仓库当前状态。

### 1.1 参考模板复查（2026-02-25 二次核验）

按你的要求，我对同级项目 `~/code/opennext-cloudflare-starter-template` 做了重新核验，确认可用并提炼到以下结论：

1. 模板确实落地了 Better Auth + Drizzle + D1 Binding：  
   - `src/server/auth/auth.ts`（`betterAuth` + `drizzleAdapter`）  
   - `src/server/db/index.ts`（`drizzle(env.DB)`）  
   - `src/server/db/schema/auth.ts`（`user/session/account/verification`）  
2. 模板的 auth 路由是 App Router 形态：  
   - `src/app/api/auth/[...all]/route.ts`（`toNextJsHandler(auth)`）  
3. 你当前项目仍是 Pages Router（`pages/api/*`），因此应做“等价迁移”，不能直接复制 route 文件。  
4. 该模板的迁移与运维实践可直接借鉴：  
   - `wrangler.jsonc` 的 D1 `migrations_dir` 管理  
   - `scripts/db-migrate.js` 的 local/remote 一键迁移  
   - `scripts/generate-better-auth-key.js` 的密钥生成流程

---

## 2. 当前仓库现状（与本次决策直接相关）

### 2.1 认证模型现状：`auth_key` 仍是长期静态凭证

- 注册直接生成并返回 `authKey`：`pages/api/auth/register.ts`
- 登录依赖 `username + authKey`：`pages/api/auth/login.ts`
- 校验依赖 `Authorization: Bearer <authKey>`：`pages/api/auth/verify.ts`、`lib/pvp/server.ts`
- 找回接口会把原 `auth_key` 发邮件：`pages/api/auth/recover.ts`

这意味着当前模型里，`auth_key` 实际承担了“密码 + access token”的双重角色，且生命周期过长。

### 2.2 凭证存储现状：前端 `localStorage` + 固定客户端密钥

- `auth_key` 在浏览器持久化：`lib/auth.ts`
- 采用客户端硬编码密钥加密：`lib/auth.ts` 中 `ENCRYPTION_KEY`

这类模式无法达到服务端会话隔离的安全边界，本质仍是“前端可读长期凭证”。

### 2.3 鉴权实现分布：统一入口与手写 Bearer 并存

统计结果（本仓库）：

- `pages/api` 路由总数：`101`
- 使用 `requireAuthUser` 的路由：`36`
- 手写 Bearer 解析路由：`19`

典型手写入口：`pages/api/data-cards.ts`、`pages/api/decks.ts`、`pages/api/favorites.ts` 等。  
统一入口：`lib/pvp/server.ts` 下 `requireAuthUser`（会处理封禁）。

风险在于策略一致性难保证（封禁、扩展字段、日志、审计）。

### 2.4 数据访问层现状：模块化已开始，但仍是 SQL 直连主导

- `lib/database/*` 已按领域拆分，是好基础。
- 但 `queryFromD1` 调用点很多（全仓库 `215` 处，`pages/api` 仍有 `23` 处直接调用）。
- 目前 D1 访问走 Cloudflare REST API Token：`lib/database/core.ts`（每次请求带 `Authorization: Bearer <CLOUDFLARE_API_TOKEN>`）。

这会带来：

- 运行时持有高权限账号级 Token（密钥面扩大）
- 访问链路更长（HTTP 调 D1 API），不如 Binding 直连简洁

### 2.5 schema 漂移：代码依赖字段与 `schema.sql` 不一致

- 代码使用 `is_admin`、`is_review_exempt`：`pages/api/data-cards.ts`
- `lib/database/schema.sql` 的 `users` 表未定义这些字段

这会导致环境间行为不一致，也是迁移 ORM 前必须清理的点。

### 2.6 用户名“正规化”相关现状

- `username`/`email` 目前无显式 normalized 列（仅原值唯一）。
- 数据卡把 `_author`、`_authorId` 写入 `data` JSON（`lib/database/data-cards.ts`），前端多处依赖 `_author` 回退显示。

这会导致后续“改名”与历史数据的一致性策略更复杂（展示名 vs 归属 ID）。

---

## 3. 你关心的三个核心问题，我的判断

### 3.1 用户系统“正规化”

建议目标：把“身份标识、认证凭据、会话状态、展示资料”拆开管理。

最低落地模型（可与 Better Auth/自建共用）：

- `users`：用户主实体（`id`, 展示信息, 状态）
- `user_identities`：`username_normalized`, `email_normalized`, 验证状态
- `user_credentials`：密码哈希/算法参数（或由 Better Auth 表承载）
- `user_sessions`：会话、过期、吊销、设备信息
- `auth_audit_logs`：登录/刷新/登出/重置关键审计

好处：后续改名、封禁、多登录方式、设备管理都不会再挤在 `users` 一张表上。

### 3.2 数据库隔离

建议分三层看，不要一上来拆物理库：

1. **访问隔离（立刻做）**  
- 统一鉴权入口（所有受保护 API 先收敛到一个 `requireAuthUser`）  
- API 不再直接散落 SQL，统一走 repository/service 层

2. **逻辑隔离（与 Drizzle 同步做）**  
- 认证域、业务域、审计域在 schema 与代码目录明确分区  
- 迁移脚本版本化，消除“线上手工补列”状态

3. **物理隔离（按规模/合规再决定）**  
- 当前大量表通过 `user_id` 外键依赖 `users`，立即拆库会增加跨库一致性成本  
- 建议先不拆；当合规或写压显著增加，再评估“auth 库独立 + 用户镜像表”

### 3.3 ORM（Drizzle）与 Auth 的关系

你们已确定 Drizzle，这非常关键：  
**Auth 方案应服从 Drizzle 与 Edge Runtime 约束，而不是反过来。**

可行组合：

- Better Auth + Drizzle adapter（SQLite/D1）
- 自建 Auth + Drizzle（全部逻辑自己实现）

从工程风险看，当前仓库更适合前者（减少安全细节自研面）。

---

## 4. JWT + HttpOnly Cookie：怎么用才合理

建议采用：

- **主会话**：HttpOnly + Secure + SameSite Cookie（服务端 session）
- **JWT**：仅在确有跨服务/边缘子请求场景时发短期 token（分钟级），并可快速轮换

不建议采用：

- 把长生命周期 JWT 当浏览器主登录态并长期存 `localStorage`

原因：你们是第一方 Web 应用，服务端可控；优先服务端会话更容易做吊销、设备管理与风控。

---

## 5. 自建轻量 Auth vs Better Auth（针对本仓库）

| 维度 | 自建轻量 Auth | Better Auth |
| --- | --- | --- |
| 接入成本 | 短期可快起步 | 中等，需要路由与表结构接入 |
| 安全细节负担 | 全部自担（会话轮换、吊销、重置流程、审计） | 框架内置会话/插件体系，细节负担较低 |
| 与 Drizzle 协同 | 可做，但要自建完整模型 | 官方有 Drizzle 适配 |
| 与 Cloudflare Workers/D1 | 可完全定制 | 官方支持 Workers 与 D1 |
| 迁移风险 | 逻辑可控但易遗漏边界 | 需要一次性理解框架模型 |
| 长期维护 | 团队持续背锅 | 社区方案，维护成本更稳 |

我的推荐：**Better Auth 优先，自建仅作为兜底方案**。  
兜底触发条件：POC 后确认与当前 Next Pages + Edge 部署存在不可接受冲突，再退回自建。

---

## 6. 推荐迁移路线（可直接排期）

### 阶段 A（1 周）：先止血，不等 ORM

1. 停止“回发原 auth_key”找回流程，改一次性重置 token。
2. 新增统一鉴权函数（支持未来 cookie session，兼容现有 Bearer）。
3. 把 19 个手写 Bearer 路由逐步收敛到统一鉴权入口。
4. `schema.sql` 补齐真实依赖列或移除陈旧依赖（先把漂移清零）。

### 阶段 B（1-2 周）：Drizzle 基建落地

1. 建立 Drizzle schema（先覆盖 users/auth/session 相关表）。
2. 迁移体系改为版本化（wrangler d1 migrations + drizzle 管理）。
3. 新代码禁止直接 `queryFromD1`；旧代码按模块渐进迁移。

### 阶段 C（1-2 周）：接入 Better Auth

1. 接入 Better Auth（email/password + session cookie）。
2. 保留 legacy `auth_key` 登录入口，但仅用于换取新 session（不再直接作为长期 Bearer）。
3. 前端改为 cookie 驱动，会话探测 API 返回用户信息，不再在 `localStorage` 保存主凭证。

### 阶段 D（1 周+）：下线 legacy

1. 观测迁移率，逐步禁用 `auth_key` 直连能力。
2. 清理前端/后端 legacy 逻辑与字段。
3. 补齐认证回归测试矩阵（注册、登录、刷新、登出、重置、封禁、越权）。

---

## 7. 本项目的关键实现建议（具体到你当前代码）

1. **统一鉴权接口先定形**
- 新增 `lib/auth/server.ts`：`requireAuthUser(req)` 返回统一用户上下文
- 兼容顺序建议：`BetterAuth Session Cookie -> Legacy Bearer auth_key`

2. **把账号与资料拆层**
- 资料继续放 `users`（不破坏大量 FK）
- 认证凭据/会话进入独立 auth 表域

3. **`_author` 策略先定义**
- `_authorId` 作为归属事实
- `_author` 改为展示快照，不参与权限判断
- 后续改名以 `users` 显示名为准，历史快照仅作兼容展示

4. **D1 访问建议从 REST Token 过渡到 Binding**
- 运行时优先 D1 Binding，减少高权限 Token 暴露面
- 管理/迁移脚本可保留 d1-http 或 wrangler CLI

---

## 8. 最终建议（决策版）

如果你希望在“安全、速度、维护成本”三者中取平衡，我建议：

1. **本轮决策确定：Better Auth + Drizzle + HttpOnly Cookie 会话主模式。**
2. **允许 JWT，但只用于短期衍生 token，不作为主登录态。**
3. **数据库先逻辑隔离，不立即拆物理库。**
4. **先做统一鉴权收敛与 schema 清理，再推进全量 ORM 迁移。**

这个顺序可以在不大面积中断业务的情况下，把当前认证风险快速降下来，同时为后续国产云迁移或更复杂权限体系留足空间。

---

## 9. 外部资料（官方文档）

以下内容已用于本报告结论（检索时间：2026-02-25）：

- Better Auth 安装与框架集成（含 Next.js / Cloudflare Workers）  
  https://www.better-auth.com/docs/installation
- Better Auth Session 管理（database session / stateless session / revocation 说明）  
  https://www.better-auth.com/docs/concepts/session-management
- Better Auth Cookie 配置（`httpOnly`、`secure`、`sameSite`）  
  https://www.better-auth.com/docs/concepts/cookies
- Better Auth Drizzle Adapter（SQLite 支持）  
  https://www.better-auth.com/docs/adapters/drizzle
- Drizzle ORM Cloudflare D1 指南（`drizzle-orm/d1`）  
  https://orm.drizzle.team/docs/connect-cloudflare-d1
- Drizzle d1-http 驱动（远程 HTTP 连接，常用于迁移/脚本）  
  https://orm.drizzle.team/docs/connect-drizzle-proxy
- Cloudflare Workers 绑定（Binding 通过 `env` 注入）  
  https://developers.cloudflare.com/workers/runtime-apis/bindings/
- Cloudflare D1 + Wrangler 迁移配置（`migrations_dir` / D1 绑定）  
  https://developers.cloudflare.com/d1/reference/migrations/
- OWASP Session Management Cheat Sheet（会话安全基线）  
  https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- MDN HttpOnly Cookie 说明  
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#restrict_access_to_cookies
