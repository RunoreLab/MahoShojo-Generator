# 用户层 Auth 迁移引导设计（2026-02-27）

## 1. 背景与目标

本设计面向当前仓库已完成的 Auth + ORM 改造阶段，目标是把“技术改造完成”推进到“用户侧迁移完成”：

1. 新用户从注册起即进入新版 Auth（密码 + 会话）。
2. 老用户在迁移窗口内可持续登录，但持续被引导完成升级。
3. 逐步下线旧版 `auth_key` 登录，且不丢用户数据。
4. 为后续安全能力（异地提醒、风控、设备管理）补齐事件与审计基础。

---

## 2. 现状审阅（基于当前代码）

### 2.1 已具备能力

1. 新旧鉴权并存，服务端优先会话，回退 legacy bearer：
   - `lib/auth/server.ts`
   - `lib/auth/server-app.ts`
2. 新版注册/登录已接 Better Auth 桥接：
   - `app/api/auth/register/handler.ts`
   - `app/api/auth/login/handler.ts`
3. 已有 `user_auth_links` 映射与回填脚本：
   - `lib/db/schema/auth.ts`
   - `scripts/backfill-user-auth-links.ts`
4. 找回流程已升级为一次性令牌（不再直接回发旧密钥）：
   - `app/api/auth/recover/handler.ts`
   - `app/api/auth/recover/reset/handler.ts`

### 2.2 当前与迁移引导目标的主要差距

1. 注册仍允许“无密码走旧密钥”分支（非强制新 Auth）：
   - `app/api/auth/register/handler.ts`
   - `components/CharManager/AuthModal.tsx`
2. 密码登录仅支持邮箱，不支持 ID/用户名：
   - `app/api/auth/login/handler.ts`
3. 账号设置仍是预留区，未落地改密/改邮箱：
   - `components/me/MePage.tsx`
4. 迁移提醒能力不足：没有“谁还没迁移”的状态模型与 UI 提示体系。
5. 登录/注册 IP 审计不完整：
   - Better Auth 会话表有 `ip_address`（`ba_session`），但没有统一审计日志；
   - legacy 登录未记录 IP；
   - `users.registration_ip` 在 `lib/database/schema.sql` 中存在，但 Drizzle `users` 模型未映射该字段（`lib/db/schema/business.ts`）。

---

## 3. 需求映射与设计结论

### 3.1 允许 ID / 用户名 / 邮箱登录

结论：可做，推荐“单入口 identifier + 服务端解析 + 统一密码校验”。

设计要点：

1. 输入仍保持 `identifier + credential`，减少前端复杂度。
2. 服务端识别规则（按优先级）：
   - `identifier` 全数字且在安全范围内：按 `users.id`（可做开关，默认可先灰度关闭）。
   - 含 `@`：按邮箱。
   - 其他：按用户名。
3. 若识别到 ID/用户名，先映射到目标邮箱，再走 Better Auth `/sign-in/email`。
4. 对外统一错误文案为“账号或密码错误”，避免枚举。

### 3.2 注册/改密提供密码强度并强制达标

结论：应分“前端提示 + 服务端硬校验”两层，服务端为准。

建议策略：

1. P0 强制规则：
   - 长度 >= 8；
   - 至少命中 3 类字符（大写/小写/数字/符号）；
   - 不允许与用户名、邮箱前缀明显相同。
2. P1 强化规则：
   - 拦截常见弱口令；
   - 接入评分器（如 zxcvbn 思路）并要求最低分级。
3. 适用范围：
   - 注册；
   - 修改密码；
   - 重置密码。

### 3.3 账号设置 + 老用户高亮迁移提醒

结论：先补“迁移状态接口”，再驱动多入口提醒。

新增状态模型（建议）：

1. `hasAuthLink`：是否建立 `user_auth_links`。
2. `hasPassword`：是否存在 credential account 密码。
3. `emailVerified`：邮箱是否已验证。
4. `legacyOnly`：是否仍依赖旧登录。

提醒触点（至少三处）：

1. `character-manager` 登录区顶部（最高曝光）。
2. `/me` 设置页（账号中心）。
3. legacy 登录成功后弹窗（强提醒，可“稍后处理”但计数）。

### 3.4 支持修改密码与邮箱

结论：优先复用 Better Auth 现有端点，通过桥接封装业务 API。

建议接口：

1. `POST /api/me/account/password` -> 转发 `/api/auth/change-password`
2. `POST /api/me/account/email` -> 转发 `/api/auth/change-email`
3. `POST /api/me/account/password/forgot` -> 转发 `/api/auth/request-password-reset`
4. `POST /api/me/account/password/reset` -> 转发 `/api/auth/reset-password`

说明：

1. 以上端点名已在本地依赖 `better-auth`（`node_modules/better-auth/dist/api/routes/*`）可见。
2. 业务层仍需补充风控、限流、审计。

### 3.5 新注册禁止旧版注册

结论：必须尽快执行，这是迁移收敛的关键开关。

改动建议：

1. 删除 `registerWithLegacyAuthKey` 路径。
2. `password` 改为必填且强度达标，否则 400。
3. 前端移除“可留空走旧版密钥注册”文案与流程。
4. 新注册成功后不再向用户展示 `authKey`。

### 3.6 记录用户注册与登录 IP

结论：应做统一审计表，不应只依赖分散字段。

建议新增 `auth_audit_logs`（或同类命名）：

1. `id`
2. `business_user_id`
3. `auth_user_id`
4. `event_type`（register/login_success/login_failed/password_change/email_change/reset_password 等）
5. `auth_source`（better-auth / legacy）
6. `identifier_type`（id/username/email）
7. `ip`
8. `ip_anonymized`
9. `user_agent`
10. `result_code`
11. `created_at`

兼容建议：

1. 把 `users.registration_ip` 正式纳入 Drizzle `users` 模型，避免“schema 有、ORM 无”的漂移。
2. legacy 登录成功/失败也写审计，保证报表口径一致。

### 3.7 其他建议的引导能力

1. 迁移进度条：`未开始 -> 已设置密码 -> 已验证邮箱 -> 完成`。
2. 风险提示：检测异常地区/IP 后在登录后提示“是否本人”。
3. 迁移活动运营位：站内公告 + 登录后横幅 + 邮件节奏通知。
4. 强制节点：对高风险操作（改绑、删除、敏感发布）要求先完成迁移。

---

## 4. 长期离线老用户策略（重点）

你提出的问题是：长期离线用户未主动设置新密码，未来彻底移除旧 Auth 时，是否可把“新密码设为旧密钥”保证其回归可登录。

### 4.1 技术上“可以”，但不建议作为默认方案

原因：

1. 旧 `auth_key` 历史上是长期静态凭证，且曾经在旧流程中被前端长期存储；安全暴露面较大。
2. 若批量把旧密钥直接等价为新密码，本质是在延长旧凭证生命周期，风险没有真正收敛。
3. 这会削弱“迁移到新 Auth”的意义，且增加撞库/重放风险。

### 4.2 推荐方案：一次性 Legacy 认领流程（Claim Flow）

目标：不丢账号数据，同时逐步退出 legacy。

流程建议：

1. 用户输入“用户名/ID + 旧密钥 + 验证码”进入认领流程。
2. 服务端验证 legacy 成功后，不直接放行长期登录，仅授予短时迁移会话。
3. 立即要求设置新密码并确认邮箱（或完成邮箱验证）。
4. 完成后写入迁移完成标记，并失效旧密钥登录能力。
5. 全程写审计日志与风控事件（IP、UA、次数、限流）。

### 4.3 下线节奏建议（避免数据丢失）

1. T-90 ~ T-30：持续公告 + 登录弹窗提醒 + 邮件提醒。
2. T-30 ~ T0：legacy 登录仍可用，但每次登录强提醒迁移。
3. T0：关闭常规 legacy 登录入口，仅保留“认领迁移入口”。
4. T+180（可调）：关闭认领入口，仅保留人工申诉通道。

结论：

1. 可以保证“久不上线用户未来回归时不丢数据”。
2. 不建议“全量把密码设置为旧密钥”。
3. 建议用“受控的一次性认领迁移”替代。

---

## 5. 建议的分阶段实施计划

### Phase A（1 周）：可见性与强约束

1. 新注册强制密码，移除 legacy 注册分支。
2. 上线密码强度校验（前后端双层）。
3. 增加 `migration-status` 接口与 UI 高亮提醒。

### Phase B（1~2 周）：账号设置能力落地

1. 上线改密码、改邮箱、忘记密码/重置密码。
2. 登录支持多标识（ID/用户名/邮箱）解析。
3. 增加统一审计日志（含 IP）。

### Phase C（2~4 周）：迁移收敛

1. legacy 登录后强制引导迁移（弹窗 + 软阻断）。
2. 建立离线用户认领流程。
3. 观察迁移指标并按阈值关闭 legacy 常规入口。

### Phase D（收尾）：彻底下线 legacy

1. 关闭常规 legacy 登录与注册路径。
2. 保留短期认领通道（可配置时长）。
3. 完成文案、帮助中心、客服预案更新。

---

## 6. 核心指标与验收标准

### 6.1 迁移指标

1. `legacy_login_ratio`：legacy 登录占比（目标持续下降）。
2. `migrated_user_ratio`：完成“密码 + 邮箱验证”的用户占比。
3. `password_strength_fail_rate`：密码强度拦截率（监控是否过严）。
4. `account_takeover_alert_rate`：疑似盗号告警率。

### 6.2 功能验收

1. 新用户无法走 legacy 注册。
2. 老用户可通过引导完成迁移且数据不受影响。
3. 可在个人页完成改密、改邮箱流程。
4. 登录支持 ID/用户名/邮箱并保持统一错误语义。

### 6.3 安全验收

1. 所有认证关键操作均有审计记录（含 IP 与来源）。
2. 关键接口具备限流/验证码保护。
3. 关闭 legacy 后仍可通过认领流程恢复长期离线用户。

---

## 7. 直接关联的改造文件（建议优先级）

1. 注册与登录：
   - `app/api/auth/register/handler.ts`
   - `app/api/auth/login/handler.ts`
2. 账号设置：
   - `components/me/MePage.tsx`
   - `components/me/ProfileSettingsPanel.tsx`
3. 登录/注册 UI：
   - `components/CharManager/AuthModal.tsx`
   - `pages/character-manager.tsx`
4. 数据与审计模型：
   - `lib/db/schema/business.ts`
   - `lib/db/schema/auth.ts`
   - `drizzle/*.sql`（新增迁移）

---

## 8. 最终建议

1. 立即执行“新注册强制新 Auth + 密码强度硬校验 + 迁移状态提醒”。
2. 下一步落地“改密码/改邮箱 + 多标识登录 + 审计日志”。
3. 对长期离线用户采用“一次性 legacy 认领迁移”，不要批量把旧密钥当新密码。

---

## 9. 落地进展补充（2026-02-27）

本轮已补齐“老用户设置初始密码/认领迁移”关键缺口：

1. 新增 `PUT /api/me/account/password/set`
   - 适用于“未设置密码”的已登录用户（包含 legacy 登录态）。
   - 已有 `user_auth_links` 的用户：通过一次性内部 reset token + Better Auth `/api/auth/reset-password` 完成设密。
   - 未建立 `user_auth_links` 的用户：通过 Better Auth `/api/auth/sign-up/email` 进行认领，并在服务端补齐映射。
2. 新增仓储能力 `createAuthResetPasswordVerification`
   - 文件：`lib/db/repositories/user-auth-links.ts`
   - 用于写入 Better Auth `ba_verification` 一次性重置凭证。
3. 个人页安全设置补充迁移表单
   - 文件：`components/me/AccountSecurityPanel.tsx`
   - 新增“设置登录密码（迁移）”表单，支持 legacy 会话下完成迁移第一步。
4. 迁移提醒文案修正
   - 文件：`components/me/AuthMigrationPanel.tsx`
   - 将“先完成一次密码登录”调整为“先设置登录密码并自动认领迁移”，避免对老用户给出不可执行提示。
5. 测试补充
   - 文件：`tests/me-account-auth-settings.test.ts`
   - 新增用例覆盖：
     - legacy + 已映射 + 无密码 -> 可设置初始密码；
     - legacy + 无映射 + 无密码 -> 可通过设置密码认领迁移。
6. 认证审计日志基础能力落地
   - 新增表：`auth_audit_logs`（迁移文件：`drizzle/0003_auth_audit_logs.sql`）
   - 新增仓储：`lib/db/repositories/auth-audit-logs.ts`
   - 新增审计记录工具：`lib/auth/auth-audit.ts`
   - 已接入链路：
     - 注册：`app/api/auth/register/handler.ts`
     - 登录（密码/legacy）：`app/api/auth/login/handler.ts`
     - 设置初始密码：`pages/api/me/account/password/set.ts`
     - 修改密码：`pages/api/me/account/password.ts`
     - 修改邮箱：`pages/api/me/account/email.ts`
   - 额外补齐：`users.registration_ip` 已纳入 Drizzle 模型，并在注册成功后尝试回填（仅空值时写入）。
7. `character-manager` 顶部迁移触点补齐
   - 文件：`pages/character-manager.tsx`
   - 已接入 `migration-status` 状态读取，并在登录区顶部显示高曝光迁移提醒（映射/密码/邮箱验证状态）。
8. legacy 登录后强提醒弹窗补齐
   - 文件：`pages/character-manager.tsx`
   - legacy 登录成功后弹出迁移提醒弹窗，支持“去个人页迁移”与“稍后处理”。
   - “稍后处理”已加入本地计数（`mahoshojo_auth_migration_defer_count`），用于持续施压提醒。
9. 密码登录失败语义统一
   - 文件：`app/api/auth/login/handler.ts`
   - 对外统一返回“账号或密码错误”，避免按邮箱语义暴露标识类型。
