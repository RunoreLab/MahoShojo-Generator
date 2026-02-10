# 竞技场战报插图功能设计方案（2026-02-10）

## 0. 背景与目标

当前项目已具备：

- 角色立绘生成（`/tachie`、茶会 `TachiePanel`）
- 茶会剧情插图生成（复用 `TachieGenerator` + 本地缓存）
- 竞技场战报文本生成（非流式与流式）

但竞技场战报目前缺少“基于本局内容自动生成插图”的能力，导致体验断层：

- 用户看完战报后无法直接生成本局对应画面；
- 战报分享只有文本截图，没有独立剧情插图；
- 与“茶会已支持插图生成”形成体验不一致。

本方案目标：

1. 在竞技场结果区新增“战报插图”能力；
2. 默认提示词自动拼接：
   - 角色卡外观描述（参考茶会做法）
   - 战报正文结尾片段
   - 当前状态（如有）
   - 历战记录（如有）
3. 允许用户在生成前手动编辑最终提示词；
4. **当前状态/历战记录必须来源于 AI 本次返回结果，而不是角色卡旧字段**。

---

## 1. 关键需求拆解

## 1.1 功能需求（FR）

1. 战报生成完成后（非流式/流式），展示“战报插图”面板。
2. 面板自动生成推荐提示词并填入编辑框。
3. 用户可：
   - 手动修改提示词；
   - 一键重置为推荐提示词；
   - 使用 `TachieGenerator` 发起生图；
   - 预览/下载生成结果。
4. 默认模式为“剧情插画（illustration）”。

## 1.2 数据来源要求（FR-Data）

1. 外观：来自当前参战角色数据卡（可读取 `appearance` 等）。
2. 正文片段：来自本次战报正文的末尾片段。
3. 当前状态 + 历战记录：来自 **AI 本次输出的 impacts 元数据**，不可回退到角色卡旧 `current_state`/`arena_history`。
4. 若 AI 未返回对应字段，则该字段不入默认提示词（允许为空，不伪造）。

## 1.3 非功能需求（NFR）

1. 不破坏现有战报生成链路与签名安全逻辑；
2. Edge Runtime 兼容；
3. 流式和非流式行为一致；
4. UI 与现有竞技场卡片风格一致。

---

## 2. 现状盘点（基于当前仓库）

## 2.1 竞技场结果页结构

- 页面：`components/arena/ArenaPage.tsx`
- 结果渲染：`components/arena/components/BattleResult.tsx`
  - 非流式：`BattleReportCard`
  - 流式：`StreamingBattleReportCard`
  - 角色更新区显示 `updatedCombatants` 的“历战记录/当前状态”

## 2.2 战报数据链路

### 非流式

- 前端调用：`/api/generate-battle-story`（`useBattleEngine`）
- API 内部可拿到 `impactsFromAI`，但当前响应只返回：
  - `report`
  - `updatedCombatants`
  - `adjudicationResults`
- 问题：前端缺少“原始 AI impacts”，无法保证“仅使用 AI 本次返回状态/历战摘要”。

### 流式

- 前端调用：`/api/arena/generate-stream`
- 流末尾通过 `MAHOSHOJO_ARENA_META`（或 SSE `meta` 事件）可拿到：
  - `report.headline/winner`
  - `impacts[].impact/currentStateSummary`
- 前端当前仅用于更新角色；未沉淀为“插图提示词专用状态”。

## 2.3 茶会插图可复用能力

- 面板：`components/magic-tea-party/TachiePanel.tsx`
- 生图器：`components/TachieGenerator.tsx`
- 关键可复用点：
  1. 推荐提示词构造（外观 + 剧情片段 + 风格）
  2. 可编辑最终提示词
  3. Workflow/template/node 参数化
  4. 生成结果回调

---

## 3. 核心问题与风险

1. **数据时效性风险**  
   若从角色卡读取 `current_state/arena_history`，可能拿到旧数据，不一定是本次战报对应结果。

2. **流式/非流式来源不一致风险**  
   流式有 meta，非流式当前无 `impacts` 字段返回给前端。

3. **名称匹配风险**  
   AI 返回 `characterName` 可能与参战者显示名存在轻微差异（空格/引号/别名）。

4. **提示词过长风险**  
   外观 + 正文片段 + impacts 全量拼接可能导致生图不稳定。

---

## 4. 方案对比

## 4.1 方案 A：直接从角色卡读取状态/历战（不推荐）

- 优点：改动小。
- 缺点：违反需求（可能是旧数据）；时效性不可控。

## 4.2 方案 B：严格使用 AI 本次 impacts（推荐）

- 优点：满足“来源必须是 AI 本次返回”；可解释性强。
- 缺点：需要补齐非流式响应字段并在前端加状态承载。

## 4.3 方案 C：只用 `updatedCombatants` 推断（不推荐单独采用）

- 优点：无需新增 API 字段。
- 缺点：`applyPostBattleUpdates` 存在默认兜底文本，不等于 AI 原始返回；不满足“严格来源”。

**结论：采用方案 B；`updatedCombatants` 仅用于展示，不作为插图提示词的状态/历战来源。**

---

## 5. 推荐方案（总体设计）

## 5.1 架构摘要

新增“战报插图上下文”概念，核心由三部分组成：

1. `appearanceHints`：参战者外观摘要（来自角色卡）
2. `reportTail`：战报正文末尾片段
3. `aiImpacts`：AI 本次返回的 `impact/currentStateSummary`

在 `BattleResult` 中基于上述上下文生成推荐提示词，允许用户编辑后调用 `TachieGenerator`。

## 5.2 数据流（非流式）

1. `generate-battle-story` 返回新增字段 `impacts`（原始 AI 结果）
2. `useBattleEngine` 写入 store：`latestAiImpacts`
3. `BattleResult` 读取 `newsReport + combatants + latestAiImpacts`
4. 生成推荐提示词并渲染插图面板

## 5.3 数据流（流式）

1. SSE `meta` 事件（或 inline meta fallback）提取 `impacts`
2. `useBattleEngine` 写入 store：`latestAiImpacts`
3. 流结束后 `BattleResult` 读取 `streamingMarkdown + combatants + latestAiImpacts`
4. 生成推荐提示词并渲染插图面板

---

## 6. 数据结构设计

## 6.1 API 响应扩展

在以下接口响应中新增可选字段：

- `pages/api/generate-battle-story.ts`
- `pages/api/arena/generate.ts`

```ts
type BattleAiImpact = {
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
};

interface BattleApiResponse {
  report: NewsReport;
  updatedCombatants: any[];
  adjudicationResults?: AdjudicationResult[];
  generationId?: string;
  impacts?: BattleAiImpact[]; // 新增：AI 原始 impacts
}
```

## 6.2 前端 store 扩展

在 `components/arena/types/index.ts` 与 `useBattleStore.ts` 新增：

- `latestAiImpacts: BattleAiImpact[] | null`
- `setLatestAiImpacts: (impacts: BattleAiImpact[] | null) => void`

清空战报/重新生成前应重置为 `null`，避免串局。

---

## 7. 提示词拼接规则（核心）

## 7.1 外观摘要（角色卡来源，允许使用）

建议抽出共享工具（例如 `lib/arena/battle-illustration-prompt.ts`）：

- 魔法少女：
  - `appearance.outfit/accessories/colorScheme/overallLook`
- 残兽：
  - `appearance`（字符串）+ 可选 `materialAndSkin/featuresAndAppendages`
- 通用角色：
  - 优先 `appearance` 或 `content` 的短摘要
- 每个角色不限制长度（毕竟用户可以自行修改提示词），仅保留高上限安全阈值。

## 7.2 战报尾段（正文来源）

- 非流式：`report.article.body`
- 流式：从 `streamingMarkdown` 剥离标题与结构后取正文
- 仅取末尾片段（建议 180~320 字符，可配置）
- 去除多余 Markdown 语法噪声后拼接。

## 7.3 当前状态/历战（AI impacts 来源，强约束）

- 只读取 `latestAiImpacts`：
  - `impact` → “历战记录（本次）”
  - `currentStateSummary` → “当前状态（本次）”
- 不读取角色卡 `arena_history/current_state` 作为默认提示词源。
- 若某角色字段缺失则跳过，不自动补旧值。

## 7.4 推荐提示词模板（默认）

```text
主题：魔法少女竞技场战报插图，二次元，剧情插画，画面干净，无水印，无文字。
战报标题：{headline}
角色外观：
- {角色A：外观摘要}
- {角色B：外观摘要}
战报片段（结尾）：
{reportTail}
当前状态（来自本次 AI 返回）：
- {角色A：currentStateSummary}
历战记录（来自本次 AI 返回）：
- {角色A：impact}
构图建议：突出冲突后的余波，保留视觉焦点与景深层次，适合“战报配图”。
```

---

## 8. 交互设计

## 8.1 位置与时机

- 在 `BattleResult` 中，战报卡片之后、角色更新区之前新增“🎨 战报插图”模块。
- 仅当存在有效战报内容时显示。

## 8.2 面板能力

1. 展示“推荐提示词（可编辑）”文本域；
2. 按钮：
   - 重置为推荐提示词
   - 复制提示词
3. 可选高级设置：
   - 风格预设（默认/视觉小说）
   - Workflow/template/node 参数（复用茶会写法）
4. 下方嵌入 `TachieGenerator`（`mode="illustration"`）。

## 8.3 空态/异常态

- 无外观摘要：提示“未提取到外观，已仅用战报片段生成”。
- 无 AI impacts：提示“AI 未返回状态/历战摘要，本次提示词未包含该部分”。
- 战报中断：禁用按钮并提示先完成战报生成。

---

## 9. 与现有模块的接口关系

1. `useBattleEngine`
   - 非流式：读取 `result.impacts` -> `setLatestAiImpacts`
   - 流式：读取 `meta.impacts` -> `setLatestAiImpacts`
2. `useStreamCombatantUpdater`
   - 继续用于角色写回，不改安全模型
3. `BattleResult`
   - 新增 `BattleIllustrationPanel` 渲染与上下文组装
4. `TachieGenerator`
   - 直接复用，不改 provider 流程

---

## 10. 实施清单（建议分阶段）

## Phase 1（最小可用）

1. API 返回 `impacts`（非流式两端点）
2. battle store 新增 `latestAiImpacts`
3. 提示词工具函数（外观提取 + 尾段提取 + 模板拼接）
4. 新增 `BattleIllustrationPanel`（可编辑 + 生成）
5. 接入 `BattleResult`

## Phase 2（体验增强）

1. 插图本地缓存（可按 `generationId + promptHash`）
2. 历史战报页复用（`/me/battle-reports`）
3. 多图批量生成/重抽样参数

---

## 11. 测试策略

## 11.1 单元测试（`bun test`）

建议新增：

- `tests/battle-illustration-prompt.test.ts`
  1. 外观提取：三种模板都能输出摘要
  2. 正文尾段：长度与截取位置正确
  3. impacts 来源约束：**只读 aiImpacts，不读角色卡旧状态/历战**
  4. 缺字段场景：应跳过而非伪造

## 11.2 现有链路回归

1. `tests/arena-stream-meta.test.ts`（确保 meta 提取稳定）
2. 非流式 battle 生成接口返回结构兼容
3. 流式 battle 完成后 `latestAiImpacts` 能被设置

---

## 12. 验收标准（DoD）

1. 非流式/流式战报完成后都可看到“战报插图”面板。
2. 默认提示词包含：
   - 外观摘要
   - 战报结尾片段
   - AI 返回的状态/历战（如有）
3. 未返回 AI impacts 时，不出现角色卡旧状态/旧历战内容。
4. 用户可编辑提示词并成功发起生图。
5. `bun run lint`、`bun test`、`bun run build` 通过（以最终实现分支为准）。

---

## 13. 风险与应对

1. **AI impacts 缺失**  
   - 应对：允许空缺并给出 UI 提示，不回退旧数据。

2. **名称匹配失败**  
   - 应对：复用/抽出现有名称归一化策略（与 `useStreamCombatantUpdater` 一致）。

3. **提示词过长导致画面发散**  
   - 应对：分段限长 + 总长上限（建议 2,000~3,000 字符）。

4. **流式异常导致上下文不完整**  
   - 应对：无正文但有 impacts 时仍允许生成；否则提示需重试战报。

---

## 14. 预留扩展（非本期）

1. 将插图与 `battle_report_generations.id` 关联并持久化到 R2；
2. 战报详情页（`/me/battle-reports`）支持“基于历史战报再生成插图”；
3. PVP 回合结束自动生成候选插图（异步任务）。

---

## 15. 推荐落地文件清单（供开发阶段参考）

## 新增（建议）

- `components/arena/components/BattleIllustrationPanel.tsx`
- `lib/arena/battle-illustration-prompt.ts`
- `tests/battle-illustration-prompt.test.ts`

## 修改（建议）

- `components/arena/components/BattleResult.tsx`
- `components/arena/hooks/useBattleEngine.ts`
- `components/arena/stores/useBattleStore.ts`
- `components/arena/types/index.ts`
- `pages/api/generate-battle-story.ts`
- `pages/api/arena/generate.ts`

---

## 16. 结论

本方案以“**AI 原始 impacts 作为状态/历战唯一来源**”为核心，满足了“数据时效与来源可信”要求；同时最大化复用茶会的插图生成经验（提示词拼接 + 可编辑 + `TachieGenerator`），实现成本可控、风险清晰、且可在后续平滑扩展到历史战报与持久化存储。

---

## 17. 与“统一图片资产嵌入方案”的关联（2026-02-10 补充）

本文重点解决：

1. 战报插图提示词如何构建（尤其是 impacts 来源必须来自本次 AI 输出）；
2. 流式/非流式战报插图面板如何落地；
3. 战报插图生成链路与现有竞技场流程的对齐。

若后续涉及以下能力，请以新文档为主设计依据：

- 角色卡/战报卡“插图渲染进卡片并随截图分享”的统一资产模型；
- 用户上传图片的“用户自行上传”小字注释规则；
- 图片资产写入角色卡 JSON（`_visual_assets`）；
- 云端 300KB 限制下的预估、自动精简、分级裁剪与压缩；
- 含图片数据卡“必须人工审核、跳过 AI 自动审查”的审核闭环；
- 管理后台查看内嵌图片用于人工审核。

关联文档：

- `docs/CARD_VISUAL_ASSET_EMBEDDING_DESIGN_2026-02-10.md`


