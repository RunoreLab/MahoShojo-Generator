# Desktop Hosted Arena 固定 Next 角色更新验收

- 日期：2026-10-10
- 状态：源码独审与同源完整本地 CI 通过；生产与实机待验
- 产品/测试候选：`db20a66f544d93c2f876899218c5219d7fa5efe3`
- Tree：`f4337c7415e18cbe78de65a157d6017472b89041`

## 边界与落地

依 DESK-097、[接受的 ADR](../decisions/2026-10-10_100700_Desktop固定Next角色更新修订.md)与[有限合同](../plans/2026-10-10_100000_Desktop服务器角色更新有限合同.md)，接通 `/battle`、`/arena` 新 Hosted SSE / 完整非流报告后的角色历战/状态更新。两页复用 Web 既有写入控件与共源结果展示；共享 domain 的重试投影和 index 应用由真实 Web 与 Desktop 消费，宿主保留身份/请求/快照围栏。

新任务显式冻结用户选择，原两公开恢复槽双读 pointer v1/v2/v3，原两 Native 秘密槽不增键。旧 C1/C2 创建时的 false 不追开。Native 无凭据 GET 核验 Next 自身能力，只向固定项目 Next POST 原 generation actor；无 renderer URL、ProviderKey、跨 host redirect、当前账号/匿名回退。登录冻结 expectedUserId；匿名缺原 signed token 仅沿原 Hono lookup 找回，不在 Next 新建 actor。GET 不证明两个 runtime 的 D1 相同，POST 独立核 owner/任务/终态/冻结清单。

C2 新写 true 额外要求 Hono 已安装 companion 声明 reconciliation header，并在真实 Native 创建请求携带版本；旧 companion-v1 无此 header 仍 false-only。报告依旧完整 metadata/body/impacts、`updatedCombatants: []`，新效果只冻结供独立 Next 应用，不把更新卡塞回原 C2 报告。

SSE done / JSON end 不等于 Native invoke 已返回；自动同步等原 invoke settle/guard 释放，角色封套也等本次 invoke 成功才提交。末帧后 Native scope/detach/传输拒绝严格失败。单一同步 flight、角色快照、scope/epoch/generation 围栏抑制重复/迟到结果；只重试原 generation，不追加模型请求。报告完成、角色同步、本地另存分别表达。

官方签名候选仅来自本次新鲜受检服务端响应；草稿恢复清除角色 isValid，已有 signature 不重建官方来源。更新工作副本，另存本地新卡，不覆盖源库卡；本地库大小/保存失败不回滚已完成报告。

## 有界容量与多运行时证据

32 角色与 12 MiB 请求来自现有 Arena 门禁；16 MiB 是独立接收预算，不承诺所有合法输入均能放下。64 KiB manifest 不扩大；不可用/超限时原卡和报告保留，明确角色同步不可用，不截断或重生成。

实际 Next handler/`applyPostBattleUpdates` 轻量 recipe 从 8,420,816 B 请求产生恰 16,777,216 B 成功响应；请求增加 1 B 后实际 producer 输出 16,777,217 B，handler 返回 503/263 B 错误封套。Native 从同一磁盘原件经真实 loopback HTTP 读取；TS 生产 bridge 再消费真实 Native NDJSON、调用共享纯核。

| 原件 | 结果 |
| --- | --- |
| 恰 16 MiB | Native 258 事件，TS 拼接字节和 SHA256 与 Next 原件完全一致，实际应用不修改原对象 |
| producer +1 B | Native 独立拒绝，零 IPC、无可应用更新 |
| handler 超限封套 | Native 3 事件，TS 收到 `ARENA_RECONCILIATION_RESPONSE_TOO_LARGE`，无部分更新 |

成功原件 SHA256 `258112fc2127cdc00071401f5a4e9403b37108a91ff0209062a63d8f7476fe6b`；+1 原件 `fe62889b8b4e7d0c3233dbc4d0c381dc4c452e5f04044d8e1ef03659e533a0bd`。原件与配方 metadata 留仓外 `ci-runtime/arena-role-capacity/manifest.json`，不提交巨大 blob。

容量调查另发现旧 producer `apps/web/lib/arena/service.ts` 的 `lastEntryId + 1` 可对开放 JSON 字符串 id 做拼接并放大响应；`packages/domain/src/arena-post-battle.ts` 有对应假定。此片不修改历史兼容/规范写入语义，后继应依实际 schema 区分旧数据只读兼容和新规范写入。

## 分层验证与纠错

- 共源 Web retry/application：原真实消费者、重名/重排/缺失/占位与旧响应回归；Web 默认请求和响应不改
- Next/contract：自身 GET 版本/签名能力、版本不符、原匿名与 expectedUser、owner/manifest/终态、下标唯一/范围、HMAC 与旧 Web 回归
- Rust：固定两 host、无 redirect/无 ProviderKey/无匿名回退、scope 与原秘密槽、整封套先校验后发 IPC；定向 67 通过，后补真实创建请求导出测试 1 通过，clippy 全 targets 与 rustfmt 通过。容量三个专用运行另全部执行通过；旧 C2 最大容量 ignored 配方本轮未重新执行
- Desktop session + 真 Hosted adapter/role bridge 的合成 Native-shaped IPC：64 组合覆盖两页/交付/身份/资金/四种写选择；最终 bridge/session 105 项过
- 实际页面/router/共享 UI/session/bridge → 合成 Native-shaped IPC → loopback：169 项过，含两页/两交付/四选择的新 16 组合；原 C1/C2 页面旅程保留
- C2 真实 producer 门禁修复：companion 22、Hono readiness 6、runtime→SQLite D1→Next 全链 1 通过
- 实际 Native 捕获的 create-json HTTP 原 method/path/headers/body（账号 123、true/true、合成凭据）被上述真实链消费；去掉新 header 的同原件先得到 400，模型调用与 D1 均为零；随后完整原件只生成一次，落真实 SQLite 冻结 manifest，再由 Next 应用。原件/基线 2 项过，独审独立复跑。真实 hybrid resolver + 本地 synthetic auth/verify stub，不是生产 cookie 验证
- 新三运行时角色容量 TS consumer 3 项过；生产 Desktop tsc、触达 lint/边界通过

独审识别并闭合两个真实阻断：C2 旧 producer 的 false-only 不能由 DOM mock 矩阵代替；Native 终止 IPC 早于 guard 释放不能由同步 mock 推定。另补末帧后 Native rejection 不得提升为成功。失败过程日志保留，未仅列首次绿色。

早期全 Desktop 测试源码类型探索暴露既有非生产测试类型错误，未称其通过；正式生产门禁使用 `tsconfig.build.json`。早期 4 个页面 fixture 的 v2/固定 false 假定与 3 个 Web 展示 mock 的旧入口假定已按新显式契约/真实共源入口修正，最终对应回归通过。

## 正规安装与完整 CI

官方 Node 22 / pnpm 11 使用 clean `desktop-webpkg-policy-integrated` 的依赖字节复制到私有目录，无共享可变 inode；随后实际 `pnpm install --frozen-lockfile --offline --ignore-scripts` 于 10:28:55–10:29:19 UTC 退出 0，锁文件不变，47 workspace 链接/CLI/虚拟存储验证通过。未手改 pnpm metadata；此前临时目标测试链接不计官方安装。

首轮 `0cbb2762f` 同源完整 CI 于 10:32:14–10:36:47 UTC 退出 1：workspace 所有测试已过（Desktop 122 文件/2101 项、Web 468/3200），随后 contracts 新测试因未使用解构变量违反既有 `no-unused-vars` 停止。只改该测试字段省略写法，不放宽 lint；原失败终态/日志与前后同源干净证据保留。

最终 `pnpm run ci:verify` 于 **10:42:33–10:51:39 UTC 退出 0**，前后均为 `db20a66f544d93c2f876899218c5219d7fa5efe3` / tree `f4337c7415e18cbe78de65a157d6017472b89041`，start/final status 均为空。Desktop 122 文件/2101 项、Web 468/3200、root 35/276 全过；hosted-runtime 为 800 通过/21 条条件跳过，完整命令成功不代表所有条件测试执行。workspace lint/build、管理员/DR 客户端 bundle 边界与仓库门禁通过。单行修正后、最终完整 CI 前另跑全 workspace lint 与全生产类型门禁也均退出 0，未降低规则。6 个原 C1/C2/Direct Native fixture 与新角色容量/Native 创建请求原件均显式传入。日志位于仓外 `ci-runtime/arena-role-validation/`，Native/容量/同源请求在 `ci-runtime/arena-role-capacity/`。

## 仍待验证

- 本片无真实用户 cookie/Key、生产模型/生成/角色更新/部署
- Next/Hono 新能力需部署并在真实环境满足同一任务归属；本地 GET/POST 合成证据不声称生产 runtime 已就绪
- 未运行 Windows/Tauri/WebView/真实 OS SecretStore，实际双端视觉与 OS 生命周期见[本片 Windows 有限清单](../runbooks/2026-10-10_105300_Desktop角色更新Windows有限验收.md)，所有条目仍待执行
- D4 内容运行、连续故事/插图、Strict/多人及整个 Desktop b-2 完成度不因本片开放或标记完成
