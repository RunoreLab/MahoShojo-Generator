# AI 连续对话能力实施蓝图（2026-03-11）

> 关联文档：`docs/AI_CONTINUOUS_DIALOGUE_DESIGN_2026-03-11.md`  
> 目的：把上一份设计讨论稿进一步收敛为“可实施接口设计”，明确本地会话结构、建议文件落点、API DTO、冷却/限流实现与测试边界，供后续开发直接参考。

> 2026-03-11 补充决策：
>
> - 当前进入开发任务拆解与首批落地的只有“连续战报会话”
> - “角色卡 AI 连续编辑会话”保留设计，但暂缓实施
> - 考虑 D1 读写配额，第一批实现暂不新增或变更服务端数据库结构
> - 因此，第一批服务端冷却只做“无数据库结构变更”的软保护方案；D1 审计限流保留为后续增强目标

## 1. 实施范围

本蓝图覆盖两条能力线：

1. 连续战报会话
2. 角色卡 AI 连续修改会话

当前执行批次：

- 进入开发任务拆解并优先落地：连续战报会话
- 暂缓实施：角色卡 AI 连续修改会话

本轮不做的内容：

- 登录态云同步
- provider 原生多轮 chat 抽象
- 通用万能 SessionEngine

核心策略保持不变：

- local-first
- 多请求会话化
- 前端体验冷却 + 服务端限流

当前批次的限流解释：

- 前端继续承担主要 UX 冷却
- 服务端第一批只做无 DB schema 变更的软保护
- 更强的持久化审计限流保留在后续版本评估

---

## 2. 总体模块划分

推荐新增一个轻量公共命名空间 `lib/ai-session/`，只承载“会话存储/类型/限流工具”，不承载业务 prompt。

建议文件布局：

```txt
lib/ai-session/storage.ts
lib/ai-session/rate-limit.ts
lib/ai-session/types.ts

lib/ai-session/battle-story/types.ts
lib/ai-session/battle-story/storage.ts
lib/ai-session/battle-story/digest.ts
lib/ai-session/battle-story/context.ts

lib/ai-session/card-edit/types.ts
lib/ai-session/card-edit/storage.ts
lib/ai-session/card-edit/apply-draft.ts
lib/ai-session/card-edit/diff-preview.ts

pages/api/arena/session/generate-next.ts
pages/api/arena/session/refresh-summary.ts
pages/api/data-cards/edit-draft.ts

components/arena/hooks/useBattleStorySession.ts
components/arena/components/BattleStorySessionPanel.tsx
components/CharManager/useAiCardEditSession.ts
components/CharManager/AiCardEditPanel.tsx
```

职责边界：

- `lib/arena/*` 继续负责战报生成业务
- `lib/data-card-*` / `validateDataCard` 继续负责卡片合法性
- `lib/ai-session/*` 只负责“会话”

当前批次只需要真正创建以下文件：

```txt
lib/ai-session/storage.ts
lib/ai-session/types.ts

lib/ai-session/battle-story/types.ts
lib/ai-session/battle-story/storage.ts
lib/ai-session/battle-story/digest.ts
lib/ai-session/battle-story/context.ts

pages/api/arena/session/generate-next.ts
pages/api/arena/session/refresh-summary.ts

components/arena/hooks/useBattleStorySession.ts
components/arena/components/BattleStorySessionPanel.tsx
```

以下文件保留为第二批角色卡编辑能力预留，不进入当前实施批次：

```txt
lib/ai-session/card-edit/*
pages/api/data-cards/edit-draft.ts
components/CharManager/useAiCardEditSession.ts
components/CharManager/AiCardEditPanel.tsx
```

---

## 3. 本地存储实现

## 3.1 为什么不用 localStorage

虽然当前竞技场主状态和按钮冷却大量使用 localStorage，但连续战报与连续编辑会话都不适合继续放 localStorage，原因是：

1. 战报正文和 Markdown 重写草案会很长
2. 会有分支、checkpoint、章节列表，写放大明显
3. localStorage 是整串覆盖，不适合频繁增量写入

因此建议直接使用 IndexedDB。

## 3.2 数据库建议

建议新建独立 DB：

- `ai-continuous-dialogue:v1`

不建议直接并入 `magic-tea-party:v1`，原因：

- 产品域不同
- 后续清理/迁移节奏不同
- 避免对象仓名继续膨胀

## 3.3 Object Store 设计

### 连续战报

1. `battleStorySessions`
2. `battleStoryChapters`

### 角色卡编辑

1. `cardEditSessions`
2. `cardEditCheckpoints`

如果后续确认草案需要单独持久化，再加：

1. `cardEditDrafts`

第一期可以把 `pendingDraft` 内联在 session 记录里，不单独开表。

## 3.4 建议索引与敏感信息边界

建议索引：

- `battleStorySessions.by_updatedAt`
- `battleStorySessions.by_branch_session`（`branchOf.sessionId`）
- `battleStoryChapters.by_session_index`（`[sessionId, index]`）
- `battleStoryChapters.by_session_createdAt`（`[sessionId, createdAt]`）
- `battleStoryChapters.by_sourceChapterId`
- `cardEditSessions.by_updatedAt`
- `cardEditSessions.by_template_updatedAt`（`[template, updatedAt]`）
- `cardEditCheckpoints.by_session_createdAt`（`[sessionId, createdAt]`）

敏感信息边界：

- 不持久化 `customProvider.apiKey`
- 不持久化任何 `Authorization` / 临时签名 / 上游原始响应头
- session 只允许落 `providerId` / `modelId` / `providerMode` 这类可回显但不敏感的配置
- 导出会话时默认剔除临时错误状态、`retryAfter`、调试信息与上游 request id
- 连续角色卡编辑中的 `workingCard` 保留当前协议字段名，不在会话层做 `snake_case -> camelCase` 改造

---

## 4. 连续战报会话：数据结构

## 4.1 Session Meta

```ts
type BattleStorySessionRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: {
    mode: 'classic' | 'kizuna' | 'daily' | 'scenario';
    language: string;
    storyLength: string;
    generationMode: 'stream';
  };
  seed: {
    combatants: unknown[];
    scenario?: Record<string, unknown> | null;
    auxScenarios?: Record<string, unknown>[];
    questionnaires?: Array<{
      id: string;
      title: string;
      kind: 'magical-girl' | 'canshou';
      useLore?: boolean;
      loreMarkdown?: string;
    }>;
    settings: {
      readArenaHistory: boolean;
      writeArenaHistory: boolean;
      readCurrentState: boolean;
      writeCurrentState: boolean;
      readNarrativeHistory: boolean;
      writeNarrativeHistory: boolean;
    };
  };
  workingCombatants: unknown[];
  sessionSummary?: string;
  summaryMeta?: {
    coveredUntilChapterIndex: number;
    coveredChapterIds: string[];
    refreshedAt: number;
    mode: 'ai' | 'deterministic-fallback';
  };
  lastChapterId?: string | null;
  chapterCount: number;
  branchOf?: {
    sessionId: string;
    chapterId: string;
  };
  archivedAt?: number;
};
```

## 4.2 Chapter Record

```ts
type BattleStoryChapterRecord = {
  id: string;
  sessionId: string;
  index: number;
  action: 'start' | 'continue' | 'branch' | 'rewrite';
  status: 'active' | 'superseded';
  sourceChapterId?: string | null;
  supersededByChapterId?: string | null;
  generationId?: string | null;
  title: string;
  markdown: string;
  reportJson: Record<string, unknown>;
  deterministicDigest: {
    chapterTitle: string;
    winner?: string;
    officialConclusion?: string;
    bodyExcerpt?: string;
    impactDigest?: Array<{
      characterName: string;
      impact?: string;
      currentStateSummary?: string;
    }>;
  };
  createdAt: number;
};
```

## 4.3 为什么章节单独存表

原因：

1. 添加新章节时，不必整条 session 全量重写
2. 分支时只需要引用 `sourceChapterId`
3. 后续导出整段故事时也更容易流式拼接

## 4.4 动作语义与约束

`action` 的含义需要在第一期就锁定，否则前后端会很容易做出互不兼容的实现。

### `start`

- 只允许用于空会话
- 生成的章节固定为 `index = 1`
- 生成成功后写入 `lastChapterId`

### `continue`

- 只允许基于当前会话的最新 `active` 章节继续
- 新章节 `index = chapterCount + 1`
- prompt 上下文包含 `sessionSummary + 最近窗口章节 + 最新 workingCombatants`

### `branch`

- `branch` 的目标 `sessionId` 必须是一个新的分支会话 id
- 前端先在本地复制“分支点之前的 active 章节”和 `workingCombatants`
- `sourceChapterId` 必填，表示从该章后开始分叉
- 新分支会话应继承原会话的 `sessionSummary` 与 `summaryMeta`，但只覆盖到 `sourceChapterId` 所在位置
- 分支后的首个新章节 `index = sourceChapter.index + 1`

### `rewrite`

- 第一期开严格约束：只允许重写“当前会话最后一章”
- 旧章节标记为 `status = 'superseded'`
- 新章节沿用相同 `index`
- `sourceChapterId` 指向被重写章节
- 若用户要改更早的中间章节，不做就地重写，改为引导用户创建分支会话

这样做的原因是：中途重写老章节会让后续章节全部失去因果基础，第一期不值得承受这类复杂度。

## 4.5 上下文编译预算

连续战报不是把所有历史全文重新塞回模型，而是走固定编译策略：

1. 固定种子层：初始角色、情景、问卷 Lore、生成设置
2. 滚动记忆层：`sessionSummary` + 最近未摘要章节的 deterministic digest
3. 最近窗口层：最多回放最近 2 章完整 Markdown
4. 当前状态层：`workingCombatants`
5. 本轮引导层：`userGuidance`

建议初始预算：

- 最近窗口最多 2 章
- 单章回放正文建议截断到 6000 字符以内
- `userGuidance` 建议服务端裁到 800 字符以内
- 当最近窗口超限时，优先保留最新章节全文，较旧章节退化为 digest

---

## 5. 连续战报：前端落点

## 5.1 状态归属

现有 `useBattleStore` 继续负责“当前竞技场生成页”的即时状态，例如：

- 当前参战者
- 当前情景
- 当前 battle result
- 当前 streaming markdown

新增的连续会话状态不要塞进 `useBattleStore`，建议新建：

- `components/arena/hooks/useBattleStorySession.ts`

它负责：

- 创建/切换会话
- 加载章节列表
- 触发继续续写 / 分支续写 / 重写本章
- 在生成成功后把新的 `workingCombatants` 与 chapter 落本地

## 5.2 UI 建议

建议新增：

- `BattleStorySessionPanel`

最少包含：

- 当前会话标题
- 章节列表
- 当前分支来源
- 继续续写
- 基于当前章分支
- 重写当前章
- 导出整段故事

不建议第一期做成复杂工作台；先作为竞技场生成区的增强侧栏即可。

---

## 6. 连续战报：API 设计

## 6.1 为什么需要单独 endpoint

虽然可以让前端直接继续调用现有 `/api/arena/generate-stream`，但连续战报仍建议新建一层包装接口，原因：

1. 需要显式接收会话上下文
2. 需要新增 `action/sourceChapterId/chapterIndex` 语义
3. 需要统一返回 `chapterDigest`
4. 需要单独挂服务端限流类别

## 6.2 Endpoint

建议：

- `POST /api/arena/session/generate-next?format=sse`

说明：

- 第一期开流式即可
- 非流式不作为 MVP 必选项

## 6.3 Request DTO

```ts
type BattleStoryGenerateNextRequest = {
  sessionId: string;
  action: 'start' | 'continue' | 'branch' | 'rewrite';
  sourceChapterId?: string;
  chapterIndex?: number;
  chapterContext: {
    sessionSummary?: string;
    recentChapters: Array<{
      id: string;
      index: number;
      title: string;
      markdown: string;
    }>;
    workingCombatants: unknown[];
  };
  seed: {
    combatants: unknown[];
    scenario?: Record<string, unknown> | null;
    auxScenarios?: Record<string, unknown>[];
    questionnaires?: unknown[];
    mode: 'classic' | 'kizuna' | 'daily' | 'scenario';
    storyLength: string;
    language: string;
    settings: {
      readArenaHistory: boolean;
      writeArenaHistory: boolean;
      readCurrentState: boolean;
      writeCurrentState: boolean;
      readNarrativeHistory: boolean;
      writeNarrativeHistory: boolean;
    };
  };
  userGuidance?: string;
  customProvider?: {
    providerId: string;
    modelId: string;
    apiKey: string;
  };
};
```

## 6.4 Response / SSE 扩展事件

沿用当前竞技场 SSE 事件，并新增：

- `event: session_meta`
- `event: chapter_digest`

示例：

```json
event: session_meta
data: {"sessionId":"...","chapterId":"...","action":"continue","sourceChapterId":"..."}
```

```json
event: chapter_digest
data: {"chapterTitle":"...","winner":"...","officialConclusion":"...","bodyExcerpt":"...","impactDigest":[...]}
```

这样客户端无需自己重复构造 deterministic 摘要。

## 6.4.1 事件顺序与兼容约束

为了尽量复用当前 [`pages/api/arena/generate-stream.ts`](/home/notuhao/code/MahoShojo-Generator/pages/api/arena/generate-stream.ts) 与 [`components/arena/hooks/useBattleEngine.ts`](/home/notuhao/code/MahoShojo-Generator/components/arena/hooks/useBattleEngine.ts) 的解析逻辑，建议新接口遵守以下顺序：

1. `session_meta`：请求通过服务端限流后立即发送一次
2. `markdown`：正文流式分块，多次
3. `reasoning` / `reasoning_done`：完全沿用现有可选事件
4. `telemetry`：沿用现有事件
5. `meta` / `meta_error`：沿用现有角色更新元事件
6. `chapter_digest`：在正文结束后发送一次
7. `done`：最后发送一次

失败顺序：

1. `session_meta` 可选
2. `error`
3. `done`，且 `ok = false`

客户端落库规则：

- 收到 `markdown` 不代表章节可以持久化
- 只有在收到 `done` 且 `ok = true` 后，才允许把 chapter、digest、workingCombatants 一起写入 IndexedDB
- 若只有 `chapter_digest` 没有 `done`，仍视为失败，不落本地
- 若 `meta_error` 出现，但正文和 digest 完整，允许继续保存章节，只是不写角色状态更新调试结果

建议事件体：

```ts
type BattleStorySessionMetaEvent = {
  sessionId: string;
  chapterId: string;
  chapterIndex: number;
  action: 'start' | 'continue' | 'branch' | 'rewrite';
  sourceChapterId?: string;
  providerMode: 'system' | 'custom';
  acceptedAt: number;
};

type BattleStoryChapterDigestEvent = {
  chapterId: string;
  sessionId: string;
  chapterIndex: number;
  chapterTitle: string;
  winner?: string;
  officialConclusion?: string;
  bodyExcerpt?: string;
  impactDigest?: Array<{
    characterName: string;
    impact?: string;
    currentStateSummary?: string;
  }>;
};
```

## 6.5 服务端实现建议

不要在新 endpoint 内部再 `fetch('/api/arena/generate-stream')` 一层。  
建议把现有竞技场战报生成抽成共享 service，再让两个 endpoint 共用。

建议新增共享函数，例如：

- `lib/arena/session-generate.ts`

输入：

- 规范化后的 battle request

输出：

- SSE response / live markdown / usage / impacts / chapter digest

这样可以避免两套 promptBuilder 和两套解析逻辑。

补充说明：

- 当前第一批实现允许采用“`generate-next` 代理现有 `generate-stream`，并在代理层注入 `session_meta` / `chapter_digest`”的过渡方案
- 该方案的目标是先把 battle story 入口低风险跑通
- 等前端会话层稳定后，再评估是否把竞技场生成主链路进一步抽成共享 service，替代代理实现

---

## 7. 连续战报：章节摘要与 AI 摘要的调用时机

## 7.1 Deterministic 摘要

在主战报成功后，同请求内直接生成，不额外调用模型。

建议固定算法：

- `chapterTitle`：优先取正文第一个 Markdown 标题；没有则回退为 `第 N 章`
- `winner`：优先取解析出的 report / impacts；没有则留空
- `officialConclusion`：优先取 report 中的官方结论；没有则取正文结尾第一句摘要
- `bodyExcerpt`：去掉标题与系统注释后的纯文本前 160 到 240 字
- `impactDigest`：按当前参战者顺序输出，不额外排序，不做模型改写

建议约束：

- `bodyExcerpt` 最多 240 字
- `impactDigest` 最多保留 8 个对象
- deterministic digest 必须可重复生成，不能依赖随机抽样

## 7.2 AI 会话摘要

建议单独 endpoint：

- `POST /api/arena/session/refresh-summary`

Request：

```ts
type BattleStoryRefreshSummaryRequest = {
  sessionId: string;
  digests: Array<{
    chapterId: string;
    index: number;
    chapterTitle: string;
    winner?: string;
    officialConclusion?: string;
    bodyExcerpt?: string;
    impactDigest?: Array<{
      characterName: string;
      impact?: string;
      currentStateSummary?: string;
    }>;
  }>;
  previousSummary?: string;
  customProvider?: {
    providerId: string;
    modelId: string;
    apiKey: string;
  };
};
```

Response：

```ts
type BattleStoryRefreshSummaryResponse = {
  summary: string;
  coveredChapterIds: string[];
};
```

调用策略：

- 由前端在主生成成功后按阈值判断是否调用
- 调用失败不阻断主流程

## 7.3 AI 摘要触发阈值

本期直接定为以下策略，不再留作开放项：

1. 满足以下任一条件时，前端在章节成功落本地后异步调用 `refresh-summary`
2. 距离上次 AI 摘要后，新增 `active` 章节数 >= 3
3. 自上次 AI 摘要后累计 deterministic digest 文本总长度 >= 1800 字符
4. 当前会话首次达到 6 章且仍没有 `sessionSummary`

补充约束：

- 同一 session 的 `refresh-summary` 最短间隔 30 秒
- 分支会话继承父会话摘要时，不立即强制重算；只在分支后新增章节达到阈值时再刷新
- `refresh-summary` 输入只使用 `previousSummary + 未覆盖章节 digests`，不回放完整正文
- 若 AI 摘要失败，保留旧摘要继续运行；必要时可把最近 1 到 2 章 deterministic digest 拼成临时 fallback summary

---

## 8. 角色卡 AI 编辑会话：数据结构

## 8.1 Session Record

```ts
type CardEditSessionRecord = {
  id: string;
  title: string;
  template: 'magical-girl' | 'canshou' | 'general' | 'general-scenario';
  createdAt: number;
  updatedAt: number;
  baseCard: Record<string, unknown>;
  workingCard: Record<string, unknown>;
  sessionSummary?: string;
  messageCount: number;
  pendingDraft?: CardEditDraft;
  latestValidation?: {
    ok: boolean;
    error?: string | null;
  };
  nativeness: {
    originalHadSignature: boolean;
    currentHasSignature: boolean;
    droppedByAi: boolean;
  };
};
```

## 8.2 Checkpoint Record

```ts
type CardEditCheckpointRecord = {
  id: string;
  sessionId: string;
  title: string;
  cardSnapshot: Record<string, unknown>;
  createdAt: number;
};
```

---

## 9. 角色卡 AI 编辑：草案格式

## 9.1 统一 Draft 壳

```ts
type CardEditDraft = {
  id: string;
  sessionId: string;
  template: 'magical-girl' | 'canshou' | 'general' | 'general-scenario';
  mode: 'field-patch' | 'document-rewrite';
  summary: string;
  warnings: string[];
  touchedPaths: string[];
  nativeness: {
    willDropSignature: true;
    reason: string;
  };
  preview: {
    beforeExcerpt?: string;
    afterExcerpt?: string;
  };
  payload: CardEditDraftPayload;
};
```

## 9.2 结构化卡：字段补丁

```ts
type StructuredCardDraftPayload = {
  kind: 'field-patch';
  ops: Array<{
    op: 'set' | 'unset';
    path: string;
    value?: unknown;
    reason?: string;
  }>;
};
```

第一期不建议支持复杂数组原子操作，原因是：

- 容易和现有 schema 对齐失控
- 可读性差

对于数组字段，第一期直接整字段 `set` 新数组即可。

## 9.2.1 字段补丁的安全边界

第一期建议把补丁协议收紧，不做“任意路径可写”。

约束如下：

- `path` 使用点路径，如 `profile.title`、`battleStyle`
- 不支持 `a[0].b` 这类数组索引写法
- 数组若要修改，只允许对整个数组字段执行 `set`
- 禁止修改 `signature`
- 禁止修改系统拥有的元字段，如持久化 id、作者标记、审核标记、时间戳
- 禁止出现 `__proto__`、`constructor`、`prototype` 等危险路径片段
- `touchedPaths` 必须与 `ops` 中实际出现的 path 一致，且顺序稳定

推荐服务端只生成“白名单路径”上的草案，真正应用前客户端再做一次二次校验。

## 9.2.2 预览规则

结构化卡不建议只给用户一大段 JSON。

建议预览层输出：

- 变更摘要：1 到 3 句自然语言
- 字段列表：`path + before + after`
- 校验预警：来自 `validateDataCard`
- 原生性提示：明确告知会移除 `signature`

如果某个字段值很长：

- `before` / `after` 预览截断到 240 字
- 完整值只在“展开详情”里看

## 9.3 通用卡：文档重写草案

```ts
type DocumentRewriteDraftPayload = {
  kind: 'document-rewrite';
  title?: string;
  contentField: 'content';
  nextContent: string;
};
```

`general` / `general-scenario` 第一期开这个模式就够了，不必强行做 JSON Patch。

## 9.3.1 文档重写模式的边界

`general` / `general-scenario` 建议只开放以下能力：

- 重写 `content`
- 可选重写 `title`
- 输出 Markdown diff 预览

建议约束：

- `nextContent` 不能为空
- `nextContent` 建议限制在 40_000 字符以内
- 若只改标题而不改正文，不走 `document-rewrite`，而是退回结构化 `field-patch`
- diff 以“按行比较”为主，不追求复杂的词级最优 diff

这样可以把实现复杂度控制在一个很稳的范围内，同时满足大多数“润色/扩写/删改情节卡文案”的真实需求。

---

## 10. 角色卡 AI 编辑：API 设计

## 10.1 Endpoint

建议：

- `POST /api/data-cards/edit-draft`

说明：

- 只负责生成草案
- 草案应用放客户端纯函数完成

## 10.2 Request DTO

```ts
type GenerateCardEditDraftRequest = {
  sessionId: string;
  template: 'magical-girl' | 'canshou' | 'general' | 'general-scenario';
  workingCard: Record<string, unknown>;
  sessionSummary?: string;
  recentMessages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
  }>;
  userInstruction: string;
  customProvider?: {
    providerId: string;
    modelId: string;
    apiKey: string;
  };
};
```

## 10.3 Response DTO

```ts
type GenerateCardEditDraftResponse = {
  draft: CardEditDraft;
  validationPreview?: {
    ok: boolean;
    error?: string | null;
  };
};
```

## 10.4 为什么草案应用放客户端

原因：

1. 这是 local-first 会话
2. 应用补丁不需要模型
3. 现有 `validateDataCard` 在前端已可直接复用
4. 用户确认前不应该触发服务器落盘

建议纯函数：

- `lib/ai-session/card-edit/apply-draft.ts`

职责：

- 应用 draft
- 移除 `signature`
- 生成 checkpoint
- 运行 `validateDataCard`

## 10.5 Recent Messages 建议裁剪

角色卡编辑接口里的 `recentMessages` 不应无限增长。

建议：

- 只发送最近 6 条消息
- 更早历史通过 `sessionSummary` 表达
- `assistant` 侧消息优先保存“上轮草案摘要”，而不是整卡 JSON
- `userInstruction` 为空字符串时直接拒绝，不进入模型

---

## 11. 角色卡 AI 编辑：前端落点

## 11.1 `details.tsx`

定位：

- 面向“刚生成完结果，还想继续改”

建议新增入口：

- “继续 AI 打磨”按钮

建议能力：

- 新建编辑会话
- 输入修改要求
- 查看 draft 预览
- 应用 draft
- 导出当前工作版本

## 11.2 `character-manager.tsx`

定位：

- 面向“已有卡片的持续编辑”

建议新增面板：

- `AiCardEditPanel`

它应直接读取当前编辑区的 `characterData` 作为 `workingCard`，并在应用 draft 后：

- 更新编辑区内容
- 删除 `signature`
- 更新 `hasLostNativeness`
- 追加 checkpoint

---

## 12. 服务端限流：阶段化建议

## 12.1 当前批次约束

当前已确认约束：

- 暂不新增或变更服务端数据库结构
- 尽量避免为连续战报引入稳定性的额外 D1 读写负担
- 但仍需要保留服务端侧的最基本滥用拦截能力

因此，本节拆成两个层次：

1. 第一批实际落地：无 DB schema 变更的软保护方案
2. 后续增强目标：D1 审计限流方案

## 12.2 第一批实际落地方案

建议组合：

1. 前端 `useCooldown` 继续负责主要 UX 冷却
2. 新 endpoint 内部增加进程内 `Map` / token bucket 级别的轻量服务端保护
3. 同一 `sessionId + actionType` 在短时间内重复请求时直接返回 `429`
4. 服务端继续返回 `Retry-After`，前端收到后覆盖本地剩余时间
5. `refresh-summary` 采用更严格的短窗口限制，避免摘要接口被频繁触发

推荐键设计：

- `battleStory:<providerMode>:<actionType>:<sessionId>`
- `battleStoryIp:<providerMode>:<actionType>:<ip>`

推荐初始保护阈值：

- `generate-next`：
  - 官方 Key：最短间隔 120 秒
  - 自带 Key：最短间隔 3 秒
  - 同 session 并发保护：同一时刻只允许 1 个进行中的生成
- `refresh-summary`：
  - 官方 Key：最短间隔 15 秒
  - 自带 Key：最短间隔 3 秒
  - 同 session 并发保护：同一时刻只允许 1 个进行中的摘要刷新

实现参考：

- 轻量 token bucket 可参考 [`pages/api/arena/leaderboard/search.ts`](/home/notuhao/code/MahoShojo-Generator/pages/api/arena/leaderboard/search.ts)
- 前端冷却兼容逻辑可参考 [`components/arena/hooks/useBattleEngine.ts`](/home/notuhao/code/MahoShojo-Generator/components/arena/hooks/useBattleEngine.ts)

限制说明：

- 这是实例内软保护，不是跨实例、跨冷启动的强一致限流
- 第一批只能做到“降低误触和明显滥用”，不能达到持久审计版的稳健程度
- 若后续线上观测到滥用压力或成本压力明显升高，需要重新评估 D1 审计或平台侧限流能力

## 12.3 为什么当前不直接采用持久化审计

在 Cloudflare / Edge / Serverless 环境下，in-memory Map 只能做弱保护，不足以满足“稳健安全运行”的要求。

原本更理想的做法，是对连续能力使用可持久查询的审计表。

但当前由于 D1 读写配额顾虑，第一批不采用该方案，只保留为后续增强目标。

## 12.4 后续增强目标：建议新增表

建议新增：

- `ai_action_audit_logs`

建议字段：

```ts
type AiActionAuditLog = {
  id: string;
  actionType: string;
  userId?: number | null;
  ipAnonymized?: string | null;
  sessionId?: string | null;
  providerMode: 'system' | 'custom';
  resultCode: 'STARTED' | 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'ABORTED';
  retryAfterSeconds?: number | null;
  metadataJson?: string | null;
  createdAt: string;
  finishedAt?: string | null;
};
```

为什么不复用 `auth_audit_logs`：

- 语义不对
- 后续查询维度不同
- 不应把认证审计和 AI 行为审计混在一起

## 12.4.1 建议 D1 Schema

```sql
CREATE TABLE IF NOT EXISTS ai_action_audit_logs (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  user_id INTEGER,
  ip_anonymized TEXT,
  session_id TEXT,
  provider_mode TEXT NOT NULL,
  result_code TEXT NOT NULL,
  retry_after_seconds INTEGER,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_action_logs_action_user_created
  ON ai_action_audit_logs (action_type, user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_action_logs_action_ip_created
  ON ai_action_audit_logs (action_type, ip_anonymized, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_action_logs_action_session_created
  ON ai_action_audit_logs (action_type, session_id, created_at);
```

实现建议：

- 复用现有 IP 匿名化工具，不额外发明一套
- `STARTED` 在请求通过限流并真正开始调用模型前写入
- 完成后更新同一条记录为 `SUCCESS` / `FAILED` / `ABORTED`
- 被限流拦截的请求单独写 `BLOCKED`

## 12.5 后续增强目标：建议限流工具

建议新增：

- `lib/ai-session/rate-limit.ts`

暴露接口：

```ts
type ConsumeAiActionRateLimitInput = {
  req: Request;
  actionType:
    | 'battle_story_session_continue'
    | 'battle_story_session_regenerate_chapter'
    | 'battle_story_session_refresh_summary'
    | 'card_edit_session_generate_draft';
  sessionId?: string;
  providerMode: 'system' | 'custom';
  userId?: number | null;
};

type ConsumeAiActionRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  reason: 'cooldown' | 'burst_window' | 'ip_window' | 'user_window';
  auditLogId?: string;
};
```

使用位置：

- `pages/api/arena/session/generate-next.ts`
- `pages/api/arena/session/refresh-summary.ts`
- `pages/api/data-cards/edit-draft.ts`

## 12.6 后续增强目标：限流判定顺序

建议参考 [`lib/auth/mail-send-guard.ts`](/home/notuhao/code/MahoShojo-Generator/lib/auth/mail-send-guard.ts) 的“可查询审计”思路，但增加“先写 STARTED 再收尾更新”的并发保护。

推荐顺序：

1. 提取 `userId`、匿名化 IP、`sessionId`、`providerMode`
2. 查询同 `actionType + sessionId` 是否存在过近的 `STARTED/SUCCESS/FAILED/ABORTED`
3. 查询同 `actionType + userId` 的窗口计数
4. 查询同 `actionType + ipAnonymized` 的窗口计数
5. 若任一命中，则写入 `BLOCKED` 并返回 `429 + Retry-After`
6. 若通过，则立即写入 `STARTED`
7. 调模型
8. 请求结束时更新为 `SUCCESS` / `FAILED` / `ABORTED`

`STARTED` 必须计入冷却判断，否则并发双击会在第一条请求尚未完成时绕过最小间隔。

## 12.7 后续增强目标：建议初始阈值

### 连续战报正文生成

- 官方 Key：`minInterval = 120s`
- 自带 Key：`minInterval = 3s`
- 同 session burst：官方 `2 次 / 5 分钟`，自带 `8 次 / 5 分钟`
- 同用户窗口：官方 `12 次 / 1 小时`，自带 `120 次 / 1 小时`
- 同 IP 窗口：官方 `30 次 / 1 小时`，自带 `240 次 / 1 小时`

### 连续战报摘要刷新

- 官方 Key：`minInterval = 15s`
- 自带 Key：`minInterval = 3s`
- 同 session burst：`1 次 / 30 秒`
- 同用户窗口：官方 `60 次 / 1 小时`，自带 `240 次 / 1 小时`

### 角色卡草案生成

- 官方 Key：`minInterval = 60s`
- 自带 Key：`minInterval = 3s`
- 同 session burst：官方 `3 次 / 10 分钟`，自带 `20 次 / 10 分钟`
- 同用户窗口：官方 `30 次 / 1 小时`，自带 `180 次 / 1 小时`
- 同 IP 窗口：官方 `60 次 / 1 小时`，自带 `300 次 / 1 小时`

这些值保留为“持久化审计版”的后续参考值，不属于当前第一批的硬性实施范围。

---

## 13. UI 层的冷却规则

建议前端统一规则：

### 连续战报

- 官方 Key：120 秒
- 自带 Key：3 秒
- 失败短冷却：3 秒

### 角色卡编辑草案

- 官方 Key：60 秒
- 自带 Key：3 秒
- 失败短冷却：3 秒

前端收到 `429` 时，应优先使用服务端 `Retry-After` 覆盖本地剩余时间。

## 13.1 冷却结果矩阵

说明：

- 本表描述的是“当前第一批可实现的前端表现”
- 若后续切换到 D1 审计限流，服务端内部状态机会比本表更细

| 场景 | 前端冷却 | 服务端状态（概念） |
| --- | --- | --- |
| 请求成功完成 | 完整冷却 | `STARTED -> SUCCESS` |
| 请求被 `429` 拦截 | 使用 `Retry-After` 覆盖 | `BLOCKED` |
| 服务端校验失败，模型尚未真正开始 | 短冷却 3 秒 | `FAILED` |
| 流式过程中断，但请求已进入模型阶段 | 完整冷却 | `ABORTED` |
| 用户主动取消，但模型已经开始生成 | 完整冷却 | `ABORTED` |

这里故意把“已进入模型阶段”的中断统一视为会消耗一次正式机会，以避免通过取消重试绕开冷却。

---

## 14. 测试建议

## 14.1 连续战报

至少覆盖：

1. 会话创建、续写、分支、重写的本地存储正确性
2. `chapterDigest` 生成稳定
3. `sessionSummary` 回退策略正确
4. 成功、失败、429 下冷却行为正确
5. `workingCombatants` 在多章后持续一致

## 14.2 角色卡编辑

至少覆盖：

1. 结构化卡 draft 应用后的字段正确
2. `general` / `general-scenario` 的 `content` 重写 draft 正确
3. 应用 draft 后 `signature` 被移除
4. `validateDataCard` 错误可被前端感知
5. checkpoint / 回退正确

## 14.3 服务端限流

至少覆盖：

1. 官方 Key 与自带 Key 阈值不同
2. 同 session 突发限制生效
3. `Retry-After` 返回正确
4. 失败短冷却与成功完整冷却区分正确

---

## 15. 推荐落地顺序

当前批次：

1. 先做 `lib/ai-session/battle-story/*` 的本地存储与类型定义
2. 做连续战报 `generate-next` endpoint
3. 做战报摘要 `refresh-summary`
4. 做连续战报前端会话 Hook 与最小 UI
5. 做第一批软限流与冷却对齐
6. 做 battle story 回归测试

后续批次再做：

1. 角色卡编辑会话与 `edit-draft` endpoint
2. 客户端 draft 应用、diff 预览与 checkpoint
3. D1 审计限流增强

这条顺序能尽量复用现有竞技场链路，把“连续战报”先独立跑通，再评估角色卡编辑与持久化审计限流是否值得进入下一批。
