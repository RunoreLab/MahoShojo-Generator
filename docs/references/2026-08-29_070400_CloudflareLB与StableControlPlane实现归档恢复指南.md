# Cloudflare LB 与 Stable Control Plane 实现归档恢复指南

状态：`historical / optional / reference-only / not-production-default`

日期：2026-08-29

用途：保存 G25E-1/G25E-2 已完成的 Hosted DR、stable endpoint、control-plane contract、故障演练与 production activation gate 参考，使未来重新评估托管 Load Balancing 时可以复用，而不是从零设计。

本文件不是生产激活证据，不表示 Cloudflare Load Balancing 已购买、配置或部署。

## 1. 归档时仓库位置

- 仓库：`RunoreLab/MahoShojo-Generator`
- 推荐文档/后续实施分支：`feat/arena-multiplayer-hono-redis`
- 归档观察 HEAD：`aa6ee64974009db8f1de2faf64f8380d173a8307`
- 该分支相对 `refactor/platform-rearchitecture` 观察基线：merge base `6170b38f2ce403d1f187f4de608006001606a55e`，ahead 123、behind 0
- 成本基线观察：GitHub 默认分支 `feature/v0.2.0_Battle_Growth_MahoShojo` / `07d8edf1544cf30867e81f929748a73ecd3cd362`；候选分支中未购买/未授权的 LB 机制不计为既有成本
- `6170b38f...` 是 commit；其 tree 为 `f5a85523...`。恢复记录不得把 tree SHA 当作 commit SHA。

HEAD 只用于说明本文件形成时的快照。未来恢复必须从当时最新主线新建分支，不应长期固定在该 SHA。

## 2. 已验证的关键 checkpoint

### G25E-1：Hosted DR contract / stable endpoint

| 角色 | Commit | 说明 |
| --- | --- | --- |
| 设计冻结 | `759e98b0c9c5fc7610c6826db409c8dfafe99a40` | 新增 G25E-1 Hosted DR 契约与稳定入口设计 |
| 代码/整改终点 | `42f65f932261044d130d2e19b4940637ca6b32bb` | G25E-1 实施日志记录的最终代码终点 |
| 审计事实更正 | `a0297b7bdf52bca8c84bd74a8d83605359050609` | 校正 preview、evidence、commit 与回滚事实 |

参考窗口：`759e98b0^..a0297b7b`。该范围包含多个 contract、安全、CORS、D1 provider、生成配置和测试提交；只能用于审阅/定位，**不得默认整段 cherry-pick**。

### G25E-2：fault drills / Phase 2.5 exit

| 角色 | Commit | 说明 |
| --- | --- | --- |
| 审计基线 | `61e691f6304613b0055ec2bfd761503b478a9ef0` | G25E-2 日志记录的起点 |
| 功能 checkpoint | `0551220fe08d9ee9aa43306e949a9497dfd980af` | Hosted DR fault、preview 与 CI 边界主要实现 |
| 审查整改 | `5d6b952ea909dc77d9be04bdb913ef8b063bf105` | 关闭当时 Phase 2.5 退出审查问题 |
| 文档收口 | `46bf3ae3c86ba0726371029aacbd259ac56b64d1` | 完成 G25E-2 与 Phase 2.5 退出审计 |

后续补充审计已把完整 `ACCEPT-014` / `ACCEPT-018` 调整为 partial；恢复者必须阅读当前版本日志，不能只依赖 `46bf3ae3` 当时的标题或状态。

## 3. 当前仍保留的实现入口

以下路径在归档观察 HEAD 已核实存在，且大部分对当前低成本 DR 仍有直接价值：

### 机器契约与验证

- `config/hosted-dr-capabilities.json`
- `config/hosted-dr-drills.json`
- `scripts/check-hosted-dr-contract.mjs`
- `scripts/check-hosted-dr-schema.mjs`
- `scripts/generate-hosted-dr-client-config.mjs`
- `scripts/hosted-dr-client-config.mjs`
- `scripts/verify-hosted-dr.mjs`
- `apps/api/scripts/verify-hosted-dr-redis.ts`

### Primary / DR readiness 与客户端

- `apps/api/src/health.ts`
- `apps/api/src/app.ts`
- `apps/web/app/api/hosted/dr-readiness/route.ts`
- `apps/web/config/hono-api.ts`
- `apps/web/config/hosted-dr-client.generated.ts`
- `apps/web/lib/hono-api-routing.ts`
- `apps/web/lib/hono-api-client.ts`
- `apps/web/lib/hosted-dr/`

### 规格、计划、日志与 Runbook

- `docs/decisions/2026-08-23_104000_Hosted运行时容灾与Cloudflare灾备决策.md`
- `docs/specs/2026-08-26_175654_G25E-1_Hosted_DR契约与稳定入口设计.md`
- `docs/plans/2026-08-26_175654_G25E-1_Hosted_DR契约与稳定入口实施计划.md`
- `docs/logs/2026-08-26_201133_平台重整G25E-1_Hosted_DR契约与稳定入口实施日志.md`
- `docs/specs/2026-08-26_230557_G25E-2_Hosted_DR故障演练与Phase2.5退出审计设计.md`
- `docs/plans/2026-08-26_230557_G25E-2_Hosted_DR故障演练与Phase2.5退出审计实施计划.md`
- `docs/logs/2026-08-27_094500_平台重整G25E-2与Phase2.5退出审计.md`
- `docs/runbooks/2026-08-27_000000_Hosted_DR生产演练授权前置与回滚.md`

恢复前必须用 `git ls-tree` / `git show` 核实路径在目标 commit 是否存在；本文路径列表不是对未来目录结构的永久承诺。

## 4. 哪些成果值得复用

即使不启用 Cloudflare LB，以下成果继续保留：

- capability/method/request class/replay policy manifest；
- Hono/Next shared core 与双 adapter contract；
- Hono D1 Gateway / Cloudflare D1 binding-Sessions 双 provider；
- public wire、CORS、secret/binding、version skew、schema expand/contract gate；
- safe-read/new-request-only/fail-closed 分类；
- non-idempotent unknown outcome no-replay；
- Hono/DR readiness；
- Redis empty、Gateway unavailable、D1 unavailable、mid-flight disconnect 等 fault evidence；
- production action authorization、停止条件和回滚思路。

真正被当前 ADR 降级的是：默认必须使用 stable logical endpoint + 外部托管 control plane，以及“未购买/未纳管 LB 就阻断默认生产构建/并轨”。

## 5. 推荐恢复方式

### 方式 A：只参考当前保留代码（优先）

当前仓库仍保留大部分 seam。未来评估 managed control plane 时，先从当时最新分支创建 spike：

```bash
git switch -c spike/managed-hosted-dr-control-plane <latest-approved-base>
rg -n "hosted-dr|stableOrigin|controlPlane|dr-readiness" config scripts apps docs
```

先复用当前 manifest/adapter/tests，再只补缺失的产品配置；不要先恢复旧 production gate。

### 方式 B：查看历史文件而不修改工作区

```bash
git show 759e98b0:docs/specs/2026-08-26_175654_G25E-1_Hosted_DR契约与稳定入口设计.md
git show a0297b7b:docs/logs/2026-08-26_201133_平台重整G25E-1_Hosted_DR契约与稳定入口实施日志.md
git show 46bf3ae3:docs/logs/2026-08-27_094500_平台重整G25E-2与Phase2.5退出审计.md
```

### 方式 C：选择性恢复单个文件

```bash
git show <checkpoint>:<path> > <temporary-path>
git diff --no-index <current-path> <temporary-path>
```

审阅差异后手工迁移仍适用的段落/实现。不要直接覆盖当前 manifest、workflow、auth、schema 或 generated file。

### 方式 D：选择性 cherry-pick

只有当目标提交职责单一、与当前依赖兼容、且已阅读 commit diff 时才可：

```bash
git cherry-pick -n <commit>
git diff --check
git status --short
```

`-n` 让维护者在提交前检查并拆除过时的 build blocker、origin 假设、workflow、secret/evidence 和 unrelated changes。G25E-1/G25E-2 大提交包含多文件安全门禁，默认不整段 cherry-pick。

## 6. 重新激活前必须重新决策的事项

未来任何 managed control plane 提案必须重新回答：

- 真实 incident/SLO/客户端版本碎片是否证明 client preflight 不足；
- 选用 Cloudflare LB、Worker router、DNS 还是其他产品，为什么；
- 固定费、计量费、流量、health monitor、origin 数和预算上限；
- 谁是服务器/开支/变更窗口/回滚 owner；
- SSE/长流是否经过代理，CPU/连接/流量成本如何；
- Provider POST 在产品层是否会被 retry、failover、hedge；
- 如何证明 non-idempotent operation 不会创建第二 Provider/第二权威效果；
- stable/primary/DR origin、CORS、Access、direct-origin bypass 和 secret 最小化；
- D1 binding/Sessions、Gateway、Redis、R2、schema/version skew；
- preview/isolated/production drill 与停止条件；
- client-preflight 与 managed mode 的迁移、兼容和单一 source of truth。

未形成新的 accepted ADR、预算授权和真实演练证据前：

- 不得把 `controlPlane.provisioning` 改为 production；
- 不得购买/创建 LB pool/monitor；
- 不得修改 DNS/Worker route/Access；
- 不得恢复“未纳管 stable control plane 阻断默认 build”的旧口径；
- 不得用历史 PASS 声称当前版本已经 production-ready。

## 7. 归档完整性核对

恢复者应至少运行：

```bash
git cat-file -t 759e98b0c9c5fc7610c6826db409c8dfafe99a40
git cat-file -t a0297b7bdf52bca8c84bd74a8d83605359050609
git cat-file -t 0551220fe08d9ee9aa43306e949a9497dfd980af
git cat-file -t 5d6b952ea909dc77d9be04bdb913ef8b063bf105
git cat-file -t 46bf3ae3c86ba0726371029aacbd259ac56b64d1
git merge-base --is-ancestor 6170b38f2ce403d1f187f4de608006001606a55e aa6ee64974009db8f1de2faf64f8380d173a8307
```

所有结果应为 commit/成功；若仓库历史已重写，先从远端 tag/bundle/其他 clone 恢复对象，不能把短 SHA 指向的新对象当作原实现。

## 关联当前决策

- [低成本 Hosted DR 与客户端预检切换主题](../topics/2026-08-29_070000_低成本HostedDR与客户端预检切换.md)
- [低成本 Hosted DR 与客户端预检切换决策](../decisions/2026-08-29_070100_低成本HostedDR与客户端预检切换决策.md)
- [客户端预检 Hosted DR 选择规范](../specs/2026-08-29_070200_客户端预检HostedDR选择规范.md)
- [低成本 Hosted DR 范围调整与客户端预检实施计划](../plans/2026-08-29_070300_低成本HostedDR范围调整与客户端预检实施计划.md)
