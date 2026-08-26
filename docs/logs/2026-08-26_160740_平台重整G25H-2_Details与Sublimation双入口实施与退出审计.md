# 平台重整 G25H-2 Details 与 Sublimation 双入口实施与退出审计

日期：2026-08-26

状态：`COMPLETE`

分支：`refactor/platform-rearchitecture`

起点：`05b64453`

代码终点：`37ab0b67`

适用设计：[G25H-2 Details 与 Sublimation 双入口设计](../specs/2026-08-26_135547_G25H-2_Details与Sublimation双入口设计.md)

## 1. Objective 与重新估算

启动描述中“三条 handler 约 2,478 行”不是当前仓库事实。基线实际是四个 Web handler、2,341 行：Details 691 + 361，Sublimation 951 + 338；route inventory 为 `18 shared / 10 exited / 0 legacy`。G25H-1 已移除 Arena session 的 Cloudflare → Hono SSE parse/re-encode self-hop，G25H-2 的实际范围是四条 Hosted AI route 的深 composition re-entry，不是再修一次 session path。

实施按 6–8 小时级高后果原子边界拆成 service contract、Details runtime、Sublimation domain/runtime、Hono/telemetry 与 review 五类 checkpoint。未改变 accepted ADR，未移动客户端不可信、服务器权威、secret 隔离、数据所有权、Legacy/Better Auth、Arena v1 wire 或非幂等不盲目重放的验收终点。

## 2. 实际完成的设计与实现

### 2.1 同一 shared service 的双入口

- `@mahoshojo/hosted-api` 定义 Details / Sublimation structured 与 stream application service contract，统一 method、step order、短路与异常脱敏 wire。
- `@mahoshojo/hosted-runtime` 持有四路 runtime 与唯一 Node default composition。`apps/api` 的 Hono adapter 直接使用该 service，`apps/web` 只保留 Next/OpenNext DR adapter；两侧都不 `fetch()` 对方，不导入 app 内部源码，不解析/重编码 SSE。
- `config/hono-api-routes.json` 与生成 manifest 精确收口为 `22 shared / 6 exited / 0 legacy`；Tea Party/Tavern 与 `regenerate` 没有被顺手扩入。

### 2.2 Details 与 questionnaire 权威

- 保留 questionnaire answer mapping、逐答案 safety、限速、custom Provider、AI meta、reasoning SSE、activity、native questionnaire 服务端重解析与签名 fail-closed。
- preset 以 package generator 生成的可验证静态 TypeScript asset 随 Node bundle 携带；`--check` 在 hosted-runtime build 中阻断 drift。服务端不再经公开 URL 自跳取 preset。
- 审查期发现并闭合私有 DataCard ownership 缺口：只接受经 Better Auth verify、Legacy Bearer 或签名 activity token 解析的受信 actor；伪造 `X-Mahoshojo-User-Id` 无效。已认证用户可读自己的卡或 public + approved，匿名只能读 public + approved，解析失败 fail closed。

### 2.3 Sublimation 领域规则与兼容

- 角色源/目标模板转换、Arena history retention、`current_state` 注入防护、immutable name 与 final merge 进入 `@mahoshojo/domain`，Web converter/helper 缩为薄转发。
- 保留 `magical-girl` / `canshou` / `general` 与外部 snake_case 字段兼容；初审发现的 `general-scenario` 误归类已修复，通用情景继续按旧 wire 丢弃角色 `content`。
- 原卡签名验证、native lore 服务端重载、guided signing 开关、history/current-state/finalize、structured AI meta 与 stream Markdown/reasoning wire 均由 shared runtime 保留。任何客户端 lore 或未受信 guidance 可进入 prompt，但默认不获得服务器签名。

### 2.4 低基数 lifecycle telemetry

- 固定字段只包含 operation、`hono-primary | next-dr`、`success | rejected | failure | cancelled` 与 duration；不记 prompt、正文、URL、Provider 配置或 secret。
- Hono snapshot schema 聚合四路 operation/placement/outcome，Next DR 输出等价结构化 observation。流式终态在 body EOF/cancel/read error 时最多一次结算；最终复审用真实 Hono composition 发现 cancel/EOF 竞态，`5069f271` 改为先登记 `cancelled` 再向上游传播 cancel，并以 cancel/read-error 测试固定。

## 3. Atomic checkpoints

| 提交 | 主题 |
| --- | --- |
| `353edd71` | 冻结 G25H-2 双入口设计与实施计划 |
| `350ce29d` | 固定 Details / Sublimation service contract |
| `e46d3709` | Details shared runtime + Next DR |
| `4f76ebb6` | Sublimation conversion/finalize 权威规则下沉 domain |
| `a2cc0575` | Sublimation shared runtime + Next DR |
| `e6ebfa59` | 四路 Hono re-entry、telemetry 与 22/6/0 manifest |
| `e14d69fc` | 封闭客户 lore 签名与 preset 公网取回信任缺口 |
| `79323586` | 闭合 `general-scenario`、DataCard ownership 及独立测试审查 findings |
| `97fde647` | 保留 Sublimation 外部 snake_case wire 并通过 naming gate |
| `5069f271` | 闭合 Hono stream cancel 终态竞态与文档 diff-check Minor |
| `37ab0b67` | 让 root ownership tests 复用单次 workspace boundary scan，避免 build 后重复全仓解析超时 |

## 4. 验证证据

### 4.1 最终聚合门禁

- `pnpm ci:verify`：exit 0。workspace test/lint/build 全部通过；workspace tests 为 455 files / 2,600 tests，其中 hosted-api 7/117、domain 7/18、hosted-runtime 54/295、apps/api 18/152、apps/web 336/1,792；root 另为 14 files / 139 tests。
- boundary check 通过；workspace naming 保留 1,377 条既有 report-only 审计项并以 0 退出，本 Goal 没有放宽 gate。
- workspace lint 与 root lint 通过；workspace build 包括 questionnaire assets `--check`、D1 Gateway Wrangler dry-run、API tsc 与 Web Next production build（187 页）。
- 收口期一次 `pnpm ci:verify` 在 workspace test/lint/build 全过后，root ownership 的两个用例因各自重复调用全仓 boundary parser 而超过 15 秒；该次 exit 1 没有计为 PASS。`37ab0b67` 把 boundary scan 移到一次 `beforeAll` 并在两个断言间复用；targeted ownership 4/4 与 root 14 files / 139 tests 通过，随后聚合命令整体重跑 exit 0。

### 4.2 server / Cloudflare / runtime

- `pnpm server:routes`：生成 22 条 shared route。
- `pnpm build:server`：exit 0，单文件 Hono bundle `dist/index.mjs` 约 6.4 MB。
- `XDG_CONFIG_HOME=$PWD/.tmp/xdg-config pnpm build:cf`：exit 0；3 个 D1 ID 配置检查、Next 187 页与 OpenNext Worker bundle 通过。输出包含既有 proxy、`compatibility_date`、Node `punycode` 警告，独立复跑还观察到不影响 exit 0 的偶发 webpack cache `ENOENT` warning；本 Goal 未将这些 no-new-regression 项扩张为全仓清债。
- 使用临时 Docker Redis 7、Wrangler local D1 和本地专用占位 secret 运行 `pnpm verify:server:runtime`：第一次因两个占位 HMAC 不足 32 字符被 production config fail-closed 拒绝，不计 PASS；合规长度重跑 exit 0，live、ready、Redis、D1、migrated `400`、exited `404` 与 rate-limit key 七项均为 true。临时容器与本地 D1 状态随后已删除，未连接 production。

### 4.3 定向回归

- hosted-api：7 files / 117 tests；domain：7 / 18；hosted-runtime：54 / 295；apps/api：18 / 152；apps/web：336 / 1,792，均在最终聚合门禁通过。
- review 整改的定向证据包括：DataCard/Arena actor/Details/Sublimation 4 files / 29 tests；Hono composition 1 / 16；lifecycle 1 / 11；Next DR + public safety 2 / 11；四路 custom Provider/policy/signature 矩阵均通过。
- `git diff --check 05b64453..HEAD`、route inventory 与 source self-hop/AI-direct scan 通过；四个 Hono adapter 与四个 Web handler 无 `fetch()` 对跳。

## 5. Builder self-review 与 independent review

### 5.1 Builder self-review

Builder 逐项核对 accepted MUST/MUST NOT/ACCEPT、双入口 service identity、副作顺序、wire/header/status、secret/log、app/package boundary、DataCard/signature authority、abort 与 non-idempotent replay。自审发现并闭合两个信任缺口：客户自带 Sublimation lore 不得继承 native 签名；Node preset 必须 bundled-only 且 drift fail closed，不得从 Cloudflare 公开 URL 取回。

### 5.2 独立 architecture 审查

- 初审：Critical 0；Important 2。`general-scenario` 被误归类为角色通用模板，以及 topic/实施日志尚未收口。
- 关闭：`79323586` 恢复通用情景 canonical 推断与 content 处理；本文档 checkpoint 更新 topic/accepted plan/实施设计与退出审计。最终 Critical 0 / Important 0 / Minor 0 open。

### 5.3 独立 security / authority / compatibility / replay / data 审查

- 初审：Critical 0；Important 1。旧 Details/Sublimation DataCard loader 可让知道 ID 的匿名请求读取私有 questionnaire，并进入 Provider/签名路径。
- 关闭：`79323586` 提取受信认证 actor，让 Details/Sublimation 使用 owner-or-public-approved 查询。复审确认 Better Auth、Legacy Bearer、activity token、stale-cookie fallback、Arena v1 actor/wire、safe-read replay class 与 secret isolation 无回归。最终 Critical 0 / Important 0 / Minor 0 open。

### 5.4 独立 test-adequacy 审查

- 初审：Critical 0；Important 5，Minor 3。涉及 lifecycle 双 placement 终态、真实 Next DR POST/stream、四路 custom Provider，rate/safety 短路、native signature fail-closed、Sublimation stream bridge、asset drift 与旧注释。
- 首轮关闭：`79323586` 补齐全部矩阵。复审又给出 Minor 2：真实 Hono cancel/read-error telemetry 与 Markdown 尾随空格。
- 最终关闭：`5069f271` 的真实 Hono composition 红测反而捕获 cancel/EOF 竞态，修复后 Hono 16 tests 与 lifecycle 11 tests 通过；`git diff --check` 恢复 clean。最终 Critical 0 / Important 0 / Minor 0 open。

## 6. Stopping condition 与状态矩阵

| 项目 | 状态 | 证据/说明 |
| --- | --- | --- |
| Details/Sublimation 四路 Hono primary + Next DR 同 service | `PASS` | 22/6/0 manifest，identity/adapter/POST/wire tests |
| auth/rate/safety/provider/questionnaire/signature/history/finalize/abort | `PASS` | package + Hono + Next DR 矩阵通过 |
| 无 Hono→Cloudflare 或 Cloudflare→Hono self-hop | `PASS` | source/boundary tests，八个入口无 `fetch()` 对跳 |
| 低基数 telemetry 与流式单终态 | `PASS` | Hono/Next、EOF/error/abort/cancel 回归 |
| contract/server/workspace/Next/OpenNext build | `PASS` | 上述聚合门禁、server bundle、runtime verifier 与 `build:cf` |
| independent review | `PASS` | architecture/security/test 最终 Critical/Important/Minor 0 open |
| production deploy/cutover / remote DB/Redis / production drill | `DEFERRED` | 未授权且不是 G25H-2 stopping condition；进入 G25E-2 |
| production schema/data migration | `NOT_APPLICABLE` | 无 schema、migration 或持久化 wire 变更 |
| secret/Access/credential 变更 | `NOT_APPLICABLE` | 无新 secret 名称/值/权限；仅本地一次性占位值 |
| release/tag/push | `NOT_APPLICABLE` | 未执行 |
| blocker | `BLOCKED: none` | G25H-2 stopping condition 无未闭合项 |

## 7. 生产、schema、secret 与 release 影响

- 本 Goal 只修改代码、测试、机器可读 route manifest 与文档；没有 production deploy/cutover、远程 DB/Redis 写入、secret/Access/credential 修改、release/tag 或 push。
- 无 schema/migration/持久化格式变化。Hono telemetry snapshot schema 从 3 扩展到 4 只是本地运维观测 contract，不是业务持久化 schema。
- 无新增 secret 名称。私有 DataCard 读取复用 Arena 已有 Better Auth verify / Legacy Bearer / activity token 解析；相关配置缺失时退化为只允许 public + approved，fail closed。
- 部署后四路默认 primary 将落在 Hono；Next/OpenNext 仍保留同核 DR adapter。自动切换、稳定逻辑入口与 Cloudflare 独立 DatabaseProvider 尚未实现，不得将本 Goal 描述为 production DR 已完成。

## 8. 回滚

无 DB restore、Redis flush、secret 回退或客户端重发要求。如需整体回滚，在未另行发布的前提下，以普通 `git revert` 按以下逆序处理：

```text
本文档收口提交
37ab0b67
5069f271
97fde647
79323586
e14d69fc
e6ebfa59
a2cc0575
4f76ebb6
e46d3709
350ce29d
353edd71
```

仅需暂时撤回 route placement 时，也应整体 revert route/telemetry checkpoint 及其后依赖改动，不把 manifest 手工改回而留下两份 business core。

## 9. 剩余 Phase 2.5 与下一 Goal

剩余默认关键路径：

1. G25E-1：DR capability manifest、replay/secret/DatabaseProvider/contract 状态、Cloudflare 独立 DatabaseProvider、consistency/bookmark contract 与 stable logical endpoint/control-plane seam；
2. G25E-2：隔离 fault-injection / local / preview DR 故障矩阵与 Phase 2.5 总退出审计；需要 production 权限的 drill 继续明确待授权；
3. G25H-3 Tea Party/Tavern 仍为 telemetry-gated optional，默认不阻塞 Phase 2.5 退出；`regenerate` 继续 exited/Next。

基于最终 22 shared / 6 exited / 0 legacy、已有 operation/placement lifecycle observation，以及仍缺 machine-readable DR manifest / provider / control-plane 的仓库事实，下一 Goal 重估为 **G25E-1，5–6 小时**。可回滚 checkpoint 应按（a）manifest + replay/secret contract，（b）Cloudflare DatabaseProvider + consistency，（c）stable control-plane seam 拆分；若（c）的产品 PoC 超出窗口，不吞并 G25E-2 故障演练来伪造完成。
