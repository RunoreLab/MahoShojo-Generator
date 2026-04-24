# Custom Story Length Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留预设档位的同时，为竞技场与 PVP 共用的故事选项增加“自定义目标字数”输入，并把该值稳定透传到生成链路。

**Architecture:** 保留既有 `storyLength` 枚举作为预设档位，新增独立 `customStoryLength` 字段承载用户输入的正整数文本。前端共享面板负责交互与基础数字过滤，接口与提示词层优先使用自定义值，连续战报会话与 PVP 规则同步携带该字段。

**Tech Stack:** Next.js Pages Router, React 19, Zustand, TypeScript, Bun test

---

### Task 1: 写失败测试，锁定新增行为

**Files:**
- Modify: `tests/story-options-panel-visibility.test.tsx`
- Modify: `tests/arena-prompt-builder.test.ts`
- Modify: `tests/pvp-parse-rules.test.ts`
- Modify: `tests/ai-session/battle-story-generate-next.test.ts`
- Modify: `tests/arena/battle-story-session-utils.test.ts`
- Modify: `tests/battle-lite-inherited-summary.test.ts`

- [ ] 增加共享面板对自定义字数输入的渲染断言
- [ ] 增加 prompt builder 优先使用自定义字数的断言
- [ ] 增加 PVP 规则解析对 `customStoryLength` 的保留与清洗断言
- [ ] 增加连续战报 generate-next 对 `customStoryLength` 透传断言
- [ ] 增加轻量页摘要对自定义字数展示断言

### Task 2: 实现前端共享状态与交互

**Files:**
- Modify: `components/shared/StoryOptionsPanel.tsx`
- Modify: `components/arena/types/index.ts`
- Modify: `components/arena/stores/useBattleStore.ts`
- Modify: `components/arena/components/StoryOptions.tsx`
- Modify: `components/arena-lite/BattleLiteStoryOptions.tsx`
- Modify: `components/arena-lite/battle-lite-inherited-summary.ts`

- [ ] 为竞技场共享状态增加 `customStoryLength`
- [ ] 在共用面板中新增“自定义”入口和数字输入框
- [ ] 预设按钮与自定义输入互斥，切回预设时清空自定义值
- [ ] 轻量页摘要在存在自定义值时展示自定义文案

### Task 3: 实现接口、连续战报与 PVP 透传

**Files:**
- Modify: `lib/arena/logic.ts`
- Modify: `pages/api/arena/generate.ts`
- Modify: `pages/api/arena/generate-stream.ts`
- Modify: `pages/api/generate-battle-story.ts`
- Modify: `lib/ai-session/battle-story/types.ts`
- Modify: `components/arena/utils/battleStorySession.ts`
- Modify: `components/arena/hooks/useBattleStorySession.ts`
- Modify: `pages/api/arena/session/generate-next.ts`
- Modify: `lib/pvp/types.ts`
- Modify: `lib/pvp/defaults.ts`
- Modify: `lib/pvp/validate.ts`
- Modify: `components/pvp/PvpRoomPage.tsx`
- Modify: `components/pvp/PvpSettlementCard.tsx`

- [ ] 提示词拼接优先输出自定义目标字数
- [ ] 竞技场同步/流式接口接受并记录自定义值
- [ ] 连续战报会话 source/seed/generate-next 请求同步自定义值
- [ ] PVP 规则校验、设置页、展示文案同步自定义值

### Task 4: 验证

**Files:**
- Test: `tests/story-options-panel-visibility.test.tsx`
- Test: `tests/arena-prompt-builder.test.ts`
- Test: `tests/pvp-parse-rules.test.ts`
- Test: `tests/ai-session/battle-story-generate-next.test.ts`
- Test: `tests/arena/battle-story-session-utils.test.ts`
- Test: `tests/battle-lite-inherited-summary.test.ts`

- [ ] 先跑新增/修改的测试文件，确认红绿循环成立
- [ ] 再跑 `bun test` 相关子集确认无回归
- [ ] 跑 `bun run lint`
