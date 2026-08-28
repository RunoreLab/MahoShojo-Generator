# Arena 多人 GMR-10 运行时 Hardening 与退出审查整改日志

日期：2026-08-29

状态：`DONE`

Goal：`GMR-10 hardening / fault / load audit`

实现基线：`14d0e58d`

代码 checkpoints：

- `0684bb61 feat(api): 增加 Arena Room telemetry v5`；
- `65bff17e feat(api): 接入 Room hardening 指标`；
- `eb66f6d9 test(arena): 固化 GMR-10 故障与副作用证据`；
- `c68fcd39 test(arena): 增加 Room 非生产负载基线`；
- `c63cd9b4 test(api): 稳定 verifier 安全看门狗`（full gate 并发稳定性整改）；
- `3a0c833f fix(api): 强制 Room Redis verifier opt-in`；
- `7cae4b7f fix(api): 收紧 Room verifier 安全边界`；
- `bf2bb98c test(arena): 收窄 hardening 证据口径`。

## 1. Objective 与 stopping condition

本 Goal 为 Hono + Redis 单 writer 的 Arena Room v1 补齐可执行 hardening 证据：低基数 runtime telemetry、ordered
十类故障 drill、真实 Redis/WebSocket 非生产负载基线、generation terminal effect gate exactly-once、secret/content
隔离，以及 v1 退出审计。它不执行或授权 production activation，不设置生产 SLA，也不自动启动 GMR-11、multi-instance、
sticky routing、distributed lease 或 Durable Object。

accepted GMR-10 设计第 5 节和 Goal 指南中的 stopping condition 已全部满足；GMR-11 与 GMR-H 保持独立 `DEFERRED`
决策，不由本 Goal 自动推进。

## 2. 关键设计与权威边界

- telemetry：`hono.runtime.telemetry` 显式提升为 schema v5，新增 `arenaRoom`。actor/checkpoint/socket/sync/
  publisher/incident 只接受固定 union 和数值，不接受 room/user/ticket/generation ID、正文、错误原文、URL、Provider、SQL
  或 credential。interval counter/peak reset 与 active gauge 分离；observer exception fail-soft，不反转 authority mutation。
- actor/registry：active open room 与 resident actor 分开统计；enqueue-to-complete latency、全局/单 Room queue peak、overload、
  create/recover/fence/quarantine/replacement-required 均从 authority seam 发出，不提升客户端信任。
- Redis/checkpoint：记录实际 UTF-8 serialized envelope bytes、固定 operation/outcome/latency；Redis process memory/eviction
  明确只是隔离进程采样，不冒充单 Room 精确占用。
- WSS/publisher：Room socket gauge、reconnect/current/replay/snapshot/resync、bounded outbound backlog、slow-consumer close 与
  publisher in-flight/drop/error 在实际成功 enqueue/attach 后结算；同步 throw/observer throw 不泄漏 gauge 或改变 close policy。
- fault evidence：`config/arena-room-hardening-evidence.json` 固定 ordered 10 drill ID、owner/selector、命令 allowlist、恢复分类
  与保护性断言；validator 进入 `workspace:verify`，拒绝 owner 漂移、`FLUSH*`、默认/生产 namespace 和 credential material。
- verifier safety：所有会写 Redis 的 Room/generation/process/fault/load verifier 仅允许显式
  `HOSTED_API_ENVIRONMENT=local|test`、loopback URL 与安全非默认 prefix；production/preview/未知环境均在任何连接、spawn、
  SCAN 或 DEL 前 fail closed。共享 guard 还拒绝 default/prod/production/preview/local/test/ci/verify 与历史默认 prefix；
  清理只覆盖隔离 Room/checkpoint/directory/ticket/generation namespace，并以异 namespace sentinel 证明不越界。
- terminal effect：真实 generation verifier 在既有 finalizer 的 rating settlement 与 story-impact port 外直接计数；同一
  terminal 重复 finalize 时两者 invocation 均为 `1`。该证据诚实标记 `terminalEffectScope=invocation-gates`；当前
  `applyStoryImpacts` adapter 没有外部 story 持久写，因此不宣称不存在的 external story write。
- public/data compatibility：未改变 Arena v1 public Room wire、checkpoint schema、D1 schema、Legacy/Better Auth、数据所有权
  或 non-idempotent replay policy；Redis 仍只持有 active Room/replay 协调事实，D1/R2 terminal authority 不变。

## 3. 故障与真实运行证据

### 3.1 Ordered 10 drills

| Drill | 分类 | 实际证据 |
| --- | --- | --- |
| socket disconnect | recoverable | 真实 Node WSS host disconnect 只清对应 presence；member 继续收 authoritative terminal |
| host refresh | recoverable | 单 tab close/refresh 不 revoke membership；presence/deadline 保持服务器权威 |
| Redis unavailable | recoverable | checkpoint/directory mutation fail closed；未提交 actor state 不安装 |
| Hono restart + Redis survives | recoverable | 两个真实 `createAdaptorServer` 前后以 HTTP 创建/恢复；Redis `run_id` 稳定、停机窗口 checkpoint raw 不变、room/member identity 可读、旧 epoch 位于 fence set |
| exact Redis checkpoint loss | unrecoverable | 只 exact DEL active checkpoint；lookup/join/recover 不复活，lazy cleanup 后发出 replacement-required 并创建不同 Room ID |
| stale/orphan directory | recoverable | malformed/missing/orphan candidate exact lazy cleanup，保留并发 replacement 与分页单调性 |
| generation mid-flight SIGKILL | recoverable | 子进程真实 `SIGKILL`；新进程读 durable `producer_lost`，recovery/retry Provider start 均为 0 |
| slow consumer | recoverable | bounded frame/byte queue 饱和只关闭 slow socket，要求 replay/snapshot resync |
| oversized/flood | recoverable | binary/oversized/malformed 与连接/用户 flood 在 authority mutation 前 fail closed |
| VPS unreachable | unrecoverable | 已连接真实 socket 收到 1012；shutdown 后 `gateway.prepareUpgrade()` synthetic preflight 返回 503；actor force-close、Redis seam close，旧 Room unavailable；`transparentFailover=false` |

### 3.2 本机 Redis 7.0.15 真实 verifier

- hardening fault：`checkpointUnchangedDuringRestart=true`、`honoServersStarted=2`、`redisRunIdStable=true`、
  `oldEpochFenced=true`、`replacementRequiredObserved=true`、VPS close `1012`、`secretPersisted=false`、foreign sentinel preserved；
- Room authority：full checkpoint/fence/recovery/Proposal/generation/directory/ticket/TTL matrix 全部为 `true`；
- durable generation：Provider starts `1`、real finalizer runs `2`、rating settlement invocation `1`、story-impact gate invocation
  `1`、terminal reexecution `false`、secret persisted `false`；
- process recovery：真实 `SIGKILL`，`producerLostAfterKill=true`、recovery/terminal retry Provider starts `0`，durable
  marker/error event/snapshot 一致，secret persisted `false`；
- fixed load：32 Room × 4 real WSS × 20 planned authority transition = 128 sockets / 640 transitions；含 32 次 host-online
  presence 后 actor applied 精确为 `672`，client message 精确为 `2176`，额外 operation/fan-out 会直接失败。AOF
  `appendfsync always` 在整改前后两次均通过：`6398` 为 `16826.17 ms`，共享 prefix/exact-count 整改后的 `6400` 为
  `20784.601 ms`；最终一次 actor p50/p95/p99 `920/1135/1172 ms`，checkpoint p50/p95/p99
  `916.496/1131.216/1168.557 ms`；queue peak `1`，socket
  peak/opened/closed `128/128/128`，message `2176`，error `0`，slow-consumer close `0`，eviction delta `0`，
  192 个隔离 key 清理后 remaining `0`，foreign sentinel preserved，secret persisted `false`，
  `serviceLevelObjective=null`。这些只是在 fsync-always 本机实例上的事实，不外推 production SLA。

最终验证使用独立 `127.0.0.1:6398` 与整改后 `127.0.0.1:6400` 临时 Redis；每次结束均执行 `shutdown nosave`，
随后分别删除约 5.1 MB 临时 AOF/日志目录。更早的普通隔离 Redis 负载曾约 `1447 ms`，因 Redis 持久化配置不同不与
上述 fsync-always 结果混为同一基线。
未使用生产 Redis、远端 VPS 或私钥。

## 4. Builder self-review 与阶段审查整改

Builder self-review 重点复核 observer 提交时序、active/resident gauge、checkpoint exact bytes、publisher synchronous throw、
socket delivery enqueue、incident 语义、verifier 清理边界与 manifest 声明是否超出证据。

component instrumentation 独立复审曾发现 `Critical 0 / Important 1 / Minor 3`：

- checkpoint loss 缺少 replacement-required：修为只有 directory record 存在而 authority checkpoint 缺失时发 incident，避免
  random 404 冒报；
- actor 早期 reject 未计数、sync delivery 在 `peer.send` 前计数、publisher `attach` 同步 throw 泄漏 finished gauge：均已修复并
  增加回归测试；
- README telemetry schema 版本债在本 Goal 最终文档中改为 v5。

fault/load 阶段独立复审曾发现 `Critical 0 / Important 2 / Minor 2`：

- 原 Hono restart 只重建 runtime seam：改为先后启动两个真实 Hono adaptor server，经 HTTP 创建/恢复，并比较 Redis
  `run_id` 与 checkpoint raw；
- Room/generation/process verifier 缺 production/unknown fail-closed，且存在默认 prefix：统一要求显式 local/test 与安全 prefix，
  CI/manifest 同步；
- manifest 正向测试曾使用伪 owner repository：改为验证当前真实仓库 owner/selector；
- load WebSocket open 无内部 timeout：统一纳入 verifier timeout。

final security/architecture review 又发现并关闭两个 Important：通用 Room verifier 缺显式 `ROOM_REDIS_VERIFY=true`
opt-in；五条 verifier 的运行时 prefix regex 会接受 production/default 等保留 namespace。前者由 `3a0c833f` 以缺 opt-in
零连接测试关闭；后者由 `7cae4b7f` 抽取共享 guard，并为 Room/generation/process/fault/load 补 production prefix
零连接测试。process verifier token 同时改为 strict opaque token + SHA-256 派生 ID，避免清洗/截断碰撞。

test-adequacy final review 的三个 Minor 均已关闭：load gate 由下限改为 actor `672` / message `2176` 精确计数；Hono
restart evidence 收窄为 checkpoint raw、session identity 与 fence-set 事实；VPS evidence 明确区分真实已连接 socket 的 1012
与 shutdown 后 synthetic `prepareUpgrade` 503，不再把后者描述成真实网络 upgrade。

上述整改后的 targeted、安全负向、真实 Redis fault/generation/process/Room/load、API build/lint 均已重新通过。最终三路复审
结论在第 6 节记录。

## 5. 实际验证

已完成：

- 最终 verifier safety/load targeted：API `4 files / 31 tests PASS`；root workflow/evidence `3 files / 21 tests PASS`；
- `pnpm --filter @mahoshojo/api test`：`47 files / 470 tests PASS`；
- `pnpm --filter @mahoshojo/api run build`：PASS；
- `pnpm --filter @mahoshojo/api run lint`：PASS；
- `pnpm run check:arena-room-hardening`：`10 drills / productionExecution=DEFERRED / PASS`；
- 真实 loopback Redis fault、Room、generation、process 与 load verifier：全部 PASS，详细输出见第 3 节；
- 首次 `pnpm ci:verify` 在 workspace 并行 CPU 争用下发现两条 safety child-process test 的 5 秒 watchdog
  过短：脚本尚在 `tsx` 启动阶段即被测试自身 `SIGKILL`，且实际 Redis connection 仍为 `0`。`c63cd9b4` 将四组
  child-process safety test 统一为 10 秒有界 watchdog，并给原先可能无限等待的两组补 timeout；整改后 standalone
  当时的 `4 files / 24 tests`、API `47 files / 463 tests`、build/lint 通过；后续 prefix guard 回归把当前计数增加到
  `31` 与 `470`；
- 最终 `pnpm ci:verify`：PASS。第一次最终复跑在机器 load average `8.55`、swap 已满时出现 8 个 Web 文件的 15 秒
  timeout 和一个受遗留异步状态影响的断言失败；Web standalone 随即以 `358 files / 1972 tests PASS` 通过。负载回落后
  原命令完整重跑 PASS，未修改无关 Web 实现或放宽测试门槛。最终 workspace boundary、naming report-only gate、Hosted DR
  schema/contract、user-visible structural contracts、10-drill hardening gate、全部 workspace test/lint/build、API `47/470`、Web `358/1972`、
  Hosted runtime `57/330`、multiplayer-core `10/84`、Next `188/188`、preview fail-closed、Hosted DR executable
  evidence、Arena release writer-disabled gate、root `21 files / 211 tests` 与 root lint 全部通过；
- `git diff --check`：PASS。

既有 naming `1425` 条为 report-only；preview physical D1、stable production control plane 与真实 production drill
保持既有 `DEFERRED`，未作为 GMR-10 新回归。

## 6. Independent final review

最终三路独立复审全部 `PASS`：

- architecture/authority：先前 production/default 等保留 prefix、process token 派生碰撞与 load 精确计数问题已由
  `7cae4b7f` 关闭；最终 Critical `0` / Important `0` / Minor `0`；
- security/compatibility/replay/data：缺失 `ROOM_REDIS_VERIFY=true` 显式 opt-in 的 Important 已由 `3a0c833f` 关闭；
  最终 Critical `0` / Important `0` / Minor `0`；
- test-adequacy/load/evidence：load exact counts、Hono restart 与 VPS 503 证据口径三个 Minor 已由 `7cae4b7f`、
  `bf2bb98c` 与本日志关闭；最终 Critical `0` / Important `0` / Minor `0`。

## 7. 状态矩阵与影响

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| GMR-10 implementation | `PASS` | telemetry、instrumentation、fault manifest/verifier、load baseline 已实现 |
| GMR-10 final validation/review | `PASS` | full validation 与三路 final independent review 全部关闭 |
| public Arena v1 wire / checkpoint schema | `NOT_APPLICABLE` | 未改变 public wire 或持久化格式 |
| production deploy/cutover/fault drill | `DEFERRED` | 未授权、未执行；本地证据不得描述为生产演练 |
| production schema/DB/Redis write | `NOT_APPLICABLE` | 无 migration；只写隔离 loopback Redis |
| secret/Access/credential | `NOT_APPLICABLE` | 未读取私钥、未变更 credential；secret canary 未持久化 |
| release/tag/push/history rewrite | `NOT_APPLICABLE` | 未执行 |
| GMR-11 production activation | `DEFERRED` | 必须另行人工/平台 go/no-go，不由本 Goal 自动推进 |
| GMR-H multi-instance/DO | `DEFERRED` | 仅留下指标事实，不满足自动启动条件 |
| blocker | `BLOCKED: no` | 无未关闭 Critical/Important/Minor 或人工判断 blocker |

## 8. 回滚

按 checkpoint 逆序 revert：`bf2bb98c` → `7cae4b7f` → `3a0c833f` → `c63cd9b4` → `c68fcd39`
（verifier/load）→ `eb66f6d9`（fault/evidence/CI）→ `65bff17e`
（component instrumentation）→ `0684bb61`（telemetry v5）→ 最终文档 checkpoint。回滚无需 D1/Redis migration；当前没有
production writer/route activation。若只需停止 verifier，不运行显式 opt-in command 即可，但 feature/config 不替代代码回滚。

## 9. 当前剩余工作

GMR-10 范围内无剩余工作。GMR-11 production activation 与 GMR-H multi-instance/DO evaluation 继续 `DEFERRED`，必须分别
满足外部门禁并获得人工/平台 go/no-go 后另开 Goal；本 Goal 不把它们转为 `READY`。
