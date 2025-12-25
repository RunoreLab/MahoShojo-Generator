# 竞技场「流式生成」稳定性审查报告

生成时间：2025-12-23  
范围：`/arena-stream`（前端）与 `/api/arena/generate-stream`（Edge API）相关的流式生成、Markdown 展示、角色更新链路

---

## 1. 结论摘要（TL;DR）

当前流式生成“不稳定”的核心原因主要集中在两类：

1) **标题/Markdown 结构被人为“预置字符”破坏**  
前后端同时通过 `#` 进行“流式开头预热”，导致真实标题很容易被拼接成 `## 标题` 或 `#` 残留，从而引发：
- 标题识别失败 → 角色更新校验失败
- UI 展示标题层级异常（多余 `#`）

2) **客户端对 Markdown 的“完成态判定/解析”过于依赖特定格式细节**  
例如对 `##` 标题要求必须带空格（`## 标题`），当模型输出 `##标题` 时会被误判为“不完整战报”，进一步导致更新流程被跳过或报错。

此外还存在一个“功能层面的缺口”：

3) **流式战报本身不包含 impacts/currentStateSummary，所以“仅写入当前状态”在流式模式下天然无法自动生效**  
`/api/arena/update-combatants-after-stream` 需要 `impacts[].currentStateSummary` 才会更新 `current_state.summary`；而流式输出目前只要求 Markdown（未要求提供结构化 impacts），因此写入当前状态会出现“没有可展示的角色更新”的体验。

本次我已对“非常明确且能立即正确修复”的问题做了现场修复（见第 4 节），其余改进建议与可选方案见第 5 节。

---

## 2. 当前流式链路（端到端）

### 2.1 前端（消费与展示）

- 路由入口：`pages/arena-stream.tsx`
  - `useBattleStore.getState().setGenerationMode('stream')`
- 生成与消费：`components/arena/hooks/useBattleEngine.ts`
  - `fetch('/api/arena/generate-stream')` 获取 `ReadableStream`
  - `TextDecoder` 按 chunk 拼接为 `streamingMarkdown`
  - 结束后做“完成态判定”，满足条件则调用 `useStreamCombatantUpdater.updateFromMarkdown`
- 更新端点：`components/arena/hooks/useStreamCombatantUpdater.ts`
  - 解析 Markdown 提取 `headline` 与 `winner`
  - 调用 `/api/arena/update-combatants-after-stream` 由服务端签名/写入
- UI 展示：
  - `components/arena/components/BattleResult.tsx`（流式模式渲染 `components/stream/StreamingBattleReportCard.tsx`）

### 2.2 后端（生成与透传）

- API：`pages/api/arena/generate-stream.ts`
  - 使用 `createStreamPromptBuilder(...)` 构建“Markdown 输出”提示词
  - 调用 `generateWithStreamAI(...)`（`lib/stream/raw-ai.ts`）执行 `streamText`
  - 将模型输出流透传给客户端，并在服务端旁路统计输出预览/写 D1 日志

---

## 3. 问题定位与影响分析

### P0：标题多余 `#`、标题层级偏移（根因：前后端双重 `#` 预置）

#### 现象
- 标题行可能出现残留 `#`（如 UI 中看到多余的 `#` 或标题层级异常）
- 角色更新经常失败（headline 解析失败导致被视为默认标题）

#### 根因
- 服务端：`lib/stream/raw-ai.ts` 在 `streamText` 的消息列表里预置了 `assistant: '#'`，期望模型“从 # 后继续写标题”。
- 前端：`components/arena/hooks/useBattleEngine.ts` 又额外在拼接前将 `accumulatedText` 初始化为 `'#'`。

两者叠加后，只要模型在输出时“重复写了一次 #”，最终内容就会变成 `## 标题`，而客户端解析 headline 的逻辑主要依赖 `^# ...`，从而造成 headline 解析失败。

#### 影响
- **标题解析失败 → 角色更新被拒绝**（`headline === '魔法少女速报'` 或无法提取）
- UI 端看到“标题多余 # / 标题像 H2 一样显示”的不一致体验

---

### P0：Markdown 完成态判定/解析对空格过敏（`##` 必须带空格）

#### 现象
模型输出 `##胜利者`（无空格）时：
- 前端会误判“不完整战报”（从而不进入冷却/不触发角色更新）
- 或者进入角色更新后解析失败

#### 根因
- 完成态判定与校验使用了 `^#{2,6}\\s+`（强制要求至少一个空格）

#### 影响
对不同供应商/不同模型的“轻微格式差异”容错不足，导致“偶发性失败”，用户体感为“不稳定”。

---

### P1：流式输出目标与系统提示存在潜在冲突（系统提示提到 JSON 字段）

#### 现象
偶发出现模型混入“字段名/winner/impact 等结构化痕迹”，或者输出结构漂移。

#### 根因
`getSystemPrompt(mode, combatants)` 的系统提示中包含大量“winner 字段/impact 字段”的描述（历史上用于 JSON 结构化输出）。  
而流式模式实际要求的是纯 Markdown 输出；虽然后续提示词里有“输出格式”要求，但对某些模型可能仍产生冲突与不稳定。

---

### P1：仅开启“写入当前状态”时，流式模式无法自动产生更新

#### 现象
当用户只勾选“写入当前状态”、不勾选“历战记录”：
- `/api/arena/update-combatants-after-stream` 没有收到 `impacts[].currentStateSummary` → `applyPostBattleUpdates` 不会更新 `current_state.summary`
- UI 看起来像“角色更新不工作”

#### 根因
流式提示词只要求 Markdown 战报，并未要求输出可解析的 `currentStateSummary`。  
而服务端写入当前状态必须依赖 `impacts` 输入。

---

## 4. 本次已落地的立即修复（已提交到代码）

### 4.1 移除前后端双重 `#` 预置（修复标题多余 `#` / 标题层级偏移）

- `lib/stream/raw-ai.ts`：移除 `assistant: '#'` 预置消息
- `components/arena/hooks/useBattleEngine.ts`：移除 `accumulatedText = '#'` 的初始化

### 4.2 放宽 Markdown 校验的“空格假设”

- `components/arena/hooks/useBattleEngine.ts`：完成态判定从 `^#{2,6}\\s+` 放宽为 `^#{2,6}\\s*`
- `components/arena/hooks/useStreamCombatantUpdater.ts`：校验从 `^#{2,6}\\s+` 放宽为 `^#{2,6}\\s*`

### 4.3 解析/展示层对标题层级偏移做容错

- `components/arena/hooks/useStreamCombatantUpdater.ts`：headline 提取支持 `#{1,3}`（兼容偶发 `## 标题`）
- `components/stream/StreamingBattleReportCard.tsx`：headline 提取支持 `#{1,3}`，导出标题也同步兼容
- `lib/arena/battle-report-log-utils.ts`：`extractHeadlineFromMarkdown` 支持 `#标题`（无空格）

### 4.4 强化流式提示词的“第一行必须是 # ”与“禁止输出结构化字段名”

- `lib/arena/logic.ts`：在流式输出格式要求中新增强制约束：
  - 第一行第一个字符必须是 `# `
  - 禁止输出 JSON/YAML/代码块及字段名（winner/impact/currentStateSummary 等）

### 4.5 UX：生成中即展示卡片（避免首屏只出现一个 `#` 或空白）

- `components/arena/components/BattleResult.tsx`：流式模式下 `isGenerating` 时也渲染 `StreamingBattleReportCard`（内容可为空串）

---

## 5. 推荐改进方案（按优先级）

### 方案 A（推荐）：引入“可解析的 impacts/currentState”输出，但不污染用户正文

目标：让流式模式也能自动写入“历战影响/当前状态”，而不需要第二次 AI 调用，也不让用户正文变得臃肿。

做法（两种实现择一）：

1) **HTML 注释尾部携带 JSON 元数据（推荐）**  
要求模型在输出末尾追加一段：
`<!-- MAHOSHOJO_META: { ... } -->`  
前端在流完成后提取该注释并 JSON.parse，再调用 `/api/arena/update-combatants-after-stream` 时带上 `impacts`。

优点：不影响渲染（Markdown 渲染通常会忽略 HTML 注释），格式明确、解析稳定。  
风险：模型可能漏写/写错；需做校验与兜底（漏写就退化为当前行为）。

2) **新增隐藏板块（如 `## 角色影响` / `## 当前状态`），UI 折叠展示**  
优点：对用户可见且可手动校对。  
缺点：正文更长，视觉上更“像结构化报告”。

### 方案 B：自动触发一次“重做角色更新”（使用既有端点）

目标：不改流式战报格式，复用已有 `/api/arena/redo-combatant-updates` 生成 impacts/currentStateSummary。

做法：流式完成并成功写入历战记录后，如果用户开启了 `writeCurrentState`（或用户显式选择“自动生成更新”），前端自动调用 `redo-combatant-updates`。

优点：落地快、复用现有 schema 与服务端逻辑。  
缺点：额外一次 AI 调用（成本与耗时增加）；需在 UI 上明确告知“生成后还在更新角色”。

### 方案 C：升级传输协议为 SSE/事件流（结构化分通道）

目标：让“正文流”和“元数据/结构化更新”走不同事件类型，彻底消除“靠 Markdown 解析结构化信息”的不确定性。

做法：后端返回 `text/event-stream`：
- `event: markdown` → data: chunk
- `event: meta` → data: JSON（reporterInfo、adjudicationResults、最终 impacts 等）
- `event: done`

优点：结构清晰、扩展性强；前端消费更稳定。  
缺点：改动面较大，需要统一处理浏览器兼容与断线重连策略。

---

## 6. 手动验证清单（建议按顺序）

1) 打开 `http://localhost:3000/arena-stream`，发起一次生成：
   - 标题第一行应为单一 `# ` 开头（不应出现标题前额外的 `#` 残留）
   - 不应出现“标题看起来像二级标题”的情况
2) 开启“写入历战记录”，生成完成后应看到：
   - `角色更新` 面板出现更新条目（至少写入一条历战记录）
3) 将 `writeArenaHistory=false`、`writeCurrentState=true`（仅写当前状态）：
   - 预期：当前版本仍可能没有更新（属于第 3 节的功能缺口，需按第 5 节方案补齐）
4) 反复生成 5~10 次，观察：
   - 是否仍出现 `## 标题`、标题缺失、或“完成态判定失败”

---

## 7. 备注与局限

- 本次修复聚焦“确定性 bug”（双重 `#` 预置、空格假设、标题容错、提示词强约束），可显著降低你截图中那类“标题异常/更新失败”的概率。
- “流式模式自动写入 current_state.summary”属于功能缺口，需要引入可解析的 impacts 或二次 AI 调用；我已在第 5 节给出落地路线与取舍。

