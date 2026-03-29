# Battle Lite Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/battle` 恢复为面向新用户的简洁单列竞技场页，同时保留 `/arena` 作为完整版，并让两页共享竞技场核心状态与结果链路。

**Architecture:** 新建 `BattleLitePage` 作为简洁页容器，页面结构参考 `2025-09` 的旧 `battle` 页，但底层生成、角色选择、情景读入、结果展示、连续战报会话等逻辑全部优先复用当前 `components/arena/*` 与 `useBattleStore`。为避免完整版隐藏设置“漏”进简洁页，需要增加一层“简洁页默认值归一化”，把语言、字数、高级读写设置、卡片宽度等隐藏能力钉回简洁页预期值。

**Tech Stack:** Next.js Pages Router、React 19、TanStack Query、Zustand persist、Tailwind 4、Bun test

---

## File Map

- Create: `components/arena-lite/BattleLitePage.tsx`
- Create: `components/arena-lite/BattleLiteHeader.tsx`
- Create: `components/arena-lite/BattleLiteScenarioSection.tsx`
- Create: `components/arena-lite/BattleLiteStoryOptions.tsx`
- Create: `components/arena/shared/ArenaPageLinks.tsx`
- Create: `components/arena/shared/ArenaRankingLinks.tsx`
- Create: `components/arena/shared/ArenaCommunitySection.tsx`
- Modify: `pages/battle.tsx`
- Modify: `components/arena/ArenaPage.tsx`
- Modify: `components/arena/stores/useBattleStore.ts`
- Modify: `components/arena/types/index.ts`
- Modify: `components/shared/StoryOptionsPanel.tsx`
- Modify: `components/arena/components/BattleActions.tsx`
- Test: `tests/battle-store-lite-defaults.test.ts`
- Test: `tests/arena-shared-links.test.tsx`
- Test: `tests/story-options-panel-visibility.test.tsx`
- Test: `tests/battle-actions-advanced-toggle.test.tsx`
- Test: `tests/battle-lite-page.test.tsx`

## Task 1: 简洁页默认值归一化与状态边界

**Files:**
- Modify: `components/arena/types/index.ts`
- Modify: `components/arena/stores/useBattleStore.ts`
- Test: `tests/battle-store-lite-defaults.test.ts`

- [ ] **Step 1: 写一个失败用例，锁定简洁页默认值归一化行为**

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

describe('battle lite defaults', () => {
  beforeEach(() => {
    const store = useBattleStore.getState();
    store.setSelectedLanguage('en-US');
    store.setStoryLength('long');
    store.setArenaFreeRankingEnabled(true);
    store.updateSettings({
      readNarrativeHistory: true,
      writeNarrativeHistory: true,
      battleReportCardWidthMode: 'manual',
      battleReportCardWidthPx: 920,
      userGuidance: '保留这个字段',
    });
  });

  test('applyBattleLiteDefaults 会把隐藏高级项收敛到简洁页默认值', () => {
    useBattleStore.getState().applyBattleLiteDefaults();
    const state = useBattleStore.getState();

    expect(state.selectedLanguage).toBe('zh-CN');
    expect(state.storyLength).toBe('default');
    expect(state.arenaFreeRankingEnabled).toBe(false);
    expect(state.settings.readNarrativeHistory).toBe(false);
    expect(state.settings.writeNarrativeHistory).toBe(false);
    expect(state.settings.battleReportCardWidthMode).toBe('manual');
    expect(state.settings.battleReportCardWidthPx).toBe(500);
    expect(state.settings.userGuidance).toBe('保留这个字段');
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test tests/battle-store-lite-defaults.test.ts`
Expected: FAIL，提示 `applyBattleLiteDefaults` 不存在或断言不通过

- [ ] **Step 3: 在类型定义里补上简洁页默认值 action**

```ts
export interface BattleStoreState {
  // ...
  applyBattleLiteDefaults: () => void;
}
```

- [ ] **Step 4: 在 store 中实现 `applyBattleLiteDefaults`**

实现要求：

- 把隐藏能力归一化到简洁页默认值
- 保留以下“用户看得见”的状态：
  - `combatants`
  - `teams`
  - `scenario`
  - `battleMode`
  - `generationMode`
  - `settings.userGuidance`
  - `userProviderConfig`
  - 当前结果与连续战报相关状态

```ts
applyBattleLiteDefaults: () =>
  set((state) => ({
    selectedLanguage: 'zh-CN',
    storyLength: 'default',
    arenaFreeRankingEnabled: false,
    selectedQuestionnaires: [],
    settings: {
      ...state.settings,
      readArenaHistory: true,
      readArenaHistoryLimit: 3,
      isArenaHistoryUnlimited: false,
      writeArenaHistory: true,
      readCurrentState: true,
      writeCurrentState: true,
      readNarrativeHistory: false,
      readNarrativeHistoryLimit: 10,
      isNarrativeHistoryUnlimited: false,
      writeNarrativeHistory: false,
      battleReportCardWidthMode: 'manual',
      battleReportCardWidthPx: 500,
    },
  })),
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `bun test tests/battle-store-lite-defaults.test.ts`
Expected: PASS

- [ ] **Step 6: 提交这一小步**

```bash
git add components/arena/types/index.ts components/arena/stores/useBattleStore.ts tests/battle-store-lite-defaults.test.ts
git commit -m "feat: add battle lite state defaults"
```

## Task 2: 抽出双页共用的导航、排行榜入口与社区区块

**Files:**
- Create: `components/arena/shared/ArenaPageLinks.tsx`
- Create: `components/arena/shared/ArenaRankingLinks.tsx`
- Create: `components/arena/shared/ArenaCommunitySection.tsx`
- Test: `tests/arena-shared-links.test.tsx`

- [ ] **Step 1: 写一个失败用例，锁定共用导航文案**

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test, expect } from 'bun:test';
import { ArenaPageLinks } from '@/components/arena/shared/ArenaPageLinks';

test('简洁版和完整版导航都输出正确入口', () => {
  const liteHtml = renderToStaticMarkup(<ArenaPageLinks variant="lite" />);
  const fullHtml = renderToStaticMarkup(<ArenaPageLinks variant="full" />);

  expect(liteHtml).toContain('/arena');
  expect(liteHtml).toContain('进入完整版竞技场');
  expect(fullHtml).toContain('/battle');
  expect(fullHtml).toContain('切换到简洁版');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test tests/arena-shared-links.test.tsx`
Expected: FAIL，提示模块不存在

- [ ] **Step 3: 实现共用导航组件**

```tsx
type ArenaPageLinksProps = {
  variant: 'lite' | 'full';
};

export function ArenaPageLinks({ variant }: ArenaPageLinksProps) {
  return variant === 'lite' ? (
    <Link href="/arena">进入完整版竞技场</Link>
  ) : (
    <Link href="/battle">切换到简洁版</Link>
  );
}
```

- [ ] **Step 4: 实现排行榜入口组件**

要求：

- 输出与当前完整版一致的两个入口
- 支持 `onOpenRankingModal?: () => void`
- 简洁页和完整版都使用同一份文案

```tsx
export function ArenaRankingLinks(props: {
  onOpenRankingModal?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 text-sm flex-wrap">
      <button type="button" onClick={props.onOpenRankingModal}>快速查看排行榜</button>
      <Link href="/ranking">进入排行榜页</Link>
    </div>
  );
}
```

- [ ] **Step 5: 实现社区区块组件**

要求：

- 直接复用 `lib/communityGroups.ts`
- 文案与当前完整版保持一致
- 简洁页与完整版都用这一个组件渲染

- [ ] **Step 6: 运行测试，确认通过**

Run: `bun test tests/arena-shared-links.test.tsx`
Expected: PASS

- [ ] **Step 7: 提交这一小步**

```bash
git add components/arena/shared/ArenaPageLinks.tsx components/arena/shared/ArenaRankingLinks.tsx components/arena/shared/ArenaCommunitySection.tsx tests/arena-shared-links.test.tsx
git commit -m "feat: share arena page links and community sections"
```

## Task 3: 给现有共享组件加“简洁页裁剪能力”

**Files:**
- Modify: `components/shared/StoryOptionsPanel.tsx`
- Modify: `components/arena/components/BattleActions.tsx`
- Create: `components/arena-lite/BattleLiteStoryOptions.tsx`
- Test: `tests/story-options-panel-visibility.test.tsx`
- Test: `tests/battle-actions-advanced-toggle.test.tsx`

- [ ] **Step 1: 写 `StoryOptionsPanel` 的失败用例**

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'bun:test';
import { StoryOptionsPanel } from '@/components/shared/StoryOptionsPanel';

test('简洁版可以隐藏字数和语言选择', () => {
  const html = renderToStaticMarkup(
    <StoryOptionsPanel
      isGenerating={false}
      enableUserGuidance
      userGuidance=""
      onUserGuidanceChange={() => {}}
      storyLength="default"
      onStoryLengthChange={() => {}}
      selectedLanguage="zh-CN"
      onSelectedLanguageChange={() => {}}
      showStoryLength={false}
      showLanguage={false}
    />
  );

  expect(html).toContain('故事方向引导');
  expect(html).not.toContain('期望字数');
  expect(html).not.toContain('生成语言');
});
```

- [ ] **Step 2: 写 `BattleActions` 的失败用例**

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, mock, test } from 'bun:test';

mock.module('@/components/arena/hooks/useBattleEngine', () => ({
  useBattleEngine: () => ({
    handleGenerate: () => {},
    isGenerating: false,
    isCooldown: false,
    remainingTime: 0,
    providerCooldownMode: null,
    otherRemainingTime: null,
  }),
}));

test('简洁版可隐藏高级叙事历史/上下文估算区块', async () => {
  const { BattleActions } = await import('@/components/arena/components/BattleActions');
  const html = renderToStaticMarkup(<BattleActions showAdvancedUtilities={false} />);
  expect(html).not.toContain('高级：叙事历史 / 上下文估算');
});
```

- [ ] **Step 3: 运行测试，确认当前失败**

Run: `bun test tests/story-options-panel-visibility.test.tsx tests/battle-actions-advanced-toggle.test.tsx`
Expected: FAIL，提示 props 不存在或区块仍被渲染

- [ ] **Step 4: 为 `StoryOptionsPanel` 增加可选显示开关**

新增 props：

- `showStoryLength?: boolean`
- `showLanguage?: boolean`

默认值保持 `true`，避免影响旧调用方。

```tsx
type Props = {
  // ...
  showStoryLength?: boolean;
  showLanguage?: boolean;
};
```

- [ ] **Step 5: 为 `BattleActions` 增加可选隐藏高级工具的 props**

```tsx
interface BattleActionsProps {
  showAdvancedUtilities?: boolean;
}

export function BattleActions({
  showAdvancedUtilities = true,
}: BattleActionsProps) {
  // ...
  return (
    <>
      {/* 生成按钮 */}
      {showAdvancedUtilities ? (
        <CollapsibleSection title="高级：叙事历史 / 上下文估算">
          {/* 现有内容 */}
        </CollapsibleSection>
      ) : null}
    </>
  );
}
```

- [ ] **Step 6: 实现 `BattleLiteStoryOptions`**

要求：

- 只显示：
  - 故事方向引导
  - 自定义 AI 能力提供商
- 不显示：
  - 生成语言
  - 期望字数
  - 问卷 Lore
  - 判定

```tsx
export function BattleLiteStoryOptions() {
  const settings = useBattleStore((state) => state.settings);
  const updateSettings = useBattleStore((state) => state.updateSettings);
  const isGenerating = useBattleStore((state) => state.isGenerating);
  const setUserProviderConfig = useBattleStore((state) => state.setUserProviderConfig);

  return (
    <>
      <StoryOptionsPanel
        isGenerating={isGenerating}
        enableUserGuidance
        userGuidance={settings.userGuidance}
        onUserGuidanceChange={(value) => updateSettings({ userGuidance: value })}
        storyLength="default"
        onStoryLengthChange={() => {}}
        selectedLanguage="zh-CN"
        onSelectedLanguageChange={() => {}}
        showStoryLength={false}
        showLanguage={false}
      />
      <AiProviderSelector onConfigChange={setUserProviderConfig} />
    </>
  );
}
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `bun test tests/story-options-panel-visibility.test.tsx tests/battle-actions-advanced-toggle.test.tsx`
Expected: PASS

- [ ] **Step 8: 提交这一小步**

```bash
git add components/shared/StoryOptionsPanel.tsx components/arena/components/BattleActions.tsx components/arena-lite/BattleLiteStoryOptions.tsx tests/story-options-panel-visibility.test.tsx tests/battle-actions-advanced-toggle.test.tsx
git commit -m "feat: add battle lite option toggles"
```

## Task 4: 实现简洁版头部、情景区与页面主体

**Files:**
- Create: `components/arena-lite/BattleLiteHeader.tsx`
- Create: `components/arena-lite/BattleLiteScenarioSection.tsx`
- Create: `components/arena-lite/BattleLitePage.tsx`
- Modify: `pages/battle.tsx`
- Test: `tests/battle-lite-page.test.tsx`

- [ ] **Step 1: 写一个失败用例，锁定简洁版头部与主流程存在**

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, mock, test } from 'bun:test';

mock.module('@/components/arena/hooks/useArenaData', () => ({
  usePresetQuery: () => ({ grouped: { magicalGirl: [], canshou: [] }, isLoading: false, error: null }),
}));

test('BattleLitePage 会输出简洁版说明、预设角色区块和完整版入口', async () => {
  const { BattleLitePage } = await import('@/components/arena-lite/BattleLitePage');
  const html = renderToStaticMarkup(<BattleLitePage />);

  expect(html).toContain('这是简洁版');
  expect(html).toContain('基于 2025 年 9 月版本');
  expect(html).toContain('🎴 预设角色');
  expect(html).toContain('/arena');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test tests/battle-lite-page.test.tsx`
Expected: FAIL，提示页面组件不存在

- [ ] **Step 3: 实现 `BattleLiteHeader`**

要求：

- 明确写出“简洁版”
- 标注“基于 2025 年 9 月版本”
- 提供进入完整版竞技场入口
- 保留使用须知与百科链接

```tsx
export function BattleLiteHeader() {
  return (
    <>
      <ThemeImage ... />
      <p>这是简洁版，基于 2025 年 9 月版本调整，并适配当前后端。</p>
      <ArenaPageLinks variant="lite" />
      <CollapsibleSection title="📰 使用须知" defaultOpen>
        {/* 更新后的说明 */}
      </CollapsibleSection>
    </>
  );
}
```

- [ ] **Step 4: 实现 `BattleLiteScenarioSection`**

要求：

- 只保留主情景能力
- 复用 `ScenarioPickerPanel`
- 不显示辅助情景、预设情景、辅助情景上传/排序

```tsx
export function BattleLiteScenarioSection(props: {
  onOpenScenarioModal: () => void;
  onRandomMatchScenario: () => void;
  isAuthenticated: boolean;
}) {
  const scenario = useBattleStore((state) => state.scenario);
  const isGenerating = useBattleStore((state) => state.isGenerating);
  const isMatching = useBattleStore((state) => state.isMatching);
  const setError = useBattleStore((state) => state.setError);
  const { handleScenarioUpload, handleScenarioPaste } = useBattleActions();

  return (
    <ScenarioPickerPanel
      onOpenScenarioModal={props.onOpenScenarioModal}
      onRandomMatchScenario={props.onRandomMatchScenario}
      onScenarioUpload={handleScenarioUpload}
      onScenarioPaste={handleScenarioPaste}
      onActionError={(error) => setError(`❌ ${error.message}`)}
      isAuthenticated={props.isAuthenticated}
      isGenerating={isGenerating}
      isMatchingBlocked={isMatching !== null}
      isMatchingScenario={isMatching === 'scenario'}
      scenarioFileName={scenario.fileName}
      isScenarioNative={scenario.isNative}
    />
  );
}
```

- [ ] **Step 5: 实现 `BattleLitePage`**

页面要求：

- 单列主卡片
- `applyBattleLiteDefaults()` 在 mount 时执行一次
- 首屏顺序固定为：
  - 头部与说明
  - 排行榜入口
  - 预设角色（独立区块）
  - 在线角色库 / 随机匹配
  - 本地导入
  - 已选角色 / 分队
  - 模式选择
  - 情景设置（仅情景模式）
  - 故事方向引导 + 自定义 AI 提供商
  - 生成方式
  - 开始生成（隐藏高级工具）
  - 社区
- 主卡片下方直接放：
  - `BattleResult`
  - `BattleStorySessionPanel`

```tsx
export function BattleLitePage() {
  useEffect(() => {
    useBattleStore.getState().applyBattleLiteDefaults();
  }, []);

  return (
    <div className="magic-background-white">
      <div className="mx-auto w-full max-w-[720px] px-4 pb-8 pt-6">
        <div className="rounded-[28px] border p-5 sm:p-6">
          <BattleLiteHeader />
          <ArenaRankingLinks onOpenRankingModal={() => setShowRankingModal(true)} />
          <CollapsibleSection title="🎴 预设角色" defaultOpen>
            <PresetSelector />
          </CollapsibleSection>
          <CollapsibleSection title="🌐 在线角色库 / 随机匹配" defaultOpen>
            <DatabaseSelector layout="column" ... />
          </CollapsibleSection>
          {/* 其余主流程 */}
          <CollapsibleSection title="🚀 开始生成" collapsible={false}>
            <BattleActions showAdvancedUtilities={false} />
          </CollapsibleSection>
          <CollapsibleSection title="💬 社区" defaultOpen={false}>
            <ArenaCommunitySection />
          </CollapsibleSection>
        </div>

        <BattleResult onSaveImage={handleSaveImage} />
        <BattleStorySessionPanel onSaveImage={handleSaveImage} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 把 `pages/battle.tsx` 改为简洁版入口**

```tsx
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BattleLitePage } from '@/components/arena-lite/BattleLitePage';

export default function Battle() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <BattleLitePage />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `bun test tests/battle-lite-page.test.tsx`
Expected: PASS

- [ ] **Step 8: 提交这一小步**

```bash
git add components/arena-lite/BattleLiteHeader.tsx components/arena-lite/BattleLiteScenarioSection.tsx components/arena-lite/BattleLitePage.tsx pages/battle.tsx tests/battle-lite-page.test.tsx
git commit -m "feat: add battle lite page shell"
```

## Task 5: 在完整版 `/arena` 中接入简洁版入口并完成总体验证

**Files:**
- Modify: `components/arena/ArenaPage.tsx`
- Create: `tests/arena-full-page-links.test.tsx` (可选；若 `tests/arena-shared-links.test.tsx` 已覆盖可不新建)

- [ ] **Step 1: 在完整版页头接入“切换到简洁版”入口**

要求：

- 入口位置与排行榜入口同层
- 不影响现有排行榜弹窗按钮
- 文案明确是“简洁版”

```tsx
<div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
  <ArenaPageLinks variant="full" />
  <ArenaRankingLinks onOpenRankingModal={() => setShowRankingModal(true)} />
</div>
```

- [ ] **Step 2: 用共享社区组件替换完整版内联社区区块**

目标：

- 让 `/battle` 和 `/arena` 的社区内容保持同源
- 避免后续一边更新一边遗漏

- [ ] **Step 3: 运行定向测试**

Run: `bun test tests/arena-shared-links.test.tsx tests/battle-store-lite-defaults.test.ts tests/story-options-panel-visibility.test.tsx tests/battle-actions-advanced-toggle.test.tsx tests/battle-lite-page.test.tsx`
Expected: PASS

- [ ] **Step 4: 运行 lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 5: 运行构建检查**

Run: `bun run build`
Expected: PASS

- [ ] **Step 6: 提交收尾**

```bash
git add components/arena/ArenaPage.tsx
git commit -m "feat: link arena full page with battle lite page"
```

## Notes

- 简洁页保留“预设角色”独立区块，不要并回在线角色库或本地导入。
- 简洁页首屏保留“快速查看排行榜 / 进入排行榜页”。
- 简洁页底部扩展区不额外加总标题，直接延续当前结果区与连续战报区域的表现方式。
- 简洁页不应出现以下显式控件：
  - 平均等级
  - 生成语言
  - 轻量模型开关
  - 问卷 Lore
  - 判定编辑器
  - 辅助情景
  - 排位快捷设置
  - 高级读写设置

