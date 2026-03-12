# AI 连续战报章节规划设计补充（2026-03-12）

> 状态：讨论结论，待实现。  
> 关联文档：
>
> - `docs/AI_CONTINUOUS_DIALOGUE_DESIGN_2026-03-11.md`
> - `docs/AI_CONTINUOUS_DIALOGUE_IMPLEMENTATION_BLUEPRINT_2026-03-11.md`
> - `public/encyclopedia/continuous-battle-story.md`
>
> 目的：在“连续战报会话”已完成首批落地的基础上，为“总章节数设置 / 固定章节数情景卡”补一份独立设计，明确数据模型、提示词接入点、UI 位置与兼容边界，供后续实现时直接参考。

## 1. 背景

当前连续战报已经具备：

- 本地会话与章节链
- 续写 / 分支 / 重写最后一章
- deterministic digest + AI 摘要
- 基于会话上下文的 `generate-next`

但还缺一个关键能力：

- **显式的章节规划信息**

也就是说，系统目前只知道：

- 当前要写第几章
- 前文发生了什么

却**不知道这条故事原本打算写几章**。

这会带来两个直接问题：

1. AI 容易在中途过早收束  
   当前 prompt 里只有“正在写第 N 章”，没有“总共 M 章”，模型很容易把第 2 章写成大结局。

2. 固定次数的情景卡只能靠文案硬提示  
   例如内置预设 [`public/scenario-presets/S11_mayfly_bossfight_v1.json`](/home/notuhao/code/MahoShojo-Generator/public/scenario-presets/S11_mayfly_bossfight_v1.json) 目前只能通过自然语言要求 AI “分五次生成”，甚至让它去读 `narrative-history` 的条目数来推断当前阶段。这种做法可用，但不稳定，也不利于后续维护。

因此，本补充设计聚焦一个收敛问题：

- 如何在**不重做连续战报架构**的前提下，把“总章节数 / 当前章节定位”正式纳入连续战报会话。

---

## 2. 仓库现状与约束

## 2.1 当前已有的最佳接入点

现有连续战报链路里，最适合接入章节规划的地方已经存在：

- 类型与会话记录：
  - `lib/ai-session/battle-story/types.ts`
  - `lib/ai-session/battle-story/storage.ts`
- 上下文编译：
  - `lib/ai-session/battle-story/context.ts`
- 内部提示词：
  - `lib/ai-session/battle-story/prompts.ts`
- 生成校验：
  - `lib/ai-session/battle-story/generate-next.ts`
- 前端会话入口：
  - `components/arena/hooks/useBattleStorySession.ts`
  - `components/arena/components/BattleStorySessionPanel.tsx`

这意味着“章节规划”应该被当成**连续战报会话的一部分**扩展进去，而不是去改底层 provider 抽象。

## 2.2 当前已有字段不能直接复用

当前 `BattleStorySessionRecord.chapterCount` 的语义是：

- 当前活动章节数 / 已生成章节数

它不是：

- 计划总章节数

因此不能把 `chapterCount` 直接拿来同时表达“已完成 3 章”和“计划共 5 章”。这两个概念必须分开。

## 2.3 章节规划不应放进通用竞技场全局设置

当前一次性竞技场生成并不需要“总章节数”。  
章节规划只对“连续战报会话”有意义。

因此它不适合直接塞进：

- `BattleSettings`
- 通用 `StoryOptionsPanel`

否则会污染普通单次战报心智。

## 2.4 内容层可以增量扩展，但不应靠正则乱猜

当前情景卡 schema 有一个很关键的现实条件：

- [`lib/schemas/scenario.ts`](/home/notuhao/code/MahoShojo-Generator/lib/schemas/scenario.ts) 允许 `_` 前缀的额外字段
- [`lib/schemas/general-scenario.ts`](/home/notuhao/code/MahoShojo-Generator/lib/schemas/general-scenario.ts) 本身就是 catch-all

这意味着：

- **可以安全增加带 `_` 前缀的结构化扩展字段**

但不建议做的事是：

- 在运行时对 `description` / `content` 做通用正则，尝试从自由文本里猜“分五章”“共三回合”

原因：

- 脆弱
- 不可审计
- 易被提示词文本误伤
- 后续难以测试与维护

推荐路线应当是：

1. 新增**结构化情景卡扩展字段**
2. 对已有内置预设做显式补标
3. 不做面向任意自由文本的章节数推断

---

## 3. 设计目标

本次设计的目标是：

1. 让 AI 明确知道“当前第几章 / 共几章”
2. 让非终章与终章拥有不同的收束要求
3. 支持用户手动设置章节数
4. 支持情景卡给出“建议章节数”或“固定章节数”
5. 保持当前 local-first 会话架构，不引入新的服务端数据库依赖
6. 不破坏现有续写 / 重写 / 导出 / 摘要机制

本次**不做**：

1. 不做“服务端自动连跑 N 章”
2. 不做 provider 原生 messages 会话改造
3. 不做情景卡自由文本章节数解析
4. 不做多阶段计划（如“5 战斗章 + 1 后日谈”）的首批泛化协议
5. 不做中途任意回退到中间章节再继续分支的重构

---

## 4. 方案对比

## 4.1 方案 A：只在启动时把“总章节数”拼进 prompt，不进入会话模型

做法：

- 用户输入 5
- 开始会话时把“共 5 章”写进首章 prompt
- 后续续写仍只靠当前 `chapterIndex`

问题：

- 会话记录里没有 canonical plan
- UI、导出、分支、重写都不知道原始计划
- 后续章节如果没再显式传递，信息就丢了

结论：

- 不推荐

## 4.2 方案 B：复用 `chapterCount` 作为计划章节数

做法：

- 让 `chapterCount` 在开始时写成 5
- 每写完一章再改成 1、2、3……

问题：

- 字段语义冲突
- 当前 UI、导出、测试都把它当“已生成章节数”
- 会让重写 / 分支后的语义非常混乱

结论：

- 明确不采用

## 4.3 方案 C：新增显式 `chapterPlan`，并允许情景卡提供结构化提示

做法：

- 会话记录单独保存“计划总章节数”
- 生成时把“当前章 / 总章数 / 是否终章”编译进 prompt
- 情景卡可用结构化字段提供建议值或固定值

优点：

- 语义清楚
- 与现有架构兼容
- 便于 UI / 导出 / 校验 / 测试统一

结论：

- **推荐方案**

---

## 5. 推荐设计

## 5.1 会话层新增 `chapterPlan`

推荐在 TypeScript 业务层新增：

```ts
type BattleStoryChapterPlan = {
  totalChapters: number;
  source: 'user' | 'scenario';
  locked: boolean;
};
```

并挂到 `BattleStorySessionRecord`：

```ts
type BattleStorySessionRecord = {
  // 现有字段...
  chapterCount: number; // 已完成/活动章节数
  chapterPlan?: BattleStoryChapterPlan;
};
```

关键约束：

- `chapterCount` 保持“实际章节数”语义不变
- `chapterPlan.totalChapters` 才是“计划章节数”
- `chapterPlan` 允许缺省，表示开放式会话

建议范围：

- `totalChapters` 首批限制为 `1 ~ 20`
- 超出范围直接拒绝，不进入 prompt

## 5.2 情景卡使用结构化扩展字段，而不是自由文本推断

推荐内容层协议：

```json
{
  "_battle_story": {
    "total_chapters": 5,
    "plan_mode": "fixed"
  }
}
```

字段含义：

- `_battle_story.total_chapters`
  - 情景卡建议或要求的总章节数
- `_battle_story.plan_mode`
  - `suggested`：作为默认值，用户仍可改
  - `fixed`：作为硬约束，用户不可改

边界映射规则：

- 内容层 JSON 保持协议字段风格：`snake_case`
- 进入 TypeScript 业务层后，mapper 转为：
  - `totalChapters`
  - `planMode`

推荐优先级：

1. 情景卡 `fixed`
2. 用户手动设置
3. 情景卡 `suggested`
4. 无设置（开放式）

这套优先级的好处是：

- 强约束卡可以真正锁住流程
- 普通卡也能给默认建议
- 用户手动设置不会被“建议值”意外覆盖

## 5.3 UI 放在连续战报面板，不进入全局竞技场设置

推荐把“章节规划”放在 [`components/arena/components/BattleStorySessionPanel.tsx`](/home/notuhao/code/MahoShojo-Generator/components/arena/components/BattleStorySessionPanel.tsx) 内，而不是通用故事选项里。

推荐交互：

1. 在“新建连续战报”按钮附近新增一块“章节规划”
2. 提供：
   - `不限制`
   - 常用快捷值：`2 / 3 / 5 / 8 / 12`
   - 一个数字输入框
3. 若情景卡提供 `suggested`：
   - 自动预填
   - 用户仍可改
4. 若情景卡提供 `fixed`：
   - UI 显示“情景卡固定 5 章”
   - 输入框只读

推荐展示项：

- 当前进度：`2 / 5`
- 本章定位：`中段推进` / `终章`
- 计划来源：`用户设置` / `情景卡固定`

首批建议只把“未开始会话的默认章节规划”存在面板本地状态或 `localStorage`，不要写进 `BattleStore.settings`。

原因：

- 这是连续战报私有配置
- 普通单次战报并不消费这个字段

## 5.4 Prompt 层新增“章节规划层”

推荐在 [`lib/ai-session/battle-story/context.ts`](/home/notuhao/code/MahoShojo-Generator/lib/ai-session/battle-story/context.ts) 的 prompt section 中新增一层：

```txt
## 章节规划层
- 计划总章节数：5
- 当前要生成：第 2 章 / 共 5 章
- 本章定位：中段推进章
- 剩余章节（含本章）：4
```

并在 [`lib/ai-session/battle-story/prompts.ts`](/home/notuhao/code/MahoShojo-Generator/lib/ai-session/battle-story/prompts.ts) 的内部 guidance 中增加规则：

- 若 `current < total`
  - 不要把全部主线一次性结清
  - 本章需要有阶段性收束，但应留下下一章明确接力点
- 若 `current === total`
  - 这是终章
  - 需要收束主要矛盾、交代主要结果、给出结尾余波

推荐写法示意：

```txt
本会话计划共 5 章，当前正在生成第 2 章。
本章不是终章。请推进主线，但不要提前把整条故事直接写到最终结局；结尾需要留下可供下一章承接的明确变化、悬念或阶段结果。
```

终章示意：

```txt
本会话计划共 5 章，当前正在生成第 5 章。
本章是终章。请完成主线收束，交代主要冲突结果与角色余波，不要再强行留下“下一章继续”的空钩子。
```

这样做的价值是：

- 不依赖情景卡自己数 `narrative-history`
- 不要求用户每一章都手写“这还不是结局”
- 与当前 `internalGuidance` 机制完全兼容

## 5.5 `generate-next` 的校验规则要感知 `chapterPlan`

推荐在 [`lib/ai-session/battle-story/generate-next.ts`](/home/notuhao/code/MahoShojo-Generator/lib/ai-session/battle-story/generate-next.ts) 的现有校验基础上增加一层：

- `start`
  - 若 `chapterPlan.totalChapters` 存在，则必须 `>= 1`
- `continue`
  - 如果下一章索引 `>` `totalChapters`，直接拒绝
- `branch`
  - 如果分支后下一章索引 `>` `totalChapters`，直接拒绝
- `rewrite`
  - 允许重写最后一章
  - 不改变 `chapterPlan`

这意味着首批的明确行为是：

- 达到计划章节数后：
  - **允许重写最后一章**
  - **允许导出**
  - **不允许继续续写**
  - **不允许从当前结尾再 append 新章**

这样可以保持与当前 `branch = 从当前结尾追加一章` 的语义一致，不需要顺手重做分支模型。

## 5.6 分支会话继承 `chapterPlan`

推荐规则：

- 若当前会话存在 `chapterPlan`
- 新分支会话默认继承同一份 `chapterPlan`

原因：

- 分支本质是“另一条路线”，不是“另一种章节总量”

但首批需配套一条约束：

- 如果原会话已经达到固定总章节数，则不再允许从当前结尾创建新分支

否则会天然生成 `total + 1` 章，和固定章节计划冲突。

## 5.7 导出与元数据显示计划进度

推荐更新导出头信息：

当前 [`components/arena/utils/battleStorySession.ts`](/home/notuhao/code/MahoShojo-Generator/components/arena/utils/battleStorySession.ts) 的导出头只有“章节数”，后续建议改为：

- 无计划时：`章节数：3`
- 有计划时：`章节进度：3 / 5`

面板中的“当前会话元数据”建议同步展示：

- 已完成章节数
- 计划总章节数
- 是否已完成

---

## 6. 对情景卡的推荐协议

## 6.1 首批只支持单一 `total_chapters`

首批协议只解决：

- “总共几章”

不解决：

- “前 5 章是战斗，第 6 章必须后日谈”
- “第 3 章必须进入第二阶段”

原因：

- 这些已经从“章节数”进入“章节脚本 / 阶段机”范畴
- 复杂度明显更高
- 当前需求的最小核心只是“总章数 + 当前章”

## 6.2 内置预设建议迁移方式

像 [`public/scenario-presets/S11_mayfly_bossfight_v1.json`](/home/notuhao/code/MahoShojo-Generator/public/scenario-presets/S11_mayfly_bossfight_v1.json) 这类内置卡，后续建议：

1. 保留原有文案描述，作为叙事说明
2. 额外新增结构化字段：

```json
"_battle_story": {
  "total_chapters": 5,
  "plan_mode": "fixed"
}
```

3. 不再让 AI 通过 `narrative-history` 条目数去猜“现在是第几章”

这样做后：

- 章节定位由系统显式提供
- `narrative-history` 回归为“状态推进”用途
- 情景卡文案不再承担控制流程的脆弱职责

## 6.3 复杂情景卡的后续扩展方向

对于“5 战斗章 + 1 后日谈”这类需求，推荐放到下一阶段再讨论，届时可考虑：

```json
"_battle_story": {
  "total_chapters": 5,
  "plan_mode": "fixed",
  "postscript_mode": "manual-epilogue"
}
```

但这不是本次章节数设计的阻塞项。

---

## 7. 风险与规避

## 7.1 不要把“章节规划”塞进普通竞技场生成

风险：

- 污染一次性战报 UI
- 让用户误以为普通生成也会自动分章

规避：

- 仅在连续战报面板展示

## 7.2 不要做自由文本正则推断

风险：

- 不稳定
- 易误判
- 难测

规避：

- 情景卡使用结构化 `_battle_story`

## 7.3 不要让 `chapterCount` 一字段双重语义

风险：

- 会话、导出、测试全部混乱

规避：

- 新增独立 `chapterPlan`

## 7.4 不要在非终章过度强行限制文风

风险：

- prompt 过硬，正文容易僵硬、模板味过重

规避：

- 只约束“是否全局完结”
- 不约束具体文风和必须使用的句式

---

## 8. 更细的实现切片确认

本节在上一版“推荐落地顺序”基础上，进一步细化为可实施切片，并把本轮补充讨论的两个要求一起纳入：

1. 情景卡新增字段后，角色管理页也要允许编辑相关设置，且不影响原生性
2. 内置预设中涉及固定章节/固定次数推进的卡，要补结构化字段

## 8.1 切片 A：内容层协议与 schema 显式化

目标：

- 确定 `_battle_story` 的结构
- 不只依赖 catch-all，而是让 schema 显式知道这个扩展字段

建议修改：

- [`lib/schemas/scenario.ts`](/home/notuhao/code/MahoShojo-Generator/lib/schemas/scenario.ts)
- [`lib/schemas/general-scenario.ts`](/home/notuhao/code/MahoShojo-Generator/lib/schemas/general-scenario.ts)

建议新增业务结构：

```ts
type ScenarioBattleStoryExtension = {
  total_chapters: number;
  plan_mode: 'suggested' | 'fixed';
};
```

推荐做法：

- 内容层继续使用 `_battle_story`
- 但在 schema 中把 `_battle_story` 声明为显式 optional 字段
- 不再完全依赖“因为 `_` 前缀允许，所以随便塞”

这样做的好处：

- 校验更严格
- 编辑器更容易拿到明确类型
- 后续补测试更直接

## 8.2 切片 B：连续战报会话类型与请求 DTO 扩展

目标：

- 让本地会话和服务端生成请求都能感知章节规划

建议修改：

- [`lib/ai-session/battle-story/types.ts`](/home/notuhao/code/MahoShojo-Generator/lib/ai-session/battle-story/types.ts)
- [`lib/ai-session/battle-story/context.ts`](/home/notuhao/code/MahoShojo-Generator/lib/ai-session/battle-story/context.ts)
- [`lib/ai-session/battle-story/prompts.ts`](/home/notuhao/code/MahoShojo-Generator/lib/ai-session/battle-story/prompts.ts)
- [`lib/ai-session/battle-story/generate-next.ts`](/home/notuhao/code/MahoShojo-Generator/lib/ai-session/battle-story/generate-next.ts)
- [`pages/api/arena/session/generate-next.ts`](/home/notuhao/code/MahoShojo-Generator/pages/api/arena/session/generate-next.ts)

建议新增业务层结构：

```ts
type BattleStoryChapterPlan = {
  totalChapters: number;
  source: 'user' | 'scenario';
  locked: boolean;
};
```

并补到：

- `BattleStorySessionRecord.chapterPlan`
- `BattleStoryPromptContextInput.chapterPlan`
- `generate-next` request DTO

这里有一个必须明确的现实约束：

- 当前连续战报是 local-first
- 服务端并不知道浏览器 IndexedDB 里的 session 内容

因此 `generate-next` 不能假设自己能从服务端拿到 `chapterPlan`。  
正确做法是：

- 客户端在每次 `generate-next` 请求时，显式把 `chapterPlan` 一起带上

推荐 DTO 形态：

```ts
chapterPlan?: {
  totalChapters: number;
}
```

首批不需要把 `source` / `locked` 全量透传给服务端。  
服务端只需要知道：

- 本次是否存在固定/建议总章节数
- 当前 `chapterIndex` 是否越界

## 8.3 切片 C：连续战报前端 UI 与计划来源合并

目标：

- 在不污染单次竞技场设置的前提下，让用户能设置章节数
- 同时接收情景卡提供的默认/固定章节规划

建议修改：

- [`components/arena/hooks/useBattleStorySession.ts`](/home/notuhao/code/MahoShojo-Generator/components/arena/hooks/useBattleStorySession.ts)
- [`components/arena/components/BattleStorySessionPanel.tsx`](/home/notuhao/code/MahoShojo-Generator/components/arena/components/BattleStorySessionPanel.tsx)

建议实现：

1. 在会话面板维护一个“待启动章节规划”状态
2. 启动前根据以下优先级解析：
   - 情景卡 `fixed`
   - 用户手动设置
   - 情景卡 `suggested`
   - 无设置
3. 启动会话时，把解析结果写入 `sessionDraft.chapterPlan`
4. 会话开始后：
   - 元数据显示 `已完成 / 总章数`
   - `continue` / `branch` 按总章数判断是否禁用

推荐新增一个纯函数 helper，而不是把优先级硬写在 Hook 内部：

- `resolveBattleStoryInitialChapterPlan`

文件位置可选：

- `lib/ai-session/battle-story/plan.ts`
- 或 [`components/arena/utils/battleStorySession.ts`](/home/notuhao/code/MahoShojo-Generator/components/arena/utils/battleStorySession.ts)

更推荐前者，因为这属于会话业务逻辑，不是纯 UI 工具。

## 8.4 切片 D：角色管理页支持编辑章节规划，且不破坏原生性

目标：

- 情景卡在档案馆中可视化编辑 `_battle_story`
- 这类改动不应导致原生性丧失

建议修改：

- [`components/ScenarioEditor.tsx`](/home/notuhao/code/MahoShojo-Generator/components/ScenarioEditor.tsx)
- [`pages/character-manager.tsx`](/home/notuhao/code/MahoShojo-Generator/pages/character-manager.tsx)

当前代码现状必须注意：

1. [`components/ScenarioEditor.tsx`](/home/notuhao/code/MahoShojo-Generator/components/ScenarioEditor.tsx) 没有章节规划编辑区
2. [`pages/character-manager.tsx`](/home/notuhao/code/MahoShojo-Generator/pages/character-manager.tsx) 的通用 `renderFormFields()` 会直接隐藏所有 `_` 前缀字段
3. 同文件里的原生性丧失判定，目前**没有**忽略 `_` 前缀字段
4. 但 [`lib/signature.ts`](/home/notuhao/code/MahoShojo-Generator/lib/signature.ts) 在签名生成/校验时，默认**已经忽略所有 `_` 前缀字段**

这意味着如果采用 `_battle_story`，角色管理页至少要同步做三件事：

1. 在 `ScenarioEditor` 增加“连续战报章节规划”分组
2. 对 `general-scenario` 也提供同样的编辑入口
3. 把前端原生性比较逻辑同步到“忽略 `_battle_story`”

这里推荐的具体策略不是“忽略所有未知字段”，而是：

- **与签名语义保持一致，至少忽略 `_battle_story`**

如果后续团队确认：

- 所有 `_` 前缀字段都属于兼容协议/非实质内容层元数据

那么前端原生性判定也可以直接统一为：

- 忽略所有 `_` 前缀字段

但无论选择哪一种，必须保证：

- 前端原生性提示
- 服务端签名校验

两边语义一致，不能出现“前端提示会掉原生，实际签名仍有效”或者反过来的情况。

## 8.5 切片 E：模板转换与字段保留策略

目标：

- 避免 `_battle_story` 在模板转换时被静默降级或吞掉

建议修改：

- [`lib/data-card-converter.ts`](/home/notuhao/code/MahoShojo-Generator/lib/data-card-converter.ts)

当前现状：

1. `sanitizeForConversion()` 不会删除 `_` 前缀字段
2. 但 `convertToScenario()` / `convertToGeneralScenario()` 并没有把 `_battle_story` 当结构化字段保留
3. 结果是 `_battle_story` 可能被当作 unmatched 内容并折叠进 `description` / `content`

这对章节规划来说是不合适的，因为：

- 它应该是可计算配置
- 不是情景正文文案

推荐保留规则：

1. `scenario -> general-scenario`
   - 保留 `_battle_story` 为结构化字段
2. `general-scenario -> scenario`
   - 保留 `_battle_story` 为结构化字段
3. `scenario/general-scenario -> magical-girl/canshou/general`
   - 直接丢弃 `_battle_story`
   - 不转写进说明文字

原因：

- `_battle_story` 只对情景类卡有意义
- 不应污染角色卡正文或分析字段

## 8.6 切片 F：内置预设补标策略

目标：

- 只为“仓库中已经明确写出固定章节/固定次数推进”的预设补字段

建议修改：

- [`public/scenario-presets/S11_mayfly_bossfight_v1.json`](/home/notuhao/code/MahoShojo-Generator/public/scenario-presets/S11_mayfly_bossfight_v1.json)
- 视需要同步更新说明文本：[`lib/scenario-presets.ts`](/home/notuhao/code/MahoShojo-Generator/lib/scenario-presets.ts)

当前保守结论：

### 应立即补标

- `S11_mayfly_bossfight_v1.json`
  - 原文已经明确写出“战斗部分的故事分为五次生成”
  - 这是最明确、最低争议的 `fixed` 候选

建议补：

```json
"_battle_story": {
  "total_chapters": 5,
  "plan_mode": "fixed"
}
```

### 暂不补标

- `S05_mirror_mundane_v2.json`
  - 明确是长期循环 / 第 M 次经历
  - 但不是固定总章节数
- `S10_everyday_streaming_v3_1.json`
  - 有阶段和多时间段推进
  - 但不是固定总章节数
- `S06_magical_girl_assessment_day.json`
  - 是单次流程中的“两个阶段”
  - 不是多章连续战报规划

这批卡更适合未来讨论：

- 阶段机
- 回合/节点脚本
- 非固定上限的长线推进

不应在本次“章节数设置”切片里一起做。

## 8.7 切片 G：文档与百科同步

目标：

- 避免后续用户只知道“连续战报支持续写”，却不知道“章节规划”是如何生效的

建议后续同步更新：

- [`public/encyclopedia/continuous-battle-story.md`](/home/notuhao/code/MahoShojo-Generator/public/encyclopedia/continuous-battle-story.md)
- [`public/encyclopedia/scenario-advanced.md`](/home/notuhao/code/MahoShojo-Generator/public/encyclopedia/scenario-advanced.md)

建议补充说明：

- 用户如何设置总章节数
- 情景卡固定章节数如何覆盖用户输入
- 固定章节数达到后为何不能继续 append

---

## 9. `_` 前缀结构化扩展字段 vs 不带前缀字段

本节专门回应本轮新增问题：

- 新增带 `_` 前缀的结构化扩展字段
- 与新增一个不带前缀的普通字段

两种方式有什么区别，哪种更好？

## 9.1 在当前仓库里的真实差异

### 方案 1：使用 `_battle_story`

现实表现：

1. [`lib/schemas/scenario.ts`](/home/notuhao/code/MahoShojo-Generator/lib/schemas/scenario.ts) 当前已经允许 `_` 前缀附加字段
2. [`lib/signature.ts`](/home/notuhao/code/MahoShojo-Generator/lib/signature.ts) 当前默认忽略所有 `_` 前缀字段参与签名
3. 因而这类字段天然更接近“兼容协议/非实质元数据”

### 方案 2：新增非前缀字段，例如 `battle_story`

现实表现：

1. `ScenarioSchema` 当前会把它当非法字段，必须改 allowedKeys
2. 它会默认参与签名
3. 在角色管理页里编辑它，默认会触发原生性丧失
4. 任何转换器、校验器、说明文档都要把它当“正式业务字段”补齐

也就是说，在当前代码基础上：

- `_battle_story` 是顺着已有仓库约定走
- `battle_story` 是在另起一条语义线

## 9.2 使用 `_` 前缀的优点

1. 与当前签名体系天然兼容  
   这是最大的现实优势。项目已经把 `_` 前缀视为签名忽略域，这正好符合“章节规划设置不影响原生性”的目标。

2. 与当前 schema 兼容成本更低  
   即使暂时不显式入 schema，也不会立即被 `ScenarioSchema` 拒绝。

3. 更容易表达“这是协议层扩展，不是正文内容的一部分”  
   章节规划本质上更像运行时控制参数，而不是情景叙事本身。

4. 避免顶层命名空间继续膨胀  
   不会把 `title / description / elements / metadata` 这类正文层字段和控制字段混在一起。

## 9.3 使用 `_` 前缀的缺点

1. 现有通用编辑器通常会主动隐藏它  
   当前 [`pages/character-manager.tsx`](/home/notuhao/code/MahoShojo-Generator/pages/character-manager.tsx) 的通用表单就直接过滤了 `_` 字段。

2. 如果只靠 catch-all，不显式入 schema，会让类型信息模糊  
   这也是为什么本设计推荐：
   - 仍使用 `_battle_story`
   - 但要显式写入 schema / 类型 / 编辑器

3. 团队成员可能误把它理解为“私有字段，可以随便塞任意内容”  
   因此需要在文档中明确：
   - `_` 前缀字段属于兼容协议元数据
   - 不应承载大量叙事正文或 prompt 语料

## 9.4 使用非前缀字段的优点

1. 语义更显眼  
   看 JSON 的人第一眼就知道这是正式字段。

2. 通用表单更容易自然显示  
   不会被“隐藏 `_` 字段”的逻辑拦住。

3. 如果未来确认这是内容层长期稳定主字段，表达会更直接

## 9.5 使用非前缀字段的缺点

1. 会直接进入签名语义  
   这与“允许用户在角色管理页调整章节设置而不影响原生性”的目标相冲突。

2. 当前 schema、转换器、编辑器、说明文档都要同步扩容  
   改造面更大，而且更容易漏。

3. 它会把“控制配置”误提升为“卡内容主结构”  
   对当前项目的内容层边界来说，这不是最合适的抽象。

## 9.6 推荐结论

结合当前仓库现状，**更好的方式是：继续使用带 `_` 前缀的结构化扩展字段，但把它显式类型化，而不是只靠隐式 catch-all**。

也就是推荐：

```json
"_battle_story": {
  "total_chapters": 5,
  "plan_mode": "fixed"
}
```

而不推荐：

```json
"battle_story": {
  "total_chapters": 5,
  "plan_mode": "fixed"
}
```

推荐理由不是抽象偏好，而是当前代码已经给出的现实基础：

1. `_` 前缀字段默认不参与签名
2. `_` 前缀字段当前已被 schema 接受
3. 本需求明确希望“在角色管理页中允许用户调整章节设置，且不影响原生性”

这三点叠加后，`_battle_story` 显然更贴合现状。

## 9.7 需要同步声明的边界

如果采用 `_battle_story`，建议在文档里明确约定：

1. `_battle_story` 属于兼容协议元数据
2. 它只承载小型、结构化、可计算的控制信息
3. 它不承载长篇正文，不承载大量 prompt 文本
4. 它在情景类卡之间应结构化保留
5. 它在角色卡目标模板转换时应被主动丢弃

这样可以避免 `_` 前缀被滥用成“万能垃圾桶”。

---

## 10. 建议测试范围

后续实现时，至少补以下回归测试：

1. `prompt` 层
   - 有计划章节数时，非终章 guidance 正确
   - 终章 guidance 正确
2. `generate-next` 校验
   - `continue` 超过 `totalChapters` 被拒绝
   - 达到总章节数后 `rewrite` 仍允许
3. `session` 逻辑
   - 分支会话继承 `chapterPlan`
   - 固定章节完成后禁用继续续写
4. `scenario` 映射
   - `_battle_story.plan_mode = suggested`
   - `_battle_story.plan_mode = fixed`
5. `character-manager` 原生性
   - 仅修改 `_battle_story` 不触发 `hasLostNativeness`
6. `signature` 行为
   - 修改 `_battle_story` 后 `verifySignature` 仍保持一致
7. `data-card-converter`
   - `scenario <-> general-scenario` 保留 `_battle_story`
   - 转到角色模板时丢弃 `_battle_story`
8. `export`
   - 有计划时输出 `3 / 5`

---

## 11. 推荐落地顺序（后续实现时）

1. 补 `chapterPlan` 类型与 session record
2. 补 `_battle_story` schema 与解析 mapper
3. 调整 `character-manager` / `ScenarioEditor`，使 `_battle_story` 可编辑且不破坏原生性
4. 补 `data-card-converter` 的 `_battle_story` 保留/丢弃策略
5. 在 `BattleStorySessionPanel` 增加“章节规划” UI
6. 在 `context.ts` / `prompts.ts` 注入章节规划 prompt
7. 在 `generate-next.ts` 与请求 DTO 中增加计划章节数校验
8. 更新导出头与会话元数据显示
9. 为内置固定章节情景卡补结构化字段
10. 补测试与百科文档

---

## 12. 结论

本次需求最稳妥的设计，不是“多加一句 prompt”，而是：

- 在连续战报会话中新增 **显式 `chapterPlan`**
- 在情景卡中新增 **结构化 `_battle_story` 扩展**
- 在 prompt 中显式注入 **当前章 / 总章数 / 是否终章**

这样可以同时解决三件事：

1. 用户可手动规划长篇分章
2. 固定章节数情景卡不再依赖脆弱文案控制
3. 当前连续战报的 UI、导出、校验与分支语义都能保持一致

这是与当前仓库结构最兼容、实现风险最低、后续可扩展性也最好的路线。
