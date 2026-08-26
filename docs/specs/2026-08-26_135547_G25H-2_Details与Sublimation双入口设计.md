# G25H-2 Details 与 Sublimation 双入口设计

> 状态：active implementation design
> Goal：`G25H-2 Details / Sublimation re-entry`
> 基线：`05b64453`（`refactor/platform-rearchitecture`）
> 适用上位口径：平台重整 accepted ADR/architecture/spec、Hosted 长生成断网可恢复流规格、Goal 自治执行与验收规格

## 1. Objective 与当前事实

本 Goal 将以下四条能力从 `exitedRouteIds` 重新纳入 Hono primary，并保留 Next/OpenNext disaster-recovery（DR）入口：

- `generate-magical-girl-details`
- `generate-magical-girl-details-stream`
- `generate-sublimation`
- `generate-sublimation-stream`

启动描述中的约 2,478 行不是当前事实。基线四个 handler 合计 2,341 行：Details 691 + 361 行，Sublimation 951 + 338 行。route inventory 为 18 shared / 10 exited / 0 legacy。四路仍由 `apps/web` handler 独占，尚无 Hono adapter；Hono session path 的 Cloudflare → Hono SSE parse/re-encode self-hop 已由 G25H-1 消除，本 Goal 不得重新引入类似 self-hop。

## 2. 强制不变量

- 客户端输入始终不可信；限速、安全检查、Provider 校验、原生问卷解析与签名决定均由服务器执行。
- 签名密钥、Provider 凭据、管理能力不得进入客户端或 wire；日志与 telemetry 不记录 prompt、卡片正文、问卷回答、URL、Provider 配置或 secret。
- Hono primary 与 Next DR 必须调用同一 package service / runtime composition；禁止 app→app import、动态导入 Next handler 或 Hono→Cloudflare self-hop。
- Legacy/Better Auth、Arena v1 authority/wire、D1/DO/R2 所有权不变；Redis 不获得业务权威。
- 生成一旦可能开始，不做透明盲重放；现有四路保持单次请求语义，流式请求继续透传 `Request.signal`。
- 现有 method/status/error/body/header、AI meta、reasoning SSE、活动记录、问卷答案映射与 custom Provider 兼容保持不变。

## 3. 方案

### 3.1 Shared service 与双入口

在 `@mahoshojo/hosted-api` 提供 Details / Sublimation 的应用服务 contract，在 `@mahoshojo/hosted-runtime` 提供四个 runtime。`node-runtime/default-services` 完成唯一默认 composition：

```text
apps/api adapter ─┐
                  ├─ default service ─ runtime ─ safety/rate/provider/signature/D1 ports
apps/web handler ─┘
```

Web handler 缩为显式 compatibility adapter；Hono adapter 直接导出同一默认 service。非 POST method 与异常 wire 由 shared service 固定，避免两个入口漂移。

### 3.2 Details

Details 复用现有 questionnaire seam：preset index、selection/native resolution、answer lookup、长度校验、lore、custom Provider、structured/raw AI、签名、activity 与 AI meta。非流式继续只在服务端重新解析的 native questionnaire 且无超限答案时签名；stream 继续输出 Markdown/reasoning SSE，不伪造结构化签名。两路均逐答案安全检查并保持 `magical_girl_details_generate` 限速 action。

### 3.3 Sublimation

Sublimation 的角色卡转换、Arena history retention/current_state finalization 是纯领域规则，迁入 `@mahoshojo/domain` 成为唯一权威实现；原 Web helper 保留薄 re-export，既有 UI/测试调用不变。runtime 复用 questionnaire native resolution 与 Node signature ports：

- 验证原卡签名；
- 仅在原卡 native、无非原生 guidance/history/lore，或 accepted 配置允许 guided signing 时重签；
- native lore 必须由服务器按 selection 重新加载，失败即 fail closed 取消签名；
- 非原生数据参与时删除签名；
- `arena_history` retention、`current_state` 读写开关与 immutable names 均由共享 finalize 执行。

stream 保持当前 Markdown wire，不执行结构化 finalize/re-sign；它与非流式共享输入裁剪、安全、Provider 与 abort 规则，而非把两种产品输出错误地合并为同一 wire。

### 3.4 Telemetry

新增受信任的 G25H execution observation，仅包含：

- operation：四个固定枚举；
- placement：`hono-primary | next-dr`；
- outcome：`success | rejected | failure | cancelled`；
- durationMs。

Hono runtime snapshot 聚合上述维度，并与既有 process CPU/event-loop/AI upstream telemetry 同时采样；Next DR 输出同 schema 的结构化 lifecycle log。它用于按 operation/placement 对齐 CPU 与延迟观测窗口，不声称在本地构造 Cloudflare 生产 CPU 数据，也不把路由选择伪装成已观测事实。

## 4. Atomic checkpoints 与回滚

1. `domain`: 下沉 Sublimation 纯规则并让 Web helper 兼容转发；可单独 revert。
2. `details`: 增加 shared Details contract/runtime/tests，Web 先切同 service，但尚不改 route inventory；可单独 revert。
3. `sublimation`: 增加 shared Sublimation contract/runtime/tests，Web 先切同 service，但尚不改 route inventory；可单独 revert。
4. `routes`: 增加四个 Hono adapter、telemetry、manifest 22 shared / 6 exited、文档与边界测试；整体 revert 即恢复 Next-only 路由。
5. `review`: 只处理审查 finding 与证据文档，不改变验收标准。

每个行为 checkpoint 先增加失败测试并保留 RED 证据，再实现 GREEN；每批运行受影响 package/app 的 test、typecheck/lint/boundary checks。任何 checkpoint 都不得依赖 production schema、secret 或 deploy 才能回滚。

## 5. Stopping condition

只有同时满足下列条件才完成 Goal：

- 四路进入 22 shared / 6 exited / 0 legacy，生成 manifest 无 Next 动态 import；
- Hono/Next handler identity 或 adapter parity 证明两入口使用同一默认 service；
- auth/限速、安全、Provider、签名、问卷 native 许可、Arena history/current_state/finalize、abort 与 wire 兼容测试通过；
- telemetry 不含敏感载荷且可按固定 operation/placement 比较；
- hosted-api、domain、hosted-runtime、apps/api、apps/web targeted tests/typecheck/lint、workspace boundary/contract、Hono bundle 与 Cloudflare build 通过；
- Builder self-review 与独立 architecture、security/authority、compatibility/replay/data、test-adequacy review 无未关闭 Critical/Important finding。

## 6. 明确不在范围内

- production deploy/cutover、远程 DB/Redis 写操作、secret/Access/credential 变更、release/tag/push；
- G25H-3（Magic Tea Party / Tavern / battle report regenerate）；
- 为已有 unrelated warning/audit/naming debt 做全仓清债；
- 为普通 Details/Sublimation 请求新增透明重放或可恢复长生成协议。
