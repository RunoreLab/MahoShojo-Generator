# Auth + ORM 合并前审阅报告（2026-02-27）

> 审阅分支：`feature/Auth+ORM`
> 
> 目标分支：`feature/v0.2.0_Battle_Growth_MahoShojo`
> 
> 审阅目的：确认 Auth / ORM 落地是否达到合并生产前的质量要求，识别未完成工作与缺陷

---

## 1. 审阅结论（先看）

当前分支**核心改造已基本完成**（Auth 路由迁移、统一鉴权、仓储层下沉、迁移脚本与测试补齐均已落地），但**暂不建议直接合并生产分支**。

阻断原因：

1. 存在一个真实功能缺陷：`logout` 未注销 Better Auth 会话 Cookie（仅清理本地存储）。
2. `wrangler.toml` 的 production 区段当前仍指向测试 D1。
3. 工作区存在 310 个“纯换行改动”（无业务逻辑改动），直接提交会造成超大噪音 diff，显著增加合并风险。

结论：**达到“开发目标的主体实现”，但尚未达到“可安全合入生产”的最终状态。**

---

## 2. 本次验证范围与结果

### 2.1 质量门禁结果

在加载 `env.test` 的前提下执行：

1. `bun run lint`：通过
2. `bun test`：通过（`445 pass / 0 fail`）
3. `bun run build`：通过（有 Edge Runtime 兼容告警）
4. `bun run build:cf`：通过（Cloudflare Pages 构建链路可完成）

### 2.2 环境约束执行说明

1. 未执行任何数据库写入型测试（未跑迁移、未写测试数据）。
2. 已核对 `.env` 与 `env.test` 的 D1/R2/Account 配置为不同值。
3. 注意：`next build` 日志仍显示 `Environments: .env`（Next.js 默认行为），因此 CI/本地应继续强制注入测试环境变量并避免误连生产。

---

## 3. 关键发现（按严重度）

## [高] 缺陷 1：前端 `logout` 未真正注销 Better Auth 会话

- 证据：
  1. 登录成功后会透传并设置会话 Cookie：`app/api/auth/login/route.ts:131-148`
  2. 当前 logout 仅清理 localStorage：`lib/auth.ts:299-301`
  3. `useAuth` 的 logout 只调用上述清理逻辑：`lib/useAuth.ts:91-96`
- 影响：
  1. 密码登录用户点击“退出”后，仅 UI 状态被清空；会话 Cookie 仍有效。
  2. 页面刷新或再次调用 `/api/auth/verify` 后可恢复登录态，导致“假退出”。
- 建议：
  1. `authApi.logout` 改为调用 Better Auth `sign-out` 端点（带 `credentials: 'include'`）。
  2. 清理 Cookie 成功后再清理 localStorage 兼容字段。
  3. 新增回归测试：`password login -> logout -> verify should be unauthorized`。

## [高] 阻断 2：当前 production D1 绑定仍为测试库

- 证据：`wrangler.toml:19-24`（`env.production` 的 `database_name` 仍为 `mhsj-d1-test`，ID 与默认段同值）
- 影响：
  1. 若直接按当前配置部署 production，存在连接测试库风险。
  2. 造成线上数据隔离失效或环境错配。
- 建议：
  1. 合并前必须替换 production 为真实生产 D1 绑定。
  2. 将 preview / production 的 DB ID 差异做成强校验（CI 阻断）。

## [中] 风险 3：D1 配置校验脚本只校验“格式”，不校验“环境语义”

- 证据：`scripts/check-wrangler-d1-config.mjs:52-77`
- 现状：仅检查 UUID 合法性与占位符，不检查 production 是否误指向 test DB。
- 影响：格式正确但环境错误时仍会放行。
- 建议：增加策略校验，例如：
  1. 要求 `env.production` 与 `env.preview` 不同 ID；
  2. 或通过 CI 注入允许的 production DB ID 白名单并强比对。

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
  1. 先修复 logout 与 session-only 验证；
  2. 再逐步去掉前端对 `Authorization: Bearer` 的依赖；
  3. 最后下线 legacy key 登录入口。

---

## 4. 目标完成度评估

按 `docs/AUTH_ORM_DUAL_TRACK_APP_ROUTER_EXECUTION_2026-02-25.md` 目标评估：

1. 阶段 A1（Auth 路由与统一鉴权）：**已完成**
2. 阶段 A2（Drizzle 基建与迁移机制）：**已完成**
3. 阶段 B（受保护 API 迁移到仓储层）：**已基本完成**（`queryFromD1` 仅剩兼容别名）
4. 阶段 C（会话化收口与 legacy 下线）：**未完成**（至少 logout 与凭证收口未闭环）

总体完成度：**约 85%~90%**（可发布前还需完成收口项）

---

## 5. 还有“可以做但尚未做”的工作

1. 补齐会话退出闭环（服务端 sign-out + 客户端状态同步 + 回归测试）。
2. 给 wrangler 校验脚本补“环境语义”检查，避免 production/test 误绑。
3. 清理工作区纯换行改动，并加 `.gitattributes` 固化规范。
4. 增加 Auth App Router 关键 E2E/集成测试（注册、登录、verify、recover、reset、logout）。
5. 制定 legacy auth_key 下线计划（版本窗口、灰度开关、回退策略）。

---

## 6. 建议的下一步执行顺序（可直接排期）

1. P0：修复 logout 会话注销缺陷并补测试。
2. P0：修正 production D1 绑定并新增 CI 阻断规则。
3. P1：清理 310 个纯换行改动，保持分支差异可审阅。
4. P1：补 Auth 关键链路集成测试，形成合并前门禁。
5. P2：推进阶段 C 收口，逐步下线 legacy Bearer。

---

## 7. 附：本次执行命令摘要

1. 分支差异：`git log/diff`（`feature/v0.2.0_Battle_Growth_MahoShojo..feature/Auth+ORM`）
2. 质量门禁：`bun run lint`、`bun test`、`bun run build`、`bun run build:cf`
3. 代码审计：`rg` 检索鉴权入口、`queryFromD1` 残留点、runtime 声明
4. 工作区检查：`git diff --stat HEAD`、逐文件 `--ignore-space-at-eol` 验证
