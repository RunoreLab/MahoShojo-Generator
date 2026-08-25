# 平台重整 G25C `apps/api` 真实应用激活与 Telemetry 收口实施日志

日期：2026-08-25

状态：`COMPLETE`（实现与最终环境验收均已闭合）

- Goal：`G25C`
- source commit：`dbc073f7`
- 最终实现 commit：`5a2780b2`
- 主要 independent review remediation commits：`2547b998`、`537510b1`、`51e72669`、
  `ab5a3213`、`5981c6e4`、`d385452b`、`99032cb6`、`fe3e3ff8`
- 文档收口 commit：本日志所在提交
- 实施计划：[`2026-08-24_053840_G25C_apps-api真实应用激活与HonoTelemetry收口实施计划.md`](../plans/2026-08-24_053840_G25C_apps-api真实应用激活与HonoTelemetry收口实施计划.md)
- Implements/validates within G25C slice：`MONO-003`、`MONO-004`、`MONO-005`、`MONO-006`、`RESOURCE-005`
- Advances only：`MONO-002` 的 `apps/api` slice、`MONO-009` 的 10 条 retained adapter slice、
  `RESOURCE-003` 的 Hono telemetry subset；完整目标仍由 G25D/G25E 等后续 Goal 闭合
- Validates：`ACCEPT-008`中与 Hono/Next shared contract 及应用边界相关的本地部分
- Preserves：`AI-006`、`AUTHORITY-001..006`、`DR-004..011`、`DR-013..014`、`COMPAT-001..002`、Arena v1 wire/authority
- Goal governance：`GOAL-040`、`GOAL-050..052`、`GOAL-060..061`、`GOAL-070..072`

## 1. Objective 与实际范围

G25C 已将 Hono Node runtime 从 legacy root `server/` 所有权迁入真实 `apps/api`
workspace app，并一并收口 server-only runtime composition、AI/D1/Redis 容量 telemetry、
bundle、Docker、CI 与 deploy ownership。`5a2780b2` 所在版本已通过本地真实 Docker build/Compose、
隔离 D1 Gateway + Redis built-runtime integration，以及同一 SHA 的 GitHub Actions Hono build；
因此本日志将 G25C stopping condition 记为完成。

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
- build job 使用 ephemeral `redis:7-alpine` 和 `wrangler dev --local` D1，bundle 生成后运行
  canonical `verify:server:runtime`；Docker build 与 `compose config --no-env-resolution` 同为
  fail-closed gate，隔离运行时通过后才允许上传 artifact；
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
- `pnpm --filter @mahoshojo/hosted-runtime test/lint/build`：最终 31 files / 146 tests，lint/typecheck 通过；
- `pnpm --filter @mahoshojo/hosted-api test/lint/build`：3 files / 29 tests，lint/typecheck 通过；
- `pnpm --filter @mahoshojo/api` 的 test/lint/build/build:bundle：最终 15 files / 110 tests，生成
  10 条 shared route 和 5.3 MB single-file bundle；
- deploy release-contract/installer/script/workflow：4 files / 62 tests；两个 shell 的 `sh -n`、
  `dash -n` 及 affected ESLint 通过；
- `fe3e3ff8` 最终 affected 复验：apps ownership、hosted-runtime ownership 与 deploy/workflow
  6 files / 68 tests；workflow YAML 成功解析为 2 jobs、10 build steps，affected ESLint 与
  `git diff --check` 通过；
- `pnpm run build:server`：生成 10 shared / 0 legacy bundle；同一 artifact 以 dummy-only
  `HONO_CONFIG_CHECK_ONLY=true` 生产配置成功加载，没有连接外部服务；
- `pnpm run check:workspace:boundaries`：通过；
- `pnpm run workspace:verify`：11 个实际 package/app 的 boundary、naming、test、lint、build 通过；
- 环境收口前 checkpoint 的 `pnpm exec vitest run --reporter=dot --maxWorkers=1`：
  329 files / 1796 tests 通过；最终断连修复合并后的 root 数量见下方 329 files / 1802 tests；
- `pnpm lint`：0 warning/error；只有 Next 15 自身 `next lint` 弃用提示；
- `pnpm build`：Next production build 通过，生成 187 个静态页面；
- `XDG_CONFIG_HOME=$PWD/.tmp/xdg-config pnpm build:cf`：3 个 D1 ID 配置检查、Next build
  和 OpenNext Worker bundle 通过；仅保留既有 proxy、较旧 `compatibility_date` 和 `punycode`
  弃用提示；
- 环境收口前 checkpoint 的 `CI=true VITEST_MAX_WORKERS=1 pnpm run ci:verify`：workspace verify、
  329/1796 root tests 与 root lint 通过；最终同一聚合入口的证据见下方 329/1802；
- `git diff --check`：通过。

最终环境收口在 `5a2780b2` 取得以下 fresh evidence：

- `pnpm run ci:verify`：11 个 workspace 的 test/lint/build 通过，root 329 files / 1802 tests 与
  root lint 通过；首次在受限沙盒内运行时，真实 TCP fixture 因 loopback `listen EPERM` 退出，
  在允许 loopback 的同一环境重跑后 API 15 files / 110 tests 与聚合命令均通过；
- workflow 明列的 ownership/runtime/deploy 集合为 6 files / 68 tests；
- `docker build --file apps/api/Dockerfile .`：Node 22 Alpine image、filtered dependency closure 与
  10 shared route / 5.3 MB bundle 构建通过；
- 一次性 `docker:28-cli` root 环境使用未改写的 production Compose、`HONO_RELEASE_DIR` 与空
  `/opt/mahoshojo-hono/.env.hono` 成功执行 `docker compose ... config --no-env-resolution`；
- 隔离 Redis 7 与 local Wrangler D1 Gateway 启动后，`pnpm run verify:server:runtime` 的 live、ready、
  Redis、D1、retained route `400`、exited route `404` 与 rate-limit key 七项均为 true；
- [Deploy Hono run #25](https://github.com/RunoreLab/MahoShojo-Generator/actions/runs/32800983786)
  的 build job 在 `5a2780b2` 上成功，container、single-file bundle、built-runtime integration 与
  artifact upload steps 均实际执行并通过；deploy job 因非 production branch 按设计跳过；
- [Cloudflare Workers run #88](https://github.com/RunoreLab/MahoShojo-Generator/actions/runs/32800983793)
  的 preview build/deploy 同一 SHA 通过；没有执行 production deploy/cutover。

最终定向复验时曾从仓库根错误调用
`vitest --config packages/hosted-runtime/vitest.config.ts`；package config 的相对 `include` 因 cwd
错误扩张到 root tests，产生 alias 解析失败。改在 `packages/hosted-runtime` cwd 运行同一 binary 后
31 files / 138 tests 全部通过；该次失败归类为命令调用错误，不是代码回归，原始失败未被当作 PASS。

`check:naming:workspace` 仍输出 49 条非阻断审计，主要是 D1/Redis/V8 外部 canonical
snake_case 字段和字面量 mapper。检查按既有 report-only 契约退出为 0；G25C 没有放宽
naming/boundary gate，也没有展开全仓命名清债。

### 4.2 已关闭的环境 BLOCKED

最终验收前，本机曾因 Docker Desktop integration 不可用、沙盒拒绝 Wrangler 网络接口枚举且缺少
Redis server，无法运行 Docker/Compose 与 canonical built-runtime verifier；这两项因此按
`GOAL-061` 记录为环境 `BLOCKED`，没有用静态 contract 或 production 资源伪造 PASS。

2026-08-25 环境恢复后，两项均在本地取得真实 PASS；首次远端 run 又暴露
`docker compose config --no-env-resolution` 仍要求绝对 `env_file` 存在。`5a2780b2` 在干净 runner
原子创建 root-only 临时目录与空 env file，只向 sudo Compose 保留 `HONO_RELEASE_DIR`，并以 EXIT trap
清理；没有把 production `env_file` 改成 optional。修复后本地 root 容器与 Deploy Hono run #25
均通过，原两个环境 Important 与新增 CI Important 全部关闭。

### 4.3 NOT_APPLICABLE / DEFERRED

- production deploy/cutover：`NOT_APPLICABLE`，G25C 默认授权明确排除；
- production schema/data migration/write/restore：`NOT_APPLICABLE`，无 schema 或持久化格式变更；
- secret/Access/credential change：`NOT_APPLICABLE`，无新 secret 值或权限操作；
- release/tag：`NOT_APPLICABLE`；用户仅正常 push 当前非生产分支以触发最终 CI/preview 验证，
  Hono production deploy 按分支门禁跳过；
- 入口层 DR selection/failover reason、稳定逻辑入口、独立 Cloudflare D1 provider、
  version skew/expand-contract probe 与 fault drill：`DEFERRED` 到 G25E，不属于 G25C；
- 生产容量阈值/SLA：`DEFERRED`，accepted plan 要求先采集真实基线，本 Goal 不伪造数字。

## 5. Builder self-review 与 independent review

Builder 按 `GOAL-050` 复核了 `dbc073f7..fe3e3ff8`：

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
6. Docker/Compose/runtime workflow contract 只检查宽松字符串，可能被 step skip、关闭 errexit、
   remote credential 或裸/反斜线 shell boolean continuation 绕过。

上述代码层 Critical/Important/Minor 均在对应原子提交修复并重跑 affected validation；第 5 项由
`99032cb6` 关闭；该 checkpoint 当时的 fresh evidence 为 hosted-runtime 31/145、API 15/105、root affected 3/7、
scripts ESLint、package lint/typecheck 与 API bundle 全部通过；第 6 项由 `fe3e3ff8` 关闭，RED
mutation 证明裸 boolean continuation 可吞 verifier，GREEN 后 workflow 13/13、最终 affected 6/68、
YAML parse、ESLint 与 diff-check 通过。最终 CI 修复 review 又发现 `install -d` 会跟随末级 symlink 的
TOCTOU Important，以及 cleanup 函数体断言不足的 Minor；先以行为探针确认根因，再按 RED/GREEN 改为
原子 `mkdir -m 700 --`、创建成功后注册 trap，并精确锁定 cleanup 函数体。复审为 Critical 0、
Important 0、Minor 0。独立 architecture、security 与 protective review 对最终 checkpoint 均给出
`Ready: yes`，本地与 Actions 环境证据关闭先前两个环境 Important。

## 6. Stopping condition 状态矩阵

| 项目 | 状态 | 证据/说明 |
| --- | --- | --- |
| `apps/api` 真实 source/manifest/test/lint/build/env/health/deploy ownership | `PASS` | app lifecycle、README/env、bundle、Docker/Compose/workflow/deploy contract |
| root 不持有 API runtime dependencies | `PASS` | manifest/lockfile ownership tests；Hono/Redis/node-server 只在 app |
| Docker/CI/deploy 只要求 API dependency closure | `PASS` | 本地 Docker/Compose 与 Deploy Hono container step 同一 SHA 通过 |
| Hono 不导入 Web/root internals | `PASS` | boundary/generator/ownership 测试，10 shared / 0 legacy registry |
| AI/D1/Redis telemetry 真实收口 | `PASS` | 31/146 hosted-runtime 与 15/110 API tests，schema v2 integration |
| 不伪造入口选择 | `PASS` | `not-observed` / `null` contract 与 canary negative tests |
| build artifact、health/readiness、rollback 等价 | `PASS` | bundle、built-runtime 7 项、deploy fault tests 与 Actions artifact upload 通过 |
| full server/workspace/CI verification | `PASS` | local `ci:verify`、Docker/runtime 与两条 Actions run 同一 SHA 通过 |
| independent review | `PASS` | 最终 CI fix 复审 Critical 0、Important 0、Minor 0，`Ready: yes` |
| production deploy/cutover | `NOT_APPLICABLE` | 未授权、未执行 |
| local external runtime/Docker execution | `PASS` | WSL Docker、isolated Redis、local Wrangler D1 与 canonical verifier 通过 |
| G25D Web relocation / G25E Hosted DR | `DEFERRED` | 后续独立 Goal |

G25C 的代码 objective、全部必要 stopping condition 与独立 review 已闭合；没有开放 `FAIL`、
Critical、Important 或 Minor，Goal 状态为 `COMPLETE`。production deploy/cutover 仍是
`NOT_APPLICABLE`，不能因本 Goal 完成而描述成已执行。

## 7. 回滚

1. 文档收口可独立 revert，不改运行时；
2. CI 环境 gate 可独立 revert `fe3e3ff8`；最终安全修复可独立 revert `99032cb6`；deploy
   hardening 从 `d385452b` 向前按原子提交逆序 revert；若未执行生产发布，无远程回滚；
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

- G25D：真实 `apps/web` 与 root orchestration ownership 行为等价迁移；
- G25E-1：Hosted DR capability/replay manifest、稳定逻辑入口、独立 Cloudflare D1 provider 与
  compatibility probe；
- G25E-2：Hono/Redis/D1 Gateway/D1/mid-flight/version-skew 的隔离 fault harness/drill；
- Phase 2.5 最终退出审计。

当前立即下一入口为 G25D。root Web 仍有约 783 个 `app/components/public` 及相关文件，303 个 `app/` 文件、
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
