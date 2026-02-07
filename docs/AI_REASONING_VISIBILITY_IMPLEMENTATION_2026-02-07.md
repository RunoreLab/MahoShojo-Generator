# AI 思考内容展示功能落地记录（Phase 1）

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

---

## 2. 异常样例处理策略（Gemini thought 泄漏）

针对 `docs/temp/魔法少女速报_战斗战报.md` 这类“思考内容混入正文”的异常：

- 优先使用结构化 reasoning 事件（SDK 主通道）
- 当结构化 reasoning 缺失时，前端对正文前缀做**低置信提取**并在 panel 展示来源为“正文提取(低置信)”
- 本阶段默认不强制改写正文结构，避免误切正文（仅展示补充）

---

## 3. 当前限制与后续建议

1. 当前主打通路径为“竞技场 SSE 战报”。
2. PVP 已预留 `aiReasoning` 透传位，但其上游仍是纯文本流，尚未完整升级到 reasoning 事件通道。
3. 其他 stream 页面（free/details/canshou/sublimation/scenario/tavern/magic-tea-party）尚未统一接入，建议按设计文档 Phase 2 批量推进。

---

## 4. 验收建议（手工）

1. 竞技场开启流式生成，观察战报卡片：
   - 生成中显示“AI 正在思考…”或摘要
   - 点击后可查看详细思考内容
2. 检查 metadata 区域与正文渲染无回归。
3. 导出图片时确认 reasoning panel 默认不出现在截图内。

