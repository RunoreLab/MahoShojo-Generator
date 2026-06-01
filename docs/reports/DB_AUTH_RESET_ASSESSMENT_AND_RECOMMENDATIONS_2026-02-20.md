# 用户系统与数据库重置评估报告（2026-02-20）

## 1. 评估目标与边界

- 目标：从系统工程视角，评估当前“用户系统 + 数据库访问层”是否达到正式运营要求，并判断是否需要重置。
- 边界：基于仓库代码静态审查，不包含线上真实流量、真实数据规模与真实攻击数据。
- 结论先行：**建议执行“结构性重置”（Auth 与数据访问层重构），不建议继续在当前模型上做补丁式延长。**

---

## 2. 现状审查（事实）

### 2.1 认证模型现状

1. 当前登录凭据是长期 `auth_key`，直接作为 Bearer 凭证使用：
- `lib/database/schema.sql:8`
- `lib/database/users.ts:61`
- `pages/api/auth/verify.ts:24`

2. 注册接口直接下发 `authKey` 给前端，恢复接口可邮件回发同一密钥：
- `pages/api/auth/register.ts:122`
- `pages/api/auth/recover.ts:87`

3. 前端将凭据存储在 `localStorage`，且“加密密钥”硬编码在客户端代码中：
- `lib/auth.ts:3`
- `lib/auth.ts:4`
- `lib/auth.ts:83`

4. 会话体系缺失（无 HttpOnly Cookie 会话、无 refresh token、无会话吊销表）：
- 代码检索 `Set-Cookie` 无认证写入（仅见透传 cookie 逻辑：`lib/subrequest-auth.ts:30`）。

### 2.2 鉴权实现一致性

1. 认证逻辑存在双轨：
- 一部分 API 走统一鉴权工具 `requireAuthUser`：`lib/api/server.ts:61`
- 另一部分 API 手写解析 `Authorization`：`pages/api/data-cards.ts:36`、`pages/api/data-card-recycle.ts:20`、`pages/api/user-capacity.ts:7`

2. 路由规模与分布（仓库内统计）：
- `pages/api` 总路由约 `39` 个。
- 手写 Bearer 解析端点约 `9` 个。
- 使用 `requireAuthUser` 的端点约 `7` 个。

### 2.3 数据库与访问层现状

1. 数据库访问在运行时依赖 Cloudflare REST API Token，而非 Worker D1 Binding：
- `lib/database/core.ts:93`
- `lib/database/core.ts:103`
- `lib/database/core.ts:178`

2. 迁移机制不足：
- 有统一 schema 文件，但缺少版本化 migration 框架与迁移状态管理：`lib/database/schema.sql`
- 存在按功能单独“补建表”脚本（例如 large_objects）：`scripts/init-large-objects.ts:5`
- 前端文案也提示需手工去 D1 控制台执行 SQL：`components/worksheet/components/WorksheetStatistics.tsx:45`

3. 代码与 schema 存在漂移迹象：
- API 代码使用 `is_admin`、`is_review_exempt`：`pages/api/data-cards.ts:31`
- 当前 schema `users` 表未定义上述字段（仅到 `avatar_webp_base64`）：`lib/database/schema.sql:4`

4. ORM 未落地：
- 仓库检索 `drizzle|prisma|kysely|typeorm|mikro|sequelize` 无命中（`package.json` 与源码层）。

### 2.4 测试覆盖现状

- `tests/` 基本未覆盖认证 API 与会话安全链路（登录/注册/密钥恢复/鉴权边界缺少系统性测试）。

---

## 3. 风险评估（按优先级）

### P0（上线阻断级）

1. **长期静态密钥即身份**：`auth_key` 同时扮演“密码 + token”，泄露后可长期复用。
2. **凭据可被回发与持久存储**：注册返回明文密钥、找回邮件发送明文密钥、前端 localStorage 存储。
3. **无标准会话控制**：无法精细化做设备管理、单设备下线、风险会话吊销、短时令牌轮转。

### P1（高风险）

1. **鉴权实现分叉**：多处手写 Bearer 校验，后续补丁极易遗漏。
2. **Schema/代码漂移**：权限字段依赖不清晰，导致不同环境行为不一致。
3. **数据库操作缺少迁移基线**：多人协作与跨环境发布风险高。

### P2（中风险）

1. **运行时持有高权限 Cloudflare Token**：扩大密钥泄露影响面。
2. **数据访问层与业务耦合偏重**：API 直接拼 SQL 的比例较高，不利于后续迁移国内云数据库。

---

## 4. 是否需要“重置”

### 结论

**需要。且建议“结构性重置”，不是“在旧方案上继续修补”。**

### 原因

- 当前认证模型属于“早期可用型”，并非“正式运营型”。
- 安全边界（凭据生命周期、会话控制、密钥治理）未达上线基线。
- 数据层缺少可验证迁移机制，难以支持后续高频演进。

---

## 5. 方案对比（决策视角）

### 方案 A：继续修补现有 auth_key 模式

- 优点：改动最小、短期快。
- 缺点：核心风险不消失，后续技术债会指数增长。

### 方案 B：硬重置（删库重建 + 用户重注册）

- 优点：实施最快、架构最干净。
- 缺点：用户资产损失最大，运营风险高。

### 方案 C：结构性重置

- 思路：保留业务数据，重建认证与数据访问基建，分阶段迁移。
- 优点：风险可控，兼顾正式运营与连续迭代。

---

## 6. 推荐目标架构（Auth + ORM 隔离）

### 6.1 认证层（Auth）

1. 认证形态：
- 改为“短期 Access + 可轮换 Refresh”会话机制。
- Refresh 仅存 HttpOnly + Secure Cookie；Access 短时有效。

2. 凭据存储：
- 不再保存可逆/可直接使用的长期密钥。
- 凭据使用强哈希（如 Argon2id/scrypt/PBKDF2 之一，按 Edge 可用能力选型）。

3. 安全能力：
- 会话表 + 吊销表 + 设备维度信息（UA/IP 摘要）。
- 登录失败限流、找回流程一次性 token、密钥轮换。

4. API 鉴权：
- 全部收敛到统一中间层（取代手写 Bearer 解析分支）。

### 6.2 数据访问层（ORM 隔离）

1. 引入 ORM（建议 Drizzle，原因：D1/SQLite 兼容较好，迁移到 MySQL/PostgreSQL 成本可控）。
2. 建立分层：
- `domain`（业务规则）
- `repository`（接口）
- `infrastructure`（ORM 实现）
3. 目标：
- API 不直接拼 SQL。
- schema 与迁移脚本同源管理，具备版本追踪。

### 6.3 云与可迁移性

1. 当前 Cloudflare 阶段：优先采用 Worker D1 Binding（减少运行时 API Token 暴露）。
2. 未来国内云：通过 ORM repository 适配器替换底层驱动，尽量不改业务层。

---

## 7. 验收标准（必须满足）

1. 安全：
- 生产链路不再使用长期静态 `auth_key` 作为 Bearer。
- 受保护 API 100% 走统一鉴权中间层。

2. 数据：
- migration 可重复执行，且有版本记录与回滚说明。
- schema 与代码不再出现权限字段漂移。

3. 工程：
- 认证相关单元/集成测试补齐（登录、刷新、登出、吊销、找回、越权）。
- 发布前完成 `pnpm lint`、`pnpm test`、`pnpm build`。
