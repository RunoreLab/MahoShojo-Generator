# Desktop Hosted Arena C1-SSE 有限纵切验收

状态：**有限源码纵切、独立审查和完整本地 CI 已通过**。本报告不代表服务端部署、真实账号/Key、Tauri/Windows 或 D4 内容运行验收。

依据：[冻结实施合同](../plans/2026-10-10_042500_DesktopHostedArena流式纵切实施合同.md)及[Desktop 实施规格 DESK-095](../specs/2026-09-30_160000_Desktop客户端实施规格.md)。

## 交付与边界

- 两产品沿同一 Arena session 与实际共享控件/战报视图接入官方固定 Hono SSE；四模式、匿名/登录、系统/预设 BYOK、Markdown/自由 Web/精确包目标分层验证。创建前需服务端公开能力证明；账号由 Native 捕获且服务端严格断言，不把旧 Hono 忽略 header 当作已保护。
- 凭据留原生受保护存储；两个匿名恢复槽固定 product，公共 pointer 独立于正文草稿。Key 只注入创建。首次未知只查找/续流，重新打开显式恢复从原 actor 无旧游标开始，由服务端提供 snapshot/可用重播；自动重连用 C0 已消费 cursor，Native 发送高水位不替代它。
- 停止受理和 producer 终态分开，离页只 detach。取得真实 completed 与当前输出资格才可追加活动历史；恢复不自动重演副作用，显式追加与库保存分开。任一账号/目标 scope 变化永久清旧资格，A→B→A 不复活。
- 原 pointer 与 Native slot 不能假设原子同步。错误携带独立意图归属证明；只有本次 create 的 prior-retained、未派发且本地 CAS 仍成立才回滚。只读 recovery_hint 可协助显式放弃原本机恢复，两个 CAS 分别保护本地原件与 Native 精确 requestId；它不停止服务器、不删除凭据、不重建缺失 pointer 字段。外部新原件在回滚以及 C0 后续 failed 保存阶段均受磁盘 CAS 保护。
- Header metadata 缺失/不合法/过大保正文并明确显示，不能本地重掷或补 winner。服务端 completed 不等于精确包输出合格；缺 Base 保原文/Artifact，可导出，导包本身不重新取得历史资格。若服务端仍保留结果，可显式恢复复验。
- 非流完整 JSON、服务器签名角色写回仍明确未交付；UI 有效写入值为 false，保用户 Direct 偏好。没有改源卡、Direct projector 冒签名或默认回退。Web 安全源码视图不执行内容，D4 仍待实机门禁。

## 分层证据

1. Hono 真 actor/default service 与旧未传 header 路径回归；contracts 严格 DTO、fixture 与真实 producer projector/encoder。完整服务端输出硬限仍 4 MiB，Native 验可观测当前正文+reasoning，附加 meta 只保最新块。
2. Native 原 aa072 产品实际模块全回归 328 通过、1 OS 凭据用例忽略；后继 5bdc5d7cf 同源 Arena 34/34、clippy all-targets -D warnings 通过。后继容量补证 d29b3d693 为 test-only，两项独立通过及 clippy 通过：注入 requestId 和合成 Key 后的最终 HTTP 封套 12,582,912 字节成功，+1 字节零 POST；真实canonical TS meta的4,202,360字节SSE经HTTP→Native→68条Channel完整保真。没有把34项和后继2项说成新hash全套重跑；最终整合23份原生模块/fixture/manifest/lock/脚本 SHA256 与后继实测证据逐一相同。早期一次旧 cloud 并发测试失败与独跑/完整重跑成功证据均保留，未删失败日志。
3. 真 loopback HTTP→生产 Rust stream→EventSink 的388条消息，实际 snapshot wire 25,166,029字节、385片、4,194,304字节正文，最大单IPC封套393,308字节；TS真实bridge读取原文件完整重组，未用JS自造Native wire。原文件 SHA256 d508c0947bc0497bb3835c90645548725cffa8088b68b97db06e63eb6f7ee748。真实 meta projector/encoder 的source 4 MiB夹具wire4,202,360字节；真实Native68消息文件 SHA256 ee68238d96ba665ae80b24074383dd30108561323d1c8d797302c64d4fc43121，同一TS产品桥也通过该原文件重组并逐事件核同值。两个跨语言用例需要本地产物环境变量；没有fixture的普通测试会skip，本轮定向和最终CI均显式启用两份真实文件，不把未配置的skip计作通过。
4. Desktop真实C0/bridge/adapter 64组完整输入矩阵，以及创建未知、热重连去重、snapshot替换、同actor显式恢复、取消202/409/超时、错身份/晚响应、输出预算、HTML/JS/CSS/JSON四目标和缺包/坏Artifact。Session保存失败/重试/墓碑及历史scope隔离继续受检。
5. 真实路由DOM→共享控件→session/C0/bridge→模拟IPC→合成loopback，完整64组（两产品×四模式×两格式×两资金来源×匿名/登录），另恢复/保存重开库、停止/离页、关闭唯一handle、hint确认/损坏原文/双CAS等场景。此层不代表真实Tauri Channel、Windows凭据或线上模型。
6. 实际C0迟到失败会续写failed状态的磁盘CAS问题已先RED复现，再GREEN闭合；失败证据独立保存。最终四层102项＋真实路由85项共187定向通过，含完整64组页面矩阵。Direct原旅程103项回归通过，生产和定向test类型、lint、workspace boundary通过。
7. 合同5分钟idle/10分钟total软提示在首轮完整CI后仍是实际漏项，已以fake clock先RED，再共源原Web纯timeout算法：环境读取留原宿主，Desktop显式soft；精确阈值、阈值后继续chunk/done、首chunk前可见、旧scope不发布、完成/取消/离页清瞬时提示均已GREEN。新纯核8项、原Web consumer10项通过；没有自动取消、重连或重新POST。

## 完整 CI

第一轮固定7d2e6b31745e2b0abaef4ce7cc829f2f9b0f67a7/tree1dae149c06b803fd450b3dfb0c032ebab70c02b5，于05:31:50Z–05:39:58Z退出0、前后同源且干净；它是软提示补片前证据，不能替代新版验收。

第二轮固定 e0f47c2bcfdfe432be4b83adb2c383108789d720/tree50d2b6f1480b6ec37b2e3c7ceb9c18e5a340055f，于 05:44:39Z–05:47:15Z 退出 1，前后同源且干净。Desktop 1863 通过、1 失败；失败是页面测试仅等待固定 25 ms 就断言保存完成。产品仍在合法等待摘要与 repository IPC。以延迟 IPC 确定性 RED 复现后，仅测试改为等待两次实际保存各自的 saved 状态及按钮恢复，确保第二次点击确实派发，记录仍只有一条；没有延长固定 sleep 或修改产品。原失败完整日志 SHA256：74d1ffc5dd52f5083baadc5c14db7c11cea3ce6a74ec37d0c9f20598e0120632。

第三轮最终固定产品 `030b90d313b56fa9ec47c7ab532c1795b704427b` / tree `9766608eea153f0ef3d6f817b032b460a78465a8`，于 `2026-10-10T06:01:31Z`–`2026-10-10T06:09:40Z` 执行完整 `pnpm run ci:verify`，退出 **0**；起止 SHA/tree 相同，工作树均干净。workspace checks/tests/lint/build、根 repo tests/lint 全部完成；测试计数见下。完整日志 SHA256：`d0a771da2964a618603b9d4b4674aa3109762bfd1907ca650ce95d7321694941`。最终文档原子只更新报告和必要导航，不改变已验产品。

主要完整套件统计：Desktop 114 文件 / 1864 项，Web 465 / 3156，API 55 / 735，contracts 40 / 362，ai-core 24 / 249，hosted-api 12 / 214，hosted-runtime 86 / 771，ui-web 79 / 677，根 repo 34 / 274，均通过。各 workspace build 与 lint 也由同一入口串联完成；完整本地 CI 不包含真实 Windows/Tauri 启动或线上 Hosted 请求。

## 后继门禁

源码可进入受检 Hosted SSE 路径，旧/未声明必要能力的正式服务仍 fail closed。没有生产部署或真实凭据请求。JSON完整响应容量/分帧、签名角色 reconciliation、连续故事/插图、Strict/多人各自后继；Tauri/Windows/OS SecretStore、真实模型、视觉和 D4 隔离执行继续单列待验，不能将本片称为整个 b-2 完成。
