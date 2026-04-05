# Challenge 完整对手卡与低 Rows Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/challenge` 的竞技场对手只在“完整公开卡可读且可渲染”时进入 remote 候选池，节点主链路改为服务端选敌并回传瞬时 sidecar，失败时稳定回退 `preset-only`，同时把额外 D1 读约束在有限 leaderboard 窗口与最多两次 `id IN (...)` 查询内。

**Architecture:** 保留 `/api/arena/leaderboard` 作为 live 排行榜真相源，并继续吃它已有的 15 秒 edge cache；challenge 自身不再逐 ID 走 `/api/public-data-cards?id=...`，而是在服务端用精确 ID 集合批量读取公开角色卡，再用共享的可渲染纯函数过滤出真正可展示的候选。`/api/challenge/enemy-candidates` 扩展为“兼容候选模式 + selectionSeed 服务端选敌模式”双契约；controller 在当前会话内暂存 `resolvedSourceCardLite`，展示层优先消费 sidecar，避免刚验证成功又二次单卡读取。

**Tech Stack:** Next.js Pages Router、Cloudflare Edge Runtime、D1 + Drizzle、TypeScript strict、Bun test、现有 challenge controller / enemy display / leaderboard API

---

## 执行前提

- 已批准 spec：[`docs/specs/2026-04-05_101533_challenge完整对手卡来源与低RowsRead设计.md`](/home/notuhao/code/MahoShojo-Generator/docs/specs/2026-04-05_101533_challenge完整对手卡来源与低RowsRead设计.md)
- 按 `@superpowers:test-driven-development` 执行：先写失败测试，再做最小实现，再验证
- 本计划不改挑战存档结构，不把完整敌方原卡写入 `RunStateV1`、`EncounterSnapshotV1`、IndexedDB
- 本计划允许兼容模式保留 `candidates[]` 返回，但 challenge 实际节点主链路必须统一切到 `selectionSeed` 服务端选敌
- 不引入 challenge 自有 route 级缓存；leaderboard 继续复用现有 `/api/arena/leaderboard` edge cache

## 文件结构与职责

### 新增文件

- `lib/challenge/source-card-renderability.ts`
  - 统一 challenge 可渲染模板识别与最小字段校验，成为 server / client 共用的单一真相源
- `lib/db/repositories/challenge-public-card-read.ts`
  - 只负责 `data_cards` 的精确 ID 集合公开读取，不做搜索、COUNT 或无关 JOIN
- `tests/challenge-source-card-renderability.test.ts`
  - 覆盖 `magical-girl` 最小字段、通用模板识别与“不可渲染时拒绝入池”

### 修改文件

- [`lib/challenge/types.ts`](/home/notuhao/code/MahoShojo-Generator/lib/challenge/types.ts)
  - 增加 `ChallengeResolvedSourceCardLite` 等 challenge 专用 DTO
- [`lib/challenge/enemy-display.ts`](/home/notuhao/code/MahoShojo-Generator/lib/challenge/enemy-display.ts)
  - 改为依赖共享 renderability 模块，并支持 sidecar-first 展示解析
- [`lib/challenge/worlds/arena/enemy-source.ts`](/home/notuhao/code/MahoShojo-Generator/lib/challenge/worlds/arena/enemy-source.ts)
  - 移除 remote 路径把失败 `data_card` 降成 `season-entity` 的行为，改成两段窗口验证、阈值降级与“已验证候选池 + sidecar 索引”产出
- [`lib/challenge/server/enemy-candidates.ts`](/home/notuhao/code/MahoShojo-Generator/lib/challenge/server/enemy-candidates.ts)
  - 串接 leaderboard 请求、批量公开卡读取、selectionSeed 模式、sidecar 构造与埋点
- [`pages/api/challenge/enemy-candidates.ts`](/home/notuhao/code/MahoShojo-Generator/pages/api/challenge/enemy-candidates.ts)
  - 解析 `selectionSeed`，返回互斥的双模式 payload，并统一 `success:false` 错误响应
- [`components/challenge/hooks/useChallengeController.ts`](/home/notuhao/code/MahoShojo-Generator/components/challenge/hooks/useChallengeController.ts)
  - 节点进入时调用 selection 模式、暂存 `resolvedSourceCardLite`、把请求到持久化保持为紧邻操作
- [`tests/challenge-enemy-source.test.ts`](/home/notuhao/code/MahoShojo-Generator/tests/challenge-enemy-source.test.ts)
  - 覆盖两段窗口、阈值降级、不再产出 `season-entity`
- [`tests/challenge-enemy-candidates-api.test.ts`](/home/notuhao/code/MahoShojo-Generator/tests/challenge-enemy-candidates-api.test.ts)
  - 覆盖 selection 模式、兼容模式、fallback 契约与错误响应
- [`tests/challenge-enemy-display.test.ts`](/home/notuhao/code/MahoShojo-Generator/tests/challenge-enemy-display.test.ts)
  - 覆盖 sidecar 优先、共享 renderability 生效、fallback 只走兼容补查
- [`tests/challenge-page.test.tsx`](/home/notuhao/code/MahoShojo-Generator/tests/challenge-page.test.tsx)
  - 覆盖 challenge 页面实际请求参数切换到 `selectionSeed`

### 只读参考

- [`pages/api/arena/leaderboard.ts`](/home/notuhao/code/MahoShojo-Generator/pages/api/arena/leaderboard.ts)
  - 已有 `offset`、`limit`、`includePresets` 与 strict 过滤，不要重复发明 challenge 榜单接口
- [`lib/db/repositories/arena-read.ts`](/home/notuhao/code/MahoShojo-Generator/lib/db/repositories/arena-read.ts)
  - strict live 排行榜公开条件的实际实现
- [`pages/api/public-data-cards.ts`](/home/notuhao/code/MahoShojo-Generator/pages/api/public-data-cards.ts)
  - 现有公开单卡契约，仅用于字段语义参考，不再作为 challenge 主热路径
- [`lib/challenge/enemy-display.ts`](/home/notuhao/code/MahoShojo-Generator/lib/challenge/enemy-display.ts)
  - 已包含模板识别与 `magical-girl` 最小字段判断，需抽到共享模块
- [`tests/challenge-page-node-stage.test.tsx`](/home/notuhao/code/MahoShojo-Generator/tests/challenge-page-node-stage.test.tsx)
  - 可复用现有 challenge 页面渲染夹具

## 关键约束

- remote 路径只允许产出 `public-card` 或 `preset`；`season-entity` 仅保留历史兼容与本地快照语义
- `selectionSeed` 只保证同一候选集合内稳定选样；真正恢复确定性依赖持久化后的 `enemySnapshot`
- `resolvedSourceCardLite` 必须是 challenge API 的 camelCase DTO：`{ id, name, data, updatedAt }`
- `resolvedSourceCardLite.data` 必须保留为 JSON 字符串，不要在 API 边界提前转成对象
- 单次 remote 主链路最多：
  - 2 次 `/api/arena/leaderboard`
  - 2 次 `data_cards id IN (...)` 批量查询
- 禁止回退到 `O(N)` 个逐 ID `/api/public-data-cards?id=...` HTTP 请求

### Task 1: 建立共享 renderability 模块与 sidecar 类型

**Files:**
- Create: `lib/challenge/source-card-renderability.ts`
- Modify: `lib/challenge/types.ts`
- Test: `tests/challenge-source-card-renderability.test.ts`

- [ ] **Step 1: 先写失败测试，固定 challenge 可渲染规则**

在 `tests/challenge-source-card-renderability.test.ts` 里锁定以下行为：

```ts
import { describe, expect, test } from 'bun:test';

import {
  inferChallengeRenderableTemplate,
  isChallengeRenderableSourceCard,
} from '@/lib/challenge/source-card-renderability';

describe('challenge source card renderability', () => {
  test('magical-girl 需要完整关键字段', () => {
    expect(
      isChallengeRenderableSourceCard({
        codename: '雪绒',
      }),
    ).toBe(false);
  });

  test('完整 magical-girl 会被识别并通过', () => {
    const card = {
      codename: '雪绒',
      appearance: {},
      magicConstruct: {},
      wonderlandRule: {},
      blooming: {},
      analysis: {},
    };
    expect(inferChallengeRenderableTemplate(card)).toBe('magical-girl');
    expect(isChallengeRenderableSourceCard(card)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test tests/challenge-source-card-renderability.test.ts`
Expected: FAIL，提示模块不存在

- [ ] **Step 3: 在类型层加入 sidecar DTO**

在 [`lib/challenge/types.ts`](/home/notuhao/code/MahoShojo-Generator/lib/challenge/types.ts) 增加：

```ts
export interface ChallengeResolvedSourceCardLite {
  id: string;
  name: string;
  data: string;
  updatedAt: string | null;
}
```

要求：

- 只保留 `id / name / data / updatedAt`
- 不新增 `updated_at`
- 不把 DTO 做成 `any`

- [ ] **Step 4: 实现共享纯函数模块**

在 `lib/challenge/source-card-renderability.ts` 实现最小接口：

```ts
export type ChallengeRenderableTemplate = 'magical-girl' | 'canshou' | 'general';

export function inferChallengeRenderableTemplate(cardPayload: Record<string, unknown>): ChallengeRenderableTemplate | null {
  // 1. 复用 inferTemplate
  // 2. 只返回 challenge 现有可展示模板
}

export function isChallengeRenderableSourceCard(cardPayload: Record<string, unknown>): boolean {
  // 1. 先识别模板
  // 2. magical-girl 校验 codename / appearance / magicConstruct / wonderlandRule / blooming / analysis
  // 3. canshou / general 以现有展示组件最小要求为准
}
```

- [ ] **Step 5: 运行测试并补齐边界用例**

把测试补到以下场景后再跑：

- `general` 模板对象可通过
- 未识别模板返回 `null / false`
- `data` 为 JSON 字符串时先由调用方解包，不在本模块内承担 I/O

Run: `bun test tests/challenge-source-card-renderability.test.ts`
Expected: PASS

- [ ] **Step 6: 提交当前任务**

```bash
git add lib/challenge/types.ts lib/challenge/source-card-renderability.ts tests/challenge-source-card-renderability.test.ts
git commit -m "feat: 抽出 challenge 原卡可渲染校验"
```

### Task 2: 重构 arena enemy source，改成两段窗口验证 + 批量公开卡读取

**Files:**
- Create: `lib/db/repositories/challenge-public-card-read.ts`
- Modify: `lib/challenge/worlds/arena/enemy-source.ts`
- Modify: `tests/challenge-enemy-source.test.ts`

- [ ] **Step 1: 先写失败测试，锁定 remote 候选不再产出 season-entity**

在 `tests/challenge-enemy-source.test.ts` 新增用例：

```ts
test('data_card 补卡失败时会被跳过，而不是降为 season-entity', async () => {
  const result = await resolveArenaEnemyCandidates(
    { tier: 'elite', sourceMode: 'online-first', runSeed: 'run-x', limit: 2 },
    {
      loadRankedEntityWindow: async () => [
        { entityType: 'data_card', entityId: 'missing-card', displayName: '失联敌人' },
        { entityType: 'preset', entityId: 'preset-1', displayName: '雪绒' },
      ],
      loadPublicCardsByIds: async () => new Map(),
      loadPresetPool: () => [createMockArenaCard({ id: 'preset-1', name: '雪绒', powerLevel: 'flower', isPreset: true })],
    },
  );

  expect(result.candidates.some((item) => item.sourceType === 'season-entity')).toBe(false);
});
```

再补两条：

- 第一窗口不足时会请求第二窗口
- 两窗口后仍低于阈值时整体返回 `preset-only`
- mixed remote 候选中只有“通过共享 renderability 校验”的条目能留下

- [ ] **Step 2: 运行测试，确认旧实现失败**

Run: `bun test tests/challenge-enemy-source.test.ts`
Expected: FAIL，至少有一条仍返回 `season-entity` 或没有第二窗口行为

- [ ] **Step 3: 新增 challenge 专用批量公开卡读取 helper**

在 `lib/db/repositories/challenge-public-card-read.ts` 实现：

```ts
export type ChallengePublicCardRow = {
  id: string;
  name: string;
  data: string;
  updatedAt: string | null;
};

export async function listChallengePublicCharacterCardsByIds(
  db: AppDrizzleDb,
  ids: string[],
): Promise<ChallengePublicCardRow[]> {
  // 1. 空数组直接返回 []
  // 2. 用 inArray(dataCards.id, ids)
  // 3. 带上 type/is_public/review_status/deleted_at 过滤
  // 4. 只 select id/name/data/updated_at
}
```

实现约束：

- 不做 COUNT
- 不做搜索
- 不做 `users` / `tags` / `metrics` JOIN
- `ids.length` 必须先在调用方裁到窗口大小以内

- [ ] **Step 4: 重构 enemy source 的依赖与返回语义**

把 [`lib/challenge/worlds/arena/enemy-source.ts`](/home/notuhao/code/MahoShojo-Generator/lib/challenge/worlds/arena/enemy-source.ts) 改成按窗口工作，而不是“拿一个实体查一个 ID”：

```ts
type LoadRankedEntityWindow = (input: { tier: StrengthTier; limit: number; offset: number }) => Promise<RankedArenaEntity[]>;
type LoadPublicCardsByIds = (ids: string[]) => Promise<Map<string, ChallengeResolvedSourceCardLite>>;

type ResolveArenaEnemyCandidatesResult = {
  resolvedSourceMode: 'remote' | 'preset-only';
  candidates: EnemySnapshotV1[];
  resolvedSourceCardsById: Map<string, ChallengeResolvedSourceCardLite>;
};
```

实现顺序：

1. 先读第一窗口（最多 18）
2. 仅对窗口里的 `data_card` 做一次批量公开卡查询
3. 通过共享 renderability 模块过滤
4. 不可用实体直接跳过
5. 不足再读第二窗口（最多 12，`offset=firstWindowLimit`）
6. 两窗口后若 remote 候选 `< 3`，整体切 `preset-only`
7. **不要在 `enemy-source.ts` 内完成最终选敌**；这里的职责只到“产出已验证候选池 + `resolvedSourceCardsById`”

- [ ] **Step 5: 保留 preset 直通，但移除 remote 路径 season-entity 产出**

在同一文件内明确：

- remote 路径：
  - `data_card -> public-card | skip`
  - `preset -> preset | skip`
- 仅本地快照 / 历史兼容路径保留 `season-entity`

- [ ] **Step 6: 运行 source 相关测试**

Run: `bun test tests/challenge-enemy-source.test.ts`
Expected: PASS，且新增断言表明 remote 路径不再生成 `season-entity`

- [ ] **Step 7: 提交当前任务**

```bash
git add lib/db/repositories/challenge-public-card-read.ts lib/challenge/worlds/arena/enemy-source.ts tests/challenge-enemy-source.test.ts
git commit -m "feat: 重构 challenge remote 对手候选低读链路"
```

### Task 3: 扩展 `/api/challenge/enemy-candidates` 为双模式契约并接入服务端选敌

**Files:**
- Modify: `lib/challenge/server/enemy-candidates.ts`
- Modify: `pages/api/challenge/enemy-candidates.ts`
- Modify: `tests/challenge-enemy-candidates-api.test.ts`

- [ ] **Step 1: 先写 API 失败测试，锁定 selection 模式契约**

在 `tests/challenge-enemy-candidates-api.test.ts` 先补三类断言：

```ts
test('selectionSeed 模式返回 enemySnapshot 和 resolvedSourceCardLite，不返回 candidates', async () => {
  // 断言 payload.enemySnapshot 存在
  // 断言 payload.resolvedSourceCardLite.id === payload.enemySnapshot.sourceId
  // 断言 candidates === undefined
});

test('selectionSeed 模式在 remote 不足阈值时仍返回 preset-only enemySnapshot 和 null sidecar', async () => {
  // 断言 status=200
  // 断言 payload.resolvedSourceMode === 'preset-only'
  // 断言 payload.enemySnapshot 存在
  // 断言 payload.enemySnapshot.sourceType === 'preset'
  // 断言 payload.resolvedSourceCardLite === null
  // 断言 candidates === undefined
});

test('compatibility 模式仍返回 candidates，且省略 enemySnapshot / resolvedSourceCardLite', async () => {
  // 断言 payload.candidates 存在
  // 断言 enemySnapshot === undefined
  // 断言 resolvedSourceCardLite === undefined
});

test('参数错误统一返回 success=false', async () => {
  // 断言 status=400 且 payload.success=false
});
```

- [ ] **Step 2: 运行 API 测试，确认当前失败**

Run: `bun test tests/challenge-enemy-candidates-api.test.ts`
Expected: FAIL，当前 handler 只返回 `candidates`

- [ ] **Step 3: 在 server resolver 引入 selection 模式联合返回类型**

在 [`lib/challenge/server/enemy-candidates.ts`](/home/notuhao/code/MahoShojo-Generator/lib/challenge/server/enemy-candidates.ts) 定义清晰联合：

```ts
type ResolveEnemyCandidatesCompatibilityResult = {
  mode: 'compatibility';
  worldId: ChallengeWorldId;
  tier: StrengthTier;
  resolvedSourceMode: 'remote' | 'preset-only';
  candidates: EnemySnapshotV1[];
};

type ResolveEnemyCandidatesSelectionResult = {
  mode: 'selection';
  worldId: ChallengeWorldId;
  tier: StrengthTier;
  resolvedSourceMode: 'remote' | 'preset-only';
  enemySnapshot: EnemySnapshotV1;
  resolvedSourceCardLite: ChallengeResolvedSourceCardLite | null;
};
```

实现要点：

1. 仍通过 `fetch('/api/arena/leaderboard?...offset=...')` 复用 leaderboard edge cache
2. 公开卡读取改为直接调用 `listChallengePublicCharacterCardsByIds`
3. `selectionSeed` 存在时**只在 `lib/challenge/server/enemy-candidates.ts` 这一层**完成最终选敌，不再把候选交给客户端再挑，也不在 `enemy-source.ts` 再做第二套 selection
4. 若选中 `public-card` 却拿不到 sidecar，必须继续补位或整体降级，不能返回 `public-card + null sidecar`

- [ ] **Step 4: 改 handler，落实互斥字段与统一错误响应**

在 [`pages/api/challenge/enemy-candidates.ts`](/home/notuhao/code/MahoShojo-Generator/pages/api/challenge/enemy-candidates.ts)：

```ts
const selectionSeedRaw = url.searchParams.get('selectionSeed');
const selectionSeed = typeof selectionSeedRaw === 'string' && selectionSeedRaw.trim() ? selectionSeedRaw.trim() : null;
```

然后：

- `selectionSeed == null`:
  - 返回 `{ success:true, worldId, tier, resolvedSourceMode, candidates }`
- `selectionSeed != null`:
  - 返回 `{ success:true, worldId, tier, resolvedSourceMode, enemySnapshot, resolvedSourceCardLite }`
- `400/405/500`:
  - 返回 `{ success:false, error:'...' }`

- [ ] **Step 5: 在 server 层补结构化埋点**

至少打印或集中收集以下字段：

```ts
{
  leaderboardWindowRequestCount,
  bulkPublicCardQueryCount,
  validatedCandidateCount,
  selectedFromWindow,
  fallbackReason,
}
```

要求：

- 埋点不要写入数据库
- 不要把完整卡 payload 打进日志

- [ ] **Step 6: 运行 API 测试**

Run: `bun test tests/challenge-enemy-candidates-api.test.ts`
Expected: PASS

- [ ] **Step 7: 提交当前任务**

```bash
git add lib/challenge/server/enemy-candidates.ts pages/api/challenge/enemy-candidates.ts tests/challenge-enemy-candidates-api.test.ts
git commit -m "feat: 为 challenge 敌人接口加入服务端选敌契约"
```

### Task 4: controller 切到 selection 模式，并在展示链路优先复用 sidecar

**Files:**
- Modify: `components/challenge/hooks/useChallengeController.ts`
- Modify: `lib/challenge/enemy-display.ts`
- Modify: `tests/challenge-enemy-display.test.ts`
- Modify: `tests/challenge-page.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定页面请求改为 selectionSeed**

在 `tests/challenge-page.test.tsx` 增加断言：

```ts
expect(requestedUrl).toContain('/api/challenge/enemy-candidates');
expect(requestedUrl).toContain('selectionSeed=');
expect(requestedUrl).toContain('tier=');
```

再补一条展示层测试：

```ts
test('resolvedSourceCardLite 存在时不会再次 fetch public card', async () => {
  const result = await resolveChallengeEnemyDisplay({
    enemySnapshot: { ...baseEnemySnapshot, sourceType: 'public-card', sourceId: 'card-1' },
    resolvedSourceCardLite: {
      id: 'card-1',
      name: '雪绒',
      data: JSON.stringify({ templateId: GENERAL_CHARACTER_TEMPLATE_ID, name: '雪绒', content: '...' }),
      updatedAt: '2026-04-05T10:00:00.000Z',
    },
    fetchPublicCardById: async () => {
      throw new Error('should not fetch');
    },
  });
  expect(result.status).toBe('resolved');
});
```

- [ ] **Step 2: 运行展示与页面测试，确认当前失败**

Run: `bun test tests/challenge-enemy-display.test.ts tests/challenge-page.test.tsx`
Expected: FAIL，当前 controller 还没有 `selectionSeed`，display 也不接受 sidecar

- [ ] **Step 3: 在 controller 中把“请求选敌 -> 写入 encounter”保持为紧邻操作**

在 [`components/challenge/hooks/useChallengeController.ts`](/home/notuhao/code/MahoShojo-Generator/components/challenge/hooks/useChallengeController.ts)：

1. 扩展 API payload 类型为 selection 联合
2. `resolveBattleEnemySnapshot` 计算：

```ts
const selectionSeed = `${runState.runSeed ?? 'no-seed'}:${nodeId}:${nodeType}`;
search.set('selectionSeed', selectionSeed);
```

3. 返回结构改成：

```ts
{
  enemySnapshot,
  resolvedSourceMode,
  resolvedSourceCardLite,
}
```

4. 用单独的瞬时 state 保存当前节点 sidecar，例如：

```ts
const [currentEnemySourceCardLite, setCurrentEnemySourceCardLite] = useState<ChallengeResolvedSourceCardLite | null>(null);
```

5. 在 `resetNodeStageState()`、resume 切换、离开节点时清空 sidecar

- [ ] **Step 4: 改 display resolver 为 sidecar-first + shared renderability**

把 [`lib/challenge/enemy-display.ts`](/home/notuhao/code/MahoShojo-Generator/lib/challenge/enemy-display.ts) 改成：

```ts
export async function resolveChallengeEnemyDisplay(input: {
  enemySnapshot: EnemySnapshotV1 | null;
  resolvedSourceCardLite?: ChallengeResolvedSourceCardLite | null;
  fetchPublicCardById: (id: string) => Promise<unknown | null>;
}): Promise<ChallengeEnemyDisplayState> {
  // 1. 若 resolvedSourceCardLite.id === enemySnapshot.sourceId，先解包 sidecar.data
  // 2. 否则再走 preset / public-card / season-entity 的兼容补查
  // 3. 模板识别与可渲染判断统一调用 source-card-renderability.ts
}
```

要求：

- 不再在 `enemy-display.ts` 内保留另一份模板判断
- sidecar 命中时绝不再发单卡请求
- 兼容补查仍保留给 resume / 历史 `season-entity`

- [ ] **Step 5: 跑展示与页面回归**

Run: `bun test tests/challenge-enemy-display.test.ts tests/challenge-page.test.tsx`
Expected: PASS

- [ ] **Step 6: 提交当前任务**

```bash
git add components/challenge/hooks/useChallengeController.ts lib/challenge/enemy-display.ts tests/challenge-enemy-display.test.ts tests/challenge-page.test.tsx
git commit -m "feat: challenge 节点接入服务端选敌 sidecar"
```

### Task 5: 跑整组合回归并核对低读预算

**Files:**
- Modify: `tests/challenge-enemy-source.test.ts`
- Modify: `tests/challenge-enemy-candidates-api.test.ts`
- Modify: `tests/challenge-enemy-display.test.ts`
- Modify: `tests/challenge-page.test.tsx`
- Optional Modify: `docs/specs/2026-04-05_101533_challenge完整对手卡来源与低RowsRead设计.md`（仅当实现过程中发现必须回写的偏差）

- [ ] **Step 1: 跑 challenge 相关测试集合**

Run:

```bash
bun test tests/challenge-source-card-renderability.test.ts tests/challenge-enemy-source.test.ts tests/challenge-enemy-candidates-api.test.ts tests/challenge-enemy-display.test.ts tests/challenge-page.test.tsx
```

Expected: PASS

- [ ] **Step 2: 跑 lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 3: 如有必要，补一条手工验证清单**

本地或预发手工检查：

1. 新开一个 `/challenge` run，进入 battle / elite / boss 节点
2. Network 中确认请求是 `/api/challenge/enemy-candidates?...selectionSeed=...`
3. 确认选中 `public-card` 时，节点展示不再额外打一次 `/api/public-data-cards?id=...`
4. 人工模拟 remote 不足阈值时，确认接口返回 `resolvedSourceMode='preset-only'`

- [ ] **Step 4: 核对日志埋点是否能解释 fallback**

至少确认一次日志里能看到：

- `leaderboardWindowRequestCount`
- `bulkPublicCardQueryCount`
- `validatedCandidateCount`
- `fallbackReason`

并且：

- 没有完整卡 `data` 落日志
- 没有逐 ID 单卡补查风暴

- [ ] **Step 5: 提交最终整合**

```bash
git add \
  docs/plans/2026-04-05_111037_challenge完整对手卡与低RowsRead实现计划.md \
  lib/challenge/types.ts \
  lib/challenge/source-card-renderability.ts \
  lib/db/repositories/challenge-public-card-read.ts \
  lib/challenge/worlds/arena/enemy-source.ts \
  lib/challenge/server/enemy-candidates.ts \
  pages/api/challenge/enemy-candidates.ts \
  components/challenge/hooks/useChallengeController.ts \
  lib/challenge/enemy-display.ts \
  tests/challenge-source-card-renderability.test.ts \
  tests/challenge-enemy-source.test.ts \
  tests/challenge-enemy-candidates-api.test.ts \
  tests/challenge-enemy-display.test.ts \
  tests/challenge-page.test.tsx
git commit -m "feat: 完成 challenge 完整对手卡低读改造"
```

## 交付完成定义

- `/api/challenge/enemy-candidates` 已同时支持 compatibility / selection 双模式，且字段互斥清晰
- challenge 实际节点主链路已改用 `selectionSeed` 服务端选敌
- remote 路径的 `data_card` 补查失败会被跳过，不再常规产出 `season-entity`
- `resolvedSourceCardLite` 已在当前 controller 会话内复用，display 先吃 sidecar 再考虑兼容补查
- server / client 对“是否可渲染”只剩一套共享纯函数
- 新链路的读预算仍然是“最多两次 leaderboard + 最多两次 `id IN (...)`”
