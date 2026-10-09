# ADR：Desktop AI Provider 选择器与多模型连接体验统一

> 2026-10-09 部分条款已被[预设独立身份与服务器 BYOK 修订](./2026-10-09_010600_DesktopAI预设独立身份与服务器BYOK修订.md)精确取代：预设不再必须保存为 Profile，服务器 BYOK 进入本轮，新输入模型 ID 统一 200。本文及实施记录保留历史含义，其余安全和兼容要求继续有效。

- 日期：2026-10-08
- 状态：`accepted`（维护者已确认产品方案；AIP-1..4 + D5.1-AIP-r1 审查收口已实施，AIP-5 自动与实机验收保持 `PENDING`）
- 决策标识：`ADR-desktop-ai-provider-parity`
- 范围：`RunoreLab/MahoShojo-Generator`，`feat/desktop`；Web 侧只进行不改变业务的共源 UI 改进
- 关联：[2026-10-04 Desktop 线上本地整合 ADR](https://github.com/RunoreLab/MahoShojo-Generator/blob/feat/desktop/docs/decisions/2026-10-04_202000_Desktop线上本地整合与AI配置共源决策.md)、`DESK-ONLINE-001..005`、`DESK-PARITY-001`、`DESK-SET-003`

## 背景

目前 `AiProviderSelectorView`、`useAiProviderSelection` 已共源，Web 由薄封装消费，Desktop 的四类生成页仍主要使用独立的执行位置、Profile 下拉选择和高级参数装配，导致“Web 先选供应商/模型/Key”与“Desktop 先去设置创建 Profile”的交互分叉。Desktop 的独立 Profile 和操作系统凭据机制是正确的执行安全架构，不应因视觉统一而废弃。

原 `DESK-ONLINE-002` 将 Desktop 内置预设限制为“只能复制成自定义连接后再使用”。这一额外步骤不符合用户当前确认的产品方向，现决策只修订此项**用户操作流程**，不变更预设不可原位修改、Direct 核验和 SecretStore 等约束。

## 已决定

1. **统一选择器**：Web 与 Desktop 使用同一个可受控的 Provider 选择器表单和原子控件。Desktop 为增强宿主，增加执行位置、已保存连接分组、直接配置/保存、连接编辑与多个模型；Web 保持当前的供应商范围、BYOK 请求行为、持久化与 wire 不变。
2. **首次即选即配，保存后使用**：Desktop 无连接时可在生成页选择经核验能 Direct 的项目预设、选模型、录入 Key（允许无 Key 的合法本机服务），点击「保存并使用」。此操作经既有 Native Profile/SecretStore 创建用户自有连接后将它设为当前客户端执行目标；**不自动发起生成**。
3. **一个连接多个模型**：Profile V1 的 `modelId` 继续作为连接默认模型；当前模型和用户添加的模型 ID 是 Profile ID 范围内的非秘密选择偏好。生成请求使用明确选择的模型 ID；同一个连接下不同模型的高级参数独立保存。切换模型不自动覆盖 Profile 默认模型。
4. **服务器 BYOK 延后**：这一轮 Desktop 的服务器模式只开放 System Default。绝不通过向 renderer 放宽 `customProvider`、Key、任意 URL 或 secretRef 来模拟服务器 BYOK。此能力独立实施、独立验收。
5. **保留现有安全架构**：Direct 仅由 Rust 通过已保存 Profile 与 SecretStore 执行；预设目录只提供受限、已核验的 Direct 候选与填表模板；未知协议或项目转发端点不因出现在 Web 选择器里而获得直连权限；本轮不增加通用出站代理。

## Desktop 专属控件也必须共源视觉与布局

- **同一组件而非仅模仿 CSS**：当前 Web `GenerationModeSwitcher` 使用 `@mahoshojo/ui-web/details-controls/SegmentedControl`（圆角分段、两端等宽、粉色激活态、图标、说明、焦点和响应式布局）；Desktop 的 `AiExecutionLocationField` 目前采用较小的独立 `inline-flex` 按钮。实施时 **MUST** 收敛到同一 `SegmentedControl` 视觉/交互基础，必要时只为共源基础控件增加可选项禁用和原因能力；Web 现有行为不退化。
- **布局位置跟随对应 Web 页面**：Desktop `客户端｜服务器` 控件 **MUST** 与 `流式｜非流式` 控件在对应 Web 页面原有的「生成方式／生成设置」区域相邻、使用同类分组卡片和间距，而不是以不同字体、尺寸、单独靠顶的“小开关”占据另一套配置结构。页面之间允许继承各自 Web 既有字段顺序，不强迫四类页面使用同一个全局顺序。
- **宿主增强不等于另造风格**：Desktop 的「我的连接」、新建/编辑、Key 状态、Endpoint 提示、连接测试和错误反馈，优先复用 Web 同类表单、按钮、弹层、图标、文案层级、空态与键盘操作；只在必须表达 OS SecretStore、Direct/Hosted、Native 安全校验时增加宿主差异。
- **不改变业务语义**：执行位置与生成方式仍是两个正交配置。客户端 Direct 不能使用的流式生成须明确禁用/说明；Web 不出现无效的客户端执行开关。共享外观不得绕过现有服务器签名、Strict/多人资格或 Native 协议约束。
- 设计与验证以[可测试规格 DESK-AIP-009](../specs/2026-10-08_173400_DesktopAIProvider共源选择器、快速配置与多模型连接.md#desk-aip-009-web-共源页面一致性与可访问性)为准；在相同窗口宽度、缩放和主题下比对双端组件，而不是把不同截取范围的截图作为唯一依据。

## 对既有设计的准确覆盖范围

- 精确替代旧 ADR §4 与 `DESK-ONLINE-002` 中“Desktop 必须先复制预设才能开始填写/使用”的交互要求；允许在原有选择器内一次完成预设选取、Profile 创建与激活。
- **继续有效**：项目预设不可原位改写名称、Endpoint、Adapter；用户创建的 Profile 与预设不同身份、不以 Endpoint 自动认领；“server” 与“clientConnectionId”正交、无可用连接时不自动切服务器；Native 出站证据/权限/秘密和 Web 的现行功能边界；历史验收记录不倒填。
- `DESK-ONLINE-003/005` 的 Web 范围及服务器 BYOK **目标**继续有效，但 Desktop Server BYOK 本轮仍是 deferred，不得标为交付。
- 追加 `DESK-AIP-001..013` 实施规格，作为原 `DESK-ONLINE`、`DESK-PARITY` 的细化，发生矛盾时先修订旧文档再开始实现。

## 理由与取舍

- 从用户角度，把“预设供应商”和“我的连接”合并成同一选择体验，仍可在底层保留 Registry、Profile、Model Selection、SecretStore 四个 owner。
- 选择「保存并使用」而非“内存临时 Key 直接生成”，优先复用已有 staged secretRef、校验、回滚和 Profile-ID-only 的执行通路，避免新增临时秘密的 Native 协议。
- 选择模型偏好保存在 Desktop overlay 而不是将 `DirectProviderProfileV1` 扩展为复杂多模型文档，是因为现有 Direct request 已支持逐次 `modelId` 覆盖，可减少跨 Rust/TypeScript 契约改动。
- Web 的存储机制和 BYOK 业务暂不调整，防止 UI 共源时导致线上存量用户配置或调用行为回归。

## 不做的事

- 不新增 Desktop Server BYOK、不增加原生适配器、不承诺 Direct 模型自动发现、多 Key 轮询、自动模型测试或无保存的临时连接。
- 不把 Web 的 localStorage API Key 状态逻辑照搬到 Desktop。
- 不因页面统一让客户端 Direct 拥有服务器的签名、Strict 或多人权威资格。
- 不一次性重做所有 Desktop 页面；先收敛四类生成入口和 AI 设置，再沿既有 D5.1 双端对齐计划推进其他页面。

## 配置保存的持久化原子边界

「保存并使用」是一个有明确阶段结果的**用户操作**，而不是跨 SQLite、OS SecretStore 与 overlay 的伪原子事务。Profile/凭据先落盘，再尝试以单次受检 overlay 更新激活 `profileId + modelId + client`；更新失败时显示「已保存但未启用」，保留同一个候选 Profile ID 用于重新激活，不自动新建另一条连接。后续实现前仍须通过 Native 在途凭据轮换/删除竞态门禁。

## 交付与撤回

实施时按共源组件、Desktop 控制器、状态迁移、页面接线和验收分原子提交；唯一阶段计划登记 AIP 切片，不创建平行计划。若 UI 切换不可接受，允许回滚到原 Profile 选择器；用户 Profile/Secret 不可因 UI 回滚而丢失。新增 overlay v3 的旧版兼容需明示：旧客户端不得误读新版配置，也不得静默用其他 Provider 替代。

## 修订与实施状态记录

### 2026-10-09（D5.1-AIP-r1 审查收口）

不改变本 ADR 的冻结决策；以下为对决策 4/5 在实施层面的精确化说明与状态更新：

- **hosted 系统通道精确化**：维护者确认服务器模式项与 Web 一致命名为「使用系统默认配置」，并可显式选择系统目录内模型（如 GLM 5.3 Flash）或跟随「默认策略」。为此 hosted IPC 新增**受检非秘密** `systemConfig`（`providerId` 固定 `'system'`、目录内 `modelId`、`generationOverrides`），由 native 翻译为服务器侧既有 `customProvider:{providerId:'system',...}` 语义。renderer 仍 **MUST NOT** 传任意 `customProvider`/Key/`secretRef`/Endpoint；`systemConfig` 对未知字段与凭据类字段 fail-closed。这是「系统默认通道」自身的非秘密偏好，不构成 Desktop Server BYOK（继续 deferred，决策 4 不变）。
- **overlay v4**：新增 `selection.systemModelId` 非秘密偏好（与 `executionPreference`/`clientConnectionId` 正交）；v2→v3→v4 受检迁移，悬空系统模型保留诊断项不静默回落——与每连接多模型的既有语义一致。
- **选择器取值空间**：Provider 下拉统一承载「使用系统默认配置」+ 内置可直连预设 + 我的连接；`system` 与 `preset:*` 为宿主保留值，连接 ID 恒为 `conn_*` 且 store 拒绝 `system` 草稿 ID，与真实 Profile 取值空间不冲突（DESK-ONLINE-002/004）。
- **生成方式显示语义**：客户端 Direct 固定结构化通路时，三页（scenario/free/creator）显示生效的「非流式」并说明服务器流式偏好未被清除，不再让禁用的「流式」按钮看似仍在生效。
- **状态**：r1 切片 A（Store 事务收口）、B（hosted systemConfig 契约）、C（面板共源闭合）已提交；AIP-5 实机/真端点验收继续 `PENDING`，不得以自动回归等价代替。