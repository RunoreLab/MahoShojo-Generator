# 非流式 AI 思考内容展示设计方案（2026-02-07）

## 1. 背景

在 `docs/AI_REASONING_VISIBILITY_DESIGN_2026-02-06.md` 与 `docs/AI_REASONING_VISIBILITY_IMPLEMENTATION_2026-02-07.md` 的基础上，流式链路（SSE）已经具备较完整的 AI 思考展示能力。  
当前新需求是：**非流式（non-stream）在“拿得到思考内容”时也展示思考内容**，并且覆盖两类生成路径：

1. 模型原生支持 JSON（`generateObject` 主路径）
2. 模型不支持 JSON，走“提示词输出 JSON + 本地修复”回退路径（`generateText + parseStructuredJsonWithSchema`）

---

## 2. 现状审计（代码与文档）

### 2.1 已有能力（流式）

- 流式已打通 reasoning 事件链：
  - 服务端：`lib/stream/raw-ai.ts`、`lib/stream/reasoning-sse.ts`
  - 客户端：`lib/stream/read-text-and-reasoning-stream.ts`
  - 展示层：`components/ai/AiReasoningPanel.tsx`
- 页面侧流式接入已覆盖：`/arena`、`/pvp`、`/free`、`/details`、`/canshou`、`/scenario`、`/sublimation`、`/tavern`、`/magic-tea-party`

### 2.2 非流式当前缺口

1. **核心封装层未输出 reasoning 元数据**  
   `lib/ai.ts` 的 `generateWithAI()` 当前仅通过 `telemetry` 回填 `usage/finishReason/model`，没有回填 reasoning 文本。

2. **多数非流式 API 不返回 AI 元信息通道**  
   例如：
   - `pages/api/generate-magical-girl-details.ts`
   - `pages/api/generate-canshou.ts`
   - `pages/api/generate-scenario.ts`
   - `pages/api/generate-sublimation.ts`
   - `pages/api/generate-free.ts`
   - `pages/api/tavern/convert.ts`

3. **多数非流式页面未渲染 reasoning 面板**  
   当前 `AiReasoningPanel` 基本只在流式渲染；非流式页面（如 `details/canshou/scenario/sublimation/free/tavern`）尚无统一 non-stream reasoning 状态。

4. **战报非流式有组件入口，但缺后端结构化输入**  
   `components/BattleReportCard.tsx` 已支持 `report.aiReasoning`，但非流式战报 API 目前基本未回填该字段，主要依赖正文启发式提取兜底。

### 2.3 关键可行性结论（基于当前依赖 `ai@5.0.108`）

从本地类型定义可确认：

- `generateObject` 结果包含 `reasoning: string | undefined`
- `generateText` 结果包含 `reasoningText: string | undefined`

这意味着：

1. **原生 JSON 路径可以直接拿 reasoning**（无需二次请求）
2. **文本 JSON 回退路径也可以直接拿 reasoningText**（同样无需二次请求）

> 结论：非流式展示思考内容在技术上是“可直接落地”的，不需要增加额外模型调用。

---

## 3. 设计目标

1. 非流式只在“有思考内容”时展示（无内容则静默）
2. 不增加额外 LLM 调用与 token 成本
3. 不污染数据卡正文结构与签名语义
4. 与流式 UI 风格统一，但 non-stream 不强调过程状态
5. 保持对旧客户端/旧调用方式的兼容

---

## 4. 方案对比

### 方案 A：直接把 `aiReasoning` 塞进原业务 JSON

- 优点：接入简单，前端读取最直接
- 缺点：
  - 结构化数据卡会被“污染”（下载/复制/保存云端都会带上 AI 元字段）
  - 可能影响原生签名校验语义
  - 对外 API 合约不够干净

### 方案 B：通过响应 Header 传 `aiMeta`

- 优点：不污染业务 JSON
- 缺点：
  - Header 大小限制明显，不适合完整 reasoning 文本
  - 长思考文本易被截断，展示体验不稳定

### 方案 C（推荐）：**请求端显式协商，返回 `data + aiMeta` 包装体**

- 建议：客户端带请求头（如 `x-mahoshojo-ai-meta: 1`）
- 服务端在该标记下返回：

```json
{
  "data": {"...": "原有业务数据"},
  "aiMeta": {
    "aiModel": "...",
    "aiUsage": {"...": "..."},
    "aiReasoning": {"...": "..."}
  }
}
```

- 未带标记时保持旧格式（纯业务 JSON）

优点：

- 不污染业务数据主体
- 可传完整 reasoning 文本，不受 Header 限制
- 兼容老客户端（默认行为不变）

---

## 5. 推荐架构设计

## 5.1 后端：在 `generateWithAI()` 统一采集 non-stream reasoning

### 采集点（必须覆盖）

1. `generateObject` 成功分支：读取 `result.reasoning`
2. `generateText` 回退分支：读取 `textResult.reasoningText`
3. `NoObjectGeneratedError` 本地修复成功分支：默认不强提取 reasoning（可选后续 heuristic）

### 统一归一化

建议新增后端工具（命名示例）：

- `lib/ai/reasoning-extractor.ts`
  - 输入：`generateObject/generateText` 结果 + usage
  - 输出：`AIReasoningEnvelope | null`

规则建议：

- 有 `text/summary`：`status = 'done'`
- 仅有 `reasoningTokens` 无文本：`status = 'unavailable'`
- `source = 'sdk'`（后续可扩展 `provider`）
- 文本长度保护（例如 12k~20k 字符截断）并打 `anomalyFlags`

### telemetry 扩展

建议扩展 `GenerateWithAIOptions.telemetry`：

- `reasoning?: AIReasoningEnvelope | null`
- `usage` 继续复用现有 `normalizeUsage()` 逻辑

这样所有 non-stream API 可零重复读取同一份 `telemetry`。

## 5.2 API 返回契约

### 通用数据卡 API（推荐走包装体协商）

- 适用：`generate-free/details/canshou/scenario/sublimation/tavern` 等
- 原因：这些接口返回的数据会被下载、复制、保存到云端，必须避免元数据污染

### 战报 API（可直接写入业务字段）

- 适用：`/api/generate-battle-story`（及兼容端点）
- 可直接补 `report.aiReasoning`
- 同时建议补齐 `sanitizeReportByShieldWords` 对 `aiReasoning` 的净化，避免显示层口径不一致

## 5.3 前端：统一消费 non-stream aiMeta

建议新增客户端工具：

- `lib/client/read-json-with-ai-meta.ts`
  - 自动兼容：
    - 旧格式（纯业务 JSON）
    - 新格式（`{ data, aiMeta }`）

页面侧新增状态（命名示例）：

- `const [nonStreamReasoning, setNonStreamReasoning] = useState<AIReasoningEnvelope | null>(null);`

在 non-stream 请求完成后：

1. 解析业务数据并更新原有结果状态
2. 解析 `aiMeta.aiReasoning` 并写入 `nonStreamReasoning`

## 5.4 UI：非流式用 `content-only` 模式

`AiReasoningPanel` 建议增加：

- `displayMode?: 'stream' | 'content-only'`

non-stream 渲染规则：

1. 无 `text/summary`：不渲染
2. 有 `text/summary`：渲染“AI 思考内容”
3. 不显示 `thinking/unavailable/error` 过程文案
4. 保留复制按钮；来源/tokens 可作为次级信息

---

## 6. 分阶段落地建议

### Phase 1（最小可用）

1. `lib/ai.ts` 增加 non-stream reasoning telemetry 采集
2. `generate-battle-story` 回填 `report.aiReasoning`
3. `AiReasoningPanel` 增加 `content-only` 模式
4. 竞技场 non-stream 先落地验证

### Phase 2（页面扩展）

1. 通用数据卡 API 增加 `x-mahoshojo-ai-meta` 协商包装体
2. `/free`、`/details`、`/canshou`、`/scenario`、`/sublimation`、`/tavern` 接入 non-stream reasoning 展示

### Phase 3（补齐长尾）

1. `/name`（`generate-magical-girl`）等纯非流式页面补齐
2. `magic-tea-party` 非流式辅助接口（如 `generate-updates`）按需接入

---

## 7. 测试与验收

### 7.1 单元测试

1. `generateObject.reasoning` 能正确归一化到 `AIReasoningEnvelope`
2. `generateText.reasoningText` 回退路径能正确归一化
3. 仅 `reasoningTokens` 无文本时，状态为 `unavailable` 且 non-stream 不展示

### 7.2 API 合约测试

1. 未带协商头：响应格式保持旧版
2. 带协商头：返回 `data + aiMeta`
3. 结构化数据卡 `data` 内容与旧版完全一致（签名语义不变）

### 7.3 前端交互测试

1. non-stream 有 reasoning 文本时展示面板
2. non-stream 无 reasoning 时不显示占位
3. non-stream 不出现“正在思考/未返回思考内容”等状态文案
4. stream 行为不回归

---

## 8. 风险与规避

1. **模型常只给 tokens 不给文本**  
   - 规避：non-stream 仅“有内容才展示”，无内容静默

2. **思考文本可能过长或含噪声**  
   - 规避：服务端截断 + 摘要生成 + 异常标记

3. **数据卡结构被污染**  
   - 规避：采用协商包装体，不向 `data` 注入 aiMeta

4. **兼容性风险**  
   - 规避：默认保持旧响应；仅在客户端显式声明时返回新格式

---

## 9. 建议拍板项

1. 是否采用“协商包装体（推荐）”作为 non-stream aiMeta 传输协议
2. non-stream reasoning 最大保留字符数（建议 12k）
3. `content-only` 模式是否展示来源/tokens（建议默认展示为二级信息）
4. Phase 1 首批页面范围（建议：竞技场 non-stream + `/details`）

---

## 10. 与已有文档关系

1. 本文是对 `docs/AI_REASONING_VISIBILITY_IMPLEMENTATION_2026-02-07.md` 第 6 节“非流式待决策方案”的展开与可执行化。  
2. 本文不替代流式设计文档；流式仍以 `docs/AI_REASONING_VISIBILITY_DESIGN_2026-02-06.md` 与现有实现为准。
