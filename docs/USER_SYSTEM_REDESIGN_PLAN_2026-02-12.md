# 用户系统优化与重构设计（草案）

文档版本：v0.1  
创建日期：2026-02-12  
适用项目：`MahoShojo-Generator`（Next.js + Edge Runtime + Cloudflare D1）

## 1. 目标与范围

### 1.1 目标

在不破坏现有业务（数据卡、PVP、个人页等）的前提下，升级当前“用户名 + 登录密钥”账户体系，逐步演进为更成熟、可维护、安全边界更清晰的用户系统。

重点覆盖：
- 注册时邮箱验证
- 密码体系（设置、修改、重置）
- 用户名修改
- 会话管理（替代长期静态凭证）
- 鉴权中间层统一与封禁策略统一
- 向后兼容（平滑迁移老用户）

### 1.2 非目标（当前阶段）

- 暂不引入第三方 OAuth（Google/GitHub 登录）
- 暂不引入 MFA（双因子），仅保留后续扩展点
- 暂不做多租户/组织系统

---

## 2. 现状审计（基于当前代码）

### 2.1 当前账户模型

当前主模型是“用户名 + auth_key（登录密钥）”，不是传统“密码 + 会话”模型：
- 注册生成随机 `auth_key`，并直接返回给前端与用户保存  
  参考：`pages/api/auth/register.ts`
- 登录依赖 `username + authKey`  
  参考：`pages/api/auth/login.ts`
- 服务端主要通过 `Authorization: Bearer <authKey>` 识别用户  
  参考：`lib/database/users.ts`、`lib/pvp/server.ts`

### 2.2 前端凭证存储方式

- 客户端将 `authKey` 存在 `localStorage`，并使用固定硬编码密钥做可逆加密  
  参考：`lib/auth.ts`
- 该方式本质上仍属于“前端可读凭证”，无法替代服务端会话安全机制。

### 2.3 密钥找回流程

- 找回接口通过用户名+邮箱校验后，直接把原 `auth_key` 明文发邮件  
  参考：`pages/api/auth/recover.ts`
- 页面文案使用“找回密码”，但实际找回的是登录密钥  
  参考：`pages/password-recovery.tsx`

### 2.4 账号设置现状

- 个人页“账号设置”目前是预留状态，未落地改邮箱/改密码/改用户名  
  参考：`components/me/MePage.tsx`

### 2.5 鉴权与封禁校验一致性

- PVP/个人页新接口通过 `requireAuthUser`，会校验 `is_banned`  
  参考：`lib/pvp/server.ts`
- 但大量历史 API 仍在各自实现 `getUserByAuthKey`，不统一检查封禁状态  
  示例：`pages/api/data-cards.ts`、`pages/api/decks.ts`

### 2.6 用户名显示来源不一致

- 多处代码优先读取数据卡 JSON 内 `_author`，其次才是 `username`（来自 users 表）
- 一旦后续支持改用户名，会出现“新用户名与历史 `_author` 不一致”问题  
  参考：`pages/details.tsx` 等问卷/数据卡选择逻辑

---

## 3. 主要问题与风险分级

### P0（高优先级）

1. 静态长期凭证风险高
- `auth_key` 既是登录凭证，又长期有效，无过期、无设备维度、无服务端会话撤销。

2. 找回流程泄露原凭证
- 邮件发送原 `auth_key`，不是一次性重置令牌。

3. 前端本地存储凭证
- 凭证驻留 `localStorage`，存在被脚本读取风险；“固定密钥前端加密”并不能真正提升安全边界。

4. 鉴权逻辑分散
- 封禁校验在不同 API 不一致，容易出现权限绕过或行为不一致。

### P1（中优先级）

1. 注册/登录输入标准化不足
- 用户名/邮箱未统一做标准化（trim、大小写归一），存在重复/混淆边界。

2. 缺失邮箱验证状态
- 当前注册邮箱仅做格式校验，不验证邮箱所有权。

3. 缺失密码体系
- 无“设置密码/修改密码/重置密码”正式能力。

4. 缺失暴力破解防护体系
- 登录/找回等关键接口无明确频率限制、失败惩罚、风险审计。

### P2（体验与可维护性）

1. 文案语义混乱
- 页面使用“找回密码”，实际行为是“找回登录密钥”。

2. 数据模型演进隐患
- `schema.sql` 与部分业务代码存在字段预期差（如 `is_admin`、`is_review_exempt` 使用痕迹），长期会增加维护风险。

---

## 4. 方案对比

### 方案 A：在现有密钥体系上做小修补

做法：继续使用 `auth_key`，补充改密钥、密钥轮换、限流与统一鉴权。

优点：
- 改动小，上线快
- 与现网兼容成本低

缺点：
- 安全上限有限，仍是“长期静态凭证”
- 后续做账号安全能力（设备管理、异地会话等）仍困难

适用：仅做短期止血，不适合作为长期方案。

### 方案 B：混合迁移（推荐）

做法：新增“邮箱验证 + 密码 + 会话”主体系，同时兼容旧 `auth_key` 一段时间。

优点：
- 安全性与工程可落地性平衡最好
- 可以分阶段灰度迁移，业务风险可控
- 保证老用户可继续登录，再引导升级

缺点：
- 迁移期逻辑更复杂，需要兼容层

适用：当前项目最推荐路径。

### 方案 C：一次性切换到新体系

做法：立即弃用 `auth_key`，强制全量用户迁移密码会话。

优点：
- 目标架构纯净

缺点：
- 业务中断风险高，用户流失风险高
- 回滚复杂

适用：不建议当前项目采用。

---

## 5. 推荐目标架构（方案 B）

### 5.1 身份与认证模型

- 登录标识：`username` 或 `email`
- 主认证因子：`password`
- 会话机制：短期 Access Session + 可轮换 Refresh Session（服务端可撤销）
- 兼容入口：保留 legacy `auth_key` 登录入口（限迁移期）

### 5.2 邮箱验证模型

- 注册后生成一次性验证令牌（短期有效）
- 邮箱验证通过后才标记 `email_verified_at`
- 对“未验证邮箱”限制高风险操作（可配置）

### 5.3 密码重置模型

- 忘记密码只发“重置链接/重置码”，不发送旧凭证
- 重置令牌单次消费、短时有效、服务端哈希存储

### 5.4 用户名修改模型

- 支持在个人设置中修改用户名（需要当前密码确认）
- 用户名规则收紧（字符集、长度、保留词）
- 对历史业务采用“关系数据优先展示用户名”，减少 `_author` 历史快照带来的不一致

### 5.5 统一鉴权中间层

新增统一 `requireUser`（建议放 `lib/auth/server.ts`）：
- 支持读取新会话（优先）
- 兼容 legacy bearer auth_key（迁移期）
- 统一封禁、账号状态、风险状态检查

所有需要登录的 API 路由统一接入，逐步替换散落的 `getUserByAuthKey` 直查。

---

## 6. 数据库设计建议（D1）

> 下述为建议字段，实际以迁移脚本为准。

### 6.1 users 表扩展

建议新增：
- `username_normalized TEXT`
- `email_normalized TEXT`
- `password_hash TEXT`
- `password_algo TEXT`（如 `pbkdf2-sha256`）
- `password_iterations INTEGER`
- `password_updated_at DATETIME`
- `email_verified_at DATETIME`
- `legacy_auth_key_deprecated_at DATETIME`

建议索引：
- `UNIQUE(username_normalized)`
- `UNIQUE(email_normalized)`

### 6.2 新表：user_sessions

用途：服务端会话管理（可撤销/可审计）
- `id`
- `user_id`
- `refresh_token_hash`
- `created_at`
- `last_seen_at`
- `expires_at`
- `revoked_at`
- `ip`
- `user_agent`

### 6.3 新表：email_verification_tokens

- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `consumed_at`
- `created_at`

### 6.4 新表：password_reset_tokens

- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `consumed_at`
- `created_at`

### 6.5 新表：auth_audit_logs（可选但推荐）

记录关键操作：登录成功/失败、改密、改邮箱、重置密码、会话撤销。

---

## 7. API 设计建议

### 7.1 新增接口

1. `POST /api/auth/register-v2`
- 入参：`username`, `email`, `password`, `turnstileToken`
- 出参：注册结果 + 是否已发验证邮件

2. `POST /api/auth/email/verify`
- 入参：`token`
- 出参：验证结果

3. `POST /api/auth/login-v2`
- 入参：`identifier`, `password`, `turnstileToken`
- 出参：用户信息 + 会话建立（Set-Cookie）

4. `POST /api/auth/logout`
- 吊销当前会话

5. `POST /api/auth/password/forgot`
- 入参：`email`, `turnstileToken`
- 出参：统一提示（防枚举）

6. `POST /api/auth/password/reset`
- 入参：`token`, `newPassword`

7. `PUT /api/me/account/password`
- 入参：`currentPassword`, `newPassword`

8. `PUT /api/me/account/username`
- 入参：`newUsername`, `password`

9. `PUT /api/me/account/email`
- 入参：`newEmail`, `password`，后续邮箱验证

### 7.2 兼容接口策略

- 保留现有 `/api/auth/login`、`/api/auth/register`、`/api/auth/verify` 一段时间
- 逐步将前端调用切换到 v2
- 迁移完成后下线 legacy authKey 登录

---

## 8. 前端交互改造建议

### 8.1 登录/注册弹窗（`AuthModal`）

- 从“注册后展示登录密钥”改为“注册时设置密码 + 邮箱验证提示”
- 登录字段改为“用户名/邮箱 + 密码”
- 保留“使用旧密钥登录（迁移入口）”折叠区（过渡期）

### 8.2 找回密码页面

- 保留现有路径 `pages/password-recovery.tsx`，但行为改为“发送重置链接”
- 文案统一使用“重置密码”，不再出现“发送原密码/密钥”语义

### 8.3 个人页设置（`MePage`）

- 落地“修改用户名 / 修改密码 / 改绑邮箱”
- 增加“安全设置”卡片：最近登录、会话管理、异地登录提醒（后续）

### 8.4 作者显示一致性

- 渐进调整展示优先级：`username`（关系字段）优先于 `_author`（历史快照）
- 避免改名后前台显示旧作者名

---

## 9. 迁移计划（分阶段）

### Phase 0：安全止血（1-2 天）

- 统一关键接口输入标准化（trim + lower-case email）
- 登录/找回加基础限流（IP + 用户维度）
- 封禁校验统一接入更多 API（先高风险写接口）
- 文案修正：密钥/密码语义统一

### Phase 1：数据层扩展（2-4 天）

- 增加 users 扩展字段与新表（sessions / verify / reset）
- 编写 D1 迁移脚本与回填脚本（normalized 字段）

### Phase 2：新认证链路（3-5 天）

- 实现 register-v2 / login-v2 / email verify / password reset
- 引入统一鉴权中间层，并迁移核心 API

### Phase 3：账号设置落地（2-4 天）

- 实现改密码/改用户名/改邮箱接口与前端
- 处理改用户名后的作者展示一致性

### Phase 4：兼容收敛（1-2 周观察期）

- 统计 legacy authKey 使用率
- 用户提示升级
- 下线 legacy 登录入口与相关字段依赖

---

## 10. 测试与验收标准

### 10.1 功能验收

- 新用户可完成：注册 -> 邮箱验证 -> 登录 -> 退出 -> 重置密码
- 老用户可通过迁移路径平滑升级，不影响既有数据
- 可在个人页成功修改用户名/密码/邮箱

### 10.2 安全验收

- 不再通过邮件发送原始登录凭证
- 会话可服务端撤销
- 登录失败具备限流/惩罚策略
- 封禁用户在所有受保护 API 表现一致

### 10.3 回归验收

- 数据卡、卡组、收藏、PVP、个人页等既有功能不回归
- Bun 测试覆盖新增鉴权逻辑与关键边界（令牌过期、重复消费、大小写归一）

---

## 11. 实施时的关键注意事项

1. Edge Runtime 约束
- 选型需兼容 Edge，不依赖 Node-only API。

2. 密码哈希策略
- 避免自定义弱哈希，采用成熟 KDF（至少 PBKDF2 高迭代）并记录算法参数，支持未来升级。

3. 兼容窗口管理
- 迁移期同时支持新旧鉴权，必须通过开关控制并可随时回滚。

4. 审计可观测性
- 关键认证路径必须打审计日志（不记录明文敏感信息）。

---

## 12. 与当前代码的直接映射（首批改造入口）

- 鉴权核心：`lib/auth.ts`、`lib/useAuth.ts`、`lib/pvp/server.ts`
- 认证接口：`pages/api/auth/register.ts`、`pages/api/auth/login.ts`、`pages/api/auth/verify.ts`、`pages/api/auth/recover.ts`
- 用户数据层：`lib/database/users.ts`、`lib/database/schema.sql`
- UI 入口：`components/CharManager/AuthModal.tsx`、`pages/password-recovery.tsx`、`components/me/MePage.tsx`
- 受保护 API（需统一鉴权）：`pages/api/data-cards.ts`、`pages/api/decks.ts`、`pages/api/favorites.ts`、`pages/api/user-capacity.ts` 等

---

## 13. 推荐结论

建议按“方案 B（混合迁移）”执行：
- 短期先做安全止血与统一鉴权；
- 中期完成密码+邮箱验证+会话体系；
- 后期下线 legacy auth_key。

这样可以在不打断当前业务的情况下，把用户系统从“可用但脆弱”升级到“可持续演进”。
