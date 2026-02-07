# AI 思考内容展示功能落地记录（Phase 1 + Phase 2 + Phase 3）

更新时间：2026-02-07  
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

## 4. 验收建议（手工）

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
