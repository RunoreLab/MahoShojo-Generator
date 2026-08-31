# Arena 生产 Room 入口复用 Hono Primary 决策

状态：`accepted`
日期：2026-08-31
决策标识：`ADR-arena-room-reuse-hono-primary-origin-v1`
适用范围：Arena 多人 v1 production HTTPS/WSS ingress、GMR-11 及后续 production activation
基线分支：`feature/v0.2.0_Battle_Growth_MahoShojo`
基线提交：`3a972bd51909a1ae00990ef91e041ddad9ea0147`

## 1. 背景

Arena 多人 v1 已经冻结为 `apps/api` / Hono + Redis single-writer；Room HTTP/WSS、ticket、membership、reconnect、
Proposal 与 generation publisher 都由同一 Hono runtime 承载。GMR-11 的后续实现又为 production Room 单独引入了
`api.mahoshojo.colanns.me` 这一 logical origin，并围绕它增加：

- `config/arena-room-origins.json` 的 production `logicalOrigin` / `provisioning`；
- 独立 DNS、Caddy site 与 TLS provision 步骤；
- `ARENA_ROOM_LOGICAL_ORIGIN`；
- `NEXT_PUBLIC_ARENA_ROOM_ORIGIN`；
- Room 专属 origin generator、projection 与 contract test；
- production workflow / canary 对该 hostname 的额外门禁。

但这一 hostname 当前仍指向与既有 Hono primary 相同的唯一 production Hono 实例，没有形成第二 failure domain、
独立流量调度、独立扩缩容、独立认证边界或可用性能力。因此它主要增加了配置、证书、CORS/Origin 推理、部署与
故障排查表面，而没有为 Arena v1 提供等量的运行价值。

RFC 6454 把 Web Origin 定义为 scheme/host/port 保护域；新增 hostname 会形成新的 origin，而不是免费的逻辑别名。
RFC 6455 的 WebSocket opening handshake 通过目标 host、resource name、Origin 与 subprotocol 建立连接，并不要求
一个业务功能必须拥有独立 hostname。Cloudflare 的 DNS-only 记录也只做名称解析，不会因为多一个名称自动产生
proxy/failover/control-plane 能力。

## 2. 决定

### 2.1 production Room 复用已有 Hono primary public origin

Arena 多人 v1 的 production Room HTTPS/WSS **MUST** 复用 Hosted 平台现有 Hono primary public origin。

在本决策基线下，该 origin 为：

```text
https://homura.colanns.me
```

这只是当前 deployment placement，不成为 Arena wire protocol 的永久产品标识。若未来 Hosted Hono primary origin
按平台决策迁移，Room v1 应随共享 primary origin 更新，而不是维护第二份 Arena hostname 迁移逻辑。

### 2.2 不再把独立 Room hostname 作为生产前置

Arena v1 **MUST NOT** 因 production activation 新建或要求：

- `api.mahoshojo.colanns.me` 的 Room 专属 DNS；
- Room 专属 Caddy site / TLS certificate；
- 仅用于把同一 Hono 实例包装成“logical Room origin”的 proxy；
- 第二套 Room service-origin source of truth；
- 仅用于证明上述 hostname 已 provision 的 release gate。

`api.mahoshojo.colanns.me` 若被其他 Hosted 架构作为 optional/reference-only stable origin 保留，不在本 ADR 中删除；
但 Arena realtime v1 **MUST NOT** 依赖它才能上线。

### 2.3 协议身份由 path + protocol contract 表达

Room v1 继续使用现有版本化接口：

```text
HTTP  /api/arena/rooms/v1/...
WSS   /api/arena/rooms/v1/ws
Sec-WebSocket-Protocol: mahoshojo.arena-room.v1
```

Room 的协议版本、安全语义和 capability 应由 route、schema、ticket、epoch/revision 与 WebSocket subprotocol 表达，
不以 hostname 区分业务协议版本。

### 2.4 caller Origin 与 service origin 分离

Browser `Origin` allowlist 继续是安全边界，但它描述的是**谁发起请求**，不是 Room 服务必须使用哪个独立 hostname。

- Web production caller 仍可精确允许 `https://mahoshojo.colanns.me`；
- Preview caller 可保留其精确 allowlist；
- installed client 不以 browser `Origin` 作为 trust root；
- 允许来源与 service endpoint 必须在概念、配置命名和测试中分离。

因此本决策不放宽 CORS / WebSocket Origin 校验，也不改 ticket/auth/rate-limit/backpressure 语义。

### 2.5 保留 Room v1 的现有故障边界

本决策只简化 ingress，不改变 authority：

- Hono + Redis single-writer 不变；
- Redis checkpoint / directory / replay fence 不变；
- D1 durable business facts 不变；
- authoritative generation/finalization 不变；
- Room realtime 继续 `cloudflareDr=excluded` / fail closed；
- 不把同一个已 dispatch 的 Room/generation command 透明重放到另一个 runtime；
- 不宣称活动 Room 具备跨 Hono/VPS failure-domain 热接管。

### 2.6 避免重复配置

架构重整后，Room production service origin **MUST** 从既有 Hosted primary origin source of truth 派生或直接复用，
不得再由以下项目各自维护一份可漂移的生产值：

- `config/arena-room-origins.json.production.logicalOrigin`；
- `ARENA_ROOM_LOGICAL_ORIGIN`；
- `NEXT_PUBLIC_ARENA_ROOM_ORIGIN`；
- workflow 内硬编码 hostname。

迁移期若为了兼容旧代码暂时保留其中某项，它 **MUST** 与共享 primary origin 做 exact equality 校验，并在同一重整
切片中设定删除点；不能把“暂时相等的两个配置”继续当成两个权威来源。

## 3. 被覆盖范围

本 ADR 覆盖以下现行文档中“必须先 provision 独立 production logical Room origin”以及由此衍生的要求：

- `docs/plans/2026-08-30_231000_Arena多人生产激活与回滚实施计划.md`；
- `docs/plans/2026-08-27_Arena多人Goal切片执行指南.md` 中 GMR-11 “等待 production logical origin”的表述；
- GMR-11 历史日志中对当时未 provision hostname 的 blocker 判断，仅作为历史事实保留，不再作为未来门禁。

以下文档/决策不被本 ADR 取代：

- `ADR-arena-room-portable-runtime-hono-redis-first`；
- `SPEC-arena-multiplayer-hono-redis-runtime-amendment-v1`；
- Redis-only Room directory 修订；
- Hosted DR 的 capability/no-replay/active-passive 边界；
- production request flag、Web exposure、immutable writer capability 与 rollback baseline。后续发布流程已由
  `SPEC-arena-room-primary-ingress-simplification-v1` 收敛为默认分支单流水线，不再保留人工 go/no-go token。

## 4. 不采用的方案

### 4.1 继续 provision `api.mahoshojo.colanns.me`

不采用。它目前只给同一 Hono 实例增加别名，没有产生独立 availability/control-plane 价值，却需要额外 DNS/TLS/Caddy、
环境变量、client projection、测试和 runbook。

### 4.2 把 Room 迁回独立 Worker / Durable Object

不采用。当前没有新的规模、SLO 或故障数据足以推翻 Hono + Redis v1 决策；这会重新引入已明确撤出的运行时复杂度。

### 4.3 顺手删除整个 Hosted stable-origin / DR seam

不采用。本 ADR 只处理 Arena realtime ingress。其他 Hosted generation 的 client-preflight、DR adapter 和未来 optional
control plane 有独立决策，不应借 Arena 简化扩大重构范围。

## 5. 未来重新引入独立 Room hostname 的门禁

只有出现以下至少一类真实需求，并由新的 accepted ADR 说明收益大于复杂度时，才可重新引入独立 Room hostname：

1. Room 与其他 Hono API 需要不同的真实 routing / reverse-proxy policy；
2. Room 需要独立 failure domain、扩缩容或连接容量隔离；
3. 生产 incident/SLO 数据证明共享入口造成不可接受风险；
4. 需要独立 WAF、Access、证书或网络控制，且无法在 path/service policy 上安全实现；
5. 已有明确的 owner、监控、变更窗口、故障演练与回滚 runbook。

“命名更清晰”“未来也许会扩容”或“看起来更像微服务”不能单独触发该复杂度。

## 6. 影响

正面影响：

- 删除一个没有独立故障域收益的 production provision blocker；
- 减少 DNS/TLS/Caddy/env/client projection/workflow/test 的重复 source of truth；
- 浏览器 Origin、安全策略与服务地址概念更清晰；
- production canary 直接验证真实 Hono primary，故障定位链更短；
- 保留后续真正需要独立 ingress 时再演进的空间。

代价：

- Room 与其他 Hosted API 共享 Hono ingress 的连接/入口故障域；
- future Room 专属扩缩容需要新的迁移；
- 本次只冻结重整规格，现有代码中的旧 origin seam 仍需按配套规格删除/收敛后才能进行新的 production activation。
