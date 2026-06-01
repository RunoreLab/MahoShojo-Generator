# Auth + ORM 生产上线操作指南（`feature/Auth+ORM` → `feature/v0.2.0_Battle_Growth_MahoShojo`）

## 1. 目标与范围
- 目标：将 Auth + ORM 改造正式合入生产分支，并完成生产 D1 迁移。
- 目标分支：`feature/v0.2.0_Battle_Growth_MahoShojo`
- 来源分支：`feature/Auth+ORM`
- 涉及内容：
  - Better Auth 路由与桥接（`app/api/auth/*`）
  - Drizzle 运行时与仓储层（`lib/db/*`、`lib/database/*`）
  - D1 迁移脚本与迁移文件（`scripts/d1-migrate-safe.mjs`、`drizzle/*.sql`）

---

## 2. 当前基线确认（核对日期：2026-02-27）

### 2.1 代码与分支状态
- 当前工作分支：`feature/Auth+ORM`
- 工作区：干净（无未提交改动）
- 分支差异：`feature/Auth+ORM` 相对 `feature/v0.2.0_Battle_Growth_MahoShojo` 为 `0 <- 36`（目标分支不领先，Auth+ORM 领先 36 个提交）
- 本地质量校验：
  - 当前命令口径：`pnpm lint`
  - 当前命令口径：`pnpm test`
  - 当前命令口径：`pnpm build`

### 2.2 配置状态（`.env` 与 `wrangler.toml`）
- `wrangler.toml` 已配置 `env.production.d1_databases`，且 `check:wrangler:d1` 通过。
- `.env` 已配置生产 D1 访问所需凭据项（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`D1_DATABASE_ID`）。
- `.env` 中 `D1_DATABASE_ID` 与 `wrangler.toml` 的 production `database_id` 一致。
- `.env` 当前**缺少** Better Auth 关键变量：
  - `BETTER_AUTH_SECRET`
  - `BETTER_AUTH_URL`
  - `BETTER_AUTH_TRUSTED_ORIGINS`

> 说明：未配置上述变量时，密码登录/注册会走降级提示（要求改用 legacy key）；若计划上线即启用 Better Auth，会前需在 Cloudflare 生产环境变量中补齐。

### 2.3 生产 D1 现状（只读核对）
- `d1_migrations` 当前仅 1 条：`0001_create_comments_table.sql`
- 待应用迁移（4 条）：
  - `0000_auth_domain_bootstrap.sql`
  - `0001_users_admin_flags.sql`
  - `0002_auth_password_reset_tokens.sql`
  - `0003_auth_audit_logs.sql`
- Auth 关键表当前不存在（0/7）：
  - `ba_user`, `ba_session`, `ba_account`, `ba_verification`, `user_auth_links`, `auth_password_reset_tokens`
  - `auth_audit_logs`
- `users` 表关键列状态：
  - `is_review_exempt` 已存在
  - `is_admin` 缺失（将由 `0001_users_admin_flags.sql` 补齐）
- 业务基线：
  - `users.total = 3127`
  - `users_without_email = 14`
  - `duplicate_email_groups = 5`
  - `duplicate_username_groups = 11`

---

## 3. 上线前准备清单（必须完成）

### 3.0 Auth 环境变量配置指南（生产站示例：`https://mahoshojo.colanns.me/`）

> 适用场景：Cloudflare Pages 生产环境启用 Better Auth（密码注册/登录）。

#### 必填项（生产）

1. Better Auth 密钥：
   - `BETTER_AUTH_SECRET=<长度至少 32 的随机字符串>`
2. Better Auth 站点地址：
   - `BETTER_AUTH_URL=https://mahoshojo.colanns.me`
3. Better Auth 信任来源：
   - `BETTER_AUTH_TRUSTED_ORIGINS=https://mahoshojo.colanns.me`
   - 若生产同时使用 `www` 域名，请追加：`https://www.mahoshojo.colanns.me`
4. 人机验证（前后端）：
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY=<Turnstile Site Key>`
   - `TURNSTILE_SECRET_KEY=<Turnstile Secret Key>`

#### 推荐同时核对

1. D1 访问凭据：
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
   - `D1_DATABASE_ID`
2. 若使用邮件找回：
   - `RESEND_API_KEY`

#### Dashboard 配置步骤（建议）

1. 打开 Cloudflare Dashboard → Pages → 本项目。
2. 进入 `Settings -> Environment variables`。
3. 在 `Production` 环境逐项新增/更新上述变量，保存后触发一次重新部署。
4. 若 `Preview` 也要验证密码链路，同步在 `Preview` 环境设置一套对应值（`BETTER_AUTH_URL` 指向预发域名）。

#### 易错项（本次回归已命中）

1. `BETTER_AUTH_URL` 必须与实际访问域名一致且带 `https://`。
2. `BETTER_AUTH_TRUSTED_ORIGINS` 必须覆盖实际前端来源，否则会出现 Cookie/会话异常。
3. Turnstile 的 Site Key 与 Secret Key 必须同一套环境（生产/测试不可混用）。

#### 最小验收（生产域名）

1. `POST https://mahoshojo.colanns.me/api/auth/register` 不再返回 `BETTER_AUTH_MISCONFIGURED / BETTER_AUTH_DB_UNAVAILABLE`。
2. `POST https://mahoshojo.colanns.me/api/auth/login`（`mode=password`）可返回 `200` 并携带 `Set-Cookie: better-auth.session_token=...`。
3. 携带该 Cookie 调用 `POST https://mahoshojo.colanns.me/api/auth/verify` 返回 `200` 且包含 `user.id`。

---

1. 确认上线窗口与回滚负责人（代码 + 数据库双负责人）。
2. 在 Cloudflare 生产环境设置/复核以下 Better Auth 变量：
   - `BETTER_AUTH_SECRET=<长度足够的随机密钥>`
   - `BETTER_AUTH_URL=https://<生产域名>`
   - `BETTER_AUTH_TRUSTED_ORIGINS=https://<生产域名>[,https://<其他可信源>]`
3. 确认本地可执行远端 D1 只读命令。
4. 执行 D1 备份（强制）：

```bash
mkdir -p backups
XDG_CONFIG_HOME=.home/.config npx --yes wrangler d1 export DB \
  --remote \
  --env production \
  --env-file .env \
  --output "backups/prod-d1-before-auth-orm-$(date +%Y%m%d_%H%M%S).sql"
```

5. 执行迁移前基线快照（推荐保存日志）：

```bash
node scripts/d1-release-status.mjs --database DB --remote --env production --env-file .env | tee backups/prod-d1-status-before-auth-orm.log
```

---

## 4. 生产上线步骤（推荐顺序）

### 步骤 A：合并分支

```bash
git checkout feature/v0.2.0_Battle_Growth_MahoShojo
git pull origin feature/v0.2.0_Battle_Growth_MahoShojo
git merge --no-ff feature/Auth+ORM
```

如出现冲突，优先保留以下模块在 `feature/Auth+ORM` 的实现：
- `app/api/auth/*`
- `lib/auth/*`
- `lib/db/*`
- `drizzle/*`
- `scripts/d1-migrate-safe.mjs`
- `scripts/d1-release-status.mjs`

### 步骤 B：合并后本地质量门禁

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

### 步骤 C：部署代码
- 推送 `feature/v0.2.0_Battle_Growth_MahoShojo` 并触发生产部署流程。
- 确保部署使用最新 `wrangler.toml` 的 production D1 绑定配置。

### 步骤 D：执行生产 D1 迁移

先跑配置检查：

```bash
pnpm run check:wrangler:d1
```

再执行迁移（安全脚本，含 `0001` 兼容补列逻辑）：

```bash
node scripts/d1-migrate-safe.mjs --database DB --remote --env production --env-file .env
```

### 步骤 E：迁移后核验（必须通过）

```bash
node scripts/d1-release-status.mjs --database DB --remote --env production --env-file .env --require-ready
```

通过标准：
- 待应用迁移 = 0
- Auth 表覆盖 = 7/7
- users 关键列覆盖 = 2/2（包含 `is_admin`）

### 步骤 F：可选回填（仅当存在已创建的 Better Auth 用户但未映射）

先 dry-run：

```bash
pnpm run backfill:user-auth-links:dry
```

确认无异常后再写入：

```bash
pnpm run backfill:user-auth-links:write
```

---

## 5. 上线后冒烟检查

1. 账号体系：
   - 密码注册：`POST /api/auth/register`
   - 密码登录：`POST /api/auth/login`
   - 会话校验：`POST /api/auth/verify`
   - 找回与重置：`POST /api/auth/recover`、`POST /api/auth/recover/reset`
2. 兼容链路：
   - legacy key 登录仍可用（`mode=legacy`）。
3. 业务接口抽样：
   - 至少抽测 3 个读接口 + 3 个写接口（含 `pages/api/*` 老入口）确保 Drizzle 仓储迁移无回归。
4. 认证审计日志抽样（建议）：
   - 触发至少一次登录成功、一次登录失败、一次密码/邮箱修改后，执行以下查询确认审计写入：

```bash
XDG_CONFIG_HOME=.home/.config npx --yes wrangler d1 execute DB \
  --remote \
  --env production \
  --env-file .env \
  --command "SELECT event_type, result_code, COUNT(*) AS cnt FROM auth_audit_logs WHERE created_at >= CAST(strftime('%s','now') AS INTEGER) - 3600 GROUP BY event_type, result_code ORDER BY cnt DESC LIMIT 20;"
```

   - 预期：可看到 `login_success/login_failed/password_set/password_change/email_change/register_success/register_failed` 等事件样本。

---

## 6. 回滚预案

### 6.1 应用层快速回滚（首选）
- 将生产分支回退到合并前 commit 并重新部署应用。
- 数据库新增表/列通常向后兼容，应用回滚一般可先止血。

### 6.2 数据层回滚（仅在必须时）
1. 基于备份 SQL 恢复到新 D1 实例（避免在线覆盖误操作）：
   - `wrangler d1 create <new-db-name>`
   - `wrangler d1 execute <new-db-binding-or-name> --remote --file <backup.sql>`
2. 将生产绑定切换到恢复实例并重新部署。

> 不建议在原生产库直接手工 DROP 新表作为常规回滚手段，风险高且不可逆。

---

## 7. 附：本次新增核验脚本

- 脚本：`scripts/d1-release-status.mjs`
- 作用：
  - 对比本地迁移文件与远端 `d1_migrations`
  - 检查 Auth 关键表是否齐全
  - 检查 `users` 关键列是否齐全
  - 输出 `users` 基线统计（总量、空邮箱、重复邮箱/用户名组）
- 常用命令：

```bash
# 仅查看现状
node scripts/d1-release-status.mjs --database DB --remote --env production --env-file .env

# 严格校验“可上线完成态”（不通过时返回非 0）
node scripts/d1-release-status.mjs --database DB --remote --env production --env-file .env --require-ready
```
