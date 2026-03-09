# Better Auth + Drizzle 落地实施手册（v2，2026-02-25）

> 配套阅读：`docs/AUTH_DB_ISOLATION_DRIZZLE_RESEARCH_2026-02-25.md`  
> 决策更新：`docs/AUTH_ORM_DUAL_TRACK_APP_ROUTER_EXECUTION_2026-02-25.md`（App Router 终态 + 双轨渐进迁移）  
> 目标：把“建议”细化为可执行工程步骤，适配当前仓库（Next.js Pages Router + Edge Runtime + Cloudflare D1）。

## 1. 范围与决策

本手册只处理三件事：

1. 认证主链路从 `auth_key + localStorage + Bearer` 迁移到 `Better Auth + HttpOnly Cookie Session`。  
2. 数据访问层引入 Drizzle 并建立可持续迁移机制。  
3. 兼容旧用户，避免一次性中断。

已确定决策：

- 主方案：**Better Auth + Drizzle**。  
- 会话：**HttpOnly Cookie（主）**，JWT 仅在必要场景开启（例如服务间短期凭证）。  
- 数据库隔离：先逻辑隔离，不立刻物理拆库。

---

## 2. 关于 `opennext-cloudflare-starter-template` 的复查结论（已更新）

你提示已重新 clone 后，我对同级项目做了二次核验，结论如下：

1. 模板可用，包含完整的 Better Auth + Drizzle + D1 Binding 代码。  
2. 该模板基于 **Next.js App Router + OpenNext Cloudflare**，与你当前仓库的 **Pages Router + next-on-pages** 在路由层存在差异。  
3. 结论：**可以作为“架构与实现模式”参考，但不能直接逐文件复制。**

已确认可复用的关键实践（对应文件）：

1. Better Auth 主配置：`~/code/opennext-cloudflare-starter-template/src/server/auth/auth.ts`  
2. App Router auth 聚合路由：`~/code/opennext-cloudflare-starter-template/src/app/api/auth/[...all]/route.ts`  
3. Better Auth Drizzle 表结构：`~/code/opennext-cloudflare-starter-template/src/server/db/schema/auth.ts`  
4. D1 Binding + Drizzle 连接：`~/code/opennext-cloudflare-starter-template/src/server/db/index.ts`  
5. Wrangler D1 migrations_dir 绑定：`~/code/opennext-cloudflare-starter-template/wrangler.jsonc`  
6. Drizzle migration 执行脚本：`~/code/opennext-cloudflare-starter-template/scripts/db-migrate.js`  
7. Better Auth Secret 生成脚本：`~/code/opennext-cloudflare-starter-template/scripts/generate-better-auth-key.js`

---

## 3. 当前仓库的约束（必须先承认）

1. 路由体系是 `pages/api/*`，不是 App Router route handler。  
2. 大量接口仍手写 Bearer 解析，统计到 19 个核心路由。  
3. `users` 相关 schema 与代码存在漂移（如 `is_admin`、`is_review_exempt` 依赖痕迹）。  
4. 现有业务表广泛依赖 `users.id (INTEGER)` 外键，不适合粗暴重建用户主表。

---

## 4. 数据模型设计：推荐“Auth 子域并行”

## 方案 A（推荐）：Auth 子域并行，不动现有 `users.id`

核心思路：

1. 保留现有业务主表 `users`（整数 ID，给业务表继续引用）。  
2. 新增 Better Auth 核心表，命名建议加前缀（如 `ba_user`、`ba_session`、`ba_account`、`ba_verification`）。  
3. 新增映射表 `user_auth_links`：把 `ba_user.id (TEXT)` 映射到 `users.id (INTEGER)`。

优点：

1. 减少对既有业务表外键冲击。  
2. 兼容迁移可分批推进。  
3. 回滚成本低。

缺点：

1. 需要一次映射查询。  
2. 需要定义“谁是显示主资料源”（建议仍以 `users` 为主）。

## 方案 B（不推荐）：直接把 Better Auth user 并入现有 users

问题：

1. ID 类型、字段语义、历史数据差异大。  
2. 会牵引大量业务 SQL 和外键迁移。  
3. 一旦中途失败，回滚复杂。

---

## 5. 会话与 Cookie 策略（生产默认）

1. `HttpOnly = true`  
2. `Secure = true`（生产）  
3. `SameSite = Lax`（默认）；仅跨站场景再评估 `None`  
4. Session TTL：7~30 天（按产品策略定）  
5. Refresh/Rotation：交给 Better Auth session 机制  
6. 浏览器端不再保存主凭证到 `localStorage`

补充：

- 若后续启用 JWT 插件，仅发短期 token（建议 5~15 分钟）并通过服务端签发，不进入本地持久化存储。

---

## 6. 路由落地（Pages Router 版本）

## 6.1 新增 Better Auth 聚合入口

建议新增：

- `pages/api/auth/[...all].ts`

模板在 App Router 中采用 `toNextJsHandler(auth)`（见 `src/app/api/auth/[...all]/route.ts`）。  
当前仓库是 Pages Router，因此要做“等价适配层”，并关闭 bodyParser（仅示意）：

```ts
// pseudocode
export const config = { api: { bodyParser: false } };

const handler = createBetterAuthPagesHandler(auth); // 伪函数：封装 Better Auth 到 NextApiHandler
export default async function route(req, res) {
  return handler(req, res);
}
```

## 6.2 旧接口兼容策略

对以下旧接口先保留，改为“桥接层”：

1. `pages/api/auth/register.ts`
2. `pages/api/auth/login.ts`
3. `pages/api/auth/verify.ts`
4. `pages/api/auth/recover.ts`

桥接行为建议：

1. `register/login` 内部调用 Better Auth 能力创建/验证会话。  
2. 响应格式尽量保持现有前端可用（迁移窗口期）。  
3. `recover` 从“回发原密钥”改成“发一次性重置链接/验证码”。

---

## 7. 鉴权迁移批次（按风险优先级）

当前手写 Bearer 路由（19 个）：

1. `pages/api/arena/generate-stream.ts`
2. `pages/api/arena/generate.ts`
3. `pages/api/arena/strict-preflight.ts`
4. `pages/api/auth/verify.ts`
5. `pages/api/badges/equip.ts`
6. `pages/api/badges/user.ts`
7. `pages/api/data-card-meta-batch.ts`
8. `pages/api/data-card-meta.ts`
9. `pages/api/data-card-recycle.ts`
10. `pages/api/data-card-tags.ts`
11. `pages/api/data-cards.ts`
12. `pages/api/deck-cards.ts`
13. `pages/api/deck-favorites.ts`
14. `pages/api/decks.ts`
15. `pages/api/favorites.ts`
16. `pages/api/generate-battle-story.ts`
17. `pages/api/public-decks.ts`
18. `pages/api/redeem-code.ts`
19. `pages/api/user-capacity.ts`

迁移批次建议：

1. 批次 1（账户与核心资产）：`auth/*`、`data-cards*`、`decks*`、`favorites*`  
2. 批次 2（权益与容量）：`badges/*`、`redeem-code`、`user-capacity`  
3. 批次 3（生成类重接口）：`arena/generate*`、`generate-battle-story`

统一改造目标：

1. 全部改走统一 `requireAuthUser`（新版本应先尝试 Cookie Session，再兼容 legacy Bearer）。  
2. 统一封禁与状态校验逻辑。  
3. 统一审计与 traceId 输出格式。

---

## 8. Drizzle 迁移策略

## 8.1 目录建议

新增目录：

1. `lib/db/drizzle.ts`（连接与 client）  
2. `lib/db/schema/auth.ts`（Better Auth 相关表）  
3. `lib/db/schema/business.ts`（逐步承接现有业务表）  
4. `lib/db/repositories/*`（仓储层）

补充（来自参考模板的可复用点）：

1. D1 连接优先走 Binding（不是 REST Token）：`drizzle(env.DB, { schema })`  
2. 在开发模式通过 OpenNext 注入 Cloudflare context（模板用 `getCloudflareContext()`）。  
3. Schema 由 `drizzle.config.ts` 指向统一入口，再生成到 `drizzle/` 目录。

## 8.2 迁移机制

建议采用：

1. 开发：Drizzle migration 生成 SQL。  
2. 部署：通过 Wrangler D1 migrations 执行。  
3. 原则：数据库结构变更必须先落 migration，再上业务代码。

补充建议（参考模板脚本实践）：

1. 保留 `scripts/db-migrate.js` 这种“读取 wrangler 配置并自动选 local/remote”的脚本层，降低误操作。  
2. 将 `migrations_dir` 固定为同一目录，避免多人协作时 migration 漂移。

## 8.3 SQL 直连管控

1. 新增 ESLint/约定：新代码禁止直接 `queryFromD1`。  
2. 旧代码允许渐进迁移，但新功能必须走 Drizzle/Repository。

---

## 9. 与前端对接（不一次性重写）

## 9.1 短期（兼容期）

1. 保留 `lib/auth.ts` 接口形状，内部逐步转为“会话探测 + 服务端登录态”。  
2. `useAuth` 保持调用方式，底层从 `authKey` 驱动过渡到 cookie 会话驱动。  
3. `AuthModal` 文案从“登录密钥”逐步迁移为“密码/邮箱”。

补充（参考模板客户端用法）：

1. 模板通过 `createAuthClient` 暴露 `signIn/signUp/useSession`，可作为你们后续 `useAuth` 的重构目标形态。  
2. 会话读取应以服务端 `getSession` 为准，前端只做状态展示与交互。

## 9.2 中期（切换期）

1. 移除 `localStorage` 中主凭证。  
2. 登录后仅依赖后端会话。  
3. 前端仅缓存非敏感用户资料（用户名、徽章等）。

---

## 10. 测试与验收

最低测试集（建议优先补齐）：

1. 注册成功/重复注册/未过验证码。  
2. 登录成功/失败/封禁用户。  
3. 会话过期/登出/多端会话失效。  
4. 重置密码令牌单次消费与过期。  
5. 19 个历史手写 Bearer 路由在迁移后权限行为一致。

发布验收门槛：

1. `bun run lint` 通过  
2. `bun test` 通过  
3. `bun run build` 通过  
4. 线上灰度期关键鉴权接口 401/403 比例稳定

---

## 11. 回滚预案

1. 保留 legacy `auth_key` 校验路径（开关控制）。  
2. 新旧鉴权并行期至少 1~2 个版本。  
3. 一旦出现大规模登录异常：  
   1. 关闭新会话入口开关  
   2. 回退到 legacy 校验  
   3. 保留审计日志用于故障复盘

---

## 12. 两周可执行任务清单（建议）

第 1 周：

1. 新建 Better Auth 基础接入与 auth 路由。  
2. 改造 `recover` 为一次性重置令牌流程。  
3. 建立 `requireAuthUser` 新版（Cookie 优先 + Bearer 兼容）。  
4. 完成批次 1 路由迁移。

第 2 周：

1. 完成批次 2/3 路由迁移。  
2. 前端 `useAuth` 切 Cookie 会话。  
3. 清理 schema 漂移并补 migration。  
4. 补齐鉴权回归测试与灰度监控面板。

---

## 13. 参考资料（官方）

1. Better Auth Next.js 集成：  
https://www.better-auth.com/docs/integrations/next
2. Better Auth Session 概念：  
https://www.better-auth.com/docs/concepts/session-management
3. Better Auth Cookies 概念：  
https://www.better-auth.com/docs/concepts/cookies
4. Better Auth JWT 插件：  
https://www.better-auth.com/docs/plugins/jwt
5. Drizzle Cloudflare D1：  
https://orm.drizzle.team/docs/connect-cloudflare-d1
6. Cloudflare Workers Bindings：  
https://developers.cloudflare.com/workers/runtime-apis/bindings/
7. Cloudflare D1 Migrations：  
https://developers.cloudflare.com/d1/reference/migrations/
