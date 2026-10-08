# 文档导航

2026-10-08 双端产品面对照：已完成首页、`/free`、Creator CSS、本地库/设置、Scenario、角色管理预览及两问卷品牌/顺序/导航/结果呈现的分批共源修复。13条已交付路由A–E矩阵、Web实际行为变化、历史统一回归与干净分支提交见[唯一 Desktop 计划](./plans/2026-09-30_160100_Desktop客户端阶段实施计划.md)的“双端视觉/交互对照补漏”；字体/主题实际观感、同视口截图、WebView2与真实端到端仍待验，Token提示/Creator辅助入口等余项保留，不称全站完全对齐。

2026-10-08 Desktop AI Provider 统一：新[产品决策 ADR](./decisions/2026-10-08_173300_DesktopAIProvider选择器与多模型连接体验统一.md)和[DESK-AIP 实施规格](./specs/2026-10-08_173400_DesktopAIProvider共源选择器、快速配置与多模型连接.md)已接受，纳入[唯一 D5.1 计划](./plans/2026-09-30_160100_Desktop客户端阶段实施计划.md)的 AIP-0..5。Client Direct 预设支持在选择器内填 Key/模型「保存并使用」，每连接多模型；Web 只共享 UI，Desktop Server BYOK 后续实施。Desktop 专有执行位置控件将复用 Web 流式切换的 `SegmentedControl` 视觉和生成设置区段布局。本轮仅文档，无代码改动或实机验收。

2026-10-07 调研：[公开数据卡自动审查模型接入调研与方案](./reports/2026-10-07_110910_公开数据卡自动审查模型接入调研与方案.md)——决策模型（Clef/Mercury/Span）与传统审核模型（omni-moderation、Nemotron）的后端抽象、阈值/豁免/不确定处理/路由策略；骨架+全适配器已按方案落地，并经 r1 审查收口加固（无 legacy 回退、快照守卫防过期裁决、`auto_review_decisions` 审计表、输入覆盖门禁，文末实施状态）。

开发入口：[双端共源切片模板与验收指南](./runbooks/2026-10-06_084500_双端共源切片模板与验收指南.md)给出页面对照、共享边界、CSS/资源、设置 owner、缓存/生成失败和提交验收模板；已接入仓库 platform-migration skill。使用时按风险裁剪，不建立平行施工计划。

2026-10-06 公开库缓存：[ADR](./decisions/2026-10-06_084300_Desktop公开库持久缓存与离线降级决策.md)与[规格](./specs/2026-10-06_084400_Desktop公开库离线缓存规格.md)已冻结为 Desktop 的持久公开快照：不按年龄淘汰；默认 256 MiB、满额暂停新增，用户可在设置中调整预算、选择不设上限或显式开启满额淘汰（r1）；断网检索已缓存子集、联网更新当前查询；明确撤回与本地副本隔离。实现归唯一计划 K1/K2：K1 持久缓存与策略面、K2 库内离线浏览/降级/重连均已落地并经多轮审查收口（含撤回证据的进程内屏障与 fail-closed 溢出口径，r5），自动门禁通过，实机验收沿用集中计划 PENDING。

2026-10-06 后续方案：[双端产品对齐与设置共源 ADR](./decisions/2026-10-06_084100_双端产品对齐与设置共源决策.md)和[规格](./specs/2026-10-06_084200_双端产品对齐与设置共源规格.md)已冻结。唯一 Desktop 计划保留 a–d/D5.2 标识，下一步 P1 产品壳/首页 → P2 已有旅程 → G1 残兽；设置/资料/本地工具按依赖穿插。r1 审查修订增加首批设置项（生成偏好、动效、公告检查、外链确认）与 Desktop Esc 快捷菜单（N1）；r2 撤回早期「冷启动零项目请求」政策，改为「离线可用、不阻塞、不泄漏」，会话/资料/消息摘要与公告检查按业界惯例自动进行（DESK-PROD-004、DESK-ONLINE-008、ACCEPT-001 已同步精确修订）。新增能力仍待实施。

2026-10-06 调研：[Desktop 共源对齐与后续功能调研](./reports/2026-10-06_084000_Desktop共源对齐与后续功能调研.md)核对当前页面/样式差距、个人页与设置、公开卡缓存限制及迁移收益；是研究依据，不替代下列 accepted 规格和唯一实施计划。

2026-10-04 线上/本地整合：采用[客户端/服务器执行与 AI 配置共源 ADR](./decisions/2026-10-04_202000_Desktop线上本地整合与AI配置共源决策.md)及[配套规格](./specs/2026-10-04_202000_Desktop线上本地整合与AI配置共源规格.md)。系统默认 AI 仅服务端，服务器预设 BYOK 保留；Desktop 支持自定义连接，Web 仍限项目预设供应商/端点但保留预设端点下自定义 `modelId`；共源提取现有 TopBar、问卷和库模态框。执行顺序仍在唯一 Desktop 计划 D5。截至 2026-10-05：D5.0a/b/c 已落地并经审查收口，原生认证与项目通路的 D5 在线门禁经生产部署实机联调闭合（[验收记录](./runbooks/2026-10-05_144424_Desktop在线门禁验收.md)，含生成联调口径调整的维护者决策）；D5.0d/e 已落地并经审查收口（实现与自动门禁，实机验收按集中计划 PENDING）；D5.1a 已落地并经 r1 审查收口——`/details` 问卷交互与结果面共源、Desktop 四模式双执行与 hosted 非流式通路、跨宿主生成请求 golden 对拍（实现与自动门禁，实机验收 PENDING）；D5.1b/c/d、D5.2 待实施，不改变 D4b 范围或实机门禁。

2026-10-04：维护者已授权退休 Web `/pvp` 卡牌对决，当前范围以[PVP 卡牌对决退休规格](./specs/2026-10-04_150000_PVP卡牌对决退休规格.md)为准；下文较早“保留 Web PVP 产品”的口径被取代。`/battle`、`/arena`、Arena 多人及历史数据继续保留，本轮不执行生产清理。

2026-10-03 收口补充：Desktop 备份新写 manifest V2（显式 schemaVersion），兼容读取 V1 和迁移链支持的旧库，
并严格验证 blob 文件集合；见[运行时规格](./specs/2026-09-30_160000_Desktop客户端实施规格.md)。
旧 Desktop 文档对 `/battle`、`/arena` 的 PVP 误称已纠正，保留的 Arena 按 D5 规划接入；
见[产品共源 ADR](./decisions/2026-10-02_184000_Desktop产品架构与Web共源决策.md)。
问卷不属于 D3.0，D4a 须完成 core 权限最小化后才能引入第二个 webview；当前真机状态仍以各 runbook 的实际记录为准。

Desktop D2.4a/b 已落地：本地整库备份、恢复前自动备份、启动前 journal 重放与旧 SQLite/WAL/SHM/blob
代际保留已接入，具体范围和验证见[阶段计划](./plans/2026-09-30_160100_Desktop客户端阶段实施计划.md)。
[备份与恢复真机验收](./runbooks/2026-10-03_155000_Desktop整库备份与恢复验收.md)已有一次 Explorer 恢复及导入后重启闭环；磁盘失败注入、大库性能基线和断电耐久性仍未验证，不把自动故障注入等同于实机断电验证。

Desktop D2.5c 正在收口：归档文件调度、共享归档并发与导航问题已修复，原生关闭保护已接线。D2.3 / D2.5 真机门禁仍开放，统一按 [归档与产品壳真机验收](./runbooks/2026-10-03_120000_Desktop归档与产品壳真机验收.md) 回传运行证据后关闭；2026-10-03 经维护者确认先推进 D2.4、现再授权 D3.0，这些开放门禁全部保留；D3.0 的实施边界决定见[阶段计划](./plans/2026-09-30_160100_Desktop客户端阶段实施计划.md)；不把自动化通过写成完全 PASS。

Desktop 采用“同一产品、两个运行时”的[产品共源 ADR](./decisions/2026-10-02_184000_Desktop产品架构与Web共源决策.md)、[整体产品架构](./architecture/2026-10-02_184000_Desktop产品架构与共享边界.md)与[产品一致性规格](./specs/2026-10-02_184000_Desktop产品一致性与本地优先规格.md)：已迁移功能按真实切片共源，Web 同步回用；旧 PVP 路由误称已纠正，Arena 的 Desktop 能力按 D5 规划迁移，已退休 `/pvp` 不复活。Desktop 本地优先，在线能力显式接入，不重建另一套 UI。数据卡签名首期延期，无手动申请按钮；未来只在服务端可验证的可信流程中按默认关闭设置自动请求。

[Desktop Tauri V1 安全 ADR](./decisions/2026-09-30_160000_DesktopTauriV1运行时与本地安全边界决策.md)和[运行时实施规格](./specs/2026-09-30_160000_Desktop客户端实施规格.md)仍然有效：本地产物、窄 IPC、OS secret、TS 业务/Rust 机制、独立不可信渲染面与 updater 签名不变。`DESK-003` 仅精确区分远端主 UI 与主动在线数据访问，不放宽现有 CSP。自有 command ACL 必须先于第二个 webview 生效。

唯一[阶段计划](./plans/2026-09-30_160100_Desktop客户端阶段实施计划.md)保留 D0–D2，增加 D2.5 共源壳并细化 D3/D5；静态壳与 D2 机制可按依赖并行。截至 2026-10-03：D2.5a/D2.5b 与 D2.3d 已落地——`packages/ui-web` 提供共源主题/导航/能力状态/壳/归档视图，Desktop 已是产品首页并接入 `/local-library` 整库导出导入；D3.0（首页与离线百科）代码已落地并完成审查修复：`@mahoshojo/ui-web` 承载共源首页切片、百科视图与 Markdown 渲染层，产品内容只跟踪仓库根 `content/`，两端开发/构建前生成各自静态副本；首页功能清单保留在宿主，Web 外链及标题锚点回归已修复，Desktop 接入 `/encyclopedia` 与 `/encyclopedia/$slug`。[首页与离线百科真机验收](./runbooks/2026-10-03_163000_Desktop首页与离线百科验收.md)已有部分实机结果，但整体门禁仍开放；renderer Network 旅程、减少动态效果、公式/锚点已有记录，native 出站全旅程仍待验。`/details` 已接入 D3.1b/c 默认问卷、共源控件与结果正文、Direct 生成/取消、显式草稿恢复及本地保存；草稿不在卡库归档/备份中，D1 真实 Provider 和 D3.1 Tauri 完整旅程仍待验收；D3.2a 已在两端 `/local-library` 接入共源本地数据卡列表、详情与回收站，D3.2b 已接入共源字段编辑器与 Desktop `/character-manager` 本地编辑/单卡导入，实机项见[本地角色管理验收](./runbooks/2026-10-04_153000_Desktop本地角色管理验收.md)；D2.3/D2.5 原生选择器、WebView 内存/响应性、raw IPC 吞吐/回退、窗口关闭等真机门禁仍开放。现状、邻仓经验与正式版核验见[调研报告](./reports/2026-10-02_183712_Desktop产品共源与技术栈调研.md)；实际依赖仍以 manifest/lockfile 为准。

模态框页签的窄屏承载采用[模态框页签窄屏承载规格](./specs/2026-09-30_113200_模态框页签窄屏承载规格.md)：页签栏统一走 `shared/ModalTabs` 的 WAI-ARIA + 横向滚动 rail，选型依据是 W3C ARIA APG 议题 #2438 与 Material Design 3（两者都把横向滚动列为首选/标准做法，换行堆叠与「更多」菜单被明确否决）；同时修正四处弹窗外壳的 `w-[96vw]` 横向溢出与 `vh` 视口失真。

本地库在 Web 端落地采用[本地库 Web 落地与 BattleDataModal 一等数据源规格](./specs/2026-09-29_200500_本地库Web落地与BattleDataModal一等数据源规格.md)，受[本地库与数据所有权决策](./decisions/2026-08-22_022300_本地库与数据所有权决策.md)约束：数据卡与 Web 包共用独立 IndexedDB `mahoshojo-local-library`，`BattleDataModal` 新增无需登录的「本地库」tab，Web 包的选择与删除移入独立模态框，旧 Web 包缓存一次性迁入后清空。内容摘要去重、整卡替换；「导入时保存到本地库」是持久化的设备偏好。导出/备份/恢复（`LIB-007`）与 Installed APP（`LIB-004`）本轮未实现，文档中已显式标注为未完成。

Arena 结束状态与 Tokens 展示采用[结束状态与 Tokens 展示修订](./specs/2026-09-28_160000_Arena结束状态与Tokens展示修订.md)：区分推理与非推理输出，识别截断与流错误，按失败终态恢复可保留的 Markdown 部分正文。

数据卡列表加载采用[可靠性与真分页修订](./specs/2026-09-23_013000_数据卡列表加载可靠性与真分页修订.md)：我的卡/收藏使用摘要分页，单卡正文按需鉴权读取；保留旧完整列表协议，不需要数据库迁移。

Arena 多人个人历史补全：[参与战报个人历史设计](./specs/2026-09-22_121700_Arena多人参与战报个人历史补全设计.md)，冻结参与者/房主身份，以幂等关系表接入个人历史及多人安全详情。

遗留功能清理当前边界：[遗留存档与 PVP 临时数据清理](./specs/2026-09-19_163000_遗留存档与PVP临时数据清理.md)。退休无消费者的旧存档 helper，生产数据先备份校验；不新增观测表，保留旧 PVP 产品和历史战报。

已放弃的肉鸽挑战按[肉鸽挑战功能退休规格](./specs/2026-09-19_180000_肉鸽挑战功能退休规格.md)移除独立页面、API 与专属实现，保留共享缓存能力和已有本地存档结构。

Arena Web 战报当前规格：[Arena Web 战报生成与沙箱渲染规格](./specs/2026-09-17_080700_Arena%20Web战报生成与沙箱渲染规格.md)。单人（含 `/battle`）支持流式/非流式 HTML，多人沿用服务器权威流式生成；浏览器本地确认后才执行完成的沙箱文档，默认格式仍为 Markdown。

Web 包当前入口：[统一架构与后续开发规格](./specs/2026-09-22_165900_WebPackage统一架构与后续开发规格.md)、[受限模式和可信同源授权决策](./decisions/2026-09-28_205100_WebPackage受限模式与可信同源授权决策.md)、[ZIP 信封归一化与缺省导入决策](./decisions/2026-09-29_114500_WebPackageZIP信封归一化与缺省导入决策.md)、[能力预检误报收紧决策](./decisions/2026-09-29_150000_WebPackage能力预检误报收紧决策.md)、[导入作者可用性决策](./decisions/2026-09-29_151000_WebPackage导入作者可用性决策.md)、[生成目标形态示例决策](./decisions/2026-09-29_152000_WebPackage生成目标形态示例决策.md)与[目标形态契约与输出归一化决策](./decisions/2026-09-29_223000_WebPackage目标形态契约与输出归一化决策.md)。本地 ZIP、预设及预设重导入现在统一经过 browser-local materialization，已接通相对 JS/CSS/ESM、媒体、包内 fetch、历史恢复与下载；不使用 SW、不新增域名、不上传包资源。默认 Restricted Mode；独立的三秒风险确认可授予本次/当前浏览器版本的 Trusted Same-Origin，风险扩大需重新确认，撤销后重建受限页面。能力预检只报告该包真实具备的能力，提示投影输入与 Markdown 不按运行时资源扫描，被跳过数量在摘要中显式说明。导入层不因未知扩展名拒绝整个包：媒体类型表覆盖常见 Web 资源，仍无法推断时按不透明二进制导入并点名该文件；是否按文本扫描由内容而不是作者声明的媒体类型决定。包作者可以用 `generation.example` 显式提供目标文件结构示例；宿主不会自动把包自带的默认目标文件当示例。宿主现在按 `generation.mediaType` 正面声明目标文件形态，并对 JSON 类目标做确定性内容归一化（剥离 Markdown 围栏与前导路径行、提取首个顶层 JSON 值）后再校验；归一化不改写内容，digest 与 replay 以归一化后字节为准，仍不自动二次调用 Provider。旧 first-party-only 渲染适配器已删除。当前是单文档物化而非完整 HTTP 文件服务器，多文档/Worker/任意动态 CSSOM 等兼容边界见规格 §11.2；该边界只约束渲染能力，不限制导入层对打包方式的宽容度。线上库和本地包多人分发仍延后；本轮不部署或推送。本地 Web 包的持久化与删除语义见[本地库 Web 落地规格](./specs/2026-09-29_200500_本地库Web落地与BattleDataModal一等数据源规格.md)与本规格 §10 / §16.1 的 2026-09-29 收口。

架构演进背景保留在 [Web 数据卡 Runtime 与媒体资产原生支持设计建议](./reports/2026-09-17_121500_Web数据卡Runtime与媒体资产原生支持设计建议.md)。

Arena 提案人工裁决最新入口：[Arena 提案房主逐项覆盖修订](./specs/2026-09-16_164703_Arena提案房主逐项覆盖修订.md)。允许房主逐项采用旧提案值，保留引用/权限/结构校验及覆盖审阅版本保护；不强制成员 rebase。

Arena 在线数据卡采用[产品一致性修订 §1.1 的 latest 语义](./specs/2026-08-31_150000_Arena多人产品一致性与既有Arena复用修订.md#11-2026-09-20-online-datacard-latest-语义-overlay)：在线版本漂移不阻塞创建、发布、提案或生成；preset 仍严格校验，生成输入在本次解析后冻结。

Admin 业务迁移当前执行入口：[独立线上管理端迁移实施计划](./plans/2026-09-12_130000_独立线上管理端迁移实施计划.md)。新域名为 `admin.mahoshojo.colanns.me`；历史材料中的 `homura-admin.colanns.me` 实为 Arcane Docker 管理入口。

代码迁移去向与实际状态见 [迁移交付记录](./migration/2026-09-12_144000_独立管理端功能迁移与交付记录.md)；生产配置、迁移、撤权与恢复步骤见 [Admin 部署与恢复验收](./runbooks/2026-09-12_143000_独立管理端部署与恢复验收.md)。

`docs/` 负责存放主题入口、决策记录、目标架构、实施规格、阶段计划、报告、参考资料与过程日志。

## 当前权威入口

平台机制简化、复杂度预算和 Arena 多人发布使用以下最新权威入口：

- [平台复杂度预算与故障降级决策](./decisions/2026-09-01_193200_平台复杂度预算与故障降级决策.md)
- [平台机制简化实施计划](./plans/2026-09-01_193201_平台机制简化实施计划.md)
- [Arena 多人发布最小检查清单](./runbooks/2026-09-01_193300_Arena多人发布最小检查清单.md)
- [平台机制简化建议](./reports/2026-09-01_185700_平台机制简化建议.md)

该 ADR 已接受并覆盖与其冲突的旧口径：Arena 普通战后更新不再由完整角色
`baseRevisionHash` / provenance 连续性阻断；GMR-10Q、GMR-11、source digest、review evidence
和多层 release gate 不再是多人发布前置；已经交付的 AI 结果也不应仅因附加归档失败被改判失败。
认证授权、严格排位、secret、多人 host/member 权限、Provider 防重复 dispatch 与有界资源限制仍然有效。

Arena 多人 v1 production ingress 重整与后续激活使用以下专项入口：

- [Arena 生产 Room 入口复用 Hono Primary 决策](./decisions/2026-08-31_080000_Arena生产Room入口复用HonoPrimary决策.md)
- [Arena 生产 Room 入口简化与架构重整规格](./specs/2026-08-31_080100_Arena生产Room入口简化与架构重整规格.md)
- [Arena 多人生产激活与回滚实施计划](./plans/2026-08-30_231000_Arena多人生产激活与回滚实施计划.md)

Arena 多人 GMR-10P 产品一致性整改使用以下权威入口：

- [Arena 多人产品一致性与既有 Arena 复用修订](./specs/2026-08-31_150000_Arena多人产品一致性与既有Arena复用修订.md)
- [Arena 多人生成眼—手一致与 preflight 收敛修订](./specs/2026-09-04_091400_Arena多人生成眼手一致与preflight收敛修订.md)（覆盖上文的 7.3 preflight 选项，补充 7.2 命令响应收敛）
- [Arena 多人 GMR-10P 产品一致性整改实施计划](./plans/2026-08-31_150000_Arena多人GMR-10P产品一致性整改实施计划.md)
- [Arena 多人 GMR-10P 产品一致性实施与退出审计](./logs/2026-09-01_002500_Arena多人GMR-10P产品一致性实施与退出审计.md)

GMR-10P 的历史整改状态为 `DONE`。原 GMR-11 reviewed source / production activation 证明门禁已由上述复杂度预算
ADR 撤回；当前发布判断以正常 CI、feature flag、运行时 smoke、health 与回滚能力为准。

Arena 多人 GMR-10Q 门禁最小化与单人一致性整改使用以下权威入口：

- [Arena 多人门禁分层、最小化与单人一致性修订](./specs/2026-09-01_073000_Arena多人门禁分层最小化与单人一致性修订.md)
- [Arena 多人 GMR-10Q 门禁最小化与一致性整改实施计划](./plans/2026-09-01_073000_Arena多人GMR-10Q门禁最小化与一致性整改实施计划.md)
- [Arena 多人 GMR-10Q 门禁最小化与一致性实施与退出审计](./logs/2026-09-01_092555_Arena多人GMR-10Q门禁最小化与一致性实施与退出审计.md)

GMR-10Q 的历史整改状态为 `DONE`：房间存在、配置共享、协作、生成就绪、runtime 资源与结果权限已分层，0 角色可先建房，
角色/参考项容量继承 canonical Arena/runtime，未声明例外的多人语义默认继承单人。其 machine evidence 不再构成发布条件。

production ingress 专项关于 Room HTTP/WSS 直接复用 Hosted Hono primary、caller Origin 与 service origin 分离的架构结论
继续有效；旧的 immutable release tuple 与独立 source-review 批准门禁由最新复杂度预算 ADR 取代。运行控制继续保留
服务端 request kill switch 与 Web exposure switch。

Arena 战报正文存储与有限保留工作使用以下专项入口：

- [Arena 战报正文分层与有限保留实施规格](./specs/2026-08-31_102000_Arena战报正文分层与有限保留实施规格.md)
- [R2 战报 540 天 Lifecycle 上线 Runbook](./runbooks/2026-08-31_102100_R2战报540天Lifecycle上线Runbook.md)
- [D1、R2、Redis 存储优化实施计划](./plans/2026-08-31_102200_D1_R2_Redis存储优化实施计划.md)

该专项冻结 D1 metadata、existing Redis replay 与 finite R2 的正文分层；540 天是基于 2026-08-31 已知 bucket 数据的候选值，production Lifecycle 在账户其他 R2 使用和现有规则完成管理权限 read-back 前仍为 blocked。

Arena 战后角色更新的权威对账与可编辑修复使用以下专项入口：

- [Arena 战后角色更新双信任通道规格](./specs/2026-09-01_133000_Arena战后角色更新双信任通道规格.md)
- [Arena 战后角色可编辑修复实施计划](./plans/2026-09-01_133100_Arena战后角色可编辑修复实施计划.md)

该专项关于 generation owner、服务器冻结 effect，以及用户/AI 修复只产生 unsigned、non-canonical 本地派生版本的边界继续有效；
完整角色 base revision 与 provenance 连续性作为普通战后更新许可的要求，已由最新复杂度预算 ADR 撤回。

平台重整、本地优先、Monorepo、管理后台、Desktop/Mobile、本地库、Direct AI、发行与服务器权威相关工作，从下列主题页进入：

- [低成本 Hosted DR 与客户端预检切换主题](./topics/2026-08-29_070000_低成本HostedDR与客户端预检切换.md)
  - Hosted Hono/Next DR、流量选择、付费控制面、故障切换与重放边界的当前专项入口；
  - 在该专项范围内，本文档列出的新 ADR/spec 优先于较早的 stable control plane / Cloudflare LB 目标口径。
  - 2026-09-01 复杂度预算 ADR 已进一步撤回大型 manifest/generated projection/version gate/evidence CI；
    `config/hosted-routing.json`、真实 fault tests 与 dispatch 后 no-replay 是当前口径。
  - 2026-09-07 已接受的路由预检修订进一步区分 known Hono primary-only、DR-selectable 与 unknown
    route/method；客户端与 Hono readiness telemetry 均采用低基数、失败不阻断语义。
  - 当前仓库实现与审查证据见 [低成本 Hosted DR 客户端预检实施与审查日志](./logs/2026-08-29_085000_低成本HostedDR客户端预检实施与审查日志.md)。
- [平台重整与本地优先架构主题](./topics/2026-08-22_022000_平台重整与本地优先架构.md)
  - 平台重整、Local-first、Monorepo、应用边界、管理后台、Desktop/Mobile、数据所有权与发行的综合入口。
  - Admin G3-P0 当前实现与审查证据见
    [Admin 回归 G3-P0 安全基座实施与审查日志](./logs/2026-08-29_184200_Admin回归G3-P0安全基座实施与审查日志.md)。

两个主题页共同明确当前稳定决策、目标架构、可测试实施规格、阶段计划、仍然有效的领域规格与只作为历史背景的旧方案；发生 Hosted DR 专项冲突时，以专项主题及其 accepted ADR/spec（包括 2026-09-07 路由预检修订）为准。

## 目录说明

- `topics/`：主题级稳定入口，汇总当前口径、权威文档、取代关系和延后事项。
- `decisions/`：单点架构决策记录（ADR），适合长期引用。
- `architecture/`：长期系统边界、部署单元、依赖方向、信任区与数据所有权。
- `specs/`：规范性定义、结构设计和可测试的实施要求。
- `plans/`：阶段顺序、退出门禁、回滚点和交付拆分。
- `migration/`：迁移台账、字段映射、兼容损耗和生产切换记录。
- `reports/`：阶段评估、专题研究和历史推演。
- `references/`：来源笔记、外部标准与其他仓库复用证据。
- `logs/`：实施证据与过程留痕，不作为稳定结论源。

## 推荐阅读顺序

1. 先读对应 `topics/` 主题页，确认当前权威口径和取代关系。
2. 需要稳定单点结论时读 `decisions/`。
3. 设计系统边界时读 `architecture/`。
4. 编码、测试和验收时读 `specs/`。
5. 安排实施顺序、生产门禁和回滚时读 `plans/`。
6. 需要历史论证和调研背景时再读 `reports/` 与旧计划。
7. `logs/` 只用于核对实施证据，不得覆盖 ADR、架构或规格。

## 故事模型输入与数据卡投影

- [故事模型输入去冗余与原卡隔离](./specs/2026-09-11_220000_故事模型输入去冗余与原卡隔离.md)：模型专用投影、随机判定/历史/状态的单次注入，以及原卡不变边界。
