# 平台重整 G25C `apps/api` 真实应用激活与 Telemetry 收口实施日志

日期：2026-08-25

状态：`BLOCKED`（实现已收口，最终环境验收未闭合）

- Goal：`G25C`
- source commit：`dbc073f7`
- 最终实现 commit：`99032cb6`
- 主要 independent review remediation commits：`2547b998`、`537510b1`、`51e72669`、
  `ab5a3213`、`5981c6e4`、`d385452b`、`99032cb6`
- 文档收口 commit：本日志所在提交
- 实施计划：[`2026-08-24_053840_G25C_apps-api真实应用激活与HonoTelemetry收口实施计划.md`](../plans/2026-08-24_053840_G25C_apps-api真实应用激活与HonoTelemetry收口实施计划.md)
- Implements/validates within G25C slice：`MONO-003`、`MONO-004`、`MONO-005`、`MONO-006`、`RESOURCE-005`
- Advances only：`MONO-002` 的 `apps/api` slice、`MONO-009` 的 10 条 retained adapter slice、
  `RESOURCE-003` 的 Hono telemetry subset；完整目标仍由 G25D/G25E 等后续 Goal 闭合
- Validates：`ACCEPT-008`中与 Hono/Next shared contract 及应用边界相关的本地部分
- Preserves：`AI-006`、`AUTHORITY-001..006`、`DR-004..011`、`DR-013..014`、`COMPAT-001..002`、Arena v1 wire/authority
- Goal governance：`GOAL-040`、`GOAL-050..052`、`GOAL-060..061`、`GOAL-070..072`

## 1. Objective 与实际范围

G25C 的代码已将 Hono Node runtime 从 legacy root `server/` 所有权迁入真实 `apps/api`
workspace app，并一并收口 server-only runtime composition、AI/D1/Redis 容量 telemetry、
bundle、Docker、CI 与 deploy ownership。最终验收仍缺同一 commit 的真实 Docker build/Compose
和隔离 D1 Gateway + Redis built-runtime integration，因此本日志不把 G25C 报告为完成。

启动时已有后续 Phase 2.5B 证据显著改变原计划基线：14 条异构 `legacy-next`
capability 已经过结构退出审计，当前 machine-readable inventory 为 `10 shared-service / 14 exited /
0 legacy-next`。因此本 Goal 没有重做这 14 条 route 的业务下沉，而是把实际范围收窄为：

1. 将 10 条 retained Hosted capability 的唯一 Node composition 提取至
   `@mahoshojo/hosted-runtime`；
2. 激活真实 `@mahoshojo/api` app，迁移 source/manifest/test/lint/build/env/health/bundle；
3. 接入 Hono runtime 可真实观测的 AI、D1 和 Redis 低基数 telemetry；
4. 迁移 Docker/Compose/CI/deploy ownership，并将发布加固为可验证、可恢复的
   content-addressed release tuple 事务；
5. 保持 Next 公开 route、Legacy/Better Auth、签名、数据 ownership、Arena authority/wire 与
   非幂等 generation 不盲目重放。

原重新估算为约 `4.5–5.5h`。实施中独立审查推动了 provider replay/error privacy、
Redis 超时/响应校验、持久发布 journal、旧布局真实纳管、installer no-clobber 和信号回滚等
必要修复；它们共享同一 API runtime/deploy 验证链，因此留在 G25C 内闭环，没有扩张到
G25D/G25E 的 Web 迁移或 Hosted DR 产品激活。

## 2. Capability 裁决

### 2.1 实际迁移并保留在 Hono 的 capability（10）

- `generate-magical-girl`
- `generate-game-card`
- `generate-free` / `generate-free-stream`
- `generate-scenario` / `generate-scenario-stream`
- `creator/generate` / `creator/generate-stream`
- `generate-canshou` / `generate-canshou-stream`

这些 capability 已有 `@mahoshojo/hosted-api` shared application service、Next/Hono adapter contract，
且 Hosted Node runtime 对长流、Provider 调用、签名/安全和 D1/Redis 组合仍有明确价值。G25C 只迁移
它们的 runtime ownership，没有改公开 wire 或 replay class。

### 2.2 已在 Phase 2.5B 退出 Hono 的 capability（14）

- 详情/升华：`generate-magical-girl-details` 及 stream、`generate-sublimation` 及 stream；
- Arena/battle：`arena/generate` 及 stream、`arena/session/generate-next`、
  `generate-battle-story`、`me/battle-reports/[generationId]/regenerate`；
- Tavern/Tea Party：两组 generate choices/stream 与 `magic-tea-party/generate-updates`。

退出理由保持 Phase 2.5B 的 accepted 裁决：这些 route 含签名/history/finalize、Arena 写入/结算、
session state 或 stream 副作用；在没有双 runtime 收益和稳定 operation/replay contract 前，继续以同源
Next 执行更安全。G25C 没有删除或改写它们的 Next 公开 route。

## 3. 主要实现

### 3.1 `@mahoshojo/hosted-runtime`

- 持有 10 条 retained service 的唯一 Node default composition；Next compatibility wrapper 和
  `apps/api` adapter 只配置/引用同一 package singleton；
- 提取 AI/stream、Provider、D1/data port、签名/活动、限速/安全、questionnaire/build-rule 和
  静态资产；package 不导入 `apps/*`、Next、Hono 或 Cloudflare binding；
- provider fetch 只对安全、尚未收到 response 的可重试连接失败使用有界重试；HTTP redirect、
  已达 Provider 的响应失败与非幂等 generation 不透明重放；
- 公共错误与日志只输出稳定分类，不泄漏 URL、Provider、request body、credential 或原始 Error。

### 3.2 真实 `apps/api`

- 拥有 `package.json`、app-local alias/tool configs、`src/`、`tests/`、route generator、bundle/runtime
  scripts、README/env example、health/readiness、Dockerfile、Compose 和 deploy scripts；
- root `dev/start/build/routes/runtime/test:server` 只作为 workspace filter 兼容入口；Hono、Redis 与
  `@hono/node-server` 生产依赖已移至 app manifest，lockfile 有真实 `apps/api` importer；
- legacy `server/`、根 `Dockerfile.hono`、`deploy/hono` owner 和 root Hono generator 已退出；
- boundary/generator 同时禁止 app 回导 `app/api`、`pages/api`、root `server/lib/components/types` 或
  `apps/web` internals；registry 只能生成 10 条 `shared-service` route。

### 3.3 Hono telemetry

- `schemaVersion=2` 单行 JSON 保留 process CPU/RSS/heap、event-loop delay/utilization 和
  active/peak request/stream/socket；
- AI 真实调用 seam 记录 active/peak、attempt、TTFB、duration 以及 success/error/abort/timeout；
- D1 HTTP 每个真实 round trip 记录 latency、rows read/written、稳定 error class；safe-read retry
  每个 attempt 分开计数，mutation 不盲目重放；
- Redis connect/ping/fixed-window/INFO 记录 operation/latency/error，INFO 采样读取 memory、
  eviction 和 hit/miss；采样有超时且 fail-soft，不改限速或 readiness authority；
- 无法由 Hono 进程观测的入口选择仍为 `runtime.selection=not-observed`、
  `runtime.failoverReason=null`；不伪造 `primary` 选择事实；
- secret/body/URL/provider/SQL canary 负向测试、stream 唯一终态与 sampler timeout/fail-soft
  均有行为证据。

### 3.4 Build 与发布事务

- `apps/api/Dockerfile` 只复制 API 的真实 workspace dependency closure，不要求
  `apps/d1-gateway` 或未来 Admin/Desktop/Mobile 进入 image；
- workflow 保留受保护生产分支、Environment、SSH host key 和 `cancel-in-progress: false`；
  build/container/artifact 路径只引用 app owner；
- release ID 为覆盖 bundle、Compose 和 release-local deploy script 的 manifest SHA-256；
  `install-bundle.sh` 在随机 staging 上传后持同一 deploy lock 复验精确 tuple，使用
  `mv -Tn` no-clobber 原子纳管并 post-verify；
- deploy script 使用非阻塞 `flock`、精确 checksum/Compose/runtime 预检、持久四行
  `deploy.transaction`、signal forwarding、next-start recovery 和 retained route 公网 contract；
- 首次新协议发布可精确识别旧手册布局，将真实旧 bundle/Compose 复制成带
  `legacy-layout` marker 的可验证 rollback tuple；managed marker 一旦存在就不允许降级推断；
- cleanup、promotion、Docker/Compose、readiness backoff、TERM/HUP/INT、dangling symlink 与 rename
  race 均有故障注入测试。

## 4. 当前验证证据

### 4.1 PASS

- `CI=true pnpm install --frozen-lockfile --offline --trust-lockfile`：12 个 workspace，lockfile 无变化；
- `pnpm --filter @mahoshojo/hosted-runtime test/lint/build`：最终 31 files / 145 tests，lint/typecheck 通过；
- `pnpm --filter @mahoshojo/hosted-api test/lint/build`：3 files / 29 tests，lint/typecheck 通过；
- `pnpm --filter @mahoshojo/api` 的 test/lint/build/build:bundle：最终 15 files / 105 tests，生成
  10 条 shared route 和 5.3 MB single-file bundle；
- deploy release-contract/installer/script/workflow：4 files / 57 tests；两个 shell 的 `sh -n`、
  `dash -n` 及 affected ESLint 通过；
- `pnpm run build:server`：生成 10 shared / 0 legacy bundle；同一 artifact 以 dummy-only
  `HONO_CONFIG_CHECK_ONLY=true` 生产配置成功加载，没有连接外部服务；
- `pnpm run check:workspace:boundaries`：通过；
- `pnpm run workspace:verify`：11 个实际 package/app 的 boundary、naming、test、lint、build 通过；
- `pnpm exec vitest run --reporter=dot --maxWorkers=1`：329 files / 1796 tests 通过；
- `pnpm lint`：0 warning/error；只有 Next 15 自身 `next lint` 弃用提示；
- `pnpm build`：Next production build 通过，生成 187 个静态页面；
- `XDG_CONFIG_HOME=$PWD/.tmp/xdg-config pnpm build:cf`：3 个 D1 ID 配置检查、Next build
  和 OpenNext Worker bundle 通过；仅保留既有 proxy、较旧 `compatibility_date` 和 `punycode`
  弃用提示；
- `CI=true VITEST_MAX_WORKERS=1 pnpm run ci:verify`：workspace verify、329/1796 root tests
  与 root lint 通过；
- `git diff --check`：通过。

最终定向复验时曾从仓库根错误调用
`vitest --config packages/hosted-runtime/vitest.config.ts`；package config 的相对 `include` 因 cwd
错误扩张到 root tests，产生 alias 解析失败。改在 `packages/hosted-runtime` cwd 运行同一 binary 后
31 files / 138 tests 全部通过；该次失败归类为命令调用错误，不是代码回归，原始失败未被当作 PASS。

`check:naming:workspace` 仍输出 49 条非阻断审计，主要是 D1/Redis/V8 外部 canonical
snake_case 字段和字面量 mapper。检查按既有 report-only 契约退出为 0；G25C 没有放宽
naming/boundary gate，也没有展开全仓命名清债。

### 4.2 BLOCKED（阻塞 G25C stopping condition）

- `pnpm run verify:server:runtime`：当前机器没有配置安全隔离的 `D1_GATEWAY_URL`、Redis
  server 与对应测试凭据，verifier 在第一个必需配置处 fail closed；没有为验收连接生产
  Gateway/Redis。其 config-only artifact smoke、health/readiness/D1/Redis 行为测试和 bundle 均已 PASS；
- `docker build --file apps/api/Dockerfile .` 与 `docker compose ... config`：当前 WSL 没有
  Docker CLI/Desktop integration。Dockerfile closure、Compose path、workflow/container gate 及 deploy behavior 已由
  contract tests 覆盖，GitHub Actions 中的真实 Docker build gate 未被删除或弱化。

上述两项是当前机器缺失隔离运行时的环境证据，不是代码/contract `FAIL`，也不要求
production 授权；但它们属于 G25C 专用计划明确列出的适用 build/integration 验证。静态 contract、
config-only smoke 与“workflow 中保留 gate”不能替代对同一 commit 的实际运行，因此按 `GOAL-061`
阻塞当前 stopping condition。后续必须在 Docker-capable CI/preview 或隔离主机取得真实 PASS，
不能连接 production 资源来绕过。

### 4.3 NOT_APPLICABLE / DEFERRED

- production deploy/cutover：`NOT_APPLICABLE`，G25C 默认授权明确排除；
- production schema/data migration/write/restore：`NOT_APPLICABLE`，无 schema 或持久化格式变更；
- secret/Access/credential change：`NOT_APPLICABLE`，无新 secret 值或权限操作；
- release/tag/push：`NOT_APPLICABLE`，本 Goal 只形成本地原子提交；
- 入口层 DR selection/failover reason、稳定逻辑入口、独立 Cloudflare D1 provider、
  version skew/expand-contract probe 与 fault drill：`DEFERRED` 到 G25E，不属于 G25C；
- 生产容量阈值/SLA：`DEFERRED`，accepted plan 要求先采集真实基线，本 Goal 不伪造数字。

## 5. Builder self-review 与 independent review

Builder 按 `GOAL-050` 复核了 `dbc073f7..99032cb6`：

- app/package/runtime 依赖方向与 root runtime dependency ownership；
- auth/secret/authority、D1 mutation no-replay、Redis non-authority 与 Provider 失败语义；
- 10 retained / 14 exited 的 Next/Hono producer-consumer/wire 兼容；
- telemetry 低基数准确性、privacy、terminal once 和 sampler fail-soft；
- release tuple、legacy adoption、journal、signal、并发、symlink/race 与 rollback 语义；
- 无 DB schema、Arena wire、Legacy/Better Auth 用户流程或 production secret 变更。

独立上下文分别覆盖 architecture/dependency、security/authority、compatibility/data/replay 和
test adequacy。审查期间曾提出的 Important 包括：

1. AI fallback/abort/redirect 可能重放、公共错误/日志泄漏与 provider/D1/Redis 观测失真；
2. Redis INFO 采样超时、限速非法响应、二次信号日志与 canonical port ownership；
3. deploy 缺持久事务/真实旧布局纳管，cleanup 故障跳过 runtime rollback，legacy
   runtime 子 shell 无法传递 TERM，installer/adoption 存在目录链接 TOCTOU；
4. 缺少 journal/format/installer 故障、rename race、promotion 和 workflow 校验顺序的行为测试；
5. 默认 Hosted composition 误用吞扫描异常的兼容 `quickCheck`，以及 D1 fetch 默认 follow
   301/302/303/307/308 可能透明重放 mutation；runtime verifier 对已提前退出子进程可能错过
   `exit` 事件并永久等待。

上述代码层 Critical/Important/Minor 均在对应原子提交修复并重跑 affected validation；最后三项由
`99032cb6` 关闭，fresh evidence 为 hosted-runtime 31/145、API 15/105、root affected 3/7、
scripts ESLint、package lint/typecheck 与 API bundle 全部通过。独立 security 与 protective review
对最终代码 checkpoint 均给出 Critical 0、Important 0、Minor 0 与 `Ready: yes`。整个 G25C
的最终文档与验收结论仍对验收充分性保留以下开放 Important：

1. 当前 commit 尚未在 Docker-capable 环境实际通过 `docker build` 与 `docker compose config`；
2. canonical `verify:server:runtime` 尚未连接隔离 D1 Gateway + Redis，证明真实 bundle 的
   readiness、retained/exited route 与 Redis rate-limit integration。

日志跟踪、计划状态矛盾与日期 Minor 已在本次文档收口修复；上述两项环境 finding 未关闭，
最终结论为 `Ready: no`。

## 6. Stopping condition 状态矩阵

| 项目 | 状态 | 证据/说明 |
| --- | --- | --- |
| `apps/api` 真实 source/manifest/test/lint/build/env/health/deploy ownership | `PASS` | app lifecycle、README/env、bundle、Docker/Compose/workflow/deploy contract |
| root 不持有 API runtime dependencies | `PASS` | manifest/lockfile ownership tests；Hono/Redis/node-server 只在 app |
| Docker/CI/deploy 只要求 API dependency closure | `BLOCKED` | 静态 closure/workflow contract PASS；同一 commit 的真实 Docker build/Compose 未执行 |
| Hono 不导入 Web/root internals | `PASS` | boundary/generator/ownership 测试，10 shared / 0 legacy registry |
| AI/D1/Redis telemetry 真实收口 | `PASS` | 31/145 hosted-runtime 与 15/105 API tests，schema v2 integration |
| 不伪造入口选择 | `PASS` | `not-observed` / `null` contract 与 canary negative tests |
| build artifact、health/readiness、rollback 等价 | `BLOCKED` | bundle config smoke、app/deploy fault tests、Next/OpenNext builds PASS；built-runtime integration 未执行 |
| full server/workspace/CI verification | `BLOCKED` | workspace/root/Next/OpenNext/静态 CI contract PASS；Docker/runtime 两项适用验证未闭合 |
| independent review | `BLOCKED` | architecture/security/compatibility/test adequacy；2 个环境验收 Important open |
| production deploy/cutover | `NOT_APPLICABLE` | 未授权、未执行 |
| local external runtime/Docker execution | `BLOCKED` | 机器无隔离 Gateway/Redis 与 Docker CLI；不弱化 CI/preview gate |
| G25D Web relocation / G25E Hosted DR | `DEFERRED` | 后续独立 Goal |

G25C 的代码 objective 已实现，但必需 stopping condition 尚未全部闭合；当前没有 `FAIL` 或开放
Critical，仍有 2 个阻塞目标的 `BLOCKED`/Important，因此不能报告 Goal 完成。

## 7. 回滚

1. 文档收口可独立 revert，不改运行时；
2. 最终安全修复可独立 revert `99032cb6`；deploy hardening 从 `d385452b` 向前按原子提交逆序
   revert；若未执行生产发布，无远程回滚；
3. `apps/api` relocation 可回退 `76cff7dc`及后续 app/deploy 提交，恢复上一 root `server/`
   artifact；必须连同 manifest/scripts/tests 一起回退，不得保留 app→root 半迁移结构；
4. hosted-runtime extraction 可按 composition 提取提交逆序 revert，Next wrapper 恢复旧组合；
5. capability exit 若要回退，必须同时回到仍有 legacy adapter/generator/root source 的上一完整 Hono
   bundle，不能只在当前 fail-closed generator 中重填 `legacyRouteIds`；
6. telemetry 为 lossy aggregate，可独立 revert，无 schema/data/secret 回滚。

本 Goal 没有 production deploy、schema/data write、secret 变更或 release，因此不需要 DB migration、
Redis flush、credential rotation 或远程 artifact 操作。

## 8. 剩余 Phase 2.5 与下一 Goal 重估

当前 Phase 2.5 仍剩：

- G25C 最终环境验收：在同一 commit 上实际通过 Docker build/Compose 与隔离
  D1 Gateway + Redis `verify:server:runtime`，关闭 2 个 Important 后重跑 stopping audit；

- G25D：真实 `apps/web` 与 root orchestration ownership 行为等价迁移；
- G25E-1：Hosted DR capability/replay manifest、稳定逻辑入口、独立 Cloudflare D1 provider 与
  compatibility probe；
- G25E-2：Hono/Redis/D1 Gateway/D1/mid-flight/version-skew 的隔离 fault harness/drill；
- Phase 2.5 最终退出审计。

当前立即下一入口仍是 G25C 验收收口，环境具备后重估约 `0.5–1.5h`；不得在它闭合前
启动 G25D。其后 root Web 仍有约 783 个 `app/components/public` 及相关文件，303 个 `app/` 文件、
213 个静态资产、49 个 root 生产依赖、187 个静态生成页面，而 `apps/web` 尚未激活。
这个范围明显高于一次简单目录移动，下一 Goal 建议按 G25D 的既有拆分触发器收窄为：

```text
G25D-1（G25C 完成后重估 4.5–5.5h）
  激活 apps/web source/static/config/test/build/OpenNext/Cloudflare ownership，
  保持 root 兼容编排入口和全部 Web/Legacy/Arena 行为等价。

G25D-2（后续重估 2–3h）
  在 Web/API/D1 Gateway 全部拥有真实 manifest 后，将根 package/config/scripts
  收口为 workspace orchestration，不与大量源码移动共享回滚面。
```

该拆分不改变 G25D 的长期 stopping condition，只把大量 Web 迁移与 root 清理分成可独立
revert 的纵切。
