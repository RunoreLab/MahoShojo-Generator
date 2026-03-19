# 连续战报中间章节操作设计稿（2026-03-19）

> 状态：讨论稿，待确认后实施。  
> 关联文档：
>
> - `docs/AI_CONTINUOUS_DIALOGUE_DESIGN_2026-03-11.md`
> - `docs/AI_CONTINUOUS_DIALOGUE_IMPLEMENTATION_BLUEPRINT_2026-03-11.md`
> - `docs/AI_CONTINUOUS_DIALOGUE_CHAPTER_COUNT_DESIGN_2026-03-12.md`
> - `public/encyclopedia/continuous-battle-story.md`
>
> 目标：结合当前仓库实现，收敛“连续战报支持删除/重写任意章节、从中间章节开始创建分支”的产品语义、数据模型和落地边界，供后续开发直接参考。

---

## 1. 问题定义

当前连续战报已经支持：

- 新建会话
- 继续续写最后一章
- 基于最后一章创建分支会话
- 重写最后一章

但仍然缺少三个用户明显会遇到的能力：

1. 删除当前会话里的某一章战报
2. 重新生成当前会话里的某一章战报
3. 从中间某章开始新建分支，而不是只能以最后一章为起点

本次讨论先给出结论：

- **不建议把当前连续战报改成“单会话多活跃分支 DAG”模型。**
- **建议继续保持“单会话 = 单条线性活跃章节链”。**
- **从中间章节分支时，新建一个新会话。**
- **在当前会话中删除/重写中间章节时，统一定义为“截断型操作”**：
  - 删除第 `N` 章 = 删除第 `N` 章及其后续章节
  - 重写第 `N` 章 = 以第 `N` 章的输入快照重新生成，并移除旧的第 `N` 章及其后续章节

这条路线最贴合当前代码，也最接近魔法茶会已经验证过的“分支是新会话，不在原会话里堆多条活跃线”的思路。

---

## 2. 仓库现状审计

## 2.1 当前连续战报本质上是“线性尾指针”模型

关键文件：

- `components/arena/hooks/useBattleStorySession.ts`
- `components/arena/components/BattleStorySessionPanel.tsx`
- `lib/ai-session/battle-story/types.ts`
- `lib/ai-session/battle-story/storage.ts`
- `lib/ai-session/battle-story/generate-next.ts`

当前模型有几个核心前提：

1. `BattleStorySessionRecord.lastChapterId` 只指向一个“当前尾章节”
2. `BattleStorySessionRecord.workingCombatants` 只缓存“当前尾章节之后”的角色状态
3. `BattleStorySessionRecord.lastChapterInputCombatants` 只缓存“最后一章生成前”的输入状态
4. `BattleStoryChapterRecord.status` 只有 `active | superseded`
5. 前端章节列表虽然可选中任意章节，但操作按钮只围绕最后一章工作

这意味着：

- **现有 session 不是 DAG，而是单条活跃链**
- 一旦想在同一会话中同时保留“旧第 4 章后的路线”和“新第 4 章后的路线”，现有 `lastChapterId / workingCombatants / chapterCount` 语义都会失真

## 2.2 服务端 `generate-next` 的后端校验比前端更宽松

关键文件：

- `pages/api/arena/session/generate-next.ts`
- `lib/ai-session/battle-story/generate-next.ts`

现状里：

- `branch` 后端实际上允许基于 `recentChapters` 里的任意 `sourceChapterId` 推导下一章索引
- 但前端始终只把最后一章当成 `sourceChapterId`
- `rewrite` 仍然只允许“当前上下文里的最后一章”

这说明：

- **“从中间章节分支”不是纯后端能力缺失，更大程度是前端上下文构造与 session 语义未扩展**
- **“重写中间章节”则既有产品语义问题，也有上下文/状态快照缺失问题**

## 2.3 魔法茶会已经有两套值得复用的机制

关键文件：

- `lib/magic-tea-party/useMagicTeaPartySessions.ts`
- `lib/magic-tea-party/types.ts`
- `components/magic-tea-party/BranchChainModal.tsx`
- `components/magic-tea-party/SessionSidebar.tsx`

可直接借鉴的部分：

1. `forkedFrom + branchLabel`  
   分支来源不仅记录父会话 id，还保留“从哪里分支”的语义标签

2. 分支链 UI  
   通过 `BranchChainModal` 查看父链与子分支，并快速跳转

3. 摘要失效策略  
   茶会在“分支点早于摘要覆盖范围”时会主动清空摘要，避免未来信息污染新分支

不建议直接照搬的部分：

1. `mergeSessionToParent`  
   茶会消息可做“回灌合并”，但连续战报涉及 `workingCombatants / arena_history / current_state` 连续状态推进，合并分支会把状态语义复杂度明显抬高

本轮建议：

- **复用茶会的分支链展示、分支标签、摘要失效思路**
- **不做“分支合并回主线”**

## 2.4 本地章节删除，不等于删除服务端战报记录

关键文件：

- `pages/api/arena/generate-stream.ts`
- `pages/api/me/battle-reports.ts`
- `pages/api/me/battle-reports/[generationId].ts`
- `pages/api/me/battle-reports/[generationId]/regenerate.ts`

当前连续战报每一章仍会写入一条服务端 `battle_report_generations` 记录，并把 `generationId` 回填到本地章节。

因此本轮必须明确：

- **删除本地连续战报章节，只是删除本地会话链中的引用与上下文**
- **不删除服务端审计记录，也不回收其 `generationId`**
- 用户后续若已登录，仍可能在“我的战报”里看到原章节对应的历史生成记录

这个边界应当在 UI 确认文案中明确提示，避免误解。

---

## 3. 方案对比

## 3.1 方案 A：把连续战报升级成单会话 DAG

做法：

- 一个 session 内允许多个活跃的相同索引章节
- `lastChapterId` 改成多个尾节点
- `workingCombatants` 改成按分支存多份状态

优点：

- 理论上最完整
- 可以在一个会话里同时保留多条路线

问题：

1. 需要重写 session 核心语义
2. 章节列表、导出、摘要、预览、冷却、上下文窗口都要重新定义
3. 现有 `chapterCount`、`lastChapterId`、`workingCombatants` 全部不再可靠
4. 用户也更难理解“当前到底在哪条线上”

结论：

- **不推荐**

## 3.2 方案 B：保持线性会话，中间分支通过“新会话”表达

做法：

- 当前会话始终只有一条活跃链
- 从中间章节分支时，复制前缀章节到新会话，再生成新章
- 在当前会话重写/删除中间章节时，显式截断后续

优点：

- 与当前模型兼容
- 与魔法茶会“分支 = 新会话”思路一致
- 用户心智简单，风险可控

问题：

- 中间章节操作需要可靠的“章节边界状态快照”
- 旧会话无法无损直接升级为全能力状态

结论：

- **推荐方案**

---

## 4. 推荐产品语义

以下为建议的 canonical 语义。

### 4.1 删除所选章节

如果选中的是当前会话第 `N` 章：

- 删除结果 = **移除第 `N` 章及其后续所有章节**
- 会话回退到第 `N-1` 章结束后的状态

例子：

```txt
原会话：1 -> 2 -> 3 -> 4 -> 5

删除第 3 章后：
当前会话：1 -> 2
```

推荐文案：

- 选中最后一章：`删除本章`
- 选中中间章节：`删除本章及后续`

推荐额外规则：

- 若删除后会话没有任何章节，**直接删除整个空会话**

这样可以避免为了“空会话重新生成首章”额外再引入一套新按钮与状态机。

### 4.2 重写所选章节

如果选中的是当前会话第 `N` 章：

- 重写结果 = 以第 `N` 章生成前的输入状态重新生成一个新第 `N` 章
- 旧第 `N` 章被标记为 `superseded`
- 第 `N+1...` 及后续章节从当前会话中移除

例子：

```txt
原会话：1 -> 2 -> 3 -> 4 -> 5

重写第 3 章后：
当前会话：1 -> 2 -> 3'
旧第 3 章保留为 superseded
旧第 4/5 章从当前会话移除
```

推荐文案：

- 选中最后一章：`重写本章`
- 选中中间章节：`重写本章并截断后续`

这个语义要在按钮旁明确说明：

- 如果用户想保留原路线，不应直接重写当前会话
- **应优先使用“从本章创建分支”**

### 4.3 从所选章节创建分支

如果选中的是当前会话第 `N` 章：

- 新建一个 branch session
- 复制当前会话 `1..N` 章作为前缀
- 从第 `N` 章结束状态继续生成新第 `N+1` 章
- 原会话保持不变

例子：

```txt
原会话：1 -> 2 -> 3 -> 4 -> 5

从第 3 章创建分支后：
原会话：1 -> 2 -> 3 -> 4 -> 5
新分支：1 -> 2 -> 3 -> 4B
```

这与魔法茶会的“从历史消息 fork 新会话”是一致的，只是锚点从 message 变成 chapter。

---

## 5. 数据结构建议

## 5.1 会话仍保持线性，不改成 DAG

`BattleStorySessionRecord` 仍保留以下语义：

- `lastChapterId`：当前活跃尾章节
- `workingCombatants`：当前活跃尾章节之后的角色状态缓存
- `chapterCount`：当前活跃链长度

不建议把这些字段改成数组或树。

## 5.2 建议新增 `battleStoryCheckpoints` Store

相比直接把大快照塞进每个 `BattleStoryChapterRecord`，更推荐新增单独 checkpoint store。

原因：

1. 概念更清晰  
   连续战报真正需要的是“章节边界状态”，不是“章节对象本身越来越胖”

2. 更容易表达“第 N 章前 / 第 N 章后”的状态

3. 后续做截断、分支复制、兼容校验都更自然

推荐新增：

```ts
type BattleStoryCheckpointRecord = {
  id: string;
  sessionId: string;
  boundaryIndex: number;
  chapterId?: string | null;
  combatants: unknown[];
  createdAt: number;
};
```

语义定义：

- `boundaryIndex = 0`
  - 首章生成前状态
  - 等价于 session seed / 初始 working combatants
- `boundaryIndex = 1`
  - 第 1 章结束后 / 第 2 章开始前状态
- `boundaryIndex = 2`
  - 第 2 章结束后 / 第 3 章开始前状态

于是：

- 重写第 `N` 章，要读 `boundaryIndex = N - 1`
- 从第 `N` 章分支，要读 `boundaryIndex = N`
- 删除第 `N` 章及后续后，会话回退到 `boundaryIndex = N - 1`

推荐索引：

- `battleStoryCheckpoints.by_session_boundary` => `[sessionId, boundaryIndex]`
- `battleStoryCheckpoints.by_session_createdAt` => `[sessionId, createdAt]`

## 5.3 `BattleStorySessionRecord` 建议补充分支展示字段

现有 `branchOf` 只记录：

```ts
{
  sessionId: string;
  chapterId: string;
}
```

建议扩为：

```ts
type BattleStorySessionBranchOf = {
  sessionId: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle?: string;
  createdAt: number;
};
```

并建议新增：

```ts
branchLabel?: string;
```

默认格式可参考魔法茶会：

- `从第 3 章分支`
- `从第 5 章《余烬不灭》分支`

这样会话列表、分支链弹窗和导出元数据都会更直观。

## 5.4 `lastChapterInputCombatants` 建议转为兼容字段

当前 session 上的 `lastChapterInputCombatants` 可以保留，但建议降级为：

- **兼容旧会话的 fallback 缓存**
- 新逻辑优先读取 `battleStoryCheckpoints`

原因：

- 它只对最后一章有意义
- 中间章节操作不能依赖这个字段

---

## 6. 核心流程设计

## 6.1 从中间章节创建分支

输入：

- 当前 session
- 所选 source chapter = 第 `N` 章

流程：

1. 读取当前活跃章节链 `1..tail`
2. 截取前缀 `1..N`
3. 复制前缀章节到新 session，并重映射 chapter id / `sourceChapterId`
4. 复制 `boundary 0..N` checkpoint 到新 session
5. 读取 `boundary N` 作为新分支的 `workingCombatants`
6. 用前缀上下文生成新第 `N+1` 章
7. 在新 session 中写入：
   - 新 branch chapter
   - 新的 `boundary N+1`
   - `lastChapterId / workingCombatants / chapterCount`

摘要策略：

- 若父会话 `summaryMeta.coveredUntilChapterIndex > N`，则**不要**直接把摘要带入新分支
- 这和魔法茶会 fork 时的摘要失效逻辑一致
- 分支会话后续可在后台重新生成摘要

## 6.2 重写中间章节

输入：

- 当前 session
- 所选 target chapter = 第 `N` 章

流程：

1. 读取 `boundary N-1` 作为第 `N` 章的输入状态
2. 构造上下文时，只取当前活跃链中的 `1..N`
3. 若当前摘要覆盖到 `N` 或更后，则视为不安全，不直接复用
4. 重新生成新第 `N` 章
5. 将旧第 `N` 章标记为 `superseded`
6. 删除旧的 `N+1..tail` 章节与对应 checkpoints
7. 写入新第 `N` 章与新 `boundary N`
8. 更新 session：
   - `lastChapterId = newChapter.id`
   - `workingCombatants = boundary N`
   - `chapterCount = N`

关键点：

- 请求后端时，`recentChapters` 只提供到第 `N` 章为止的上下文
- 这样现有 `rewrite` 校验仍可继续工作，因为“当前上下文里的最后一章”就是 target chapter

## 6.3 删除中间章节

输入：

- 当前 session
- 所选 target chapter = 第 `N` 章

流程：

1. 删除活跃链中的 `N..tail`
2. 删除 `boundary N..tail`
3. 用 `boundary N-1` 还原 session 的 `workingCombatants`
4. 更新 session：
   - `lastChapterId = 第 N-1 章`
   - `chapterCount = N-1`
5. 若 `N = 1` 且当前会话只剩 0 章，则删除整个 session

摘要策略：

- 若 `summaryMeta.coveredUntilChapterIndex >= N`，清空摘要
- 之后由后台按剩余章节重新刷新

---

## 7. 上下文构造规则

中间章节操作最大的风险不是按钮本身，而是**未来章节信息污染当前重写/分支**。

因此建议新增一个“按锚点构造上下文”的 helper，例如：

- `buildBattleStoryAnchoredRequestWindow()`

核心规则：

### 7.1 分支操作

- 只允许读取 `1..sourceChapter`
- 不允许把 source 之后的章节带进 prompt

### 7.2 重写操作

- 只允许读取 `1..targetChapter`
- 不允许把 target 之后的章节带进 prompt

### 7.3 安全摘要规则

若当前 `sessionSummary` 已经覆盖到未来章节，则不能直接复用。

推荐判定：

- 分支到第 `N` 章后继续：`coveredUntil > N` 视为不安全
- 重写第 `N` 章：`coveredUntil >= N` 视为不安全

### 7.4 不安全摘要的降级方案

不建议为了中间章节操作再额外打一轮 AI 摘要请求。

推荐优先级：

1. 优先使用“安全摘要”
2. 若没有安全摘要，则用较早章节的 `deterministicDigest` 在本地拼一个 prefix digest summary
3. 最近窗口仍沿用当前 `recentChapters` + digest/full 混合策略

这样可以避免：

- 二次调用模型导致交互变慢
- 未来章节信息泄漏

---

## 8. UI 设计建议

## 8.1 章节列表改为“预览 + 章节操作”

当前 `BattleStorySessionPanel` 只有全局按钮，建议改成：

- 左侧章节列表继续支持选中
- 右侧预览区下方或章节列表顶部增加“针对所选章节”的操作栏

推荐按钮：

- `从本章创建分支`
- `重写本章`
- `删除本章`

当所选章节不是最后一章时，按钮文案自动变为：

- `从本章创建分支`
- `重写本章并截断后续`
- `删除本章及后续`

## 8.2 复用茶会的分支链可视化

建议新增类似茶会的：

- `components/arena/components/BattleStoryBranchChainModal.tsx`

展示：

- 父会话链
- 当前会话
- 子分支会话

这样用户在连续战报里也能快速理解：

- 自己当前在哪条线
- 哪个会话是从第几章分出来的

## 8.3 强化 destructive 操作确认

中间章节操作必须弹确认框。

推荐确认文案示例：

- 删除中间章节：
  - `确定删除第 3 章及其后续 2 章吗？当前会话会回退到第 2 章结束状态。本地章节会被移除，但服务端历史生成记录不会删除。`

- 重写中间章节：
  - `确定重写第 3 章吗？当前第 3 章及其后续 2 章会从本地会话中移除，并以新的第 3 章重新接续。若想保留原路线，请先创建分支。`

---

## 9. API / Hook / Storage 改造点

## 9.1 前端 Hook

主要变更文件：

- `components/arena/hooks/useBattleStorySession.ts`
- `components/arena/utils/battleStorySession.ts`

建议新增能力：

- `handleBranchFromSelectedChapter`
- `handleRewriteSelectedChapter`
- `handleDeleteSelectedChapter`
- `resolveSelectedChapterCapabilities`
- `buildAnchoredRecentChapterWindow`

## 9.2 IndexedDB

主要变更文件：

- `lib/ai-session/types.ts`
- `lib/ai-session/storage.ts`
- `lib/ai-session/battle-story/storage.ts`

建议：

- `AI_SESSION_DB_VERSION` 升到 `2`
- 新增 `battleStoryCheckpoints` store
- 增加：
  - 读取单个 boundary
  - 复制 prefix checkpoints
  - 删除某个边界之后的 checkpoints

## 9.3 后端 API

主要变更文件：

- `pages/api/arena/session/generate-next.ts`
- `lib/ai-session/battle-story/generate-next.ts`

建议：

- **action enum 保持不变**：继续使用 `start | continue | branch | rewrite`
- 通过前端裁剪 `recentChapters`，让 `rewrite` 仍然只面对“当前上下文里的最后一章”
- 不为本轮新增新的 action 类型

这样可以把服务端变更压到最小。

---

## 10. 兼容与迁移策略

## 10.1 旧会话无法可靠补全中间章节 checkpoint

因为当前旧会话只缓存：

- 当前尾部 `workingCombatants`
- 最后一章 `lastChapterInputCombatants`

并没有保存每个章节边界状态。

因此不能假设能对旧会话做无损回填。

## 10.2 推荐兼容策略

推荐策略：

1. 旧会话保持可读、可导出
2. 旧会话继续支持：
   - 继续续写最后一章
   - 基于最后一章创建分支
   - 重写最后一章
3. **中间章节操作仅对“已写入 checkpoints 的新会话”开放**

前端可以给出明确提示：

- `该旧会话缺少章节边界快照，暂不支持从中间章节删除/重写/分支。请在新会话中使用此能力。`

这比做不可靠迁移更稳妥。

---

## 11. 推荐实施顺序

推荐拆成三步：

### 第一步：补基础数据能力

- 新增 `battleStoryCheckpoints`
- 新章节生成时同步写 checkpoint
- 新 session / branch clone / delete truncate helper 补齐

### 第二步：开放中间章节分支

- 这是价值最高、破坏性最低的一步
- 复用魔法茶会的 `branchLabel + BranchChainModal`

### 第三步：开放中间章节重写与删除

- 这是 destructive 能力
- 要等 checkpoint 与确认文案全部稳定后再放出

---

## 12. 本文推荐的默认产品口径

以下口径如无额外反对，建议直接作为实施默认值：

1. **连续战报不改成单会话 DAG**
2. **从中间章节分支 = 新建会话**
3. **重写中间章节 = 当前会话截断后续**
4. **删除中间章节 = 删除当前章及后续**
5. **删除首章且无剩余章节 = 删除整个会话**
6. **本地删除不会删除服务端 `battle_report_generations` 记录**
7. **旧会话不强行迁移为中间章节全能力，只做能力降级提示**
8. **本轮不做分支合并回主线**

---

## 13. 结论

结合仓库现状，最成熟、风险最低、且能满足需求的方案不是“把连续战报改成树”，而是：

- **会话继续保持线性**
- **分支通过新会话表达**
- **中间章节编辑通过 checkpoint + 截断型操作实现**
- **UI 借鉴魔法茶会的 branch label / branch chain / 摘要失效策略**

这条路线的优点是：

- 能直接解决“现在只能处理最后一个战报”的问题
- 不需要推翻当前 `useBattleStorySession` 的主结构
- 兼容现有章节规划、摘要、导出和流式生成链路
- 对用户来说，心智也足够清晰

如果后续确认采用本文方案，下一步建议先实现：

1. `battleStoryCheckpoints` 数据层
2. “从所选章节创建分支”
3. “重写所选章节并截断后续”
4. “删除所选章节及后续”

