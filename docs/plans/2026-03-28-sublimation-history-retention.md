# 成长升华历战保留策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `/sublimation` 增加可配置的历战保留策略，让非流式与流式最终下载/保存的 JSON 都按同一套 `arena_history` 写回规则落地。

**Architecture:** 把“历战写回语义”从 `pages/api/generate-sublimation.ts` 内联逻辑中抽离到 `lib/sublimation/arena-history.ts`，并在非流式结构化结果与流式最终卡组装两条链路上复用。页面层只负责状态、偏好与控件展示；流式链路继续显示 Markdown/通用角色卡，但最终保存用 JSON 通过新的 stream-result helper 补齐 `arena_history` 与运行态字段，避免继续丢历史。

**Tech Stack:** Next.js Pages Router、React 19、TypeScript strict、Cloudflare Edge Runtime、Bun test、localStorage、Markdown 卡组装 helper

---

## 文件结构与职责

**共享历战语义**

- Create: `lib/sublimation/arena-history.ts`
  - 定义 `ArenaHistoryRetentionStrategy`
  - 统一 `keep-all / keep-sublimation-only / reset-all` 三种策略的归一化、标签/说明文案与 `arena_history` 写回逻辑
  - 提供“新增升华记录”构造函数，供非流式与流式共用

**非流式结构化结果组装**

- Create: `lib/sublimation/finalize.ts`
  - 承载非流式 `sublimatedData` 的最终组装逻辑
  - 负责合并 AI 结果、重应用不可变字段、按策略写回 `arena_history`、保留/同步 `current_state`
- Modify: `pages/api/generate-sublimation.ts`
  - 解析 `arenaHistoryRetentionStrategy`
  - 调用 `buildFinalSublimationData`
  - 移除当前 handler 内联的“只保留升华记录”写死逻辑

**流式最终 JSON 组装**

- Create: `lib/sublimation/stream-result.ts`
  - 从流式 Markdown 解析“升华事件”标题/影响
  - 基于源卡 + Markdown 组装最终下载/保存用通用角色卡
  - 按共享策略写回 `arena_history`，并保留现有 `current_state`
- Modify: `pages/api/generate-sublimation-stream.ts`
  - 解析并剔除 `arenaHistoryRetentionStrategy`，避免它混入 `originalCharacterData`
- Modify: `pages/sublimation.tsx`
  - 用 `buildStreamedSublimationResultCard` 代替当前直接 `buildGeneralCharacterCardFromMarkdown + resign` 的最终结果组装

**页面控件与偏好**

- Create: `lib/sublimation/preferences.ts`
  - 封装升华“资料读写策略”偏好的读取/写入，补上 `arenaHistoryRetentionStrategy`
- Create: `components/shared/SublimationArenaHistoryStrategyFieldset.tsx`
  - 把“历战记录”这组控件抽成小组件，减少 `pages/sublimation.tsx` 继续膨胀
- Modify: `pages/sublimation.tsx`
  - 新增 retention strategy state
  - 将策略纳入本地偏好与请求 payload
  - 在流式结果区增加“预览不展示历史元数据，下载/保存已按策略写回”的提示

**文档**

- Modify: `public/encyclopedia/sublimation.md`
  - 补充三种历战保留策略与默认行为说明

**测试**

- Create: `tests/sublimation-arena-history.test.ts`
  - 共享历战写回 helper
- Create: `tests/sublimation-finalize.test.ts`
  - 非流式最终结果组装 helper
- Create: `tests/sublimation-stream-result.test.ts`
  - 流式 Markdown -> 最终 JSON helper
- Create: `tests/sublimation-preferences.test.ts`
  - localStorage 偏好读写
- Create: `tests/sublimation-history-strategy-fieldset.test.tsx`
  - 历战策略控件渲染

---

### Task 1: 提取共享历战保留策略 helper

**Files:**
- Create: `lib/sublimation/arena-history.ts`
- Test: `tests/sublimation-arena-history.test.ts`

- [ ] **Step 1: 先写共享 helper 的失败测试**

创建 `tests/sublimation-arena-history.test.ts`：

```ts
import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY,
  applySublimationArenaHistoryStrategy,
  buildSublimationHistoryEntry,
  normalizeArenaHistoryRetentionStrategy,
} from '@/lib/sublimation/arena-history';

const sourceHistory = {
  attributes: {
    world_line_id: 'world-old',
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-10T00:00:00.000Z',
    sublimation_count: 2,
    last_sublimation_at: '2026-03-10T00:00:00.000Z',
  },
  entries: [
    { id: 4, type: 'battle', title: '普通对战', impact: '留下旧伤' },
    { id: 8, type: 'sublimation', title: '一转', impact: '觉醒' },
  ],
};

describe('sublimation arena history retention', () => {
  test('keep-all: 保留全部历史并追加新的升华记录', () => {
    const entry = buildSublimationHistoryEntry({
      title: '二转',
      impact: '完成蜕变',
      participantsName: '白百合',
      finalUserGuidance: null,
      hasQuestionnaireLore: false,
      questionnaireSelectionCount: 0,
      nonNativeDataInvolved: false,
    });

    const result = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: sourceHistory,
      strategy: 'keep-all',
      newEntry: entry,
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-new',
    });

    expect(result.attributes.world_line_id).toBe('world-old');
    expect(result.attributes.sublimation_count).toBe(3);
    expect(result.entries.map((item: any) => item.type)).toEqual(['battle', 'sublimation', 'sublimation']);
    expect(result.entries[2]?.id).toBe(9);
  });

  test('keep-sublimation-only: 只保留升华记录并追加新记录', () => {
    const result = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: sourceHistory,
      strategy: 'keep-sublimation-only',
      newEntry: buildSublimationHistoryEntry({
        title: '二转',
        impact: '完成蜕变',
        participantsName: '白百合',
        finalUserGuidance: '朝守护方向成长',
        hasQuestionnaireLore: true,
        questionnaireSelectionCount: 2,
        nonNativeDataInvolved: true,
      }),
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-new',
    });

    expect(result.attributes.world_line_id).toBe('world-old');
    expect(result.entries.map((item: any) => item.type)).toEqual(['sublimation', 'sublimation']);
    expect(result.entries[1]?.metadata?.user_guidance).toBe('朝守护方向成长');
  });

  test('reset-all: 仅保留本次升华记录并重置世界线', () => {
    const result = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: sourceHistory,
      strategy: 'reset-all',
      newEntry: buildSublimationHistoryEntry({
        title: '新世界线开端',
        impact: '抹去旧战痕后重生',
        participantsName: '白百合',
        finalUserGuidance: null,
        hasQuestionnaireLore: false,
        questionnaireSelectionCount: 0,
        nonNativeDataInvolved: true,
      }),
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-reset',
    });

    expect(result.attributes.world_line_id).toBe('world-reset');
    expect(result.attributes.created_at).toBe('2026-03-28T10:00:00.000Z');
    expect(result.attributes.sublimation_count).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.id).toBe(1);
  });

  test('非法策略值回退为默认 keep-sublimation-only', () => {
    expect(normalizeArenaHistoryRetentionStrategy('  ???  ')).toBe(DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY);
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test tests/sublimation-arena-history.test.ts`
Expected: FAIL，提示 `@/lib/sublimation/arena-history` 不存在

- [ ] **Step 3: 实现共享历战保留策略 helper**

创建 `lib/sublimation/arena-history.ts`：

```ts
import { randomUUID } from '@/lib/crypto';

export type ArenaHistoryRetentionStrategy =
  | 'keep-all'
  | 'keep-sublimation-only'
  | 'reset-all';

export const DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY: ArenaHistoryRetentionStrategy =
  'keep-sublimation-only';

export const ARENA_HISTORY_RETENTION_LABELS: Record<ArenaHistoryRetentionStrategy, string> = {
  'keep-all': '保留全部历史',
  'keep-sublimation-only': '只保留升华记录',
  'reset-all': '清空全部历史',
};

export const ARENA_HISTORY_RETENTION_DESCRIPTIONS: Record<ArenaHistoryRetentionStrategy, string> = {
  'keep-all': '保留全部既有历战，并追加本次升华记录',
  'keep-sublimation-only': '仅保留历次升华记录，并追加本次升华记录',
  'reset-all': '清空既有历战，仅保留本次升华记录，并重置世界线',
};

type SublimationHistoryEntryInput = {
  title: string;
  impact: string;
  participantsName: string | null;
  finalUserGuidance: string | null;
  hasQuestionnaireLore: boolean;
  questionnaireSelectionCount: number;
  nonNativeDataInvolved: boolean;
};

type ApplySublimationArenaHistoryStrategyInput = {
  sourceArenaHistory: unknown;
  strategy: ArenaHistoryRetentionStrategy;
  newEntry: Record<string, unknown>;
  nowISO: string;
  createWorldLineId?: () => string;
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const readEntries = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>;
};

const getNextEntryId = (entries: Array<Record<string, unknown>>): number => {
  return entries.reduce((max, entry) => {
    const raw = entry.id;
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0) + 1;
};

export const normalizeArenaHistoryRetentionStrategy = (value: unknown): ArenaHistoryRetentionStrategy => {
  if (value === 'keep-all' || value === 'keep-sublimation-only' || value === 'reset-all') return value;
  return DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY;
};

export const buildSublimationHistoryEntry = (input: SublimationHistoryEntryInput) => ({
  type: 'sublimation',
  title: input.title,
  participants: input.participantsName ? [input.participantsName] : [],
  winner: input.participantsName ?? '未知角色',
  impact: input.impact,
  metadata: {
    user_guidance: input.finalUserGuidance,
    scenario_title: null,
    non_native_data_involved: input.nonNativeDataInvolved,
    questionnaire_lore_used: input.hasQuestionnaireLore,
    questionnaire_selection_count: input.questionnaireSelectionCount,
  },
});

export const applySublimationArenaHistoryStrategy = (
  input: ApplySublimationArenaHistoryStrategyInput,
) => {
  const createWorldLineId = input.createWorldLineId ?? randomUUID;
  const history = toRecord(input.sourceArenaHistory);
  const attributes = toRecord(history.attributes);
  const sourceEntries = readEntries(history.entries);

  const retainedEntries =
    input.strategy === 'keep-all'
      ? cloneJson(sourceEntries)
      : input.strategy === 'keep-sublimation-only'
        ? cloneJson(sourceEntries.filter((entry) => entry.type === 'sublimation'))
        : [];

  const nextEntry = {
    ...cloneJson(input.newEntry),
    id: getNextEntryId(retainedEntries),
  };

  const nextAttributes =
    input.strategy === 'reset-all'
      ? {
          world_line_id: createWorldLineId(),
          created_at: input.nowISO,
          updated_at: input.nowISO,
          sublimation_count: 1,
          last_sublimation_at: input.nowISO,
        }
      : {
          world_line_id:
            typeof attributes.world_line_id === 'string' && attributes.world_line_id
              ? attributes.world_line_id
              : createWorldLineId(),
          created_at:
            typeof attributes.created_at === 'string' && attributes.created_at
              ? attributes.created_at
              : input.nowISO,
          updated_at: input.nowISO,
          sublimation_count:
            typeof attributes.sublimation_count === 'number'
              ? attributes.sublimation_count + 1
              : Number(attributes.sublimation_count ?? 0) + 1 || 1,
          last_sublimation_at: input.nowISO,
        };

  return {
    attributes: nextAttributes,
    entries: [...retainedEntries, nextEntry],
  };
};
```

- [ ] **Step 4: 运行测试，确认 helper 通过**

Run: `bun test tests/sublimation-arena-history.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/sublimation/arena-history.ts tests/sublimation-arena-history.test.ts
git commit -m "feat: add sublimation arena history retention helper"
```

---

### Task 2: 提取非流式最终结果组装 helper，并接入结构化升华 API

**Files:**
- Create: `lib/sublimation/finalize.ts`
- Modify: `pages/api/generate-sublimation.ts:680-704`
- Modify: `pages/api/generate-sublimation.ts:888-1014`
- Test: `tests/sublimation-finalize.test.ts`

- [ ] **Step 1: 先写非流式最终结果组装的失败测试**

创建 `tests/sublimation-finalize.test.ts`：

```ts
import { describe, expect, test } from 'bun:test';

import { buildFinalSublimationData } from '@/lib/sublimation/finalize';

describe('buildFinalSublimationData', () => {
  test('writeArenaHistory=true 且 keep-all 时保留原始 battle 历史', () => {
    const result = buildFinalSublimationData({
      originalCharacterData: {
        codename: '白百合',
        arena_history: {
          attributes: {
            world_line_id: 'world-old',
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-10T00:00:00.000Z',
            sublimation_count: 1,
            last_sublimation_at: '2026-03-10T00:00:00.000Z',
          },
          entries: [
            { id: 1, type: 'battle', title: '普通对战', impact: '留下旧伤' },
          ],
        },
      },
      baseOutputData: { templateId: '魔法少女/心之花/魔法少女（问卷生成）', codename: '白百合' },
      updatedDataFromAI: {},
      targetTemplate: 'magical-girl',
      allowReshapeNames: false,
      writeArenaHistory: true,
      writeCurrentState: false,
      arenaHistoryRetentionStrategy: 'keep-all',
      sublimationEvent: { title: '二转', impact: '完成蜕变' },
      finalUserGuidance: null,
      hasNarrativeHistory: false,
      hasQuestionnaireLore: false,
      hasNonNativeQuestionnaireLore: false,
      questionnaireSelectionCount: 0,
      isNative: true,
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-new',
    });

    expect(result.arena_history.entries.map((item: any) => item.type)).toEqual(['battle', 'sublimation']);
    expect(result.arena_history.attributes.world_line_id).toBe('world-old');
  });

  test('writeArenaHistory=false 时完整保留原始 arena_history', () => {
    const sourceHistory = {
      attributes: { world_line_id: 'world-old' },
      entries: [{ id: 1, type: 'battle', title: '普通对战', impact: '留下旧伤' }],
    };

    const result = buildFinalSublimationData({
      originalCharacterData: {
        codename: '白百合',
        arena_history: sourceHistory,
      },
      baseOutputData: { templateId: '魔法少女/心之花/魔法少女（问卷生成）', codename: '白百合' },
      updatedDataFromAI: {},
      targetTemplate: 'magical-girl',
      allowReshapeNames: false,
      writeArenaHistory: false,
      writeCurrentState: false,
      arenaHistoryRetentionStrategy: 'reset-all',
      sublimationEvent: { title: '不会写入', impact: '不会生效' },
      finalUserGuidance: null,
      hasNarrativeHistory: false,
      hasQuestionnaireLore: false,
      hasNonNativeQuestionnaireLore: false,
      questionnaireSelectionCount: 0,
      isNative: false,
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-reset',
    });

    expect(result.arena_history).toEqual(sourceHistory);
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test tests/sublimation-finalize.test.ts`
Expected: FAIL，提示 `@/lib/sublimation/finalize` 不存在

- [ ] **Step 3: 实现非流式最终结果组装 helper**

创建 `lib/sublimation/finalize.ts`：

```ts
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';
import {
  applySublimationArenaHistoryStrategy,
  buildSublimationHistoryEntry,
  type ArenaHistoryRetentionStrategy,
} from '@/lib/sublimation/arena-history';

type SupportedTargetTemplate = 'magical-girl' | 'canshou' | 'general';

type BuildFinalSublimationDataInput = {
  originalCharacterData: any;
  baseOutputData: any;
  updatedDataFromAI: any;
  targetTemplate: SupportedTargetTemplate;
  allowReshapeNames: boolean;
  writeArenaHistory: boolean;
  writeCurrentState: boolean;
  arenaHistoryRetentionStrategy: ArenaHistoryRetentionStrategy;
  sublimationEvent: { title: string; impact: string };
  finalUserGuidance: string | null;
  hasNarrativeHistory: boolean;
  hasQuestionnaireLore: boolean;
  hasNonNativeQuestionnaireLore: boolean;
  questionnaireSelectionCount: number;
  isNative: boolean;
  nowISO?: string;
  createWorldLineId?: () => string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const safeDeepMerge = (target: any, source: any): any => {
  const output = { ...target };
  if (!isObject(target) || !isObject(source)) return output;
  Object.keys(source).forEach((key) => {
    if (isObject(source[key]) && key in target && isObject(target[key])) {
      output[key] = safeDeepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  });
  return output;
};

export const buildFinalSublimationData = (input: BuildFinalSublimationDataInput) => {
  const nowISO = input.nowISO ?? new Date().toISOString();
  const out = cloneJson(input.baseOutputData ?? {});

  if (!out.templateId) {
    out.templateId =
      input.targetTemplate === 'magical-girl'
        ? '魔法少女/心之花/魔法少女（问卷生成）'
        : input.targetTemplate === 'canshou'
          ? '魔法少女/心之花/残兽（问卷生成）'
          : GENERAL_CHARACTER_TEMPLATE_ID;
  }

  Object.assign(out, safeDeepMerge(out, input.updatedDataFromAI ?? {}));

  if (input.targetTemplate === 'magical-girl' && !input.allowReshapeNames) {
    const baseMagicName = input.baseOutputData?.magicConstruct?.name;
    const baseWonderlandName = input.baseOutputData?.wonderlandRule?.name;
    const baseBloomingName = input.baseOutputData?.blooming?.name;
    if (baseMagicName && out.magicConstruct) out.magicConstruct.name = baseMagicName;
    if (baseWonderlandName && out.wonderlandRule) out.wonderlandRule.name = baseWonderlandName;
    if (baseBloomingName && out.blooming) out.blooming.name = baseBloomingName;
  }

  if (input.writeArenaHistory) {
    const participantsName = input.targetTemplate === 'magical-girl' ? out.codename : out.name;
    out.arena_history = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: input.originalCharacterData?.arena_history ?? out.arena_history,
      strategy: input.arenaHistoryRetentionStrategy,
      newEntry: buildSublimationHistoryEntry({
        title: input.sublimationEvent.title,
        impact: input.sublimationEvent.impact,
        participantsName: typeof participantsName === 'string' ? participantsName : null,
        finalUserGuidance: input.finalUserGuidance,
        hasQuestionnaireLore: input.hasQuestionnaireLore,
        questionnaireSelectionCount: input.questionnaireSelectionCount,
        nonNativeDataInvolved:
          !input.isNative ||
          Boolean(input.finalUserGuidance) ||
          input.hasNarrativeHistory ||
          input.hasNonNativeQuestionnaireLore,
      }),
      nowISO,
      createWorldLineId: input.createWorldLineId,
    });
  } else if (input.originalCharacterData?.arena_history) {
    out.arena_history = cloneJson(input.originalCharacterData.arena_history);
  }

  if (input.writeCurrentState) {
    if (out.current_state) {
      const preservedFields = Array.isArray(input.originalCharacterData?.current_state?.fields)
        ? cloneJson(input.originalCharacterData.current_state.fields)
        : Array.isArray(out.current_state.fields)
          ? cloneJson(out.current_state.fields)
          : [];
      out.current_state.fields = preservedFields;
      out.current_state.updated_at = nowISO;
    }
  } else if (input.originalCharacterData?.current_state) {
    out.current_state = cloneJson(input.originalCharacterData.current_state);
  } else {
    delete out.current_state;
  }

  return out;
};
```

- [ ] **Step 4: 用 helper 替换非流式 API 内联逻辑**

修改 `pages/api/generate-sublimation.ts`，在 request body 解构中显式加入 `arenaHistoryRetentionStrategy`，并调用新的 helper：

```ts
import {
  buildFinalSublimationData,
} from '@/lib/sublimation/finalize';
import {
  normalizeArenaHistoryRetentionStrategy,
} from '@/lib/sublimation/arena-history';

// body 解构阶段
const {
  language = 'zh-CN',
  userGuidance = '',
  narrativeHistory = '',
  fieldsToPreserve = [],
  isDowngrade = false,
  allowReshapeNames = false,
  customProvider: customProviderPayload,
  targetTemplate: requestedTargetTemplate,
  sourceTemplate: requestedSourceTemplate,
  readArenaHistory,
  writeArenaHistory,
  readCurrentState,
  writeCurrentState,
  arenaHistoryRetentionStrategy,
  questionnaireSelections: rawQuestionnaireSelections,
  questionnaires: rawQuestionnaires,
  ...originalCharacterData
} = body;

const resolvedArenaHistoryRetentionStrategy =
  normalizeArenaHistoryRetentionStrategy(arenaHistoryRetentionStrategy);

// 生成结束后
const sublimatedData = buildFinalSublimationData({
  originalCharacterData,
  baseOutputData,
  updatedDataFromAI,
  targetTemplate,
  allowReshapeNames: resolvedAllowReshapeNames,
  writeArenaHistory: resolvedWriteArenaHistory,
  writeCurrentState: resolvedWriteCurrentState,
  arenaHistoryRetentionStrategy: resolvedArenaHistoryRetentionStrategy,
  sublimationEvent: aiResult.sublimationEvent,
  finalUserGuidance,
  hasNarrativeHistory,
  hasQuestionnaireLore,
  hasNonNativeQuestionnaireLore,
  questionnaireSelectionCount: questionnaireSelections.length,
  isNative,
});
```

删除 `pages/api/generate-sublimation.ts` 中 `921-983` 的旧 `arena_history` 内联拼接代码。

- [ ] **Step 5: 运行测试，确认 helper 与非流式接线通过**

Run: `bun test tests/sublimation-arena-history.test.ts tests/sublimation-finalize.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add lib/sublimation/finalize.ts pages/api/generate-sublimation.ts tests/sublimation-finalize.test.ts
git commit -m "refactor: extract sublimation finalization"
```

---

### Task 3: 补齐流式最终 JSON 组装，让下载/保存结果按同一策略写回历战

**Files:**
- Create: `lib/sublimation/stream-result.ts`
- Modify: `pages/api/generate-sublimation-stream.ts:133-146`
- Modify: `pages/sublimation.tsx:317-342`
- Modify: `pages/sublimation.tsx:959-1001`
- Modify: `pages/sublimation.tsx:1045-1095`
- Test: `tests/sublimation-stream-result.test.ts`

- [ ] **Step 1: 先写流式最终结果 helper 的失败测试**

创建 `tests/sublimation-stream-result.test.ts`：

```ts
import { describe, expect, test } from 'bun:test';

import { buildStreamedSublimationResultCard, extractSublimationEventFromMarkdown } from '@/lib/sublimation/stream-result';

describe('streamed sublimation result', () => {
  test('extractSublimationEventFromMarkdown: 能从升华事件小节提取标题与影响', () => {
    const markdown = [
      '# 白百合「晨曦之刃」',
      '',
      '## 升华事件',
      '### 曙光重燃',
      '她在旧伤与败北中重新理解了守护的意义。',
      '',
      '## 新形态',
      '略',
    ].join('\\n');

    expect(extractSublimationEventFromMarkdown(markdown, '白百合')).toEqual({
      title: '曙光重燃',
      impact: '她在旧伤与败北中重新理解了守护的意义。',
    });
  });

  test('buildStreamedSublimationResultCard: keep-all 时保留原始 arena_history，并清掉旧签名', () => {
    const result = buildStreamedSublimationResultCard({
      markdown: [
        '# 白百合「晨曦之刃」',
        '',
        '## 升华事件',
        '### 曙光重燃',
        '她在旧伤与败北中重新理解了守护的意义。',
      ].join('\\n'),
      sourceCharacterData: {
        codename: '白百合',
        signature: 'native-signature',
        current_state: {
          summary: '旧状态',
          fields: [{ key: 'mood', label: '心境', value: '疲惫' }],
          updated_at: '2026-03-10T00:00:00.000Z',
        },
        arena_history: {
          attributes: {
            world_line_id: 'world-old',
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-10T00:00:00.000Z',
            sublimation_count: 1,
            last_sublimation_at: '2026-03-10T00:00:00.000Z',
          },
          entries: [{ id: 3, type: 'battle', title: '普通对战', impact: '留下旧伤' }],
        },
      },
      sourceTemplate: 'magical-girl',
      retentionStrategy: 'keep-all',
      writeArenaHistory: true,
      nowISO: '2026-03-28T10:00:00.000Z',
      createWorldLineId: () => 'world-new',
    });

    expect(result.templateId).toBe('通用角色');
    expect(result.arena_history.entries.map((item: any) => item.type)).toEqual(['battle', 'sublimation']);
    expect(result.current_state.summary).toBe('旧状态');
    expect(result.signature).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test tests/sublimation-stream-result.test.ts`
Expected: FAIL，提示 `@/lib/sublimation/stream-result` 不存在

- [ ] **Step 3: 实现流式最终 JSON 组装 helper**

创建 `lib/sublimation/stream-result.ts`：

```ts
import { buildGeneralCharacterCardFromMarkdown } from '@/lib/stream/markdown-card';
import {
  applySublimationArenaHistoryStrategy,
  buildSublimationHistoryEntry,
  type ArenaHistoryRetentionStrategy,
} from '@/lib/sublimation/arena-history';

type BuildStreamedSublimationResultCardInput = {
  markdown: string;
  sourceCharacterData: any;
  sourceTemplate: 'magical-girl' | 'canshou' | 'general' | 'unknown';
  retentionStrategy: ArenaHistoryRetentionStrategy;
  writeArenaHistory: boolean;
  nowISO?: string;
  createWorldLineId?: () => string;
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const stripLine = (line: string) => line.replace(/^#+\s*/, '').trim();

export const extractSublimationEventFromMarkdown = (markdown: string, fallbackName: string) => {
  const lines = markdown.split(/\r?\n/);
  const sectionIndex = lines.findIndex((line) => stripLine(line).includes('升华事件'));
  if (sectionIndex === -1) {
    return {
      title: `${fallbackName}的升华`,
      impact: markdown.trim().slice(0, 160) || '角色完成了新的蜕变。',
    };
  }

  const sectionLines = lines.slice(sectionIndex + 1).filter((line) => line.trim());
  const titleLine = sectionLines.find((line) => line.startsWith('### ') || line.startsWith('标题：'));
  const title = titleLine
    ? stripLine(titleLine).replace(/^标题[:：]\s*/, '').trim()
    : `${fallbackName}的升华`;

  const impactLines = sectionLines
    .filter((line) => !line.startsWith('### ') && !line.startsWith('## '))
    .map((line) => line.replace(/^说明[:：]\s*/, '').trim())
    .filter(Boolean);

  return {
    title,
    impact: impactLines.join('\n').trim() || '角色在这次升华中完成了新的蜕变。',
  };
};

export const buildStreamedSublimationResultCard = (
  input: BuildStreamedSublimationResultCardInput,
) => {
  const fallbackName =
    typeof input.sourceCharacterData?.codename === 'string'
      ? input.sourceCharacterData.codename.trim()
      : typeof input.sourceCharacterData?.name === 'string'
        ? input.sourceCharacterData.name.trim()
        : '';

  const defaultName =
    input.sourceTemplate === 'magical-girl'
      ? '魔法少女'
      : input.sourceTemplate === 'canshou'
        ? '残兽'
        : '角色';

  const { card } = buildGeneralCharacterCardFromMarkdown({
    markdown: input.markdown,
    fallbackName,
    defaultName,
  });

  const out: any = {
    ...card,
  };

  if (input.sourceCharacterData?.current_state) {
    out.current_state = cloneJson(input.sourceCharacterData.current_state);
  }

  if (input.writeArenaHistory) {
    const event = extractSublimationEventFromMarkdown(input.markdown, out.codename || out.name || defaultName);
    out.arena_history = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: input.sourceCharacterData?.arena_history,
      strategy: input.retentionStrategy,
      newEntry: buildSublimationHistoryEntry({
        title: event.title,
        impact: event.impact,
        participantsName: typeof out.codename === 'string' ? out.codename : out.name,
        finalUserGuidance: null,
        hasQuestionnaireLore: false,
        questionnaireSelectionCount: 0,
        nonNativeDataInvolved: true,
      }),
      nowISO: input.nowISO ?? new Date().toISOString(),
      createWorldLineId: input.createWorldLineId,
    });
  } else if (input.sourceCharacterData?.arena_history) {
    out.arena_history = cloneJson(input.sourceCharacterData.arena_history);
  }

  delete out.signature;
  return out;
};
```

- [ ] **Step 4: 让流式 API 明确解构 strategy，避免污染原始角色数据**

修改 `pages/api/generate-sublimation-stream.ts`：

```ts
const {
  language = 'zh-CN',
  userGuidance = '',
  narrativeHistory = '',
  fieldsToPreserve = [],
  isDowngrade = false,
  allowReshapeNames = false,
  customProvider: customProviderPayload,
  targetTemplate,
  sourceTemplate,
  arenaHistoryRetentionStrategy: _arenaHistoryRetentionStrategy,
  questionnaires: rawQuestionnaires,
  ...originalCharacterData
} = body ?? {};
```

这里故意用 `_arenaHistoryRetentionStrategy` 作为临时变量名，不参与流式提示词，但必须从 `...originalCharacterData` 中剔除，否则它会被误当成角色数据写入 prompt。

- [ ] **Step 5: 让页面在流式完成后使用新的最终 JSON helper**

修改 `pages/sublimation.tsx`：

```ts
import { buildStreamedSublimationResultCard } from '@/lib/sublimation/stream-result';

// 发送 payload 时补字段
const payload: Record<string, any> = {
  ...characterData,
  language: selectedLanguage,
  userGuidance: userGuidance.trim(),
  narrativeHistory: finalNarrativeHistoryText.trim(),
  fieldsToPreserve: filteredFieldsToPreserve,
  allowReshapeNames,
  isDowngrade,
  targetTemplate,
  readArenaHistory,
  writeArenaHistory,
  readCurrentState,
  writeCurrentState,
  arenaHistoryRetentionStrategy,
  // ...
};

// 流式成功后
const finalStreamCard = buildStreamedSublimationResultCard({
  markdown,
  sourceCharacterData: characterData,
  sourceTemplate,
  retentionStrategy: arenaHistoryRetentionStrategy,
  writeArenaHistory,
});

let signedCard = finalStreamCard;
const shouldSign = await shouldResignStreamedCard();
if (shouldSign) {
  const result = await resignDataCard(finalStreamCard);
  if (!result) return;
  signedCard = result;
}
setStreamedGeneralCard(signedCard);
```

- [ ] **Step 6: 运行测试，确认流式最终结果 helper 通过**

Run: `bun test tests/sublimation-stream-result.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add lib/sublimation/stream-result.ts pages/api/generate-sublimation-stream.ts pages/sublimation.tsx tests/sublimation-stream-result.test.ts
git commit -m "feat: retain arena history in streamed sublimation cards"
```

---

### Task 4: 增加页面策略控件与偏好持久化

**Files:**
- Create: `lib/sublimation/preferences.ts`
- Create: `components/shared/SublimationArenaHistoryStrategyFieldset.tsx`
- Modify: `pages/sublimation.tsx:202-203`
- Modify: `pages/sublimation.tsx:246-249`
- Modify: `pages/sublimation.tsx:451-475`
- Modify: `pages/sublimation.tsx:1688-1740`
- Modify: `pages/sublimation.tsx:1857-1898`
- Test: `tests/sublimation-preferences.test.ts`
- Test: `tests/sublimation-history-strategy-fieldset.test.tsx`

- [ ] **Step 1: 先写偏好与控件的失败测试**

创建 `tests/sublimation-preferences.test.ts`：

```ts
import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_SUBLIMATION_STATE_PREFERENCES,
  readSublimationStatePreferences,
  writeSublimationStatePreferences,
} from '@/lib/sublimation/preferences';

class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

describe('sublimation preferences', () => {
  test('缺省时回退到默认的 keep-sublimation-only', () => {
    const storage = new LocalStorageMock();
    expect(readSublimationStatePreferences(storage, 'pref-key')).toEqual(
      DEFAULT_SUBLIMATION_STATE_PREFERENCES,
    );
  });

  test('写入后能读回 arenaHistoryRetentionStrategy', () => {
    const storage = new LocalStorageMock();
    writeSublimationStatePreferences(storage, 'pref-key', {
      ...DEFAULT_SUBLIMATION_STATE_PREFERENCES,
      arenaHistoryRetentionStrategy: 'reset-all',
    });

    expect(readSublimationStatePreferences(storage, 'pref-key').arenaHistoryRetentionStrategy).toBe('reset-all');
  });
});
```

创建 `tests/sublimation-history-strategy-fieldset.test.tsx`：

```tsx
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SublimationArenaHistoryStrategyFieldset } from '@/components/shared/SublimationArenaHistoryStrategyFieldset';

describe('SublimationArenaHistoryStrategyFieldset', () => {
  test('writeArenaHistory=false 时不渲染策略单选组', () => {
    const html = renderToStaticMarkup(
      <SublimationArenaHistoryStrategyFieldset
        readArenaHistory
        writeArenaHistory={false}
        retentionStrategy="keep-sublimation-only"
        disabled={false}
        onReadArenaHistoryChange={() => {}}
        onWriteArenaHistoryChange={() => {}}
        onRetentionStrategyChange={() => {}}
      />,
    );

    expect(html).toContain('升华时读取');
    expect(html).toContain('升华后写入');
    expect(html).not.toContain('保留全部历史');
  });

  test('writeArenaHistory=true 时渲染三种策略与即时说明', () => {
    const html = renderToStaticMarkup(
      <SublimationArenaHistoryStrategyFieldset
        readArenaHistory
        writeArenaHistory
        retentionStrategy="reset-all"
        disabled={false}
        onReadArenaHistoryChange={() => {}}
        onWriteArenaHistoryChange={() => {}}
        onRetentionStrategyChange={() => {}}
      />,
    );

    expect(html).toContain('保留全部历史');
    expect(html).toContain('只保留升华记录');
    expect(html).toContain('清空全部历史');
    expect(html).toContain('重置世界线');
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test tests/sublimation-preferences.test.ts tests/sublimation-history-strategy-fieldset.test.tsx`
Expected: FAIL，提示对应模块尚不存在

- [ ] **Step 3: 实现偏好 helper 与策略控件**

创建 `lib/sublimation/preferences.ts`：

```ts
import {
  DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY,
  normalizeArenaHistoryRetentionStrategy,
  type ArenaHistoryRetentionStrategy,
} from '@/lib/sublimation/arena-history';

export type SublimationStatePreferences = {
  readArenaHistory: boolean;
  writeArenaHistory: boolean;
  readCurrentState: boolean;
  writeCurrentState: boolean;
  arenaHistoryRetentionStrategy: ArenaHistoryRetentionStrategy;
};

export const DEFAULT_SUBLIMATION_STATE_PREFERENCES: SublimationStatePreferences = {
  readArenaHistory: true,
  writeArenaHistory: true,
  readCurrentState: true,
  writeCurrentState: true,
  arenaHistoryRetentionStrategy: DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY,
};

export const readSublimationStatePreferences = (
  storage: Pick<Storage, 'getItem'>,
  key: string,
): SublimationStatePreferences => {
  const raw = storage.getItem(key);
  if (!raw) return DEFAULT_SUBLIMATION_STATE_PREFERENCES;
  try {
    const parsed = JSON.parse(raw);
    return {
      readArenaHistory:
        typeof parsed.readArenaHistory === 'boolean'
          ? parsed.readArenaHistory
          : DEFAULT_SUBLIMATION_STATE_PREFERENCES.readArenaHistory,
      writeArenaHistory:
        typeof parsed.writeArenaHistory === 'boolean'
          ? parsed.writeArenaHistory
          : DEFAULT_SUBLIMATION_STATE_PREFERENCES.writeArenaHistory,
      readCurrentState:
        typeof parsed.readCurrentState === 'boolean'
          ? parsed.readCurrentState
          : DEFAULT_SUBLIMATION_STATE_PREFERENCES.readCurrentState,
      writeCurrentState:
        typeof parsed.writeCurrentState === 'boolean'
          ? parsed.writeCurrentState
          : DEFAULT_SUBLIMATION_STATE_PREFERENCES.writeCurrentState,
      arenaHistoryRetentionStrategy: normalizeArenaHistoryRetentionStrategy(parsed.arenaHistoryRetentionStrategy),
    };
  } catch {
    return DEFAULT_SUBLIMATION_STATE_PREFERENCES;
  }
};

export const writeSublimationStatePreferences = (
  storage: Pick<Storage, 'setItem'>,
  key: string,
  value: SublimationStatePreferences,
) => {
  storage.setItem(key, JSON.stringify(value));
};
```

创建 `components/shared/SublimationArenaHistoryStrategyFieldset.tsx`：

```tsx
import React from 'react';

import {
  ARENA_HISTORY_RETENTION_DESCRIPTIONS,
  ARENA_HISTORY_RETENTION_LABELS,
  type ArenaHistoryRetentionStrategy,
} from '@/lib/sublimation/arena-history';

type Props = {
  readArenaHistory: boolean;
  writeArenaHistory: boolean;
  retentionStrategy: ArenaHistoryRetentionStrategy;
  disabled: boolean;
  onReadArenaHistoryChange: (value: boolean) => void;
  onWriteArenaHistoryChange: (value: boolean) => void;
  onRetentionStrategyChange: (value: ArenaHistoryRetentionStrategy) => void;
};

const OPTIONS: ArenaHistoryRetentionStrategy[] = ['keep-all', 'keep-sublimation-only', 'reset-all'];

export const SublimationArenaHistoryStrategyFieldset: React.FC<Props> = ({
  readArenaHistory,
  writeArenaHistory,
  retentionStrategy,
  disabled,
  onReadArenaHistoryChange,
  onWriteArenaHistoryChange,
  onRetentionStrategyChange,
}) => (
  <fieldset className="border border-gray-200 rounded-lg p-3">
    <legend className="text-xs font-semibold text-gray-600 px-1">历战记录</legend>
    <label className="flex items-center text-sm text-gray-700 mt-2">
      <input
        type="checkbox"
        className="h-4 w-4 mr-2 text-purple-600 border-gray-300 rounded"
        checked={readArenaHistory}
        onChange={(event) => onReadArenaHistoryChange(event.target.checked)}
        disabled={disabled}
      />
      升华时读取
    </label>
    <label className="flex items-center text-sm text-gray-700 mt-2">
      <input
        type="checkbox"
        className="h-4 w-4 mr-2 text-purple-600 border-gray-300 rounded"
        checked={writeArenaHistory}
        onChange={(event) => onWriteArenaHistoryChange(event.target.checked)}
        disabled={disabled}
      />
      升华后写入
    </label>
    <p className="text-[11px] text-gray-500 mt-1">
      关闭读取后，仅根据设定与引导完成升华；关闭写入后，本次升华不会新增历史条目。
    </p>
    {writeArenaHistory && (
      <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50/70 p-3">
        <div className="text-xs font-semibold text-purple-800">写入策略</div>
        <div className="mt-2 space-y-2">
          {OPTIONS.map((option) => (
            <label key={option} className="flex items-start text-sm text-gray-700">
              <input
                type="radio"
                name="arena-history-retention-strategy"
                className="mt-0.5 h-4 w-4 mr-2 text-purple-600 border-gray-300"
                checked={retentionStrategy === option}
                onChange={() => onRetentionStrategyChange(option)}
                disabled={disabled}
              />
              <span>{ARENA_HISTORY_RETENTION_LABELS[option]}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          {ARENA_HISTORY_RETENTION_DESCRIPTIONS[retentionStrategy]}
        </p>
      </div>
    )}
  </fieldset>
);
```

- [ ] **Step 4: 在页面接入策略 state、本地偏好与新控件**

修改 `pages/sublimation.tsx`：

```ts
import {
  DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY,
  type ArenaHistoryRetentionStrategy,
} from '@/lib/sublimation/arena-history';
import {
  readSublimationStatePreferences,
  writeSublimationStatePreferences,
} from '@/lib/sublimation/preferences';
import { SublimationArenaHistoryStrategyFieldset } from '@/components/shared/SublimationArenaHistoryStrategyFieldset';

const [arenaHistoryRetentionStrategy, setArenaHistoryRetentionStrategy] =
  useState<ArenaHistoryRetentionStrategy>(DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY);

useEffect(() => {
  if (typeof window === 'undefined') return;
  const prefs = readSublimationStatePreferences(window.localStorage, SUBLIMATION_STATE_PREF_KEY);
  setReadArenaHistory(prefs.readArenaHistory);
  setWriteArenaHistory(prefs.writeArenaHistory);
  setReadCurrentState(prefs.readCurrentState);
  setWriteCurrentState(prefs.writeCurrentState);
  setArenaHistoryRetentionStrategy(prefs.arenaHistoryRetentionStrategy);
}, []);

useEffect(() => {
  if (typeof window === 'undefined') return;
  writeSublimationStatePreferences(window.localStorage, SUBLIMATION_STATE_PREF_KEY, {
    readArenaHistory,
    writeArenaHistory,
    readCurrentState,
    writeCurrentState,
    arenaHistoryRetentionStrategy,
  });
}, [
  readArenaHistory,
  writeArenaHistory,
  readCurrentState,
  writeCurrentState,
  arenaHistoryRetentionStrategy,
]);
```

把 `1688-1715` 的历战 fieldset 替换为：

```tsx
<SublimationArenaHistoryStrategyFieldset
  readArenaHistory={readArenaHistory}
  writeArenaHistory={writeArenaHistory}
  retentionStrategy={arenaHistoryRetentionStrategy}
  disabled={isGenerating}
  onReadArenaHistoryChange={setReadArenaHistory}
  onWriteArenaHistoryChange={setWriteArenaHistory}
  onRetentionStrategyChange={setArenaHistoryRetentionStrategy}
/>
```

并在流式结果区现有提示文案下追加：

```tsx
<p className="mt-2 text-xs text-gray-500 text-center">
  下载/保存的 JSON 已按所选历战策略写回；页面预览不展示这部分历史元数据。
</p>
```

- [ ] **Step 5: 运行测试，确认页面策略与偏好接线通过**

Run: `bun test tests/sublimation-preferences.test.ts tests/sublimation-history-strategy-fieldset.test.tsx tests/sublimation-stream-result.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add lib/sublimation/preferences.ts components/shared/SublimationArenaHistoryStrategyFieldset.tsx pages/sublimation.tsx tests/sublimation-preferences.test.ts tests/sublimation-history-strategy-fieldset.test.tsx
git commit -m "feat: add sublimation history retention controls"
```

---

### Task 5: 更新百科文案并完成整体验证

**Files:**
- Modify: `public/encyclopedia/sublimation.md`

- [ ] **Step 1: 更新百科文案，补充三种策略说明**

修改 `public/encyclopedia/sublimation.md` 的“高级选项：读写历战/状态栏”段落：

```md
升华支持分别控制“读取”和“写入”：

- 历战记录（`arena_history`）
- 状态栏（`current_state`）

当你开启“升华后写入”时，还可以选择历战保留策略：

- **保留全部历史**：保留全部既有历战，并追加本次升华记录
- **只保留升华记录**：仅保留历次升华记录，并追加本次升华记录（默认）
- **清空全部历史**：清空既有历战，仅保留本次升华记录，并重置世界线

经验建议：

- 想保留长期完整履历：选择“保留全部历史”
- 想只保留成长主线：选择“只保留升华记录”
- 想把本次升华视为全新开端：选择“清空全部历史”
```

- [ ] **Step 2: 运行针对本功能的测试集合**

Run:

```bash
bun test \
  tests/sublimation-arena-history.test.ts \
  tests/sublimation-finalize.test.ts \
  tests/sublimation-stream-result.test.ts \
  tests/sublimation-preferences.test.ts \
  tests/sublimation-history-strategy-fieldset.test.tsx
```

Expected: PASS

- [ ] **Step 3: 运行 lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 4: 运行全量测试**

Run: `bun test`
Expected: PASS

- [ ] **Step 5: 运行生产构建**

Run: `bun run build`
Expected: PASS

- [ ] **Step 6: 提交最终特性**

```bash
git add public/encyclopedia/sublimation.md
git commit -m "docs: document sublimation history retention options"
```

如果本任务包含前面遗漏的修复，一并补一个收口提交：

```bash
git add lib/sublimation pages/api/generate-sublimation.ts pages/api/generate-sublimation-stream.ts pages/sublimation.tsx components/shared/SublimationArenaHistoryStrategyFieldset.tsx tests public/encyclopedia/sublimation.md
git commit -m "feat: add configurable sublimation history retention"
```

---

## 自检

### 1. Spec coverage

- 三种策略的结果语义：Task 1
- 非流式结构化结果统一写回：Task 2
- 流式最终 JSON 统一写回：Task 3
- 页面控件、默认值、偏好记忆：Task 4
- 文档说明与验证：Task 5

无缺口。

### 2. Placeholder scan

- 未出现未定内容或“以后再补”的空泛步骤
- 每个代码步骤都给了具体文件与代码块
- 每个验证步骤都给了明确命令与预期

### 3. Type consistency

- 策略类型统一为 `ArenaHistoryRetentionStrategy`
- 默认策略统一为 `DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY`
- 页面、非流式 API、流式结果 helper 都使用同一个 strategy 类型与 normalize 函数

---

## 备注

- `pages/api/generate-sublimation-stream.ts` 即使不直接使用策略，也必须显式解构该字段；否则它会落进 `...originalCharacterData`，污染 prompt 与结果判断。
- 流式链路本期只统一最终 JSON 语义，不要求预览卡完整展示 `arena_history` 元数据。
