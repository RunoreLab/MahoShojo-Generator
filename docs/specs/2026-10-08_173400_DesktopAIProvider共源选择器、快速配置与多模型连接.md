# SPEC：Desktop AI Provider 共源选择器、快速配置与多模型连接

- 日期：2026-10-08
- 状态：`accepted`（产品/UX 目标与强制不变量已确认；AIP-1..4 + D5.1-AIP-r1 审查收口已实施，AIP-5 自动与实机验收保持 `PENDING`）
- 规范标识：`SPEC-desktop-ai-provider-parity`；配套 [ADR](../decisions/2026-10-08_173300_DesktopAIProvider选择器与多模型连接体验统一.md)
- 仓库/基线：`RunoreLab/MahoShojo-Generator` / `feat/desktop`
- 主属：已有 `D5.1` 阶段计划，建议登记非冲突子切片 `D5.1-AIP`（实际编号由唯一计划确定），不再新增平行项目计划
- 规范用词：MUST、MUST NOT、SHOULD 按 RFC 2119 的强制/建议含义解释

## 0. 目标、范围及约束

**目标**：Desktop AI 选择器是 Web `AiProviderSelector` 的增强型宿主，在外观、字段、键盘操作、文案和共同状态交互上复用相同组件；用户在任一已交付生成入口中可以选择可直连的内置供应商、填写 Key/模型并在当前选择器内保存为连接，或选择、编辑已有连接并使用一个连接下的多个模型。

**本轮**：
- `apps/desktop/src/app/{details,canshou,free,scenario,creator}-page.tsx` 五个入口与设置页的 AI 配置部分（`/creator` 经 D5.1-G3 审查决策增补，见文末「增补记录」）。
- `packages/ui-web/src/ai-provider` 的受控视图/控件、`apps/web/components/AiProviderSelector.tsx` 作为现行 Web 回归基线。
- `apps/desktop/src/features/ai-config` 的唯一 Store、Native Profile/SecretStore bridge、非秘密 overlay 版本迁移。

**不在本轮**：Desktop Server BYOK、全协议 Native Direct、无需保存的临时 Key、模型自动发现/测试、云端配置同步、用户账号联动、服务端治理协议修改、全部页面视觉重制。其他已迁页面的共源缺口按 `DESK-PARITY` 另外登记，不借本切片隐式改动 Web 产品流程。

## DESK-AIP-001 执行位置与选择器分层

1. **执行位置**（Desktop 专属）为 `client | server`，与流式/非流式、连接、模型选择互相正交。Web 不展示无实际能力的客户端按钮。
2. Desktop `server` 只显示可执行的「使用系统默认配置」通道（Provider 项标签与 Web 目录事实源 `SYSTEM_PROVIDER_OPTION.name` 一致）与项目通路提示，并允许在系统目录内选择具体模型或跟随「默认策略」——该选择作为非秘密 `systemConfig` 偏好经 hosted 通路上行（D5.1-AIP-r1，见 DESK-093 修订记录）。不得出现可以选择但不能执行的“服务器 BYOK”空按钮；切至 server 不清除上次客户端连接或模型偏好，也不得上传客户端 Key。
3. Desktop `client` 显示统一供应商/连接选择器。无配置首次启动保留 `client` 偏好与**未选择**状态，不自动选择第一供应商/连接、不静默切服务器；表单仍可填写，生成操作禁用并给出可行动的配置提示。
4. `System Default` 永不成为 Direct Profile。`direct-local` 或 `direct-remote` 根据 Native 验证后的目标地址判断；远端直连不标成离线。本轮 Direct 的产物与非流式结构化规则不变；不以底层 SSE 传输能力冒充支持用户可见的流式 Markdown 产物。
5. 在服务器强制的 Strict/多人场景仍按现有约束解析，不能让统一选择器提供客户端绕过选项。

## DESK-AIP-002 选择菜单的语义和行为

客户端下拉选择菜单有两个数据分组和一个独立动作区：

| UI 区域 | 项目 | 真实身份 | 激活条件 |
| --- | --- | --- | --- |
| 内置供应商 | 经核验的项目预设 | `presetId`，只读目录 | 选择后进入尚未保存的配置表单；保存成功后创建用户 Profile |
| 我的连接 | 已保存 Profile | `profileId`，用户资产 | 选择后载入 Profile、可选模型和 Key 存在性；不读回 Key |
| 操作区 | ＋ 新建自定义连接；管理连接 | **动作**，非 Provider ID | 打开同一表单中的新建/管理区；取消恢复原选择 |

1. UI 选项 MUST 使用带 `kind` 的显式区分类型（例如 `preset` / `connection`），不得将真实 Profile ID 与预设 slug 拼在同一未经区分的查找空间中；“新建”是动作，不是虚拟 Provider。
2. 预设与已保存连接可有相同显示名、相同 baseUrl，MUST 按身份而非 Endpoint 自动归属；不自动将旧 Profile 改认预设，旧 Profile ID/密钥引用保持不变。
3. 预设不可原位修改名称、Endpoint、adapter。选择预设后填 Key/模型只是填写**即将创建的用户 Profile**，保存后切换到“我的连接”条目。
4. `project-forward`、`system`、未核验 Direct wire、宿主未实现 adapter 的预设必须展示原因或显示为不可用，但不得被当作可执行 Direct 的快捷候选。预设支持度继续由 `describeAiPreset*DirectSupport` 与 Native adapter 实装集合交集计算。
5. `AiProviderCustomSelect` 的分组、操作项、焦点恢复、箭头键/Enter/Escape/Tab、ARIA 语义由共源层实现，Web 不显示 Desktop 专属操作。弹层在窄窗、缩放和滚动容器中不得裁切且允许触控操作。

## DESK-AIP-003 首次预设配置的“保存并使用”旅程

1. 用户主动选择可直连预设 → 选择一个该宿主已核验可用的模型（也可进入允许的自定义模型路径） → 输入 Key（若确属无需 Key 的服务则可空） → 点击 `保存并使用`。
2. 首次保存 MUST 使用目录中已经通过 Direct 能力核验的公开 Endpoint 与协议，不得从 Web 业务请求转发地址或供应商名称推测 URL/adapter。新 Profile 默认名称可为预设显示名，用户可重命名；不能反向修改目录。
3. **成功判定**为 Profile 与必要秘密已保存、配置可读且当前客户端连接/模型选择写入确认，并且生效执行位置是 `client`。**最后一步 MUST 将 `executionPreference + clientConnectionId + selectedModelId` 作为同一次受检 overlay 更新持久化（落盘确认后发布给 UI），不得顺次调用两个可独立失败的 setter 后直接宣称整体成功。** 此操作 MUST NOT 自动开始生成，也 MUST NOT 自动执行连接测试或联网探测。
4. UI 提交应防重入并复用同一候选 ID：用户双击、保存超时或刷新失败重试，不得静默产生多个不同 Profile/重复写 Key。
5. 保存失败必须保留输入（Key 仅保留在本次易失表单内，不写磁盘或日志），显示可定位字段/存储错误。若 Profile 已成功保存、但“设为当前”或列表刷新失败，必须显示“已保存但未启用/未刷新”，允许针对原 Profile ID 重试激活或刷新；**不得**谎报成功、也不得新建第二条记录。
6. 当前无 Key 的合法 loopback OpenAI-compatible 服务仍可使用；不能把所有“凭据 absent”都解释为连接不可用。公网 HTTP 仍必须用户显式确认且由 Native 重新验证。
7. 当用户切换选择、关闭表单或改变执行位置且存在未保存 Key/配置时，须有不丢失内容的可理解确认；不可暗自把明文 Key 写入持久化草稿。若选择放弃，清除这份易失的 Key 字符串。

## DESK-AIP-004 自定义连接新建、编辑与凭据处理

1. 下拉菜单的“＋ 新建自定义连接”打开选择器内的轻量表单，字段为**名称、Endpoint（API 根路径）、API Key、默认模型 ID**。当前只有 `openai-compatible` 编辑/执行通路可用；未实现的 adapter 不得假装受支持。
2. `Endpoint` 的格式含义与现行 Native 不变：OpenAI-compatible API 根 URL，由 Rust 构造 `/chat/completions`；不能让用户误把任意 Chat URL 当作通用模式，不能接受项目自有转发 Origin 或其他被 Native 拒绝的出站目标。
3. “我的连接”允许：改显示名、手动改 Endpoint、修改默认模型、增加/删除模型、替换 Key、测试当前连接、删除连接。普通选择器以内联简单字段为主；复杂详情可在同一设计体系的抽屉或设置管理中打开，不能维护独立的第二个配置 owner。
4. 既有 Key 在 UI 上只呈现 `unknown / absent / present / error` 与“已配置／凭据缺失／检查失败”等准确文案；**不读回任何明文，也不为了模仿 Web 而显示前 6 位**。编辑凭据应为明确操作：`keep`（空输入维持不变）、`replace`（提交新 Key）、`remove`（另有显式确认）。无 Key 连接并不自动视为损坏。
5. 编辑旧 Profile 必须基于完整原文做 patch/merge，保留编辑器未覆盖的 `adapter`、`transport`、headers、`generationDefaults`、原 ID 与 createdAt；不经只读列表投影进行有损读写。对当前编辑器不能表达的 adapter，保持只读并准确提示。
6. 删除当前连接或删除当前选中模型时，不能自动换成第一连接或另一模型；须在 UI 中明确要求重新选择。删除 Profile 的 Key 应在确认 Profile 删除成功后按实际旧 ref 清理；对潜在在途引用不能盲删。

## DESK-AIP-005 一个连接多个模型的非秘密数据模型

**冻结方案：保留 `DirectProviderProfileV1`，升级 Desktop overlay payload `version: 2 -> 3`。**

- 继续保留：`selection.executionPreference`、`selection.clientConnectionId`、`hiddenPresetIds`、`generationOverrides[profileId][servedModelId]`。
- 建议新增：`modelsByProfileId[profileId] = { selectedModelId?: string, customModelIds: string[] }`。字段名在实现评审时可再精简，但**只有一个 writer、按 Profile ID 隔离**是不变量。
- `profile.modelId` 是默认模型；某个 Profile 首次没有 `modelsByProfileId` 时，生效模型正是原 `profile.modelId`，保证旧用户请求不变。
- 用户添加的模型 ID 是**该连接**的模型，不是全局供应商模型或配置好的第二条连接；同名不同连接的模型及高级参数必须完全隔离。
- 模型下拉包含 Profile 默认模型与用户显式加入的模型，去重后展示；目录预设的模型列表仅作提示，不通过相同 URL 自动猜测旧 Profile 的来源或模型范围。
- 用户更改“当前模型”写入非秘密选择偏好，**不自动改 Profile 默认模型**；修改默认模型须独立显式操作。一次生成将明确模型 ID 传入已有 Direct 请求的 `modelId`，不得回落为 `profile.modelId` 或其他模型而不告知用户。
- 用户手填 `servedModelId` 必须做非空、长度、危险控制字符与大小边界校验，建议与现有 Profile 默认模型的 256 字符上限对齐；未知模型能力呈现“未知”，而不是假定完整支持。
- 内置预设的已核验 Direct 模型作为一键配置候选；若预设整体 wire 已核验且未显式禁止该模型，允许用户输入其自有 `modelId`，但不得伪称该模型已被项目核验。若目录仅对个别模型核验、其他模型 wire 未核验，则不能借预设快捷入口悄悄放行；用户可以显式通过合法自定义 Endpoint/Profile 途径尝试，仍遵守原生出站校验和失败提示。
- 若选中模型后来被显式删除、Endpoint 修改导致其不可用或其所属 Profile 缺失，显示需重新选择，不在后台静默回落。移除模型展示项不会隐式清空已有参数；若要连带删除参数必须得到明确确认。
- `generationOverrides` 仍以 `[profileId][modelId]` 隔离。连接编辑或模型切换期间，不得把上一个模型的 overrides 写到新模型。已保存的旧参数即使暂时不支持，也不得无提示覆盖或实际发送。

## DESK-AIP-006 配置存储与迁移

| 数据 | 现权威与目标权威 | 禁止行为 |
| --- | --- | --- |
| Web 供应商/模型/Key 偏好 | Web 既有 storageNamespace/localStorage（本轮不迁） | 不改变 Web 原 Key/wire 语义 |
| Desktop 当前执行偏好、当前连接、模型列表、模型级参数 | Desktop 单例 `DesktopAiConfigStore` overlay，建议 payload v3 | 不双写 `config.json` 或建立第二套页面状态 |
| Desktop 完整连接 Profile（含默认模型/Endpoint） | 既有 Native SQLite opaque Profile | 不将连接详情降格为 UI 列表投影 |
| Desktop API Key/凭据引用 | OS SecretStore + Profile `apiKeyRef` | 不在 overlay、日志、报告、备份、普通请求出现 Key 明文 |
| 项目预设目录 | 既有 `@mahoshojo/ai-core/provider-catalog` | 不原位改写、按 Endpoint 猜测用户连接身份 |

迁移不变量：

1. 维持已有 `mahoshojo.desktop.ai-config.v1` 单一 key（key 名与 payload version 分开），新增受检 v3 payload；读取 v2 时，将新增 `modelsByProfileId` 初始化为缺省/空，以 `profile.modelId` 作为默认。保留 selection、隐藏预设、全部 profile/model overrides 字典，不重写 Key 或 Native Profile。
2. v2→v3 只在成功完整解析后执行受检、幂等写入；持久化异常不虚报升级成功，不覆盖原始未知/损坏数据。原 `version:1` 或未来未知版本继续 fail-closed，不自动 reset、不改选其他连接。升级与旧客户端回退的“不兼容需升级”情况应明示。
3. 当前选择的 Profile ID 即使在列表缺失仍保持诊断，不自动选择首条。删除当前 Profile 的结果应经明确操作确认；Profile 异步读取失败/部分结果不足以证明对应配置应被清理。
4. 非秘密 overlay 沿用现有 256 Ki 字符预算，新增集合不得产生无限制膨胀；对象动态键/模型 ID 继续使用安全解析与 null-prototype 处理，防止 `__proto__` 等键名污染。超限与写入失败保留上次有效配置。
5. `config.json` 的人工编辑功能另有 owner（`DESK-SET-003..005`）；在专门迁移设计获批准前，**不**把这份 overlay 同步搬进 `config.json`。

## DESK-AIP-007 Key 保存、任务快照及竞态

1. 仍使用 `validate profile -> staged secretRef 写入 -> save full Profile -> 旧凭据安全清理` 的既有路径；前段失败不改变旧 Profile 或旧 Key。`remove` 必须显式，并在 Profile 成功解除引用后安全清理旧 Key。
2. 存在跨存储事务边界（OS SecretStore、SQLite 与 overlay/localStorage）：不能承诺不存在跨介质部分成功。各阶段应返回可重试的真实状态；保存成功但启用失败以 `saved-not-activated` 表示，并固定其新建 Profile ID，以防重试产生重复连接。
3. 本次生成开始时冻结输入、execution location、Profile 身份、Endpoint、模型、生成参数以及适用的凭据版本。Profile/Key 编辑仅影响**后续**请求。当前实现中保存成功后旧 secretRef 会尽力删除，实施前必须审查 Native 加载 Profile/读取秘密与替换凭据并发时是否会误删在途所需 Key；必要时给在途引用加 pin/deferred cleanup 或安全的版本校验，不得仅凭前端按钮禁用宣称消除竞态。
4. 新配置不可让未知状态的 Hosted 生成重新派发，也不能使 Direct/Hosted 请求间切换自动造成第二次付费调用；沿用 requestId、取消、唯一终态、uncertain/no replay 现有约束。
5. 录入 Key 的 React 表单只是易失临时输入，保存后清空；Native secret 明文仅交专有受控命令，普通 `AiExecutionRequest` 不出现明文 Key、任意 Endpoint、header 或任意 secretRef。断网、本机服务不启动、Keychain 失败等错误必须分别处理。

## DESK-AIP-008 Provider/模型/生成参数能力门禁

1. `supported` 必须同时符合：供应商 Direct wire 核验、当前 Native adapter 已实现、相应模型或自定义模型路径允许实际调用；不以 Web 列表或 `provider.type` 推测。
2. 当前 Native 主力仅支持 OpenAI-compatible Direct；Anthropic/Google 等协议未实现时不可假装通用 `/chat/completions` 支持；系统默认和项目转发端点不提供 Direct 快捷调用。
3. Web 端“供应商/模型成功率”来自项目服务器统计，**不能**直接当作用户 Direct 连接可用性。Desktop 如显示服务器侧数据必须标注“仅供参考”；本地连接只用有来源、有时间的测试结果展示，不自动测试。
4. `temperature`、输出 Tokens、`thinking` 等高级参数要经模型、adapter 与**实际请求映射**三重判断：本期 Native Direct `thinking` 虽然可保存但尚未真实下发，UI 不能显示成已生效。可禁用并解释，原保存值仍要保留；Web 现有能力不退化。
5. 客户端现有“非流式/结构化”生成约束维持；切到 server 时允许其已有 Hosted 流式业务路径。不可将切执行位置实现为对其他页面或服务器模式偏好的不可见覆盖。

## DESK-AIP-009 Web 共源、页面一致性与可访问性

1. 将现有 `AiProviderSelectorView` 的**纯受控展示层**（供应商选择、模型选择、自填模型、凭据状态/编辑入口、高级参数、状态说明）与 Web 当前的 `useAiProviderSelection` 持久化副作用分离。Web 继续用原 Hook/namespace/wire，Desktop 用 `DesktopAiConfigStore` 控制同一 UI。不得复制一份 Desktop JSX 来实现“看起来相似”的选择器。
2. `AiProviderCustomSelect` 的可用性徽章、分组、操作动作和焦点管理共享；业务定制通过宿主 capability/受控 props 注入，不能在共享包中调用 `Tauri.invoke` 或 Next 专属模块。
3. 四个 Desktop 生成页只挂载同一套 `DesktopAiProviderPanel`/Controller，不再各自组装原生 Profile `<select>`、提示文案和参数状态。设置页的连接管理也必须消费同一 Store 与基本表单组件。
4. `GenerationModeSwitcher` 目前默认 helper 含“返回完整战报/胜者解析”文案；非战报页 MUST 关闭该业务默认 helper，按业务区段使用准确文案（与 Web `ScenarioPage` 已使用 `helper={false}` 的实践对齐）。建议改成宿主提供 contextual help，避免未来误用。
5. 按 `DESK-PARITY-001` 进行“Web 当前 / Desktop 当前 / 目标 / 合理差异 / 自动回归”对照：覆盖主要 CTA、选项顺序、输入大小、布局、主题、灰态、错误、空态、草稿保存提示、图标资源。合理差异包括客户端/服务器切换、OS SecretStore、离线本机连接等明确的宿主能力，而非未经评审的产品分叉。
6. 验收至少覆盖窗口 800×600、1024×720、1440×900、125%/200% 缩放、亮/暗主题、中文长名、窄窗菜单、键盘与屏幕阅读器基本语义。不得因追求像素完全一致而使 Desktop 独有能力不可发现。注意 `.container` / `.card` 已共源，改进重点是页面闭包与适配而非复制 CSS。

### Desktop 专属控件也要使用 Web 的共源视觉（强制）

7. **相同分段组件**：当前 `packages/ui-web/src/details-controls/GenerationModeSwitcher.tsx` 复用 `SegmentedControl`，具备圆角轨道、等宽触控目标、粉色激活态、图标、焦点环、深色主题和响应式排布；现有 `packages/ui-web/src/ai-provider/execution-location.tsx` 却自建紧凑的 `inline-flex` 小开关。AIP-1 MUST 让 `AiExecutionLocationField` **消费同一个** `@mahoshojo/ui-web/details-controls/SegmentedControl`（或由它抽取的等价共享原子控件），不得仅复制 className 以保留双实现。若个别执行位置需禁用，应扩展共享组件的可选项级 `disabled/reason`，并保持 Web 既有 `GenerationModeSwitcher` 默认语义与视觉不变。
8. **同区段、相邻布局**：对照 Web 对应页面的 Provider、生成语言、生成方式与 CTA 布局，Desktop 不得把执行位置孤立地放在不同外观的顶部“小型设置”。`客户端｜服务器` 必须置于与 `非流式｜流式` **同一生成方式/生成设置视觉区段并紧邻排列**，推荐在生成方式之前、按一致的 `input-group`、`input-label`、容器底色、间距、宽度和帮助文案层级竖向叠放。窄窗口依然全宽可点；每页保留其对应 Web 页面原有字段顺序，不强制调整不同业务页面彼此之间的结构。
9. **状态含义不混淆**：执行位置控制的是 `client/server`，生成方式控制的是 `stream/non-stream`；即使外形一致，标签、图标、帮助文字、可用性和保存偏好仍各有明确含义。客户端 Direct 不支持页面可见流式 Markdown 时，生成方式的流式项不可用并解释原因，不得因为视觉共源就误认为所有模式都已经支持。服务器模式保留原 Hosted 能力；不改变现有生成任务语义。
10. **桌面独有表单同样跟随 Web 风格**：新增连接、修改 Endpoint、Key 状态/替换、模型列表、连接测试等区段，优先复用 Web 的 `input-field`、`input-label`、`battle-lite-*`、按钮/折叠/弹层和共享焦点/ESC 层级；不允许设置页和生成页另外维护两套“仅外观看似相同”的 CSS。原生安全确认和详细诊断可扩展内容，但优先使用同类容器与反馈层级。
11. **截图/DOM 回归**：每个迁移页面以**相同尺寸、缩放、主题和配置状态**比较 Web 与 Desktop 的共同区段；另增加 `AiExecutionLocationField` 与 `GenerationModeSwitcher` 的对照门禁（轨道尺寸、图标位置、激活态、键盘/触控、灰态/原因、暗色/reduced-motion）。允许“多一个执行位置段”这种有说明的宿主差异，不能以“桌面特有”为由豁免风格共源。

## DESK-AIP-010 业务与错误状态矩阵

| 场景 | 必须呈现的结果 |
| --- | --- |
| 全新安装、无 Profile | Client 未选择；可点内置可 Direct 预设直接填写，生成尚不可用，不自动选系统 |
| 预设选好但未保存 | 明确“尚未保存”；生成不能误用其他连接；切换前保护未保存内容 |
| 首次保存 Key/Profile 成功 | 切到“我的连接”条目，保持选择的模型；只有用户点击“生成”才发请求 |
| Key 保存成功但 Profile 保存失败 | 旧 Profile/Key 不变，新 staged Secret 最多成为可回收孤儿；UI 显示错误 |
| Profile 已保存但 overlay 激活失败 | 明确 `已保存但未启用`；重试激活同一 ID，不能重复创建 |
| OS 凭据 `unknown/error/absent/present` | 逐态显示；unknown/error 不伪称“未配置”，合法无 Key 连接仍可使用 |
| 连接/模型删除或不支持 | 当前身份不静默回落；要求显式重新选择；未支持 adapter 不出站 |
| 客户端切服务器再切回来 | 客户端连接、当前模型、高级参数保留；server 不得到 Direct Key |
| 模型 A/B 同名跨连接 | 两条独立 Model ID/参数状态，不串用 |
| 连接编辑时生成正在运行 | 在途任务保持冻结的端点、Key、模型和参数；下一请求才使用修改后配置 |
| 用户取消/网络中断/unknown | 不自动重试或变更执行者；保留原有安全确认与结果状态 |

## DESK-AIP-011 原子化实施顺序与门禁

**AIP-0 文档和差异基线**：补充 ADR，精确修订 `DESK-ONLINE-002` 以及与 `003/005` 的延期口径，更新唯一 D5.1 计划并列明 Web/Desktop 的界面和 wire 对照。只做文档，不宣称功能已实施。

**AIP-1 无业务行为变更的共源 UI 抽取**：抽纯受控表单、菜单分组/操作支持、上下文帮助文案；将执行位置分段控件归并到现有 `SegmentedControl` 样式/行为共源（按需扩展可选项禁用）；Web 原 Hook 继续作为唯一 Web writer 并同提交回用；Web 测试通过，包括已有 localStorage Key、系统默认、自定义 Model ID、参数和 channel-availability 回归。

**AIP-2 Desktop Store v3 与多模型适配**：设计、测试和实现 v2→v3 单 writer 迁移、模型 ID 选择/添加/删除和 `[profileId][modelId]` overrides；Native Direct request `modelId` 走通，而没有新的通用 Key/URL IPC；迁移失败与悬空引用 fail-closed。

**AIP-3 首次保存与连接编辑**：已有 Profile 创建/编辑与 staged SecretStore 接入受控选择器，明确保存与激活的部分成功恢复、Key tri-state、旧字段无损 patch、编辑期间任务冻结安全。先单个 `/scenario` 纵切跑通，再扩四页，不复制临时页面代码。

**AIP-4 五页与设置共源闭合**：迁移 `/details`、`/canshou`、`/free`、`/scenario`、`/creator` 与设置页统一选用 Store/视图；将执行位置与生成方式放在 Web 原有生成设置区段相邻展示；修正页面级生成方式帮助文案及可见配置区块；各页面原有草稿、问卷、附件、结果和保存逻辑不被替换。

**AIP-5 自动+实机验收**：全仓 lint/typecheck/unit/integration、Native loopback SSE/mock、Store 错误注入、Web 既有行为回归、窗口/主题/键盘/触控、重启迁移与 Keychain 故障。需要真实 Direct Endpoint/公网测试的现存 D1 门禁仍保持待验状态，不用 mock 测试冒充真实端点验证；不默认消耗用户线上模型额度。

**AIP-6（单独后续）服务器 BYOK 与其他 adapter**：仅在另行冻结 Native 专用生成协议、接收方披露、资格/安全与服务端契约后实施；不属于本次退出门禁。

拆分遵循现有唯一 D5.1 计划，避免覆盖历史 D5.0b/G1/G2/P2 已经完成的记录或混入无关依赖升级。

## DESK-AIP-012 发布前最低证据

1. **产品金样**：五页和 Web 同宽/同缩放/同主题对照截图/DOM 测试，共用分段控件验证执行位置与生成方式视觉/布局一致，说明不同执行模式下合理差异；错误默认 helper 消失；桌面打开选择器即可配置预设，无需去设置页前置创建 Profile。
2. **存量兼容**：overlay v2→v3、重复迁移、损坏/未知版本、配置过大、旧 Profile/secretRef、无 Key、重复名称、特殊模型 ID（含 `:`/`__proto__`）、切换/删除/重启全部覆盖。
3. **请求真实性**：本地 mock 捕获 Native 实际端点和 `modelId`、确认 Key 不在 renderer 业务请求/日志/配置/普通云 API 中；未实现模型参数没有被 UI 伪装为已生效。
4. **竞态与失败注入**：双击保存、Secret 写失败、Profile 写失败、刷新失败、overlay 写失败、并发轮换 Key、生成时修改连接、旧请求取消/未知终态、Store 多页面同步无串台。
5. **安全与授权**：不扩展任意 URL/secretRef/header renderer 通路，不改 Direct 重定向和项目域名禁用策略；renderer 直传的 `customProvider` 及凭据类字段仍拒绝——`systemConfig`（`providerId` 固定 `'system'` + 目录内 `modelId` + `generationOverrides`）是 hosted 系统通道的唯一受检非秘密入口，由 native 注入为服务器 `customProvider`，对未知/凭据字段 fail-closed（D5.1-AIP-r1）；Strict/多人权威规则不变。
6. **Web 不回归**：用户 Key、系统默认、自定义模型、参数、渠道可用性及现有 BYOK Web 请求契约不变；shared UI 的 keyboard/focus/mode 文案可用。
7. **记录状态**：文档与自动门禁分别记录，通过才关闭对应切片。Native 真机及付费模型实测若未执行必须保持 `PENDING`，不得以单元测试等价代替。

## DESK-AIP-013 相关权威文档同步（本次 AIP-0 文档切片）

- `docs/decisions/2026-10-04_202000_Desktop线上本地整合与AI配置共源决策.md` §4：修订预设必须先复制的 UX，不改变底层身份和权威。
- `docs/specs/2026-10-04_202000_Desktop线上本地整合与AI配置共源规格.md` `DESK-ONLINE-002/003/005`：明确直接配置后保存的客户端体验、多模型以及 Server BYOK 延后。
- `docs/specs/2026-10-06_084200_双端产品对齐与设置共源规格.md` `DESK-PARITY-001` 与 `DESK-SET-003`：明确共享表单与 Store v3 迁移，保留 secret owner。
- `docs/plans/2026-09-30_160100_Desktop客户端阶段实施计划.md`：在唯一 D5.1 计划登记 AIP 切片，沿用已完工部分和未关闭实机门禁。
- 设计/测试说明可另加 `docs/reports` UI 对照表，明确已实现与尚未实现边界，不把文档写成发行说明。

## 当前已冻结与待实现时再审的窄项

| 项目 | 状态 |
| --- | --- |
| 在选择器内“保存并使用”，不自动生成 | 已冻结 |
| 先 Client Direct，Server BYOK 后续 | 已冻结 |
| 每连接多模型 + 自定义 ID，Profile V1 保留 | 已冻结方向 |
| Web 不改业务，只共源 UI | 已冻结 |
| Desktop 执行位置/生成方式同控件风格并相邻放置 | 已冻结 |
| Overlay v3 的具体字段名和旧版回退 UX | 建议方案，实施评审时核对 schema |
| 正在生成时轮换 Key 的 Native pin/deferred cleanup 实施细节 | 必须先做竞态验证后冻结 |
| 预设整体 wire 已核验时对未收录自填模型的细分提示 | 必须和现有 Direct evidence 逐供应商测试 |
| 连接模型条目数量/输入预算的额外硬上限 | 以现有大小预算和 schema 为基础，在实现阶段用实测固定 |

> 本文档为已接受的**目标实施规格**，不是已交付功能说明；本轮只同步文档，未执行代码改动、数据库迁移、生产调用或实机验收。

## 附录 A：选择器 UI 状态机（实现时按此设计测试）

| 状态 | 用户可见内容 | 可执行动作 | 转移不变量 |
| --- | --- | --- | --- |
| `client-unselected` | 供应商占位提示、内置 Direct 预设、我的连接 | 选择预设/已有连接/新建 | 不自动选择第一项，不生成 |
| `preset-draft` | 预设固定 Endpoint 说明、模型、Key、保存并使用 | 编辑易失草稿、保存、取消 | 未保存时不得冒充当前可执行 Profile |
| `connection-ready` | 我的连接、当前模型、Key 状态、高级参数 | 添加/切换模型、编辑、测试、生成 | 生效模型来自该 Profile 的选择偏好；Key 不明文回显 |
| `connection-dirty` | 明确未保存变更 | 保存更改、放弃 | 未保存的新 Key/Endpoint 不得在请求中半生效；生成前要求提交或放弃 |
| `saving` | 保存进行中 | 取消不可导致已提交的 Native 事务被误认回滚 | 禁止双击重复创建；旧 Profile/Key 在提交失败时仍有效 |
| `saved-not-activated` | Profile 已保存但激活或刷新失败 | 对既有 ID 重试激活/刷新 | 不新建第二条 Profile，不显示已启用 |
| `blocked` | overlay 未知版本/损坏；可见诊断 | 备份、显式修复/重置 | 不静默回退选第一个 Provider，Key 不跟随重置删除 |
| `server-system` | 服务器 System Default | 手动切回客户端或生成服务器内容 | 无客户端 Key、Endpoint 进入 Hosted 普通 body |

由于选中项和连接的加载/保存可能异步交错，迟到结果应按**操作发生时的连接 ID + 操作序号 + 预期 revision**归属：A 连接的检查或保存回调不能覆写用户随后选中的 B 连接界面；显示结果不应沿用旧连接的“已连接/可用”。

## 附录 B：当前源文件与目标职责

| 源位置 | 现状观察 | 目标职责 |
| --- | --- | --- |
| `apps/web/components/AiProviderSelector.tsx` | 注入 Web localStorage、可用性数据与 Next Link 的薄封装 | 保持 Web 宿主接口、存储 namespace 与 wire；消费共源受控表单 |
| `packages/ui-web/src/ai-provider/ai-provider-selector-view.tsx` | 同时组装状态 Hook 与展示 | 拆分纯展示；不要让 Desktop 继承 Web Key 自动持久化副作用 |
| `packages/ui-web/src/ai-provider/use-ai-provider-selection.ts` | Web provider/model/Key/overrides 保存状态机 | 保持 Web 现有语义，必要时改为 Web 专属 Controller 适配纯视图 |
| `packages/ui-web/src/ai-provider/custom-select.tsx` | 基本列表与 Esc 焦点返回 | 共源分组、独立操作项、键盘与可访问性语义 |
| `packages/ui-web/src/details-controls/GenerationModeSwitcher.tsx` / `SegmentedControl.tsx` | Web 生成方式以 SegmentedControl 展示；默认 helper 仍有战报文案 | 共源分段视觉，增加可选项禁用语义；非战报页不展示误导性的业务 helper |
| `packages/ui-web/src/ai-provider/execution-location.tsx` | 目前是独立的小型 `inline-flex` 分段按钮 | 复用同一 SegmentedControl 轨道/图标/激活态/焦点与响应式样式，并在生成设置区域紧邻模式控件 |
| `apps/desktop/src/features/ai-config/desktop-ai-config.ts` | overlay v2、resolve 只用 `profile.modelId` | v3 解析和 `selectedModelId` 生效目标解析；保留无静默回退 |
| `apps/desktop/src/features/ai-config/desktop-ai-config-store.ts` | Native Profile/SecretStore 唯一事实源；保存后选连接 | 追加多模型状态、保存并激活的可恢复状态与安全编辑 |
| `apps/desktop/src/features/ai-config/AiConnectionsPanel.tsx` | 原生连接选择与独立 ConnectionEditor | 消费共享选择器及同一连接表单；设置页保留高级管理 |
| `apps/desktop/src/app/{details,canshou,free,scenario,creator}-page.tsx` | 五处分别装配 `<select>` 与高级设置 | 统一使用 Desktop AI Panel；保留各自业务输入/草稿/结果模式 |
| `apps/desktop/src/features/generation/executor.ts` | Direct intent 已接受覆盖的 `modelId`，thinking 暂不下发 | 取冻结的生效模型和参数；未支持参数有真实 UI 门禁 |
| `apps/desktop/src-tauri/src/{ai,provider_profile,cloud}.rs` | Profile-ID-only Direct、Native Key 解析；Hosted 排斥 renderer `customProvider` | 保留权限边界；仅修复已证实的轮换 Key 并发漏洞，不放宽 Hosted |

## 附录 C：五页最小对照矩阵（AIP-0 建立基线时补截图证据）

| 页面 | Web 基线已见控件 | Desktop 当前 AI 配置差异 | 本轮必须统一的部分 |
| --- | --- | --- | --- |
| `/scenario` | `AiProviderSelector`、生成语言、`GenerationModeSwitcher` 且 helper=false、情景 JSON/Markdown 说明 | 独立“AI 连接”、执行位置、默认战报 helper、Direct 非流式限制 | Provider 区视觉及选模型/Key、正确模式文案；执行位置保留 Desktop 独有 |
| `/free` | Provider 选择器、Schema、语言、模式及具体说明 | 原生连接、配置区顺序和模式限制另行装配 | Provider/模型/Key 共源；Schema、附件、草稿保持业务差异 |
| `/details` | Provider、生成方式、完整问卷区 | 原生连接与参数面板另行装配 | 生成设置的共同区段共源；问卷/结果/随机/导入由既有 P2 管辖 |
| `/canshou` | Provider、生成方式、问卷/结果区 | 同上 | 与 details 相同的生成区；残兽专属问卷/结果保留 |
| `/creator` | Provider 选择器、生成方式（流式/非流式）、语言与高级生成设置区 | 原生连接与执行位置另行装配 | 统一连接选择器与执行位置/生成方式区段；问卷、规则车卡、结果快照与保存保持 Creator 业务差异 |

**对照边界**：不同分辨率截图不能单独证明布局实现不相同。共源验证应在相同窗口/视口/缩放与数据状态下执行，检查外层骨架、CSS、组件 Props、文字、行为、状态归属与主题；合理的执行宿主差异必须在用例中单独标注。

## 增补记录

- **2026-10-08（D5.1-G3 审查决策）**：`/creator` 创作工房完成纵切后，AIP-4 的 Desktop 生成页面覆盖自四页扩为五页——`/creator` 同样使用统一连接选择器、客户端/服务器执行开关，以及共享的高级生成设置布局；Web 侧仍只共享适合共享的外观与组件，不改变其 Provider 持久化或 BYOK 能力。本增补对应审查报告「需要决策的两件事」第 1 项的采纳结论。
- **2026-10-09（D5.1-AIP-r1 审查收口）**：按独立审查意见收口——生成页面板改由共源 `AiProviderSelectorForm` 装配（DESK-AIP-009.1/3 闭合）；Provider 下拉承载「使用系统默认配置」+ 内置可直连预设 + 我的连接，预设即选即配落入连接编辑器；服务器位置呈现系统模型行（含「默认策略」与 GLM 5.3 Flash 等目录模型）与按系统模型作用域保存的高级参数；overlay 升级 v4 追加 `selection.systemModelId`；hosted 契约新增受检非秘密 `systemConfig` 并由 native 注入为服务器 `customProvider`（DESK-093 修订）；`AiProviderCustomSelect` 补 `role="combobox"` 语义与裁切祖先内翻转/限高；三页生成方式在客户端显示生效的「非流式」并说明服务器偏好保留。AIP-5 实机验收继续 `PENDING`。
