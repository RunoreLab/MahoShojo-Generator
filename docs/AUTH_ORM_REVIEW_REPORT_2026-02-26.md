# Auth + ORM 分支审阅报告（feature/Auth+ORM）

> 审阅日期：2026-02-26
> 对比分支：`feature/Auth+ORM` vs `feature/v0.2.0_Battle_Growth_MahoShojo`
> 审阅范围：Auth 路由、统一鉴权、Drizzle 运行时与仓储层、迁移脚本、部署配置

## 一、结论摘要

本次 Auth + ORM 改造整体工程质量较高，核心命令 `lint/test/build` 在当前环境可通过（见“验证记录”），并且已形成较完整的仓储层替换。

我确认了 **2 个真实缺陷**，已在本分支直接修复：

1. `/api/auth/verify` 未透传权限字段，导致 Cookie 会话用户在受保护 API 中丢失 `is_admin / is_review_exempt` 能力。
2. 会话子请求未复用 Cloudflare Access 透传头，可能导致 Access 保护场景下会话鉴权失败。

同时仍有 **3 个高优先级风险/待办** 未在本轮直接改动（需要你确认策略后推进）：

1. App Router Auth 路由全部 `runtime = 'nodejs'`，与项目“Cloudflare Edge Runtime”规范存在潜在冲突（需用 Cloudflare 真实链路验证）。
2. `wrangler.toml` 仍是占位 D1 ID，未替换即部署会失败或返回 DB 不可用。
3. `drizzle/0001_users_admin_flags.sql` 为非幂等 `ALTER TABLE ADD COLUMN`，在“列已存在”的环境会直接失败。

---

## 二、已修复缺陷（本次已落地）

### [高] 会话用户权限字段丢失，造成管理员/审核豁免能力回退

- 影响：Cookie 会话登录后，`requireAuthUser` 链路中 `auth.user.is_admin`、`auth.user.is_review_exempt` 为空，导致如数据卡发布/审核相关路径行为退化。
- 根因：`/api/auth/verify` 返回的 `user` 仅包含 `id/username/prefix`。
- 修复：在 verify 响应中补齐 `is_banned/is_admin/is_review_exempt` 字段。
- 修改位置：
  - `app/api/auth/verify/route.ts:19`

### [中] 会话探测子请求未透传 Cloudflare Access 头

- 影响：当环境开启 Cloudflare Access 时，`/api/auth/verify` 子请求可能拿不到正确鉴权上下文，进而导致会话探测失败。
- 根因：鉴权子请求未复用已有的 `buildSubrequestAuthHeaders`。
- 修复：在两条会话探测路径中统一注入 Access/活动头透传。
- 修改位置：
  - `lib/auth/server.ts:131`
  - `lib/auth/request-auth-user.ts:90`

---

## 三、待处理风险与改进建议（未直接改动）

### [高] App Router Auth 路由运行时与项目规范存在冲突风险

- 现状：Auth 路由均显式声明 `runtime = 'nodejs'`。
- 证据：
  - `app/api/auth/[...all]/route.ts:4`
  - `app/api/auth/login/route.ts:16`
  - `app/api/auth/register/route.ts:20`
  - `app/api/auth/recover/route.ts:11`
  - `app/api/auth/recover/reset/route.ts:9`
  - `app/api/auth/verify/route.ts:4`
- 风险：在 Cloudflare 部署链路中可能出现运行时不兼容或行为差异（本地 Next 构建通过不等于 Cloudflare 产线可用）。
- 建议：在预发环境执行一次完整 Cloudflare Pages 验证（含登录/注册/verify/recover 全链路）。

### [高] `wrangler.toml` 仍为占位 D1 ID

- 证据：`wrangler.toml:10`, `wrangler.toml:11`, `wrangler.toml:22`, `wrangler.toml:23`, `wrangler.toml:34`, `wrangler.toml:35`
- 风险：未替换时会触发 DB 绑定不可用，Auth/ORM 路径直接不可用。
- 建议：分环境补齐真实 `database_id` 与 `preview_database_id`，并在 CI 里加入配置校验。

### [中] 迁移脚本 `0001` 非幂等

- 证据：`drizzle/0001_users_admin_flags.sql:4-5`
- 风险：若目标库已存在对应列，迁移会失败并中断后续流程。
- 建议：
  - 方案 A：迁移前做列存在检查脚本；
  - 方案 B：将该迁移改为“可重入”写法（按 D1/SQLite 实际能力处理）。

---

## 四、验证记录

### 已通过

1. `bun run lint`
2. `bun test`
3. `npm run build`

### 发现的环境现象（需记录）

1. `bun run build` 在当前机器出现过 `Next.js build worker ... SIGSEGV`（同一代码下 `npm run build` 可通过）。
2. `bun run build:cf` 在本地执行超时，且出现包管理器混用告警（`project is set up for npm but currently being run via bun`）。

> 结论：当前可确认业务代码层面没有阻断性编译/测试失败，但 Cloudflare 目标链路仍需一次专门的预发验证来闭环。

---

## 五、你问的“还有什么我可以做但还没做”

有，且优先级如下：

1. 补 E2E 回归（至少覆盖：密码注册/登录、legacy 登录、verify、recover 请求与 reset 消费、管理员/审核豁免行为）。
2. 完成 Cloudflare 预发链路验证（非本地 Next）。
3. 加一个“部署前硬校验”脚本：检查 `wrangler.toml` 是否仍有 `replace_with_*` 占位值。
4. 为 `drizzle/0001` 增加“已存在列”兼容策略，避免历史环境迁移中断。
5. 增加 Auth 统一鉴权链路单测：覆盖 `requireAuthUser` 在 session/bearer/ban/admin/exempt 场景下的返回一致性。

---

## 六、下一步执行建议（可直接排期）

1. 先做预发环境 Cloudflare 验证（优先级 P0）。
2. 并行补迁移幂等与配置校验（优先级 P1）。
3. 最后补自动化回归用例，作为合入生产分支前的门禁（优先级 P1）。
