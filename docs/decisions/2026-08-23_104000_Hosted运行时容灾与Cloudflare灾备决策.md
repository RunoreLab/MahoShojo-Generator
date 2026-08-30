# Hosted 运行时容灾与 Cloudflare 灾备决策

状态：`accepted`
日期：2026-08-23
决策标识：`ADR-hosted-runtime-resilience-cloudflare-dr`

## 背景

项目已经把一组 Hosted 生成与长流接口迁移到香港 Hono Node，以降低 Cloudflare Workers CPU 压力，并继续通过 D1 Gateway 使用 Cloudflare D1。迁移期 Next.js/OpenNext Route Handler 仍保留，因此当前代码具备低成本双运行时基础，但这部分能力尚未被定义为长期容灾边界。

香港自托管服务器、Tunnel、Node 进程、同机 Redis 与所在网络都属于可独立故障的计算基础设施。项目不能把单台 VPS 的存活当作线上数据正确性或 Hosted 能力持续可用的前提。

同时，简单采用“主 Hono 失败后把原请求再发一次 Next”会给生成、结算等非幂等操作带来重复 AI 调用、重复计费、重复 generation 或重复权威写入风险。因此容灾必须同时冻结执行面、数据权威、流量选择与重放语义。

## 决定

### 1. Hono 是主执行面，Cloudflare 是受控灾备执行面

Hosted/authoritative HTTP 能力采用：

- `apps/api` / 香港 Hono：默认主执行面；
- `apps/web` / Next.js/OpenNext Cloudflare runtime：对明确列入 DR capability/route manifest 的能力提供长期灾备 adapter；
- `apps/arena-room` / Durable Object：继续按 Arena Room ADR 维护其独立 realtime authority，不因本 ADR 并入 Hono 或 Next；
- Desktop/Mobile 的 Local/Direct 能力继续作为无需项目 Hosted runtime 的独立降级路径。

Cloudflare DR adapter 是长期架构能力，不是等待删除的 legacy API 副本。

### 2. 只允许一份业务核心，不维护两套后端业务实现

Hono 与 Next 必须调用同一份共享 service/domain/contracts。运行时差异只存在于 adapter、依赖注入、数据库 transport、任务调度、请求上下文与平台能力边界。

目标结构：

```text
                 shared service / domain / contracts
                         ▲                   ▲
                         │                   │
                  Hono runtime adapter   Next DR adapter
                         │                   │
                   apps/api / HK        apps/web / CF
```

迁移期 `apps/api -> apps/web/app/api/*` 动态 import、根应用 Route wrapper 或其他 app-to-app 源码复用仍然必须删除。**长期保留的是经过 contract test 的 DR adapter，不是 legacy import 层。**

### 3. 客户端只依赖稳定逻辑入口，不编码物理主机

目标状态下，Web/Installed Client 调用项目 Hosted API 时依赖稳定逻辑 endpoint；Cloudflare 或等价独立控制面负责把请求选择到当前可用的执行面。

客户端不得以“重新构建/重新发布前端，把 `homura` 改回同源 Next”作为正式故障切换机制。Hono 主机名可以作为 origin/运维地址存在，但不应成为客户端长期绑定的唯一可用入口。

具体采用 Cloudflare Load Balancing、Worker 路由、DNS/配置切换或其他机制由实施阶段结合账号能力、成本和流式代理 CPU 评估决定；不得为了容灾把全部长流无条件再次穿过高 CPU Worker 代理。

### 4. DR 范围显式声明，不要求所有 API 双运行

维护版本化 DR capability/route manifest。只有满足以下条件的能力才进入长期 DR：

- 用户价值或服务器权威语义要求在 Hono 故障时继续提供；
- 两个 runtime 可以共享同一业务核心和契约；
- 所需 secret、数据库 transport 与平台能力能够以最小权限安全提供；
- 已有跨 runtime contract test 和故障演练。

未列入 DR 的能力可以在主执行面故障时返回明确的 `503`/degraded 状态，不为了“100% 覆盖率”复制实现。

### 5. 数据权威与执行面分离

线上事实按领域继续由既定持久化层权威维护：

- D1：账号、线上卡、generation/结算/rating/audit 等关系型业务事实（按现有领域定义）；
- Durable Object storage：Arena 单房间 lifecycle、membership/revision 等 Room 权威状态；
- R2：已定义为大对象或最终对象存储的内容；
- Redis：缓存、限流、租约、presence、Pub/Sub、短期 stream、允许损失的聚合；
- VPS 本地磁盘：部署包、临时文件、日志或可重建运行态，不得成为唯一业务事实源。

服务器迁移或整台 VPS 丢失后，恢复新 `apps/api` 实例不应要求从旧服务器磁盘抢救用户业务数据。

### 6. Redis 永不提升为业务权威

判断某类状态能否只放 Redis 的标准不是“重要/不重要”或“高频/低频”，而是：**Redis 全部被清空后，是否仍能从权威状态恢复业务正确性。**

因此：

- cache miss/Redis outage 可以回源 D1/DO/R2 或明确降级；
- Redis lease/idempotency 只能减少重复工作，不能替代 D1 CAS、唯一约束、DO 原子状态转换或权威幂等记录；
- Redis presence、matchmaking queue、Pub/Sub 丢失只影响实时体验或等待队列，不改变已经成立的业务事实；
- rating、结算、兑换、审计、账号权限与不可恢复用户资产不得只存在 Redis；
- Redis 故障不得触发“把缓存当数据库继续写”的降级。

### 7. 主执行面与 DR 执行面尽量避免共同故障路径

Hono 正常路径继续使用受控 D1 Gateway；Cloudflare DR 在运行时允许时应优先使用原生 D1 binding / Sessions，而不是再次依赖同一个香港实例或强制依赖与 Hono 相同的 Gateway transport。

两个 DatabaseProvider 必须保持同一业务一致性契约。使用 D1 read replication 时：

- 允许陈旧的读取可以使用 `first-unconstrained`；
- 登录写、权威命令、写后读应从 `first-primary` 或现有等价强语义开始；
- 后续读取传播 D1 bookmark，保持 sequential consistency/read-your-own-writes；
- runtime 切换不得静默降低已经承诺给业务 service 的一致性语义。

### 8. Failover 以请求语义分类，禁止盲目重放非幂等操作

请求至少分为三类：

1. **safe/read 类**：GET/HEAD 等无副作用读取，可在健康检查判定主执行面不可用时自动选择 DR；
2. **durably-idempotent command 类**：具有稳定 request ID、权威去重/CAS/唯一约束且 contract test 证明重复提交不会产生第二次业务效果的写操作，可按明确策略进行重试或切换；
3. **generation/stream/settlement 等非幂等或昂贵操作**：在开始执行前选择 runtime。一旦请求可能已经到达主执行面、上游 Provider 已经开始计费或权威写入已经发生，不得因为客户端/代理看见连接失败就透明地跨 runtime 重放整个操作。

生成类恢复必须围绕稳定 `generationRequestId` / operation ID、attempt、状态查询和最终结果恢复建立，而不是依赖第二次 POST。

若具体 Cloudflare 流量产品提供请求级 zero-downtime retry/adaptive failover，非幂等路由必须验证其重试触发条件；无法证明“请求未执行或重复执行无副作用”时，关闭该路由的透明重放能力或改用只在新请求开始前生效的健康路由选择。

### 8.1 默认 active-passive，不默认双活写

Hosted DR 默认使用 active-passive：Hono 健康时由主执行面承载 DR capability，Cloudflare adapter 保持可接管但不与主执行面随机分摊权威/非幂等写流量。

只有 safe/read 或已经通过并发、幂等、quota 和一致性证明的能力，才可以另行采用 active-active。恢复主执行面后的 failback 只影响新请求，不得重新提交正在恢复或状态未知的旧 operation。

### 8.2 DR 必须保持新鲜，部署版本偏差受控

长期备用端必须随主线持续 build/test/deploy 或保持可立即部署的同源已验证 artifact，不能依赖数月未演练的历史版本。

共享 schema/contract 变更必须考虑 Hono 与 DR 的短暂版本偏差：

1. 先做 backward-compatible expand；
2. 更新 shared core 与两个 runtime adapter；
3. 对 Hono/DR 运行 contract/synthetic probe；
4. 确认不再需要旧字段/协议后才执行 contract/destructive cleanup。

任何会让当前 DR artifact 无法读取生产 schema 或接受当前 client contract 的变更，都必须先修复 DR compatibility，不能等事故发生后再发现。

### 9. DR 保持语义等价，可以缩容但不能静默降权

Cloudflare DR 可以采用更保守的：

- 并发上限；
- daily quota；
- provider/channel allowlist；
- 输出上限；
- 保护性 `429`/`503`；

但同一公开能力在 DR 下不得静默改变 authentication/actor resolution、身份、签名、排位、审核、幂等或数据所有权语义；认证失败不得自动降为匿名成功。

若某能力所需 signing secret、Provider secret 或其他高权限 secret 没有安全配置到 DR，则该能力必须 fail closed，而不是返回“看起来成功但不具备原语义”的结果。

### 10. Secret 只按 DR capability 最小复制

长期 DR 不意味着把 Hono 全部生产秘密复制到 Web Worker。

- 每项 DR capability 单独列出所需 secret；
- 能不复制的高权限 secret 不复制；
- DR secret 使用独立部署权限、轮换和审计；
- 客户端 bundle 永远不能获得服务器 secret；
- secret 缺失时 readiness/capability 必须准确报告不可用。

### 11. D1 自身故障采用明确降级，不立即引入第二套数据库双写

Hono 与 Cloudflare DR 共享 D1 authority，因此 D1 故障属于本 ADR 明确接受的共同依赖故障域。本轮不为了 VPS 容灾引入第二套跨云 SQL authority、双写或自动冲突合并。

D1 不可用时：

- 需要线上权威读写的功能明确失败或降级；
- Redis 不提升为权威库；
- 已缓存的公共只读内容只在缓存语义允许时继续展示，并标记适当陈旧状态；
- Desktop/Mobile Local/Direct、本地库和无需项目域名的能力继续可用；
- 通过 D1 Time Travel、长期导出和恢复 runbook 处理数据恢复，而不是从 Redis/VPS 推断事实。

### 12. 容灾能力必须通过故障演练维持

至少覆盖：

- Hono 进程/主机不可达：DR eligible 路由无需重新发布客户端即可切换；
- Redis 全部不可用/清空：核心业务事实和权威写入仍正确，允许的实时能力按设计降级；
- D1 Gateway 不可用：Hono readiness 失败/熔断，DR eligible Cloudflare path 可使用独立 binding transport；
- 生成中途断链：不会因为 failover 创建第二次 AI generation；
- D1 不可用：不会把 Redis 或本机磁盘提升成 authority；
- DR secret 缺失：对应 capability fail closed；
- Hono/DR version skew：当前 client contract 与生产 schema 在切换时仍兼容；
- D1 point-in-time restore / 长期导出 runbook 定期验证。

演练结果记录实际恢复时间、受影响能力、未恢复依赖与人工步骤；在有真实基线前不在 ADR 中虚构 SLA 数字。

### 13. Hono 资源可观察性是容灾门禁的一部分

主执行面至少采集：

- process CPU、RSS、heap used/limit；
- event-loop utilization 与 event-loop delay；
- active HTTP requests、active streams、长连接/socket 数；
- AI upstream active、TTFB/total duration、abort/timeout；
- D1 Gateway round trips、latency、rows read/written、error class；
- Redis latency、error、hit/miss、memory/eviction；
- runtime origin/DR selection/failover reason。

容量告警阈值在取得生产基线后冻结；不得仅凭单个 CPU 百分比判断 Hono 是否健康，也不得在没有测量的情况下把 arbitrary threshold 写成长期规范。

## 影响

### 正面影响

- 单台香港 VPS、Tunnel 或 Hono 进程失效不必等同于全部 Hosted 能力同时失效。
- Cloudflare DR 与 Hono 可以共享同一业务核心，避免长期维护两套后端逻辑。
- D1/DO/R2 的权威地位不随计算节点切换而变化。
- Redis 可以更积极承载高频、可丢失状态，而不会扩大数据正确性风险。
- Local/Direct-first 与服务器容灾形成互补：项目服务器故障时仍保留设备侧可用路径。

### 代价

- DR adapter、route manifest、secret capability 和跨 runtime contract tests 需要长期维护。
- 非幂等生成不能使用最简单的“失败自动重试到备用 origin”模型。
- Cloudflare DR 仍与 D1、Cloudflare 边缘/账号等共享部分基础设施故障域，不能被描述成完整跨云灾备。
- 为避免共同故障，需要维护两个 DatabaseProvider/transport adapter 及一致性测试。

## 不采用的方案

- **Hono 全量替换 Next 后删除所有 Cloudflare API adapter**：降低日常维护面，但使单台自托管计算节点成为 Hosted 可用性的明显单点。
- **长期维护两套独立业务代码**：修复和安全策略会漂移，DR 越久越不可相信。
- **浏览器发现 Hono 失败后无条件重试同源 Next**：可能重复执行非幂等生成、计费和权威写入。
- **Redis 作为 Hono 故障时的临时主数据库**：缓存/租约语义无法替代权威约束和恢复能力。
- **本轮增加第二套 SQL 数据库并双写**：复杂度和一致性风险远高于针对 VPS 故障的收益。
- **为了统一切流把所有 SSE/长流重新代理进高 CPU Worker**：可能重新引入此前已出现的 Cloudflare CPU 成本问题；是否代理必须经过实际资源测量。

## 当前实现与迁移差距

截至 2026-08-23：

- Hono 已通过白名单承载一组生成型 API，但仍动态复用 legacy Next route module；
- `config/hono-api.ts` 仍让客户端直接选择 `homura` origin，尚不是独立控制面的稳定逻辑入口；
- Next handler 仍可作为人工回滚面，但尚未形成长期 DR manifest、跨 runtime adapter contract 与故障演练；
- D1 authoritative / Redis cache-rate-limit 方向已经存在；Redis 更广泛使用仍应遵循本 ADR 的 non-authority 边界；
- Hono 已有 liveness/readiness 和基础错误日志，但资源 telemetry 尚需补齐。

这些属于迁移差距，不改变本 ADR 的目标状态。

## 外部依据（非规范性）

核验日期：2026-08-23。外部平台行为变化时以官方最新文档为准。

- Cloudflare Load Balancing — Active-passive failover：
  <https://developers.cloudflare.com/load-balancing/load-balancers/common-configurations/>
- Cloudflare Load Balancing — Monitors：
  <https://developers.cloudflare.com/load-balancing/monitors/>
- Cloudflare Load Balancing — Adaptive routing / zero-downtime failover：
  <https://developers.cloudflare.com/load-balancing/understand-basics/adaptive-routing/>
- Cloudflare D1 — Global read replication / Sessions and bookmarks：
  <https://developers.cloudflare.com/d1/best-practices/read-replication/>
- Cloudflare D1 — Time Travel：
  <https://developers.cloudflare.com/d1/reference/time-travel/>
- RFC 9110 §9.2.2 Idempotent Methods：
  <https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2>
- Node.js 24 `perf_hooks`（`eventLoopUtilization` / `monitorEventLoopDelay`）：
  <https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html>

## 关联文档

- [Monorepo 与应用边界决策](./2026-08-22_022200_Monorepo与应用边界决策.md)
- [本地优先与服务器权威边界决策](./2026-08-22_022100_本地优先与服务器权威边界决策.md)
- [Arena Room 部署边界与实时权威决策](./2026-08-22_184800_ArenaRoom部署边界与实时权威决策.md)
- [平台重整目标架构](../architecture/2026-08-22_022500_平台重整目标架构.md)
- [平台重整实施规格](../specs/2026-08-22_022600_平台重整实施规格.md)
- [平台重整分阶段实施计划](../plans/2026-08-22_022700_平台重整分阶段实施计划.md)
