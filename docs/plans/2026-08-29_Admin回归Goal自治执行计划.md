# Admin 回归 `/goal` 自治执行计划

状态：`active`
日期：2026-08-29
计划标识：`PLAN-admin-reintegration-goals-v1`
依赖：`SPEC-admin-reintegration-v1`、`SPEC-platform-restructure-goal-execution-v1`、`PLAN-platform-restructure-goals-v1`、`PLAN-platform-restructure-v1`

## 1. 为什么需要这份计划

现有 [平台重整 `/goal` 自治执行与验收规格](../specs/2026-08-23_235200_平台重整Goal自治执行与验收规格.md) 已经足以承担通用 Agent 治理，不应再复制一套竞争规则。

现有 [平台重整 `/goal` 纵切实施计划](./2026-08-23_235300_平台重整Goal纵切实施计划.md) 也已经定义 `G3-1：Admin 安全壳 + read-only 第一批`，但只覆盖 Admin 的第一条纵切，没有把长期 `feat/admin` 的抽取方式、当前 Review 等待期的并行边界、后续高风险批次和生产切换条件拆成 Agent 可连续执行的 Goal 队列。

因此本文件只做 Admin 专项化：

- 继承通用 `/goal` 自治、review、停止与验收规则；
- 增加正式 Phase 3 之前的 `G3-P0 pre-work`，让当前等待核心维护者 Review 的时间可以安全利用；`G3-P0` 的编号只表示 Admin 轨道前置 Goal，不表示 Phase 3 已被解锁；
- 保持原 `G3-1` 的正式 Phase 3 语义，不把 CI green 当成 Phase 2.5 accepted；
- 给后续 Admin 迁移提供按风险递增的 durable Goal 队列；
- 明确 Agent 可以自主决策什么，遇到什么必须停下报告。

安全与迁移的规范性要求见 [Admin 回归安全与迁移规格](../specs/2026-08-29_Admin回归安全与迁移规格.md)。本计划不得降低该规格、平台实施规格或 accepted ADR。

## 2. 启动时的事实重建

每次 `/goal` 启动时，Agent **不要直接相信本文件中的历史 SHA/状态**，先用仓库和远端事实重建当前基线。

至少检查：

1. 当前 branch/worktree 是否干净，是否存在用户未提交修改；
2. 当前 `refactor/platform-rearchitecture`、PR #54 或其后继集成分支/PR 的实际 head、Review、CI、merge 状态；
3. Phase 2.5 最新 topic、exit audit、补充审计和 machine-readable manifest；
4. `feat/admin` 当前 head 与其相对当前平台基线的 divergence；
5. `apps/admin` 是否已经由其他提交创建或部分实现；
6. 已有 Admin 相关 schema、route、repository、auth、audit、tests 和 deploy 资产；
7. 上一个 Admin Goal 的实施日志、未完成 finding 和 rollback 状态。

2026-08-29 制定本计划时：

- PR #54 仍为 open、non-draft、mergeable；
- head 为 `0b3d9f28f6b05700fac083d15653e3436dfc62d9`；
- Repository CI 已通过；
- 仍请求核心维护者 Review；
- `feat/admin` 是与当前平台分支明显 diverged 的长期历史分支。

这些只是制定时快照。若启动时事实变化，以远端最新事实为准，并在 Goal 日志记录差异。

## 3. 分支策略

### 3.1 新 Admin 分支

从执行时最新的平台实现基线建立新的 stacked/feature branch，例如：

```text
refactor/platform-rearchitecture
  -> feat/admin-reintegration
```

命名可以按仓库当时约定调整，核心约束是：

- 不从 `feat/admin` 创建；
- 不 merge 整个 `feat/admin`；
- 不把旧 Admin branch 变成新的 deploy branch；
- PR #54 尚未 merge 时，把 Admin 视为 stacked downstream work；
- 上游 Review 发生变化时及时 rebase/适配；
- PR #54 merge 后，按仓库实际 base retarget/rebase，不保留人为的长期分叉。

### 3.2 冲突处理

rebase/迁移冲突时的默认优先级：

```text
current accepted platform semantics
> current schema/API/security boundary
> current user-visible behavior
> old feat/admin implementation detail
```

若旧 Admin 行为与当前产品事实冲突，Agent 必须调查真实需求、tests、schema 和文档；不能仅凭“旧分支代码更多”选择旧行为。

## 4. Agent 自治权限

在不改变 accepted 产品/安全语义的前提下，Agent 可以自主：

- 调研 `feat/admin` 全部相关资产和提交历史；
- 决定单个旧文件是 keep/adapt/rewrite/drop/defer；
- 重新划分 Admin 内部 module、component、service、repository；
- 为真实复用提取职责清晰的 package；
- 选择成熟 JWT/CSRF/sanitization 等库并进行依赖审查；
- 细化 capability；
- 选择 audit 的具体可靠持久化实现；
- 选择测试层级、fixture、fault injection 与 preview harness；
- 修正文档中被新证据证伪的非 accepted 细节，并记录理由；
- 在同一风险批次内重排、合并或拆分 Goal checkpoint；
- 修复执行中发现且与当前 Goal 直接相关的安全/正确性缺陷。

Agent 不得自行：

- 放宽 Cloudflare Access/origin/RBAC/secret/CSRF/audit 等安全边界；
- 改变 accepted ADR 或 Phase 顺序来让当前 Goal 更容易通过；
- 做生产切流、生产 Access/Tunnel 变更、不可逆 migration 或 destructive production action，除非当前 Goal 明确获得相应授权；
- 新造通用 shell、SQL console、任意 HTTP proxy 或浏览器数据库管理能力；
- 将旧 `feat/admin` 整体 merge/rebase；
- 为旧代码兼容而恢复 app-to-app source import；
- 把 `BLOCKED` / `DEFERRED` 写成 `PASS`；
- 因时间不足降低 stopping condition。

遇到需要改变 accepted 语义、需要真实外部权限且未授权、或多个高层文档互相矛盾时，按通用 Goal 规格停止并向维护者报告。

## 5. Goal 总体状态机

```text
G3-P0 pre-work
  -> Phase 2.5 formal gate satisfied
  -> G3-1 read-only foundation
  -> G3-2 moderation/review
  -> G3-3 user/business writes
  -> G3-4 multiplayer/recovery high-risk
  -> G3-5 maintenance/export/config
  -> G3-6 production hardening/cutover
  -> feat/admin archive
```

`G3-P0` 可以在 Phase 2.5 正式 merge/accept 前进行，但它仍属于上游 Review 等待期的 downstream preparation，不计入正式 Phase 3；`G3-1` 及以后不因此自动解锁。

如果启动时 Phase 2.5 已正式通过，可把 G3-P0 中尚未完成且与 G3-1 同上下文的工作合入 G3-1，但仍需完成所有 G3-P0 stopping condition，不得跳过资产盘点和安全基座。

## 6. G3-P0：Admin 回归盘点 + 安全基座 pre-work

**目标尺寸：约 4–5 小时；这是 sizing heuristic，不是计时器。**

### Objective

在不触碰生产和高风险业务写入的前提下，把 `feat/admin` 从“长期分支”转化为可审查的迁移资产清单，并在当前 Monorepo 中建立一个可独立验证、可随上游 rebase 的 Admin 安全/应用基座，使正式 G3-1 不再从旧架构猜测开始。

### Preconditions

- 当前 Phase 2.5 实现已进入正式 Review；
- 当前 head 的仓库 CI 状态已核验；
- 当前 Goal 不需要未授权生产动作；
- worktree 用户修改已识别并保护。

### Required checkpoints

1. **Inventory**
   - 遍历 `feat/admin` 中 Admin page/component/route/handler/repository/table/test/job/config；
   - 按 `SPEC-admin-reintegration-v1` 建立迁移清单；
   - 对 mutating/destructive/export/maintenance 逐项写明 `legacyTrustAssumptions`；
   - 识别已被当前主线功能替代、无需迁移的 dead/duplicate asset。

2. **Current-boundary mapping**
   - 为每个保留域找到当前 schema/service/package/API owner；
   - 禁止通过临时 alias/相对路径读取 `apps/web` 内部源码；
   - 标出需要新 shared contract 的真实 seam，而不是预先创建抽象。

3. **`apps/admin` shell**
   - 若尚不存在，建立最小真实 workspace app；若已存在，先审查再增量完善；
   - 独立 manifest/build/lint/typecheck/test；
   - 无生产自动部署副作用；
   - root 只做 workspace orchestration，不重新承载 Admin runtime dependency。

4. **Security primitives**
   - Access JWT validator abstraction + isolated test fixtures；
   - internal principal/capability evaluator，deny by default；
   - server-only audit envelope；
   - same-origin Admin API/BFF convention；
   - CSRF/session/CORS/XSS 的机械 guardrail 或明确实现 seam；
   - browser/server secret boundary test。

5. **Negative harness**
   - 至少覆盖 missing token、wrong issuer/audience、expired token、no internal principal、missing capability；
   - 如果没有真实 Access production config，用本地签名/JWKS fixture 验证代码契约，并明确生产验证尚未发生。

6. **Review + docs**
   - 独立检查 inventory 是否漏域、security primitives 是否形成新的 bypass；
   - 修复所有 Critical/Important finding；
   - 写实施日志和下一 Goal 重估。

### Explicitly out of scope

- 生产 Access/Tunnel 配置；
- 生产 Admin hostname；
- 旧数据表删除或不可逆 migration；
- 用户封禁、删除、评分修复、Arena 恢复、导出、维护、系统配置的生产启用；
- 归档 `feat/admin`；
- 宣称正式 Phase 3 已完成任何业务批次。

### Stopping condition

只有全部满足才可写 G3-P0 complete：

- 迁移清单覆盖旧 Admin 资产，未分类项为 0 或有明确 `DEFERRED` 原因；
- 新 Admin 工作建立在当前平台基线，`feat/admin` 未被 whole-merge/rebase；
- `apps/admin`（或经事实证明等价的既有边界）能独立 build/test；
- security primitives 有真实 negative tests；
- browser bundle/response/test fixture 不含服务器秘密；
- 没有生产或不可逆状态变化；
- Critical/Important finding = 0 open；
- rollback 是删除/回退本 Goal 下游改动，不要求回退 Phase 2.5。

## 7. 正式 Phase 3 解锁检查

启动 G3-1 前，Agent 必须重新判断主计划中的“Phase 2.5 已通过”是否真实满足。

至少检查：

- 核心维护者 Review/项目接受状态；
- 目标 base/merge 状态；
- 最新 repository CI；
- Phase 2.5 补充审计中的 `PARTIAL/DEFERRED` 是否与 Admin 所依赖的 surface 有冲突；
- production blocker 是否只阻止 production cutover，还是会让 Admin 依赖的 contract 不稳定。

只有仓库权威记录允许正式 Phase 3 时才继续。若 PR 只是 CI green、仍未被项目接受，应继续停留在 G3-P0/允许的 pre-work 范围。除非经授权许可越过此项检查执行。

## 8. G3-1：Admin 安全壳 + read-only 第一批

本 Goal 继承现有 `PLAN-platform-restructure-goals-v1` 中的 `G3-1`，不是另一个同名 Goal。

**目标尺寸：约 4–5 小时。**

### Objective

在真实 `apps/admin` 边界建立可用于正式环境的 Access/origin/internal-RBAC/audit 基础，并迁入 read-only dashboard/analytics/content list/detail 的第一批完整纵切，不混入高风险写操作。

### Required checkpoints

- 使用 G3-P0 inventory 选择 R0 资产；
- UI -> Admin API/BFF -> service/repository -> current data source 完整闭环；
- internal principal/capability 实际用于每个请求；
- read model 不要求浏览器持有 D1/Gateway/server credential；
- 用户提供内容以不可信输入处理；
- preview/authorized environment 中验证 Access token/origin 行为；
- 独立 build/deploy boundary 与 deny-all/host-down rollback；
- read-only domain tests + negative authorization/security tests。

### Stopping condition

- wrong audience/issuer/expired/missing identity 被拒；
- valid Access identity 但无 internal capability 被拒；
- 至少一个真实 dashboard/analytics 或 content list/detail 纵切可用；
- browser 无服务器数据库/平台秘密；
- direct-origin 防护在当前可授权环境有证据，无法执行的 production 部分明确列为后续生产 gate；
- Critical/Important finding = 0 open；
- 不启用 R1–R3 生产写操作。

## 9. G3-2：举报/消息/复核工作流

**预计：约 4–5 小时，启动时重估。**

### Objective

迁入 messages/report review 等人工复核域，把“查看上下文 -> 作出裁决 -> 记录理由 -> 可追溯审计”做成第一条正式 Admin mutation 纵切。

### Required properties

- capability 按 read/review/action 最小化，不用一个 `admin` 角色覆盖全部；
- 状态迁移在服务端校验，客户端不能提交任意终态；
- action reason 必填并进入审计；
- 并发复核使用 `expectedVersion`/等价冲突控制；
- 重试不会重复产生通知/处罚/积分等副作用；
- 恶意举报文本/昵称/富文本进入 XSS fixture；
- mutation CSRF、Origin/Fetch Metadata 等适用防护进入测试；
- 失败/冲突/重复提交用户可理解，不通过“最后写入覆盖”。

### Stopping condition

- 一个完整 review mutation 端到端可用；
- unauthorized、CSRF、stale version、duplicate retry、audit failure 均有负向证据；
- 审计记录足以重建 actor/action/target/reason/result，但不泄漏 token/secret；
- rollback 能禁用该 domain writer，而不影响 G3-1 read-only Admin。

## 10. G3-3：用户、徽章与兑换等业务写入

**预计：约 4–5 小时，必要时按业务域拆成 G3-3a/G3-3b。**

### Objective

迁入 user write、badge、redemption 等 R1/R2 管理能力，在真实业务副作用存在的情况下证明 capability、幂等、并发、审计和回滚模式可复用。

### Guardrails

- 用户身份、账号安全和登录态变更不得复用普通内容编辑权限；
- 封禁/重置/敏感身份操作按 R2 处理，必要时 fresh/step-up auth；
- redemption/badge 等会触发唯一约束、库存/资格或奖励副作用时必须验证重试语义；
- bulk action 有 scope 上限与预览；
- 旧 handler 的本地可信假设必须在 inventory 中已关闭。

### Stopping condition

- 选定业务域端到端迁入当前 service/repository contract；
- capability/CSRF/idempotency/version/audit 的适用组合全部有测试；
- 无旧 branch 运行时依赖；
- rollback/feature flag 可独立关闭新 writer；
- Critical/Important finding = 0 open。

## 11. G3-4：Ratings / PVP / Arena 恢复等高风险操作

**预计：约 4–6 小时；若 Arena recovery 自身超过 Goal 尺度必须拆分。**

### Objective

迁入会影响竞技状态、评分、多人房间或恢复语义的高风险管理能力，同时保持 Arena 已冻结 authority、idempotency、generation/replay 和 runtime 边界。

### Guardrails

- Admin 不成为绕过 Arena authority 的第二写入面；
- recovery/repair 必须调用当前权威 service/command contract，而不是直接手改多张表凑结果；
- reason、expected version/stable operation ID、audit 强制；
- 对房间/生成恢复验证重复执行、部分失败和超时恢复；
- 不把 D1/Redis/Room secret 下发浏览器；
- 与 Hosted DR/Arena runtime 的既有 failover/replay 语义保持一致。

### Stopping condition

- 至少一个代表性高风险 recovery 纵切通过 fault/retry tests；
- 直接数据库捷径和浏览器特权 secret 为 0；
- replay/重复请求不产生二次结算、二次生成或状态倒退；
- rollback 能禁用 Admin recovery 而不影响正常 Arena runtime。

## 12. G3-5：维护、导出与系统配置

**预计：约 4–6 小时；建议按 maintenance/export/config 的真实复杂度拆分。**

### Objective

在不把 Admin 变成通用数据库/远程 shell 的前提下，迁入 R3 maintenance/export/system config，并建立最大 blast-radius 管控。

### Guardrails

- 不提供 arbitrary SQL/shell/generic HTTP proxy；
- maintenance 使用固定 command/schema 与 bounded scope；
- export 使用独立 capability、字段最小化、数量/时间范围、审计和短期 artifact；
- system config 写入有 schema、version、reason、audit 和 rollback；
- 大任务采用 job/receipt/progress，而不是浏览器长请求盲等；
- artifact 或导出链接不会成为长期 bearer secret；
- CSV/电子表格导出处理公式注入风险。

### Stopping condition

- 选定 R3 能力全部有最小权限、blast-radius、audit 和 rollback 证据；
- 超范围/无权限/重复/部分失败路径有测试；
- secret 与敏感数据不会进入前端或日志；
- Critical/Important finding = 0 open。

## 13. G3-6：生产加固、切换与旧分支归档

**只有获得对应生产权限/授权后才能启动。不要把它自动附在前一个 `/goal` 后面。**

### Objective

把已经在隔离/preview 验收的 Admin 能力安全接入生产 Access/origin/runtime，并完成 fail-closed、rollback、审计恢复和 `feat/admin` 退役。

### Required production evidence

- Cloudflare Access application/policy 实际配置；
- origin JWT validation 的 production audience/issuer/key rotation 配置；
- Tunnel 或等价 direct-origin bypass closure；
- 无 Access、错误 audience、直接 origin 等真实负向 probe；
- internal principal bootstrap/revoke/break-glass runbook；
- CSRF/session/CORS security headers；
- audit retention、访问、备份/恢复和 sink failure 行为；
- deny-all / Admin host down 不影响公共 Web；
- 每个已上线 domain 的 feature flag/rollback；
- no browser secret / no raw DB console；
- production smoke + repository CI/build。

### Archive gate

只有当：

- 迁移清单中需要保留的能力均 `MIGRATED` 或有正式 `DROP/DEFER` 决议；
- 新 Admin 不依赖 branch switching；
- 回滚窗口已满足；
- 旧 branch 不再承载唯一数据/运维知识；

才把 `feat/admin` 标记只读/归档。不要删除 Git 历史来“清理”。

### Stopping condition

- 所有 production security gate 有真实证据；
- 无未关闭 Critical/Important finding；
- rollback/deny-all 演练通过；
- 旧 branch 完成只读归档；
- 最终 Phase 3 audit 写入仓库。

若缺少 Cloudflare/服务器/生产数据权限，本 Goal 应保持未启动或 `BLOCKED`，而不是用 preview 证据宣布 production complete。

## 14. 每个 Admin Goal 的执行循环

在通用 Goal 规范之外，Admin Goal 应采用以下循环：

```text
reconstruct current facts
-> read authority docs
-> inspect old feat/admin assets for this domain
-> update inventory + threat assumptions
-> choose one durable vertical objective
-> implement current-architecture version
-> run positive + negative + fault tests
-> inspect browser/server secret boundary
-> self-review
-> independent/second-pass review
-> fix Critical/Important findings
-> rerun validation
-> write evidence + rollback + next estimate
```

### 14.1 不把 UI 搬迁当作完成

一个旧 Admin 页面“看起来恢复了”不代表迁移完成。对应 API/service/repository、authorization、audit、tests、rollback 未闭合时，该 domain 仍是 incomplete。

### 14.2 不把测试 mock 当作生产证据

JWT fixture、local Redis/D1、preview Access 等可以证明代码契约，但不能替代 production Access/Tunnel/direct-origin 配置的真实验收。证据必须标注环境。

### 14.3 不扩大上下文到开放 backlog

如果一个 Goal 在预检后明显超过约 5 小时：

- 按独立 stopping condition 拆分；
- 保持每个 Goal 有可持久验收的纵切；
- 不为了“本次一次做完 Admin”吞掉所有高风险域；
- 不因接近 5 小时就中断一个只差少量验证即可闭合的目标。

## 15. Review 清单

每个 Goal 的 reviewer/第二遍审查至少问：

- 是否从当前平台基线开发，而非旧 Admin 架构复活？
- 是否有 app-to-app source import 或 secret 越界？
- 是否把 Access 误当成应用 RBAC？
- 是否 deny by default、每请求授权？
- stable principal 是否依赖可变 email？
- 是否有隐藏 superadmin/break-glass 后门？
- mutation 的 reason/version/idempotency/confirmation 是否只做在 UI？
- required audit 失败是否仍可能 silent success？
- untrusted Admin content 是否进入 unsafe HTML/URL sink？
- export/bulk 是否存在无界范围或数据过度暴露？
- recovery/maintenance 是否绕过领域 authority 直改数据库？
- production 证据是否被 mock/preview 冒充？
- rollback 是否能单独关闭 Admin/domain，而不回退公共 Web/Phase 2.5？

Critical/Important finding 必须在 Goal 完成前关闭；Minor 修复或记录理由。

## 16. Goal 完成报告模板

```text
Goal: G3-...
Objective: <one durable objective>
Base SHA: <current platform base>
feat/admin source SHA: <read-only source snapshot>
Upstream PR/Review state: <fact>

Inventory delta:
- migrated: ...
- rewritten: ...
- dropped: ...
- deferred: ...

Security/trust assumptions closed:
- ...

PASS:
- ...

NOT_APPLICABLE:
- ...

DEFERRED:
- ...

BLOCKED:
- ...

Negative/fault evidence:
- ...

Secret/boundary evidence:
- ...

Review:
- Critical: 0 open
- Important: 0 open
- Minor: <fixed/documented>

Validation actually run:
- ...

Production actions actually performed:
- none | <exact list>

Rollback:
- ...

Docs/decisions changed by Agent:
- <path + reason>

Next goal estimate:
- ...
```

只要存在阻塞 stopping condition 的 `FAIL/BLOCKED`，不得把 Goal 写成 complete。

## 17. 外部方法与安全依据（非规范性）

核验日期：2026-08-29。

- Cloudflare One — Validate JWTs: <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/>
- Cloudflare One — Publish a self-hosted application to the Internet: <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/>
- OWASP Authorization Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
- OWASP Logging Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>
- OWASP Cross Site Scripting Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html>

这些资料用于支持方法和通用安全控制；仓库内 accepted ADR/spec 仍决定具体产品与平台语义。
