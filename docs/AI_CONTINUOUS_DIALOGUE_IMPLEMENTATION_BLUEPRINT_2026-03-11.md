# AI 连续对话能力实施蓝图（2026-03-11）

> 关联文档：`docs/AI_CONTINUOUS_DIALOGUE_DESIGN_2026-03-11.md`  
> 目的：把上一份设计讨论稿进一步收敛为“可实施接口设计”，明确本地会话结构、建议文件落点、API DTO、冷却/限流实现与测试边界，供后续开发直接参考。

## 1. 实施范围

本蓝图覆盖两条能力线：

1. 连续战报会话
2. 角色卡 AI 连续修改会话

本轮不做的内容：

- 登录态云同步
- provider 原生多轮 chat 抽象
- 通用万能 SessionEngine

核心策略保持不变：

- local-first
- 多请求会话化
- 前端体验冷却 + 服务端真实限流

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
  sourceChapterId?: string | null;
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

---

## 7. 连续战报：章节摘要与 AI 摘要的调用时机

## 7.1 Deterministic 摘要

在主战报成功后，同请求内直接生成，不额外调用模型。

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

## 12. 服务端真实限流：建议实现

## 12.1 为什么不用 in-memory Map

在 Cloudflare / Edge / Serverless 环境下，in-memory Map 只能做弱保护，不足以满足“稳健安全运行”的要求。

因此，连续能力的服务端限流建议使用可持久查询的审计表。

## 12.2 建议新增表

建议新增：

- `ai_action_audit_logs`

建议字段：

```ts
type AiActionAuditLog = {
  id: string;
  actionType: string;
  userId?: number | null;
  ip?: string | null;
  ipAnonymized?: string | null;
  sessionId?: string | null;
  providerMode: 'system' | 'custom';
  resultCode: 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'ABORTED';
  retryAfterSeconds?: number | null;
  metadataJson?: string | null;
  createdAt: string;
};
```

为什么不复用 `auth_audit_logs`：

- 语义不对
- 后续查询维度不同
- 不应把认证审计和 AI 行为审计混在一起

## 12.3 建议限流工具

建议新增：

- `lib/ai-session/rate-limit.ts`

暴露接口：

```ts
type ConsumeAiActionRateLimitInput = {
  req: Request;
  actionType: 'battle_story_session_continue' | 'battle_story_session_regenerate_chapter' | 'card_edit_session_generate_draft';
  sessionId?: string;
  providerMode: 'system' | 'custom';
  userId?: number | null;
};

type ConsumeAiActionRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  reason: 'cooldown' | 'burst_window' | 'ip_window' | 'user_window';
};
```

使用位置：

- `pages/api/arena/session/generate-next.ts`
- `pages/api/arena/session/refresh-summary.ts`
- `pages/api/data-cards/edit-draft.ts`

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

1. 先做 `lib/ai-session/*` 的本地存储与类型定义
2. 做连续战报前端会话与 `generate-next` endpoint
3. 做战报摘要与服务端限流
4. 做角色卡编辑会话与 `edit-draft` endpoint
5. 做客户端 draft 应用、diff 预览与 checkpoint

这条顺序能尽量复用现有竞技场链路，同时把复杂度最高的卡片编辑草案放在第二批，减少首批实现风险。
