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

---

## 七、补充执行记录（2026-02-26 晚）

已落地：

1. 新增 `scripts/check-wrangler-d1-config.mjs`，部署前硬校验 `wrangler.toml` 的 D1 配置，阻断占位值与非法 UUID。
2. 新增 `scripts/d1-migrate-safe.mjs`，替换默认迁移入口，对 `0001_users_admin_flags.sql` 增加“列存在兼容”策略，避免历史库重复迁移失败。
3. `package.json` 的 `build:cf` 与全部 `db:migrate:*` 已接入上述校验/安全迁移脚本。
4. 新增 `tests/auth-server.test.ts`，覆盖统一鉴权链路的 `session/bearer/ban/admin/exempt/unauthorized` 关键场景。
5. `app/api/auth/*` 六个 App Router 路由已从 `runtime='nodejs'` 调整为 `runtime='edge'`，`bun run build:cf` 已可通过。

仍需你在 Cloudflare 预发环境完成：

1. 基于预发域名执行真实链路回归：登录/注册/verify/recover/reset、管理员/审核豁免权限路径验证。

---

## 八、Auth + ORM 迁移穿行测试补充（2026-02-26）

### 8.1 数据来源与约束

1. 由于线上 D1 读取存在过载现象（`D1 DB is overloaded`, code `7429`），本轮改用本地旧版备份作为源数据：`/tmp/mahoshojo_20251231.db`
2. 目标库始终为测试 D1（`env.test`）。
3. 生产库未执行任何写操作；测试写入仅发生在测试 D1。

### 8.2 数据复制执行与结果（user_id <= 20 关联数据）

执行脚本（新增/改造）：

- `scripts/copy-prod-u20-data-to-test.mjs`

核心命令：

1. Dry-run：
   - `node scripts/copy-prod-u20-data-to-test.mjs --source-sqlite /tmp/mahoshojo_20251231.db --target-env env.test --max-user-id 20`
2. Apply：
   - `node scripts/copy-prod-u20-data-to-test.mjs --source-sqlite /tmp/mahoshojo_20251231.db --target-env env.test --max-user-id 20 --apply`

复制统计（22 张表，共 3667 行）：

1. `d1_migrations`: 1
2. `users`: 60
3. `badges`: 13
4. `data_cards`: 200
5. `data_card_updates`: 0
6. `decks`: 1
7. `deck_cards`: 16
8. `favorites`: 154
9. `deck_favorites`: 1
10. `battle_report_generations`: 710
11. `battle_report_generation_combatants`: 1741
12. `pvp_rooms`: 30
13. `pvp_matches`: 7
14. `pvp_rounds`: 43
15. `pvp_match_players`: 18
16. `pvp_room_players`: 42
17. `pvp_room_hands`: 34
18. `pvp_room_submissions`: 32
19. `pvp_room_chat_messages`: 19
20. `pvp_room_card_snapshots`: 295
21. `pvp_round_choices`: 84
22. `user_badges`: 166

已通过 `wrangler d1 execute` 在测试库逐表复核，上述 22 表行数与复制统计一致。

### 8.3 Auth + ORM 迁移穿行

执行命令：

- `HOME=$PWD/.home node scripts/d1-migrate-safe.mjs --database DB --remote --env production --env-file env.test`

执行结果：

1. `0000_auth_domain_bootstrap.sql` 已应用
2. `0001_users_admin_flags.sql` 已应用（检测到缺失列并补齐）
3. `0002_auth_password_reset_tokens.sql` 已应用
4. 新增应用迁移数：3

迁移后核验：

1. 新表存在：
   - `ba_user`
   - `ba_session`
   - `ba_account`
   - `ba_verification`
   - `user_auth_links`
   - `auth_password_reset_tokens`
2. `users` 表字段状态：
   - `is_review_exempt` 存在，`NOT NULL DEFAULT 0`
   - `is_admin` 存在，`NOT NULL DEFAULT 0`
   - `users.is_admin IS NULL` 数量：0
   - `users.is_review_exempt IS NULL` 数量：0
3. 关键业务表迁移前后行数保持一致：
   - `battle_report_generations`: 710
   - `battle_report_generation_combatants`: 1741
   - `pvp_rooms`: 30
   - `pvp_matches`: 7
   - `pvp_rounds`: 43
   - `data_cards`: 200

### 8.4 回归命令

以下命令在当前分支均通过：

1. `bun test`
2. `bun run lint`
3. `bun run build`
4. `HOME=$PWD/.home bun run build:cf`

### 8.5 本轮发现并处理的问题

1. 本地 SQLite 大查询出现 `unable to open database file (14)`：
   - 原因：复杂 CTE 触发临时文件路径问题。
   - 处理：本地查询前强制 `PRAGMA temp_store=MEMORY`。
2. 测试 D1 批量插入触发 `too many SQL variables`：
   - 处理：将批量参数上限从 `600` 下调至 `90`。
3. 测试 D1 远程模式执行 `PRAGMA integrity_check` 返回 `SQLITE_AUTH`：
   - 处理：脚本对该场景降级为“记录并跳过”，不误判复制失败。

### 8.6 合并评估结论（基于旧版备份穿行）

在“旧版数据快照（2025-12-31）+ user_id<=20 关联子集”条件下，Auth + ORM 迁移穿行与构建回归均通过，未发现阻断本分支合并到生产分支的问题。
