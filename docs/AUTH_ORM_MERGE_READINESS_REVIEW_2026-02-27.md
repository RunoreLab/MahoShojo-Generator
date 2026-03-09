# Auth + ORM 合并前审阅报告（2026-02-27）

> 审阅分支：`feature/Auth+ORM`
> 
> 目标分支：`feature/v0.2.0_Battle_Growth_MahoShojo`
> 
> 审阅目的：确认 Auth / ORM 落地是否达到合并生产前的质量要求，识别未完成工作与缺陷

---

## 1. 审阅结论（先看）

当前分支**核心改造已基本完成**（Auth 路由迁移、统一鉴权、仓储层下沉、迁移脚本与测试补齐均已落地），但**暂不建议直接合并生产分支**。

当前剩余阻断/风险：

1. 工作区存在 310 个“纯换行改动”（无业务逻辑改动），直接提交会造成超大噪音 diff，显著增加合并风险。
2. 阶段 C（会话化收口与 legacy 下线）尚未完成，仍存在迁移窗口期双凭证维护成本。
3. `next build` 仍显示 `Environments: .env`（Next.js 默认行为），测试与 CI 仍需强制隔离环境变量。

结论：**达到“开发目标的主体实现”，但尚未达到“可安全合入生产”的最终状态。**

---

## 2. 本次验证范围与结果

### 2.1 质量门禁结果

在加载 `env.test` 的前提下执行：

1. `bun run lint`：通过
2. `bun test`：通过（`447 pass / 0 fail`）
3. `bun run build`：通过（有 Edge Runtime 兼容告警）
4. `bun run build:cf`：通过（Cloudflare Pages 构建链路可完成）

### 2.2 环境约束执行说明

1. 未执行任何数据库写入型测试（未跑迁移、未写测试数据）。
2. 已核对 `.env` 与 `env.test` 的 D1/R2/Account 配置为不同值。
3. 注意：`next build` 日志仍显示 `Environments: .env`（Next.js 默认行为），因此 CI/本地应继续强制注入测试环境变量并避免误连生产。

---

## 3. 关键发现（按严重度，含修复状态）

## [已修复-高] 缺陷 1：前端 `logout` 未真正注销 Better Auth 会话

- 证据：
  1. 登录成功后会透传并设置会话 Cookie：`app/api/auth/login/route.ts:131-148`
  2. 当前 logout 仅清理 localStorage：`lib/auth.ts:299-301`
  3. `useAuth` 的 logout 只调用上述清理逻辑：`lib/useAuth.ts:91-96`
- 影响：
  1. 密码登录用户点击“退出”后，仅 UI 状态被清空；会话 Cookie 仍有效。
  2. 页面刷新或再次调用 `/api/auth/verify` 后可恢复登录态，导致“假退出”。
- 修复结果（2026-02-27）：
  1. `authApi.logout` 已改为调用 Better Auth `sign-out` 端点（`credentials: 'include'`）。
  2. 注销调用后再清理 localStorage 兼容字段。
  3. 已新增单测覆盖 sign-out 调用参数与失败兜底。

## [已修复-高] 阻断 2：当前 production D1 绑定仍为测试库

- 证据：`wrangler.toml:19-24`（`env.production` 的 `database_name` 仍为 `mhsj-d1-test`，ID 与默认段同值）
- 影响：
  1. 若直接按当前配置部署 production，存在连接测试库风险。
  2. 造成线上数据隔离失效或环境错配。
- 修复结果（2026-02-27）：
  1. `env.production` 的 D1 绑定已切换为生产库 ID：`8eb9b25c-5a00-4feb-b5cb-c5dd25cda1d3`。
  2. default / preview 继续使用测试库 ID：`3836f44c-4e49-4356-9b33-6080278e4448`。

## [已修复-中] 风险 3：D1 配置校验脚本只校验“格式”，不校验“环境语义”

- 证据：`scripts/check-wrangler-d1-config.mjs:52-77`
- 修复结果（2026-02-27）：已新增两条语义校验：
  1. `production database_id` 不得与 `default/preview` 复用。
  2. `production database_name` 不得为 test 命名。

## [中] 风险 4：工作区存在 310 个纯换行改动（CRLF/LF 漂移）

- 证据：
  1. `git ls-files -m` 显示 310 个已修改文件；
  2. 逐文件验证结果：`real=0 pure_eol=310`（均为纯换行差异）。
- 影响：
  1. 代码审阅噪音极大，掩盖真实业务变更；
  2. 合并冲突概率上升，回滚与 blame 可读性下降。
- 建议：
  1. 合并前先清理该批换行漂移，确保 PR 只包含业务变更；
  2. 新增 `.gitattributes` 固定换行策略，避免再次出现整仓漂移。

## [中] 改进项 5：阶段 C（会话化收口）尚未完成

- 证据：`lib/auth.ts:3-11,79-140` 仍以 localStorage 保存 `authKey` 兼容数据。
- 影响：
  1. 迁移窗口长期并存两套凭证模型，增加安全面与维护复杂度；
  2. 与“仅会话化”终态目标存在偏差。
- 建议：定义明确下线窗口：
  1. 先完成 session-only 验证；
  2. 再逐步去掉前端对 `Authorization: Bearer` 的依赖；
  3. 最后下线 legacy key 登录入口。

---

## 4. 目标完成度评估

按 `docs/AUTH_ORM_DUAL_TRACK_APP_ROUTER_EXECUTION_2026-02-25.md` 目标评估：

1. 阶段 A1（Auth 路由与统一鉴权）：**已完成**
2. 阶段 A2（Drizzle 基建与迁移机制）：**已完成**
3. 阶段 B（受保护 API 迁移到仓储层）：**已基本完成**（`queryFromD1` 仅剩兼容别名）
4. 阶段 C（会话化收口与 legacy 下线）：**未完成**（logout 已闭环，凭证收口仍未闭环）

总体完成度：**约 85%~90%**（可发布前还需完成收口项）

---

## 5. 还有“可以做但尚未做”的工作

1. 清理工作区纯换行改动（已新增 `.gitattributes`，但仍需一次性归一化）。
2. 增加 Auth App Router 关键 E2E/集成测试（注册、登录、verify、recover、reset、logout）。
3. 制定 legacy auth_key 下线计划（版本窗口、灰度开关、回退策略）。
4. 在 CI 增加强约束：构建/测试阶段禁止读取 `.env` 生产值。

---

## 6. 建议的下一步执行顺序（可直接排期）

1. P0：清理 310 个纯换行改动，保持分支差异可审阅。
2. P1：补 Auth 关键链路集成测试，形成合并前门禁。
3. P1：在 CI 增加“测试构建禁用 `.env` 生产值”约束。
4. P2：推进阶段 C 收口，逐步下线 legacy Bearer。

---

## 7. 附：本次执行命令摘要

1. 分支差异：`git log/diff`（`feature/v0.2.0_Battle_Growth_MahoShojo..feature/Auth+ORM`）
2. 质量门禁：`bun run lint`、`bun test`、`bun run build`、`bun run build:cf`
3. 代码审计：`rg` 检索鉴权入口、`queryFromD1` 残留点、runtime 声明
4. 工作区检查：`git diff --stat HEAD`、逐文件 `--ignore-space-at-eol` 验证

---

## 8. 已完成工作更新（2026-02-27）

已落地：

1. 修复会话退出缺陷：新增 `signOutBetterAuthSession`，前端 logout 现会主动请求 `/api/auth/sign-out` 注销会话 Cookie，再清理本地兼容凭证。  
   涉及文件：`lib/auth/logout.ts`、`lib/auth.ts`、`lib/useAuth.ts`。
2. 新增 logout 单测：覆盖 sign-out 端点调用参数与失败兜底场景。  
   涉及文件：`tests/auth-logout.test.ts`。
3. 修正 `wrangler.toml` 的 production D1 绑定：已切换到生产库 ID `8eb9b25c-5a00-4feb-b5cb-c5dd25cda1d3`；默认/preview 仍使用测试库 ID `3836f44c-4e49-4356-9b33-6080278e4448`。
4. 强化部署前 D1 配置校验：在原有 UUID/占位符检查基础上，新增“production 不能与 default/preview 复用同一 `database_id`”与“production `database_name` 不应为 test 命名”规则。  
   涉及文件：`scripts/check-wrangler-d1-config.mjs`。
5. 新增仓库级换行规范：`.gitattributes` 已固定默认 `LF`，降低后续跨平台 CRLF/LF 漂移概率。  
   涉及文件：`.gitattributes`。
