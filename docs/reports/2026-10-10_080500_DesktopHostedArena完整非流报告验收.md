# Desktop Hosted Arena 非流完整报告验收

状态：最终整合源码与独立审查通过，完整本地 CI 已明确退出 0。本报告不代表生产部署、真实模型/账号或 Windows/Tauri 验收。

## 1. 交付范围与来源

在已发布 UI / 模态修复 `2150073c47846aac5ec714ef1513451820376924`（tree `f41652d220c834a81336dc934b660286843ee4b8`）上，接通 `/battle` 与 `/arena` 普通四模式的 Hosted 非流完整报告。Markdown 使用真实 structured-report，Web 保自由文档与精确包目标；匿名/登录和系统/预设 BYOK 分别固定。页面继续消费既有共享控件和两端真正回用的报告视图，不复制 Web UI、历史系统或网络代理。

- 固定官方 Hono `/api/generate-battle-story`，仅创建读取并发送选定 Key。旧 C1 actor / expected-user / scope / ownership / 双 CAS / 原身份恢复与停止沿用。
- 新 `arena-companion-v1` opt-in 保存原公开 body 与完整 decoded metadata，响应删除重复 Stream-Meta 大头；旧 Web 无 opt-in 的原 body / headers / 状态与原 readiness body 不变。JSON 能力响应头只门禁新 JSON 创建，C1 恢复/停止不依赖它。
- 原生仅扩现有 `arena_hosted_stream` 的有限 `create-json` 枚举；无新 command / ACL / 任意 URL。角色两写仍固定 false，没有 signed updatedCombatants 或 Direct 副作用替代。
- 一次 POST；首头前可原 request lookup→stop。响应丢失仅原任务续读，v2 pointer 区分交付协议；恢复 structured 原文与报告阅读投影分离，明确原完整 JSON / 附加元数据缺失。202 只表示受理，detach 不等于 producer 取消。
- 首头前也显示共源 5 分钟 idle / 10 分钟 total 软提示，不硬停或重 POST。晚响应、退出/账号切换与逐片同步派发都守原 token / scope。
- 长期持有一份受检 companion 对象，报告视图复用其字段；默认详情仅序列化轻量状态。完整导出保持字段/字符串/数值语义，不承诺 HTTP 键序或原字节。
- 原草稿 4 MiB 字符、卡库 4 MiB 封套预算不变；生成成功不等于已保存，失败保内存与完整导出。活动历史仍只在当前 scope 合格完成后按原开关追加，显式恢复不自动追加，保存另由用户操作且幂等。

规范：[DESK-096](../specs/2026-09-30_160000_Desktop客户端实施规格.md#desk-096-arena-hosted-非流完整报告扩展2026-10-10)、[实施合同](../plans/2026-10-10_065400_DesktopHostedArena非流报告实施合同.md)。合同中的“当前仅调查”是形成时状态，以本验收记录当前交付。

## 2. 分层自动验证

### 共同协议 / 真实服务 / 旧 Web

contracts 固定新完整 envelope、JSON Channel、双版本恢复 pointer 和实际孤代理夹具；原 C1 合同不变。真实 runtime / companion 对拍旧新 structured / free Web / package 的完整 body 与全部 11 / 12 项 metadata，错误身份、completed 后交付不支持、两种 reasoning、usage 合计边界和 readiness 旧 body 均覆盖。原 Web 非流 consumer 51 项通过。

服务最终源码 `6d14f1ab1`，契约/错误 UTF-16 测试补片至 `2591fe565`，独审通过。没有 Provider / 签名服务真实调用；大型服务夹具为合成 ports 下的真实 runtime / companion，不等于 Redis、真实网络响应头或真实模型验收。

### Native / 跨语言

Native `8407d48c01374b7b38dd075caed8a50571d3cc77`：49 个生产模块/loopback 用例通过，独立最大 consumer 1 项通过，clippy all-targets `-D warnings` exit 0。覆盖 JSON head 等待、create-only 资金与原 actor、能力回滚后仍可恢复/停止、首头前 stop、完整 wire / secret 扫描、合法孤代理、错误封套、逐片 detach 和旧 C1 回归。整合树 29 个 source / fixture 哈希逐一等于该证据。

第一次同步 JSON 分片缺少本次 token 检查的真实取消缺口已 RED→GREEN 修复；完整错误 JSON 曾被 serde 字符串解析拒绝孤代理，也已由真实 writer → HTTP → Native → TS 链路保真闭合。保留原失败证据，不归咎 TS 丢晚包就略过 Native 围栏。

小件真实 Native 成功/错误 UTF-16 Channel 都由 production TS bridge 消费；最大同原件链见下。这里仍未启动 Tauri 应用、OS Keyring 或 Windows WebView。

### Desktop 真实宿主

真实路由 / 共源表单 / session / production bridge → 合成 IPC → 本机 HTTP fixture：153 项通过，包含两页 × 四模式 × 两正文格式 × 两资金 × 两身份 × 两交付方式共 128 组合，其中原 64 SSE 保留、新 64 JSON；其余覆盖原账号恢复、双 CAS、只读 hint、坏原件、原生唯一关闭守卫、取消与晚结果。

新增 JSON 专项覆盖首头前 lookup→stop 与晚完整包无副作用；本地完整封套草稿重开、磁盘保存失败仍可完整导出；v2 冷恢复的 structured 原文与阅读视图、原附加字段缺失；首头等待软提示后同请求完成。切换下次交付偏好不改旧结果解释。默认状态详情没有预制完整大 JSON 字符串。

原 Direct / Web 包 / session 4 文件 107 项完整回归通过。其初轮两红项仅为旧“非流不可用/服务器流式”断言，按新已交付能力更新后通过，仍保零派发、无自动 Direct 回退及晚导入不写包等断言。定向 production / 测试闭包类型检查、lint 与 workspace boundary 通过。

## 3. 完整 JSON 容量与内存边界

新协议 wire 上界为 76,711,888 B；来源推导和紧凑 recipe 见原容量调查及 canonical contracts。恰界 / +1 门禁与其余 19 recipes 共 20 个隔离串行进程全部 exit 0，最大 recipe 不重复构造。未提交几十 MiB 的生成产物到仓库。

同一最大合成合法原件：最终请求 12,582,912 B，原模型输出 4,194,304 B，完整新封套 **75,497,013 B**（实际 70 字符 generationId）；SHA256 `8a4668ad8319b06e99fcad61607a0e9b10167388f55e45748ddc8d0c9ffe8482`。

1. 真实 companion 构造：Node22.23.3 单进程峰值 521,916 KiB（509.68 MiB），包括合成输入与输出 drain，不含 Native / WebView。真实新协议原件与先前调查样例 ID / 壳不同，不能混用字节数。
2. Native 读取该同一文件的 loopback HTTP，production stream 输出 1,154 条 Channel（1,152 片）；JSONL 88,192,354 B，SHA256 `d363b9c0889f62028ed9596617dafe6765d6acdc3d5212ba9953b5f2672a12ee`。Linux debug Rust RSS 基线 8,052 KiB，峰值 93,568 KiB，交付后 19,832 KiB；逐行落盘 sink 不持完整 Channel 副本，不能代表真实 Tauri 传输成本。
3. production TS bridge 逐行消费原 JSONL，一次 invoke、完整 schema 校验、重组 wire 哈希仍同上。独立 Node22 峰值 443,112 KiB（432.73 MiB）；释放 raw 并 GC 后仅持受检对象，heap 34,333,328 B / RSS 233,246,720 B。显式序列化该完整 companion 的临时导出阶段峰值 522,568 KiB（510.32 MiB），释放后 heap 34,328,936 B。该序列化测量不包含整个会话的 draft / report / history 导出复本，更不是浏览器 Blob 下载或 WebView 总进程峰值。

显式 companion 导出长度仍 75,497,013 B，因对象键序变化 SHA256 为 `3275ad55790b91f63e104dc59388b5c3c64735daa1da7a77a2fc2dac1a72f226`；字段语义全保，不宣称原 HTTP 字节存档。三段峰值不能相加、不能作为生产同时峰值或固定 RSS 帽；renderer / WebView、完整会话导出和 Windows 实际峰值仍需独立测量。

证据目录（均仓库外）：`ci-runtime/arena-companion-json-c2-final`、`arena-hosted-json-harness`、`arena-hosted-json-capacity`、`arena-hosted-json-ts-capacity` 与 `arena-hosted-json-validation`。server / recipes / 独立报告 SHA 分别为 `d8e95bab2709c1c48fae6cf26082206f8af496099a0e7426eba5b60c06d7fc2e`、`a3b51ae6dedd83bbdf7584a7bf98dbb23f10645424b39b9d3cf8a965a7084765`、`b2cd091e4072c20be87d6924e13a2e43c47a87c3415b57d20c9f355470192d4e`。

## 4. 同批独立 D4 来源修复

按单独源码片 `6219048b11391e272d2cc4dd3db15d549560020b`（本树 `091e0472d`）整合 Web 包资源 resolver 的规范 scheme / authority 检查。其真实原生 22 项测试与独审单独成立，源码不修改包网络策略，也不开放 Arena 执行；作为发布首个可单回滚原子。[有限 Windows 补验](../runbooks/2026-10-10_074400_D4b规范来源与Document关闭有限补验.md)仍需真实用户设备结果，本轮不把它计为已验。

## 5. 最终整合 CI

固定产品 **`a382e4b91c5649277287743d407575c746ef851c`** / tree **`57a3c0f18f836aecc3c6c13edc1c3e4051aa9cb2`**，2026-10-10 **07:54:43–08:04:56 UTC** 完整 `pnpm run ci:verify` 明确退出 **0**。前后 HEAD / tree 一致，pre/post status 均空；最终文档原子不改产品。

全 workspace 类型 / lint / tests / production builds、Next client-bundle 边界及 root 门禁均通过。主要计数：contracts 42 文件 / 375 项，domain 42 / 312，hosted-runtime 89 / 794 通过与 21 大型环境用例跳过，ui-web 80 / 685，API 55 / 738，Desktop 119 / 1970，Web 466 / 3162，root 34 / 275。hosted-runtime 的 21 大型用例由上述独立串行容量窗口验证，不把常规 CI 的 skip 写成该轮运行通过。

六个环境 fixture 在本 runner 中显式开启：Direct Native events、C1 最大 snapshot / meta、C2 最大 JSONL / 成功 UTF-16 / 错误 UTF-16；Desktop 本轮无 skipped，普通未配置环境的 skip 不替代本次实达证据。

原始终态：`ci-runtime/arena-hosted-json-validation/run-20261010T075443Z/{result.txt,start-status.txt,final-status.txt,ci-verify.log}`。完整日志 SHA256：`6a0402c83d3cbfb11c4bc0dd6d6ac950b833cf85e9b70268cbf37282273e808c`。依赖使用私有安装并完成 frozen/offline 校验；最初遗漏显式 store-dir 的离线安装报缺缓存，修正仅本任务安装目录后通过，没有放宽锁或改共享 store。

磁盘回收前另保 `next-production-evidence` 的全部 1,546 个产物路径 / 字节 / SHA256，以及实际 CSS 和 build manifests；源码、依赖、Native / 容量 / terminal 证据均保留。警告包括既有 chunk 大小 / 浏览器模拟 API / 工具实验性提示，不将其改写成真实视觉或 OS 运行结论。

## 6. 未关闭事项

C2 不是整个 Desktop b-2 完成。服务器签名角色更新（含另一个固定 Next 目的地的匿名凭据许可/能力证明）、连续故事、插图、Strict/多人和 D4 执行仍按既定后继合同处理。旧 write=false generation 不能追授权变成可写角色。

Hono 公开 C1 readiness 已由无凭据 GET 证实；这不证明 C2 新 marker 已部署，更不等于真实账号 / Key / Provider 生成通过。真实 Tauri IPC、Windows / OS credentials、触屏 / 视觉、真实运行资源和网络出口策略仍分别列待验；本片没有操作用户设备、部署或改变网络安全配置。
