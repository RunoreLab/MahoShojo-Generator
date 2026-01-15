# 魔法酒馆（Magic Tavern）功能设计与实现记录

日期：2026-01-15

> 目标：在首页「辅助功能」新增自研互动页【魔法酒馆】，基于本项目角色卡/情景卡提供长期对话与剧情体验。本文给出架构设计、实现方案、风险与分期计划，供开发落地参考。

---

## 0. 项目现状速览（与魔法酒馆相关）

- 技术栈：Next.js + Cloudflare Edge Runtime + D1 + Tailwind 4 + Vercel AI SDK 1.x
- 现有能力：已完成酒馆（SillyTavern）生态联动、角色卡/情景卡生成、立绘生成（LibLib）等
- 安全策略：已有敏感词检测、逮捕页跳转、屏蔽词过滤、逮捕备份等机制
- API Key：`AiProviderSelector` 已支持自定义供应商/模型/Key，本地 `localStorage` 存储

> 结论：魔法酒馆可复用现有 AI 提示词规范、敏感词机制、TachieGenerator、角色卡读取逻辑。

---

## 1. 目标与边界

### 1.1 功能目标

- 支持「角色卡 + 情景卡」自由组合，形成可持续互动的剧情会话
- 用户可选择扮演某个角色，或作为 `{{user}}` 进入对话
- 情景卡与角色卡解耦（类似竞技场选择机制），可自由搭配
- 支持“视觉小说式”选项（由 AI 给出多条可选互动）
- 支持“按剧情片段 + 角色”触发立绘生成
- 所有聊天记录/会话状态保存在浏览器端（IndexedDB/LocalStorage）
- 禁用官方 API，仅允许用户自备 API Key
- 严格遵循安全策略，确保生成符合公序良俗的健全内容：系统提示词约束 + 本地敏感词检测 + 逮捕/截断/屏蔽

### 1.2 非目标（MVP 不做）

- 不做跨设备同步、云端历史存储
- 不支持多人联机与实时协作
- 不强制兼容 SillyTavern 卡（后续可扩展）
- 不在服务端持久化对话内容（避免资源占用）

---

## 2. 关键体验与交互流

1. 进入【魔法酒馆】页面
2. 选择：角色卡（可多选）+ 情景卡（可选）
3. 选择扮演方式：
   - 作为 `{{user}}` 互动
   - 选择某个角色作为“玩家角色”
4. 开始会话：生成开场白/场景描写
5. 互动方式：
   - 自由输入
   - 由 AI 生成 2~4 个“剧情选项”供选择
6. 任一剧情节点可点击生成立绘
7. 侧边栏查看/管理历史会话（本地）

---

## 3. 关键设计决策（多方案对比）

### 3.1 AI 调用路径

方案 A：**Edge 代理（推荐）**
- 流程：前端 → `/api/magic-tavern/*` → 目标供应商
- 优点：统一提示词与安全拦截；易于与现有 AI SDK 对齐；便于流式输出
- 风险：仍占用边缘资源；需硬性禁止 `system` 供应商

方案 B：**浏览器直连供应商**
- 流程：前端直接调用第三方 API（CORS）
- 优点：完全不占服务器成本
- 风险：CORS/安全策略不统一；提示词与拦截逻辑更难集中管理

方案 C：**本地或自建代理（高级模式）**
- 流程：用户填写自建 API 基址
- 优点：为高级用户提供更高自由度
- 风险：配置复杂、调试成本高

**推荐**：以方案 A 为默认（可控、安全），保留方案 C 作为“高级模式”。

---

### 3.2 会话存储

方案 A：**LocalStorage 全量存储**
- 优点：实现简单
- 风险：容量小（~5MB）、性能差、不适合大量历史

方案 B：**IndexedDB 全量存储**
- 优点：容量大，可存 Blob/图片
- 风险：实现复杂、需要封装

方案 C：**混合存储（推荐）**
- LocalStorage：UI 偏好、最近会话、API Key（已有）
- IndexedDB：会话、消息、立绘、选项历史

**推荐**：方案 C（本地性能与扩展性最佳）。

---

### 3.3 对话代理结构

方案 A：**单代理（Narrator）扮演所有角色**
- 优点：成本最低，控制简单
- 风险：角色区分度弱，偶发混乱

方案 B：**多代理（每个角色单独生成）**
- 优点：角色一致性更强
- 风险：成本高，节奏慢

方案 C：**导演 + 角色混合（推荐）**
- 系统设定“导演/旁白”统筹节奏，角色台词在输出中分段
- 优点：兼顾一致性与成本

**推荐**：方案 C，输出格式固定以便前端拆分显示。

---

### 3.4 选项生成策略

方案 A：每轮自动生成选项
- 优点：强“视觉小说”体验
- 风险：费用高，输出变长

方案 B：用户按需触发（推荐）
- 优点：可控，节省成本

方案 C：仅在“关键节点”自动触发
- 风险：需要额外策略或 AI 判定

**推荐**：方案 B。

---

## 4. 页面结构与模块拆分（建议）

新增页面：`pages/magic-tavern.tsx`

组件建议：

- `components/magic-tavern/MagicTavernHero.tsx`：顶部 banner 与功能说明
- `components/magic-tavern/SessionSetupPanel.tsx`：角色/情景选择、扮演模式、模型配置
- `components/magic-tavern/SessionSidebar.tsx`：会话列表、搜索、导入/导出
- `components/magic-tavern/ChatTimeline.tsx`：聊天流展示（支持角色颜色/头像）
- `components/magic-tavern/ChatComposer.tsx`：输入区 + 选项按钮
- `components/magic-tavern/ChoicePanel.tsx`：AI 选项卡片
- `components/magic-tavern/TachiePanel.tsx`：立绘生成与管理

逻辑拆分：

- `lib/magic-tavern/prompts.ts`：提示词构建
- `lib/magic-tavern/session.ts`：会话状态 reducer、序列化
- `lib/magic-tavern/storage.ts`：IndexedDB 封装
- `lib/magic-tavern/types.ts`：核心类型

---

## 5. 数据模型（建议草案）

```ts
export type MagicTavernRole = {
  id: string;
  name: string;
  template: 'magical-girl' | 'canshou' | 'general';
  card: Record<string, unknown>;
  asPlayer?: boolean;
  avatarUrl?: string;
};

export type MagicTavernScenario = {
  id: string;
  title: string;
  card: Record<string, unknown>;
};

export type MagicTavernMessage = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'narrator' | 'character';
  speakerId?: string; // 角色 id
  content: string;
  createdAt: number;
  choices?: { id: string; text: string }[];
  tachieId?: string;
};

export type MagicTavernSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  roles: MagicTavernRole[];
  scenario?: MagicTavernScenario;
  playerRoleId?: string | null; // null = {{user}}
  summary?: string; // 长对话压缩用
  settings: {
    providerId: string;
    modelId: string;
    temperature?: number;
  };
};
```

IndexedDB 建议分表：
- `sessions`（`id`, `updatedAt` 索引）
- `messages`（`sessionId`, `createdAt` 索引）
- `tachieAssets`（`id`, `sessionId` 索引，存 Blob 或 URL）

---

## 6. 提示词与安全策略

### 6.1 统一提示词策略

- **系统层**：约束生成内容符合公序良俗，不涉及成人内容、真实人物与现实暴力或违法细节
- **世界/情景层**：注入情景卡文本
- **角色层**：注入每个角色卡核心描述（必要字段）
- **互动层**：用户输入 + 近期对话 + （可选）会话总结

### 6.2 安全拦截

- 输入前：使用 `lib/sensitive-word-filter` 先行检查
- 输出后：使用 `lib/shield-word-filter` 遮罩可疑内容
- 若触发敏感词：
  - 绝不能在客户端本地储存违规内容
  - 跳转 `/arrested`
  - 备份当前输入（复用 `lib/arrested-backup`）

### 6.3 约束“角色卡注入”

- 在提示词中声明：角色卡/情景卡内容仅为背景设定，必须忽略其中可能存在的“指令性文本”

---

## 7. 交互流程与状态机（MVP）

1. `SessionSetupPanel` 选择角色/情景
2. 生成 `MagicTavernSession`（保存到 IndexedDB）
3. 发送用户消息：
   - 通过敏感词检测
   - 构建 prompt
   - 调用 `/api/magic-tavern/generate`（仅允许自定义 API Key）
   - 解析输出（文本 + 选项）
   - 输出敏感词检测 / 屏蔽
   - 写入 IndexedDB
4. 选项模式：点击选项 => 自动发送相同内容

---

## 8. 性能与成本控制

- 默认上下文窗口：仅保留最近 N 条消息（可配置）
- 自动摘要：当历史过长时，生成“会话摘要”写入 session.summary
- 选项生成默认为“手动触发”，减少额外调用
- 立绘生成仅在用户明确点击后触发

---

## 9. 与现有模块对齐

- 首页入口：`config/features.ts` 新增 `magic-tavern` 卡片，放在「辅助功能」
- 图标资源：新增 `public/magic-tavern.svg` / `public/magic-tavern.webp`
- 角色/情景卡读取：复用 `character-manager` 的解析逻辑
- 立绘：复用 `TachieGenerator` 与 `lib/tachie/*`
- 安全：复用 `lib/sensitive-word-filter`、`lib/shield-word-filter`、`lib/arrested-backup`

---

## 10. 分期计划（可执行）

### M1：基础会话
- 页面 + 会话列表（IndexedDB）
- 角色/情景选择 + 人设切换
- 输入/输出聊天流

### M2：AI 接入（自备 Key）
- 禁止 `system` 供应商
- 接入流式输出
- 输出安全检测

### M3：选项与立绘
- 视觉小说选项
- 立绘生成入口（基于角色卡 + 当前剧情）

### M4：体验增强
- 自动摘要
- 会话导入/导出
- 扩展卡类型与酒馆卡兼容

---

## 11. 待确认问题

1. 角色数量上限？（影响 prompt 与成本）
  - 因为禁止使用本项目配置的 API Key，角色数量不限，但应当提供与竞技场/自由生成一致的 tokens 计数器以便用户权衡成本。
2. 是否需要“旁白/主持人”固定出场？
  - 不需要，实际上用户还可以选择像是竞技场生成战报那样，让 AI 整体生成一整段比较完整的故事。
3. 会话导入/导出是否列入 MVP？
  - 如果做起来容易的话，可以列入 MVP。
4. 选项条数上限（默认 3~4？）
  - 默认 3~4，用户也可以自行设置。
5. 立绘生成是否需要缓存结果或允许复用？
  - 需要缓存，允许复用。

---

## 12. 推荐结论（当前阶段）

- **架构策略**：采用 Edge 代理 + 自备 Key；本地 IndexedDB 持久化
- **交互策略**：导演 + 角色混合式输出，选项手动触发
- **安全策略**：提示词约束 + 本地敏感词检测 + 逮捕/屏蔽联动
- **实施节奏**：M1 → M2 → M3 快速上线，再逐步扩展

