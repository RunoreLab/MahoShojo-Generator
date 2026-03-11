# AI 连续战报会话开发任务拆解（2026-03-11）

> 关联文档：
>
> - `docs/AI_CONTINUOUS_DIALOGUE_DESIGN_2026-03-11.md`
> - `docs/AI_CONTINUOUS_DIALOGUE_IMPLEMENTATION_BLUEPRINT_2026-03-11.md`
>
> 目标：把“连续战报会话”的第一批落地范围拆成可执行任务，作为后续编码实施顺序与验收参考。

## 1. 当前批次范围

本批次只做：

1. 连续战报会话
2. 本地会话持久化
3. 章节续写 / 分支 / 最后一章重写
4. deterministic digest
5. AI 会话摘要
6. 前端冷却 + 无数据库结构变更的服务端软保护

本批次不做：

1. 角色卡 AI 连续编辑会话
2. 登录态云同步
3. D1 审计限流表与相关 repository
4. provider 原生 messages 会话抽象
5. 大规模重写现有竞技场生成链路

## 2. 实施原则

1. 优先复用现有 [`pages/api/arena/generate-stream.ts`](/home/notuhao/code/MahoShojo-Generator/pages/api/arena/generate-stream.ts) 与 [`components/arena/hooks/useBattleEngine.ts`](/home/notuhao/code/MahoShojo-Generator/components/arena/hooks/useBattleEngine.ts) 的能力，不做“推倒重写”。
2. 第一批只允许最小共享抽取，不要为了“架构完美”先拆大面积公共层。
3. 持久化只放浏览器 IndexedDB，不引入新的服务端数据库表。
4. 服务端冷却第一批只做软保护，因此必须把前端冷却与 `Retry-After` 兼容做好。
5. `rewrite` 只允许重写最后一章；中间章改写统一改走分支。

## 3. 任务总览

建议按以下顺序实施：

1. 任务 A：连续战报类型与 IndexedDB 存储
2. 任务 B：章节 digest 与上下文编译
3. 任务 C：服务端生成入口 `generate-next`
4. 任务 D：会话摘要入口 `refresh-summary`
5. 任务 E：前端会话 Hook 与最小 UI
6. 任务 F：软限流与冷却对齐
7. 任务 G：测试与回归

依赖关系：

- B 依赖 A
- C 依赖 A、B
- D 依赖 A、B
- E 依赖 A、C，建议在 D 之后补齐摘要刷新逻辑
- F 依赖 C、D、E
- G 依赖全部前置任务

## 4. 任务明细

## 4.1 任务 A：连续战报类型与 IndexedDB 存储

目标：

- 建立 battle story session/chapter 的本地模型与增删改查能力
- 确保分支与重写语义可被本地数据结构表达

建议文件：

- `lib/ai-session/types.ts`
- `lib/ai-session/storage.ts`
- `lib/ai-session/battle-story/types.ts`
- `lib/ai-session/battle-story/storage.ts`

实施要点：

1. 建立 `BattleStorySessionRecord` 与 `BattleStoryChapterRecord`
2. 建立 `ai-continuous-dialogue:v1` IndexedDB
3. 为 session / chapter 建立必要索引
4. 提供最小 CRUD：
   - `putBattleStorySession`
   - `getBattleStorySession`
   - `listBattleStorySessions`
   - `putBattleStoryChapter`
   - `listBattleStoryChaptersBySession`
   - `markBattleStoryChapterSuperseded`
5. 明确导出时只导活动章节，不把 `superseded` 章节默认混入主线

验收标准：

1. 能创建空会话并读取
2. 能按 `sessionId + index` 正确列出章节
3. 能把最后一章标记为 `superseded`
4. 分支会话可以继承 `branchOf`

风险提示：

- 不要把所有 chapter 内联到 session 中，否则后续重写和分支会导致整条记录频繁重写

## 4.2 任务 B：章节 digest 与上下文编译

目标：

- 把连续战报的“上下文裁剪逻辑”从 UI 中抽出来
- 形成 deterministic digest 与会话 prompt 组装能力

建议文件：

- `lib/ai-session/battle-story/digest.ts`
- `lib/ai-session/battle-story/context.ts`

实施要点：

1. 从战报 Markdown 中提取标题、摘要、impact digest
2. 实现 `buildBattleStoryPromptContext`
3. 固定最近窗口与摘要拼装顺序
4. 限制 `userGuidance`、回放章节正文与 digest 长度

建议导出函数：

- `buildBattleStoryDeterministicDigest`
- `buildBattleStoryPromptContext`
- `resolveBattleStoryRecentWindow`

验收标准：

1. 同一 chapter 重复运行 digest 结果一致
2. 最近窗口超限时，较旧章节自动退化为 digest
3. 无标题正文会自动回退为 `第 N 章`

风险提示：

- 这里不要直接耦合 React 状态或页面对象，保持纯函数，方便测试

## 4.3 任务 C：服务端生成入口 `generate-next`

目标：

- 增加面向连续战报的流式生成 endpoint
- 复用现有竞技场流式生成能力，不额外套一层 HTTP 自调用

建议文件：

- `pages/api/arena/session/generate-next.ts`
- 视需要最小抽取共享逻辑到 `lib/arena/session-generate.ts`

参考文件：

- `pages/api/arena/generate-stream.ts`

实施要点：

1. 校验 `action`、`sourceChapterId`、`chapterIndex`
2. 把 battle story context 编译为当前轮请求上下文
3. 复用现有 SSE 事件结构
4. 补发 `session_meta` 与 `chapter_digest`
5. 保持 `meta` / `telemetry` / `done` 与现有解析兼容

验收标准：

1. `start` 能生成首章
2. `continue` 能生成下一章
3. `branch` 能基于指定章节生成分支首章
4. `rewrite` 只允许最后一章，且被重写章节不会继续作为主线活动章节
5. 客户端在 `done ok=true` 前不会落本地

风险提示：

- [`pages/api/arena/generate-stream.ts`](/home/notuhao/code/MahoShojo-Generator/pages/api/arena/generate-stream.ts) 已经很大，第一批应优先抽“最小共享函数”，不要尝试一次性完全重构

## 4.4 任务 D：会话摘要入口 `refresh-summary`

目标：

- 在不回放全文的前提下，为长会话刷新 `sessionSummary`

建议文件：

- `pages/api/arena/session/refresh-summary.ts`

参考文件：

- `pages/api/magic-tea-party/summarize.ts`

实施要点：

1. 输入只接受 `previousSummary + uncovered digests`
2. 服务端对 digests 长度做上限控制
3. 返回 `summary + coveredChapterIds`
4. 失败不阻断主会话

验收标准：

1. 新增 3 章后可触发摘要刷新
2. 刷新失败不会影响章节保存
3. 分支会话能在继承旧摘要的基础上继续刷新

风险提示：

- 摘要刷新一定要与正文生成解耦，不能阻塞主生成链路

## 4.5 任务 E：前端会话 Hook 与最小 UI

目标：

- 在现有竞技场页面上提供最小可用的连续战报操作面板

建议文件：

- `components/arena/hooks/useBattleStorySession.ts`
- `components/arena/components/BattleStorySessionPanel.tsx`

参考文件：

- `components/arena/hooks/useBattleEngine.ts`
- `components/arena/stores/useNarrativeHistoryStore.ts`
- `lib/magic-tea-party/useMagicTeaPartySessions.ts`

实施要点：

1. 管理 active session / chapter list / pending action
2. 接管 `start` / `continue` / `branch` / `rewrite`
3. 只在流式 `done ok=true` 后写 IndexedDB
4. 成功后同步 `workingCombatants`
5. 满足阈值时后台触发 `refresh-summary`

最小 UI 建议：

1. 当前会话标题
2. 章节列表
3. 继续续写按钮
4. 基于当前章分支按钮
5. 重写最后一章按钮
6. 导出整段故事按钮

验收标准：

1. 用户可以从当前战斗种子新建会话
2. 用户可以在现有会话上继续续写
3. 用户可以查看章节链并识别分支来源
4. 用户可以导出主线活动章节合并后的 Markdown

风险提示：

- 第一批先做增强侧栏，不要把竞技场主页面改造成复杂工作台

## 4.6 任务 F：软限流与冷却对齐

目标：

- 在不改服务端数据库结构的前提下，完成第一批基本防滥用保护

建议文件：

- `lib/ai-session/rate-limit.ts`
- `pages/api/arena/session/generate-next.ts`
- `pages/api/arena/session/refresh-summary.ts`
- `components/arena/hooks/useBattleStorySession.ts`

参考文件：

- `pages/api/arena/leaderboard/search.ts`
- `lib/cooldown.ts`
- `components/arena/hooks/useBattleEngine.ts`

实施要点：

1. 做 session 级最小间隔
2. 做实例内并发锁，避免同一 session 同时起两次生成
3. 返回 `429 + Retry-After`
4. 前端收到 `429` 后以服务端值覆盖本地冷却
5. 用户主动取消但已进入模型阶段时，仍按一次正式生成处理

验收标准：

1. 同一 session 连点“继续续写”会被拦截
2. 前端能正确显示剩余秒数
3. 摘要刷新接口也受独立冷却保护

风险提示：

- 第一批是软保护，必须在文档与实现里明确其局限，避免误以为已经具备持久审计强度

## 4.7 任务 G：测试与回归

目标：

- 为 battle story 第一批能力建立最小回归网

建议文件：

- `tests/ai-session/battle-story-storage.test.ts`
- `tests/ai-session/battle-story-digest.test.ts`
- `tests/ai-session/battle-story-context.test.ts`
- `tests/ai-session/battle-story-rate-limit.test.ts`

实施要点：

1. 测试 session / chapter 本地存储
2. 测试 deterministic digest 稳定性
3. 测试 `rewrite` / `branch` 数据状态
4. 测试 `Retry-After` 与前端冷却兼容

验收标准：

1. battle story 核心纯函数具备单元测试
2. 关键动作语义存在回归测试
3. 新增测试可在 `bun test` 下运行

## 5. 推荐实施批次

### 批次 1：最小后端骨架

- 任务 A
- 任务 B
- 任务 C 的基础流式生成

交付结果：

- 能在代码层创建会话并生成首章 / 下一章

### 批次 2：摘要与前端接入

- 任务 D
- 任务 E

交付结果：

- 用户可在页面上真正操作连续战报

### 批次 3：冷却完善与回归

- 任务 F
- 任务 G

交付结果：

- 第一批连续战报具备可接受的冷却、防误触和回归测试

## 6. 延后项记录

以下内容继续保留在设计文档中，但不进入当前编码顺序：

1. `lib/ai-session/card-edit/*`
2. `pages/api/data-cards/edit-draft.ts`
3. `components/CharManager/useAiCardEditSession.ts`
4. `components/CharManager/AiCardEditPanel.tsx`
5. `ai_action_audit_logs` 持久化审计表
6. 登录态云同步

## 7. 开发前提醒

1. 优先搜索并复用现有战报 SSE 解析逻辑，不要复制一套新的客户端事件解析器。
2. `generate-next` 若必须抽共享逻辑，应先抽最小边界，例如“规范化输入”和“统一输出事件”，不要在第一步重写整个竞技场生成模块。
3. 角色状态更新链路与 narrative history 已经是现有稳定能力，第一批连续战报应尽量贴着现有链路走。
