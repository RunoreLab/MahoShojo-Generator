# Arena 多人 GMR-10 运行时 Hardening 与退出审计设计

日期：2026-08-28

状态：`accepted goal / implementing`

实现基线：`14d0e58d`

上位口径：

- `ROOMRT-023`～`ROOMRT-029`；
- Arena 多人 Goal 切片执行指南的 `GMR-10`；
- Hono + Redis v1 仍是唯一 Room authority runtime，production writer 继续 disabled。

## 1. Objective 与非目标

GMR-10 补齐 Room v1 首发前的低基数运行时指标、十类故障演练索引、真实 loopback Redis/WebSocket 非生产负载基线与退出审计，
让 Phase H 是否值得启动可以依据数据讨论。它不设置生产 SLA，不执行生产 deploy/Redis/D1/secret 操作，也不自动触发 GMR-11、
multi-instance、sticky routing、distributed lease 或 Durable Object。

## 2. Telemetry schema v5

`hono.runtime.telemetry` 从 schema v4 显式提升到 v5，并新增 `arenaRoom`。旧字段保持原语义；这是 app-local log schema，
不是 public Room wire。

### 2.1 固定观测词汇

内部 `ArenaRoomRuntimeObserver` 只接受固定 union，不接受 roomId、user/account、ticket、generation ID、Proposal、正文或错误原文：

- registry gauge：open active rooms、resident actors；
- actor queue：全局 queued current/peak、单 Room peak、overload；
- actor operation：`command|story`、`applied|idempotent|rejected|error`、enqueue-to-complete latency；
- checkpoint：`load|save|refresh|expire|delete`、`ok|missing|conflict|error|unavailable`、exact serialized bytes、latency；
- socket：active/peak、opened/closed、slow-consumer resync close、outbound queued frames/bytes peak；
- sync：reconnect attempt、`current|replay|snapshot`、resync requested/required；
- publisher：active/peak、started/finished、published/rejected/dropped/error、in-flight backlog；
- incidents：created、recovered、fenced、quarantined、replacement-required。

Observer 调用 MUST fail-soft；指标异常不得反转已提交 checkpoint、改变 WSS close policy、保留 subscriber 或重启 Provider。

### 2.2 指标定义

- `activeRooms` 只统计 lifecycle=open 的 authority actor；`residentActors` 单独统计内存中 terminal/closed actor，二者不得混称。
- `activeSockets` 只统计 Room gateway session，不复用全 Node `http.activeSockets`。
- checkpoint bytes 是实际 UTF-8 serialized checkpoint envelope 大小，只记录数字。
- Redis `usedMemoryBytes`/eviction 是整个隔离 Redis process 的采样，不描述成精确 Room memory；Room key 数由隔离 verifier 单独给出。
- queue/backlog 继续使用现有有界结构；不得为指标新增无界 buffer。
- snapshot 中 counter/duration 是采样区间值，active gauge 保留当前值并把 interval peak reset 到 current。

## 3. Fault evidence 与真实副作用

新增 machine-readable hardening evidence manifest，固定十个 drill ID 与实际 owner test/verifier；validator 校验 ID 完整、路径存在、
evidence selector 可定位，避免退出日志靠不可执行叙述。

现有 1～9 drill 复用当前真实 WSS、Redis、SIGKILL、slow-consumer、oversized/flood 行为测试。新增/加强：

1. 隔离 active checkpoint 精确删除后，旧 room lookup/recover 不得复活，必须给出 replacement-required，并能创建不同 ID 的新 Room；
2. 本地组合 VPS-unreachable drill 同时关闭 gateway、actor registry 与 Redis seam，旧 Room 明确不可继续，不声称透明 failover；
3. 真实 Redis generation verifier 对 duplicate finalization 直接计数 rating settlement 与 story impact，各自 MUST 为 1；
4. secret/content scan 继续只检查隔离 prefix，任何清理都不得使用 `FLUSH*` 或宽泛默认 namespace。

## 4. Non-production load baseline

新增显式 opt-in、loopback-only、安全 prefix 的 verifier。默认 workload：32 rooms、每 Room 4 个真实 Node `ws` client、每 Room
20 次权威 checkpoint transition（128 sockets、640 transitions）。输出 workload、总时长、actor/checkpoint latency p50/p95/p99、
queue/socket peak、checkpoint bytes、Redis process memory/eviction delta、CPU/RSS/heap/event-loop、错误/slow-consumer drop 与清理结果。

负载 gate 只断言：权威结果正确、队列/bytes 有界、错误为 0、active gauge 与 workload 一致、清理完整。延迟只报告事实，
不设或暗示 production SLA。若 CI 资源不足，可把真实负载 verifier 作为明确 integration command，但其 typecheck、安全边界测试与
evidence manifest MUST 进入普通 CI；本 Goal 退出前必须在本机 Redis 7.0.15 至少真实运行一次。

## 5. Stopping condition

只有同时满足以下条件才能关闭 GMR-10：

- ROOMRT-025 列出的 Room 指标可由 schema v5 输出，且无高基数/secret/content 标签；
- 十类 drill 均有可执行 evidence，recoverable 恢复、unrecoverable 明确终止/rebuild；
- 真实 Redis 负载基线与 checkpoint/VPS loss drill 通过，不伪造 SLA；
- generation/rating/settlement/story impact 无重复，durable facts 未改写；
- targeted、API/workspace/full gate 与独立 architecture/security/test-adequacy review 全部关闭 Critical/Important；
- production、schema、secret、release、GMR-11、Phase H 保持 `DEFERRED`/`NOT_APPLICABLE`。

## 6. 回滚

按 checkpoint 逆序 revert：退出材料 → verifier/manifest → component instrumentation → telemetry schema。Instrumentation 只增加
可选 observer 和内部 log schema，不改变 Room checkpoint/public wire；回滚无需 DB/Redis migration。若 observer 出错，运行时仍按
原 authority/fail-closed 路径工作。
