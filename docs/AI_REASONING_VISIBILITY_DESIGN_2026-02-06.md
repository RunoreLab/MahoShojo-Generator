# AI 思考内容可视化设计方案（2026-02-06）

## 1. 背景与目标

你提出的目标很明确：把 AI 的“思考/推理内容”从正文中拆分，放入独立容器展示，让用户理解生成过程并减少正文污染。

结合当前仓库，核心问题有三类：

1. **可见性缺失**：多数链路只展示正文与 token 统计，不展示可解释的思考信息。  
2. **偶发泄漏**：个别模型会把思考内容直接输出到正文开头（你给出的 `docs/temp/魔法少女速报_战斗战报.md` 就是典型样例）。  
3. **统计异常**：部分供应商/模型在“思考是否计入 output / 是否单列 reasoning tokens”上口径不一致，导致前端展示与直觉不符。

本方案目标：

- 统一采集与展示思考信息（流式 + 非流式）
- 正文与思考严格分区（避免污染战报/角色卡正文）
- 明确“可信来源 vs 猜测来源”，避免误导
- 支持供应商差异与异常降级

---

## 2. 项目现状调研（仓库内）

### 2.1 竞技场战报链路（已有基础，但未做“思考展示”）

- `pages/api/arena/generate-stream.ts`  
  - 已在流末追加 `MAHOSHOJO_TELEMETRY_META` 注释（包含 `usage`、`aiModel`、`narrativeHistoryReadCount`）。  
  - 当前仅用于 token/模型等元数据，不含“思考正文”。
- `components/arena/hooks/useBattleEngine.ts`  
  - 会在前端结束后剥离 telemetry/meta 注释，避免系统注释泄漏到正文。
- `components/stream/StreamingBattleReportCard.tsx`、`components/BattleReportCard.tsx`  
  - 已展示 `输入/推理/输出 tokens`，但没有“思考内容容器”。

### 2.2 使用统计归一化已有兼容，但只到 tokens 级别

- `lib/arena/battle-report-log-utils.ts` 的 `normalizeUsage()` 已兼容多种命名：
  - `reasoningTokens / reasoning_tokens`
  - `output_tokens_details.reasoning_tokens`
  - `completion_tokens_details.reasoning_tokens`
- 说明：**当前只做数值归一化，不做 reasoning 文本归一化**。

### 2.3 流式通用链路存在“正文直通”风险

- `lib/stream/raw-ai.ts` 目前基于 `streamText(...).textStream` 透传文本。  
- `lib/stream/read-text-stream.ts` 与多个页面（`free.tsx`、`details.tsx`、`canshou.tsx`、`sublimation.tsx`、`scenario.tsx`、`TavernImportPanel.tsx`）是“纯文本累加”，默认把所有 chunk 当正文。  
- 一旦上游把 thought/reasoning 混入文本，前端会直接渲染出来。

### 2.4 你给出的异常样例（仓库内证据）

- 文件：`docs/temp/魔法少女速报_战斗战报.md`  
- 现象：正文开头出现大量英语“thought”草稿内容，随后才进入正式战报。  
- 这说明“思考内容”偶发被混入了主输出通道，当前链路缺少专门拦截与分离。

---

## 3. 外部技术调研结论（截至 2026-02-06）

> 重点：这里不只看“能不能拿到推理 tokens”，而是看“能不能拿到可展示的思考内容”。

### 3.1 AI SDK（你项目当前依赖：`ai@5.x`）已经提供 reasoning 能力

- `generateText` 返回中支持 `reasoningText` / `reasoning`（模型支持时可用）。  
- `streamText` 在 chunk 层面支持 `reasoning` 类型（不是只有文本）。  
- usage 结构支持 `outputTokenDetails.reasoningTokens` 与 `raw` provider usage。

**含义**：当前项目并非“SDK 不支持”，而是“我们的封装层还没把 reasoning 通道接出来”。

### 3.2 Google（Gemini）在 AI SDK 层支持 thinking 配置与 thoughts 统计

- `providerOptions.google.thinkingConfig` 支持：
  - `thinkingLevel`
  - `thinkingBudget`
  - `includeThoughts`
- provider metadata 可提供：
  - `usageMetadata.thoughtsTokenCount`
  - `promptTokenCount/candidatesTokenCount/totalTokenCount`

**含义**：Gemini 可在能力上区分“正文 token”和“思考 token”，但是否稳定返回、返回口径是否一致，仍取决于模型版本与上游通道。

### 3.3 OpenAI（通过 AI SDK OpenAI Provider）更推荐“reasoning summary”而非原始思考

- AI SDK OpenAI provider 支持 `reasoningSummary`，并可在 `streamText.fullStream` 中收到 reasoning 部分。  
- 官方路线偏向“摘要化 reasoning 可见”，不是暴露完整内部链路。

**含义**：产品上应支持“摘要优先”的展示策略，不要假设任何模型都会稳定返回可公开的原始思考文本。

### 3.4 DeepSeek（reasoner）会明确返回 `reasoning_content`

- 官方文档显示 `deepseek-reasoner` 返回：
  - `message.reasoning_content`（思考）
  - `message.content`（最终回答）
  - usage 中可含 `completion_tokens_details.reasoning_tokens`

**含义**：对于 DeepSeek/OpenAI-compatible 路径，确实存在“显式思考文本”可采集场景。

### 3.5 OpenRouter 明确指出：不同模型对 reasoning 可见性不一致

- OpenRouter 文档说明 reasoning tokens 可能出现在 `message.reasoning`。  
- 同时也说明某些模型（如 OpenAI o 系列）并不返回原始 reasoning token 文本。

**含义**：必须做**多源归一化 + 能力降级**，不能单一假设。

---

## 4. 对你提到异常的判断（结论）

你提到的异常统计：

- 模型：`gemini-3-flash-preview`
- tokens：输入 `16,127`｜推理 `-`｜输出 `3,265`
- 同时正文出现 thought

我的判断（按概率排序）：

1. **最可能：上游把 thought 当普通文本输出，或 SDK 链路未将其识别为 reasoning part**  
   - 导致 thought 进入正文，`reasoningTokens` 不可见或为 null。  
2. **次可能：供应商 usage 元数据在该次请求缺失 thoughts 字段**  
   - 现实中确有“偶发 metadata 不完整”反馈。  
3. **较低概率：前端/服务端二次拼接异常**  
   - 当前代码里没有主动拼接此类英文 thought 草稿，故概率更低。

结论：这不是单点 bug，而是**“思考通道未建模 + 多供应商口径差异”共同导致的可观测性缺口**。

---

## 5. 设计方案（推荐）

## 5.1 方案对比

### 方案 A：只做正文规则清洗（低成本）

- 做法：正则识别开头 `thought` / `<think>` / 规划草稿段，剪切到侧栏。  
- 优点：改动小，上线快。  
- 缺点：误判率与漏判率都高；无法覆盖真正的 SDK reasoning 通道。

### 方案 B：接入 AI SDK reasoning 主通道（推荐主方案）

- 做法：在生成封装层统一采集 `reasoning/reasoningText`，正文与 reasoning 并行传输/存储。  
- 优点：结构化、可测、可扩展、跨模型稳定性更高。  
- 缺点：涉及 API/前端/存储多处改造。

### 方案 C：供应商原始块兜底（增强）

- 做法：启用 raw/provider metadata 兜底解析（仅在主通道缺失时）。  
- 优点：提升异常场景覆盖率。  
- 缺点：供应商耦合高，维护成本较高。

**建议**：`B 为主 + C 为辅 + A 兜底`。

---

## 5.2 统一数据模型（新增）

建议引入统一结构 `AIReasoningEnvelope`（命名可调整）：

```ts
type AIReasoningEnvelope = {
  available: boolean;                 // 是否有可展示思考
  source: 'sdk' | 'provider_raw' | 'heuristic';
  mode: 'summary' | 'full' | 'redacted' | 'unknown';
  text?: string;                      // 汇总文本（可选）
  parts?: Array<{
    type: 'text' | 'redacted';
    text?: string;
    data?: string;
    signature?: string;               // Gemini 等可能返回
  }>;
  stats?: {
    reasoningTokens?: number | null;
    providerThoughtsTokenCount?: number | null;
    completionTokens?: number | null;
    promptTokens?: number | null;
  };
  anomalyFlags?: Array<'tokens_missing' | 'text_injected' | 'provider_inconsistent'>;
};
```

---

## 5.3 后端改造点

### A) 封装层：`lib/ai.ts`（非流式）

- 在 `generateWithAI` 成功返回时，除 `usage` 外同步捕获：
  - `reasoningText`
  - `reasoning`（结构化数组）
  - `providerMetadata`（若有）
- 写入 telemetry（当前 telemetry 结构可扩展）。

### B) 封装层：`lib/stream/raw-ai.ts`（流式，关键）

- 当前仅用 `textStream`；建议改为消费 `fullStream`（或等价 chunk 流）：
  - `text-delta` -> 正文通道
  - `reasoning` -> reasoning 通道（累积/事件化）
- 对外返回：
  - 现有文本响应保持兼容
  - 新增 `reasoningPromise` 或 `reasoningCollector`

### C) 战报流：`pages/api/arena/generate-stream.ts`

- SSE 模式：新增 `event: reasoning`（增量）与 `event: reasoning_done`（结束态）。  
- text/plain 模式：可继续在尾部追加注释元数据，但建议把 reasoning 放独立 marker（如 `MAHOSHOJO_REASONING_META`）或合并进 telemetry，避免正文混淆。

### D) 其他 stream API（第二阶段）

- `generate-free-stream.ts` / `generate-*-stream.ts` / `tavern/convert-stream.ts` / `magic-tea-party/*stream*`  
- 统一复用一个“流式包装器”，避免每条 API 重写一次 reasoning 解析。

---

## 5.4 前端改造点

### 新组件：`components/ai/AiReasoningPanel.tsx`

- 默认折叠（`显示 AI 思考过程`）  
- 显示来源标签：`SDK` / `Provider` / `正文提取(低置信)`  
- 显示统计：推理 tokens、思考文本长度、是否异常  
- 支持复制文本；导出图片时默认不包含（防止卡片污染）

### 5.4.1 交互形态（参考官方网页端风格）

建议采用“**摘要条 + 可展开详情**”两层结构：

1. **折叠态（默认）**
   - 展示一行状态条：`🧠 AI 思考中` / `🧠 AI 思考摘要：xxx`
   - 若有摘要：显示 1 行截断摘要（40~80 字）
   - 若无摘要：显示 `正在思考…`（并带轻量 loading 动效）
2. **展开态（点击）**
   - 展示完整思考内容（或分段内容）
   - 展示来源标记：`SDK` / `Provider` / `正文提取(低置信)`
   - 展示统计信息：推理 tokens、文本长度、异常标记
3. **流式过程**
   - 生成中优先更新“摘要条”（低频刷新，避免抖动）
   - 展开后才实时渲染详细思考内容（控制渲染成本）

### 5.4.2 组件 API 建议（便于全项目统一接入）

```ts
type AiReasoningPanelProps = {
  status: 'idle' | 'thinking' | 'done' | 'unavailable' | 'error';
  summary?: string | null;                   // 无摘要时显示“正在思考…”
  reasoning?: AIReasoningEnvelope | null;    // 统一数据结构（见 5.2）
  compact?: boolean;                         // 卡片内紧凑模式
  defaultExpanded?: boolean;                 // 默认是否展开
  onToggle?: (expanded: boolean) => void;
};
```

设计原则：**业务组件只传统一结构，不直接处理供应商差异**。

### 5.4.3 UI / UX 细则

- **位置**：放在“模型与 tokens 信息”下方，正文上方或下方（建议下方，避免打断阅读）。  
- **层级**：视觉弱于正文标题、强于辅助统计；避免喧宾夺主。  
- **文案**：  
  - thinking 且无摘要：`AI 正在思考…`  
  - 有摘要：`AI 思考摘要：{summary}`  
  - 无可用思考：`该模型未返回可展示思考内容`  
- **可访问性**：展开按钮可键盘操作；`aria-expanded` 与状态文本同步。  
- **导出策略**：截图/分享默认不带思考详情（可配开关），避免“战报正文污染感”。  

### 5.4.4 全项目接入架构（关键）

建议增加一个跨页面可复用的“接入中间层”：

- `lib/ai/reasoning-normalizer.ts`  
  - 负责把 SDK / provider raw / heuristic 统一到 `AIReasoningEnvelope`
- `lib/stream/read-text-and-reasoning-stream.ts`  
  - 统一处理流式 chunk：正文、reasoning、telemetry
- `components/ai/AiReasoningPanel.tsx`  
  - 纯展示组件（不关心数据来源）

这样可避免在每个页面重复写“思考解析 + 展示”逻辑。

### 5.4.5 各 AI 功能接入清单（建议顺序）

**第一批（高优先级）**
- 竞技场：`components/arena/components/BattleResult.tsx` + `StreamingBattleReportCard`
- PVP：`components/pvp/PvpRoomPage.tsx` 战报区域

**第二批（通用生成页）**
- `pages/free.tsx`
- `pages/details.tsx`
- `pages/canshou.tsx`
- `pages/sublimation.tsx`
- `pages/scenario.tsx`
- `components/tavern/TavernImportPanel.tsx`

**第三批（Magic Tea Party）**
- `pages/api/magic-tea-party/*` 对应前端消费点统一接入

统一要求：
- 每个页面都使用同一 `AiReasoningPanel`
- 每个流式页面都走同一 `readTextAndReasoningStream`
- 页面只关心“显示什么”，不关心“如何解析供应商差异”

### 战报组件接入

- `components/stream/StreamingBattleReportCard.tsx`
- `components/BattleReportCard.tsx`

把 reasoning panel 放在“模型 + tokens”信息下方，正文上方或正文下方（建议正文下方，减少阅读打断）。

### 客户端兜底清洗（只在必要时）

- 当未拿到结构化 reasoning，但正文前缀疑似 thought 泄漏时：  
  - 抽离前缀到 panel  
  - 正文保留正式战报部分  
  - 标记 `source=heuristic` + `anomaly=text_injected`

---

## 5.5 存储与观测建议

- `battle_report_generations.extra_json` 增加轻量字段：
  - `reasoningSource`
  - `reasoningChars`
  - `reasoningAvailable`
  - `reasoningAnomalyFlags`
- 完整 reasoning 文本走 R2 sidecar（建议新 kind）：
  - `battle_report_generation_reasoning`
- 增加监控指标：
  - reasoning 可用率（按 provider/model）
  - `reasoningTokens` 缺失率
  - 正文 thought 泄漏率

---

## 6. 分阶段实施计划（建议）

### Phase 1（先解决你最关心的战报问题）

1. 扩展 telemetry 数据模型（后端）  
2. 战报 SSE 增加 reasoning 事件  
3. 新建 `AiReasoningPanel`（折叠摘要 + 展开详情）并接入战报卡片  
4. 加入正文 thought 泄漏兜底抽离  
5. 补测试与灰度开关

### Phase 2（全站统一）

1. 抽出通用 `readTextAndReasoningStream()`  
2. 接入 free/details/canshou/sublimation/scenario/tavern/magic-tea-party  
3. 统一 UI 规范与可用率监控面板

---

## 7. 测试与验收标准

### 单测

- `normalizeUsage` 新增 provider metadata 合并场景  
- reasoning 抽离器（SDK 通道 / heuristic 通道）  
- telemetry/meta 解析不回归

### 集成测试

- 模拟 stream chunk：`text-delta + reasoning + telemetry`  
- 验证正文最终不含 reasoning 污染  
- 验证 panel 内容可见且与 tokens 对齐

### 验收口径

- 竞技场战报中“思考泄漏到正文”的案例显著下降  
- reasoning 可见率可量化（按模型分布）  
- 用户可在不干扰正文阅读的前提下查看思考信息

---

## 8. 风险与规避

1. **供应商策略变化**：某些模型随版本调整 reasoning 可见性  
   - 规避：能力探测 + 降级展示 + anomaly 标记。
2. **合规风险**：原始思考可能含不宜直接展示内容  
   - 规避：默认摘要优先；原始内容显示需开关与截断。
3. **性能风险**：流式解析与存储开销增加  
   - 规避：只采样必要字段，长文本入 R2，D1 只存索引。

---

## 9. 我的建议（最终）

**优先落地“战报链路（含 PVP）”的结构化 reasoning 通道**，先把你指出的真实痛点解决，再扩到全站。  

一句话版本：  
**先建“可观测、可降级、可解释”的 reasoning 基础设施，再做全局 UI 展示统一。**

---

## 10. 参考资料（调研来源）

> 调研时间：2026-02-06（UTC）

1. AI SDK Core `generateText` 参考  
   - https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text
2. AI SDK Core `streamText` 参考  
   - https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
3. AI SDK Google Provider（`thinkingConfig`、`includeThoughts`、`thoughtsTokenCount`）  
   - https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai
4. AI SDK OpenAI Provider（`reasoningSummary`、reasoning 输出）  
   - https://ai-sdk.dev/providers/ai-sdk-providers/openai
5. OpenAI Responses OpenAPI（`output_tokens_details.reasoning_tokens` 示例）  
   - https://api.openai.com/v1/responses
6. DeepSeek Chat Completion（`reasoning_content`、`completion_tokens_details.reasoning_tokens`）  
   - https://api-docs.deepseek.com/api/create-chat-completion
7. DeepSeek Reasoning Model 指南  
   - https://api-docs.deepseek.com/guides/reasoning_model
8. OpenRouter Reasoning Tokens 说明（跨模型差异）  
   - https://openrouter.ai/docs/use-cases/reasoning-tokens
9. Google AI 开发者论坛（Gemini usage 字段偶发不完整案例，作为异常佐证）  
   - https://discuss.ai.google.dev/t/missing-candidates-token-count-in-usage-metadata/102090
