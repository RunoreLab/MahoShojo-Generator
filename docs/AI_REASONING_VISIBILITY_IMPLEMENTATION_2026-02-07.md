# AI 思考内容展示功能落地记录（Phase 1 + Phase 2 + Phase 3）

更新时间：2026-02-07（复查修订 + 非流式方案补充）  
对应设计：`docs/AI_REASONING_VISIBILITY_DESIGN_2026-02-06.md`

---

## 1. 本次已落地范围

### 1.1 新增统一模型与规范化工具

- 新增类型：`types/ai-reasoning.ts`
  - `AIReasoningStatus`：`idle | thinking | done | unavailable | error`
  - `AIReasoningSource`：`sdk | provider | heuristic | unknown`
  - `AIReasoningEnvelope`：统一承载摘要、正文、tokens、异常标记等
- 新增工具：`lib/ai/reasoning-normalizer.ts`
  - `buildReasoningSummary`：生成摘要
  - `appendReasoningDelta`：拼接增量
  - `updateReasoningStatus`：更新状态
  - `extractHeuristicReasoningFromMarkdown`：正文泄漏兜底提取（低置信）

### 1.2 新增 UI 组件

- 新增组件：`components/ai/AiReasoningPanel.tsx`
  - 折叠态：显示“AI 思考摘要 / 正在思考…”
  - 展开态：显示完整思考文本、来源、tokens、文本长度、异常标记
  - 支持复制思考内容

### 1.3 战报卡片接入（流式 + 非流式）

- 流式卡片：`components/stream/StreamingBattleReportCard.tsx`
  - 新增 `aiReasoning` 入参
  - 若无结构化 reasoning，则尝试正文泄漏低置信提取并展示
  - 截图时默认隐藏 reasoning panel（避免污染导出）
- 非流式卡片：`components/BattleReportCard.tsx`
  - `NewsReport` 新增 `aiReasoning?: AIReasoningEnvelope | null`
  - 同样接入 reasoning panel 与截图隐藏逻辑

### 1.4 竞技场流式链路接入

- 状态层：
  - `components/arena/types/index.ts` 新增 `streamReasoning`
  - `components/arena/stores/useBattleStore.ts` 新增 `setStreamReasoning`
- 业务层：
  - `components/arena/hooks/useBattleEngine.ts` 新增 `reasoning` / `reasoning_done` SSE 事件处理
  - 处理 `telemetry` 时会回填 `reasoningTokens` 到 reasoning 状态
- 展示层：
  - `components/arena/components/BattleResult.tsx` 透传 `streamReasoning` 到流式战报卡片

### 1.5 后端流式事件输出

- `lib/stream/raw-ai.ts`
  - 改为基于 `result.fullStream` 消费，保留空输出预检语义
  - 新增 `onReasoningEvent` 回调，透出 `reasoning-start/delta/end`
- `pages/api/arena/generate-stream.ts`
  - SSE 模式新增输出：
    - `event: reasoning`
    - `event: reasoning_done`
  - 保留既有 `markdown / telemetry / meta / done` 事件体系

### 1.6 PVP 结算链路（第二步补齐）

- `pages/api/pvp/rooms/[roomId]/rounds/[roundId]/resolve-stream.ts`
  - 上游改为请求 `/api/arena/generate-stream?format=sse`
  - 服务端解析上游 SSE 的 `markdown/reasoning/telemetry/meta/done/error` 事件
  - 对客户端继续输出纯 Markdown 流（保持现有 PVP 前端兼容）
  - 在回合 `resultJson.streamMeta` 中落库 `aiReasoning`（含 `status/source/summary/text/reasoningTokens`）
- `components/pvp/PvpRoomPage.tsx`
  - 已透传 `streamMeta.aiReasoning` 到 `StreamingBattleReportCard`
  - 现已支持 SSE 实时消费：生成过程中即可更新 reasoning 摘要与详情

### 1.7 Phase 2：通用生成页批量接入（本次新增）

- 新增客户端统一读取器：`lib/stream/read-text-and-reasoning-stream.ts`
  - 自动兼容 `text/plain` 与 `text/event-stream`
  - 支持回调：`onText / onReasoning / onTelemetry / onMeta`
  - 普通文本流会尝试启发式提取 thought 泄漏（低置信）
- 新增服务端 SSE 桥接：`lib/stream/reasoning-sse.ts`
  - `shouldUseClientSse`：按 `?format=sse` 或 `Accept: text/event-stream` 判定
  - `createReasoningSseBridge`：把文本流 + SDK reasoning 回调统一桥接为 `markdown/reasoning/reasoning_done/telemetry/done/error`
- 已接入页面与 API：
  - 页面：`pages/free.tsx`、`pages/details.tsx`、`pages/canshou.tsx`、`pages/sublimation.tsx`、`pages/scenario.tsx`、`components/tavern/TavernImportPanel.tsx`
  - API：`pages/api/generate-free-stream.ts`、`pages/api/generate-magical-girl-details-stream.ts`、`pages/api/generate-canshou-stream.ts`、`pages/api/generate-sublimation-stream.ts`、`pages/api/generate-scenario-stream.ts`、`pages/api/tavern/convert-stream.ts`
  - 前端请求改为 `?format=sse + Accept: text/event-stream`，生成过程中可实时展示思考摘要与详情
- 测试补充：
  - `tests/read-text-and-reasoning-stream.test.ts`
  - `tests/reasoning-sse.test.ts`

### 1.8 Phase 3：magic-tea-party 全链路接入（本次新增）

- 前端流式读取统一到 reasoning SSE：
  - `lib/magic-tea-party/useMagicTeaPartyChat.ts`
  - `runGenerateStream` / `requestChoicesFallback` / `generateChoices` 均改为请求 `?format=sse`
  - 统一使用 `readTextAndReasoningStreamFromResponse` 解析 `markdown/reasoning/reasoning_done/telemetry`
  - 通过 `mergeAssistantAiMeta` 将 `aiReasoning / aiUsage / aiModel` 实时回写到 assistant 消息 `meta`
- 后端 API 输出统一桥接：
  - `pages/api/magic-tea-party/generate-stream.ts`
  - `pages/api/magic-tea-party/generate-choices.ts`
  - 新增 `shouldUseClientSse + createReasoningSseBridge`
  - 把上游文本流与 SDK reasoning 回调桥接为标准 SSE 事件，并在结束时回传 usage + aiModel telemetry
- 聊天消息 UI 接入思考面板：
  - `components/magic-tea-party/ChatMessage.tsx`
  - assistant 泡泡（raw / segments / markdown / plain）统一渲染 `AiReasoningPanel`
  - 生成中但尚无思考正文时显示“AI 正在思考…”，有摘要后优先展示摘要

---

## 2. 异常样例处理策略（Gemini thought 泄漏）

针对 `docs/temp/魔法少女速报_战斗战报.md` 这类“思考内容混入正文”的异常：

- 优先使用结构化 reasoning 事件（SDK 主通道）
- 当结构化 reasoning 缺失时，前端对正文前缀做**低置信提取**并在 panel 展示来源为“正文提取(低置信)”
- 本阶段默认不强制改写正文结构，避免误切正文（仅展示补充）

---

## 3. 当前限制与后续建议

1. 竞技场/PVP/通用生成页 + `magic-tea-party` 已完成统一接入。
2. 当前 `magic-tea-party` 聊天 UI 仅展示 reasoning 面板；`aiUsage/aiModel` 尚未在消息卡片显式展示，可作为后续增强。
3. telemetry 仍以“通用 usage”字段为主，不同供应商的细粒度 token 指标可能缺失或口径不一致。

---

## 4. 复查结果与已修复项（2026-02-07）

本轮针对 `4bf3de3` 起 6 个提交做了全链路代码复查，重点覆盖：竞技场流式、PVP 流式桥接、通用页面流式桥接、`magic-tea-party` 流式接入、前端面板渲染与状态机收敛。

### 4.1 已修复：`reasoning_done` 状态被前端固定写成 `done`

- 位置：`components/arena/hooks/useBattleEngine.ts`
- 现象：
  - 原逻辑在处理 `event: reasoning_done` 时，无论上游给出 `done/unavailable`，都会写死为 `done`。
  - 这会让“无可展示思考正文”的场景在状态语义上被误报为已完成推理。
- 修复：
  - 现已按上游 payload 的 `status` 还原为 `done | unavailable | error`。
  - 同时支持透传 `summary / errorMessage`，并做安全词过滤后再写入状态。

### 4.2 已修复：竞技场 SSE 在 `reasoning-end` 时固定下发 `done`

- 位置：`pages/api/arena/generate-stream.ts`
- 现象：
  - 原逻辑在收到 `reasoning-end` 时固定下发 `reasoning_done: done`。
  - 若该轮只有 `reasoning-start/end` 且没有任何 `reasoning-delta`，会产生“空正文但 done”语义偏差。
- 修复：
  - 现已基于是否收到有效 reasoning delta 决定状态：
    - 有增量文本 → `done`
    - 无增量文本 → `unavailable`

### 4.3 已修复：SSE 结束兜底状态与正文存在性对齐

- 位置：`components/arena/hooks/useBattleEngine.ts`
- 现象：
  - 原逻辑在收到 `event: done` 且本地状态仍为 `thinking` 时，会直接收敛为 `done`。
- 修复：
  - 现已按本地 reasoning 文本是否非空，兜底收敛为 `done/unavailable`，避免“空文本 done”。

### 4.4 已修复：PVP SSE 协商大小写兼容

- 位置：`pages/api/pvp/rooms/[roomId]/rounds/[roundId]/resolve-stream.ts`
- 现象：
  - `Accept` 头判断未统一小写，极端情况下可能漏判 `Text/Event-Stream` 之类大小写组合。
- 修复：
  - 统一按小写进行 `text/event-stream` 协商判断，减少环境差异导致的降级风险。

---

## 5. 验收建议（手工）

1. 竞技场开启流式生成，观察战报卡片：
   - 生成中显示“AI 正在思考…”或摘要
   - 点击后可查看详细思考内容
2. 在 free/details/canshou/sublimation/scenario/tavern 的流式模式下，验证思考面板可实时更新。
3. 在 `magic-tea-party` 中验证：
   - 普通回复与“生成选项”都能实时显示思考摘要/正文
   - 展开面板可查看完整思考文本，流结束后状态从 `thinking` 变为 `done/unavailable`
4. 检查 metadata 区域与正文渲染无回归。
5. 导出图片时确认 reasoning panel 默认不出现在截图内。
6. 回归命令：
   - `bun run lint`
   - `bun test`
   - `bun run build`

---

## 6. 待决策方案：非流式仅展示“思考内容”，不展示“思考状态”

### 6.1 诉求与目标

基于最新反馈，非流式（non-stream）是“一次性返回最终结果”的交互，不需要像流式那样展示 `thinking / done / unavailable / error` 过程状态。  
因此目标调整为：

1. **非流式只在“有可展示思考文本/摘要”时展示面板**。  
2. **非流式不展示状态文案**（如“正在思考…”、“未返回思考内容”）。  
3. **无思考内容时不占位，不渲染该组件**，避免视觉噪声。  

### 6.2 适用范围（待定）

- 竞技场非流式战报卡：`components/BattleReportCard.tsx`
- 以及各非流式生成页结果区（free/details/canshou/sublimation/scenario/tavern 等）在采用非流式 API 时的结果卡片

> 说明：流式链路保持现状（仍需状态展示），本方案仅针对 non-stream。

### 6.3 UI 方案（建议）

非流式模式下新增 `content-only` 展示分支（命名可调整）：

- 标题固定为：`AI 思考内容`
- 仅展示：
  - 摘要（若有）
  - 正文（若有）
  - 来源 / tokens（可保留为二级信息）
- 不展示：
  - `thinking / unavailable / error` 状态文案
  - “暂无可展示思考内容”占位提示

可选实现方式：

- 在 `AiReasoningPanel` 增加 `displayMode?: 'stream' | 'content-only'`；
- 或拆分一个轻量组件 `AiReasoningContentPanel`，专供 non-stream 使用。

### 6.4 数据来源方案对比（后端）

#### 方案 A（推荐）：主通道按“有则展示、无则静默”

- 在 non-stream API 中尝试读取 SDK 的 reasoning 字段（若模型/SDK 返回）；
- 有 `text/summary` 才回传 `aiReasoning`；
- 没有则不回传该字段，前端不显示面板。

**优点**：实现成本低、延迟/费用几乎不变、语义清晰。  
**缺点**：不同供应商可见性不一致，很多请求可能无思考内容可展示。

#### 方案 B（不建议默认）：额外补一轮“思考总结生成”

- non-stream 正文完成后，再发起一次附加调用生成“可展示推理”。

**优点**：展示率高。  
**缺点**：额外耗时和成本、语义并非原始推理、一致性风险高。

#### 方案 C（增强可选）：Provider 原始字段适配兜底

- 增加 provider 适配器，解析如 `reasoning_content` 等供应商字段。

**优点**：在特定模型可提升命中率。  
**缺点**：维护成本高，接口耦合重，需要逐供应商回归。

### 6.5 推荐决策

建议采用 **A 主方案 + C 渐进增强**：

1. 先落地“non-stream content-only UI + 有则展示、无则静默”；
2. 保持零额外调用；
3. 后续按供应商收益再决定是否引入 C。

### 6.6 实施清单（拍板后）

1. 前端：
   - `AiReasoningPanel` 增加 `content-only` 渲染模式（或新增轻量面板组件）
   - non-stream 结果卡切到 `content-only` 模式
2. 后端：
   - non-stream API（如 `pages/api/arena/generate.ts` 与各 `generate-*.ts`）补充 `aiReasoning` 回传通道（仅在有内容时）
3. 类型与契约：
   - 明确 non-stream 的 `aiReasoning` 为可选字段（无内容可省略）
4. 测试：
   - “有 reasoning 内容时显示”
   - “无 reasoning 内容时不显示”
   - “non-stream 不展示状态文案”

### 6.7 验收标准（拍板后）

1. non-stream 正常生成且无 reasoning 内容：页面不出现 reasoning 组件。  
2. non-stream 存在 reasoning 内容：页面出现“AI 思考内容”面板，仅展示内容本身。  
3. non-stream 页面不再出现“正在思考/未返回思考内容”等状态型文案。  
4. 流式页面行为不受影响。  
