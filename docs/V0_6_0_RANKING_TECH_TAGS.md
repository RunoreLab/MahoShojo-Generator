# v0.6.0 设计记录：排位分 / 技术值 / 定位标签 / 百科 / 排行榜

更新时间：2026-01-04  
适用项目：Next.js（Edge Runtime）+ Cloudflare D1 + Tailwind 4 + Vercel AI SDK 1.x

> 说明：本文是「可落地」的设计草案，用于讨论与实现对齐；具体数值（K 因子、段位阈值、技术值权重等）允许在上线后根据分布与反馈迭代。

---

## 快速实现索引（给开发者）

> 目标：把本文变成“能直接开工”的实现说明书（DB / API / 触发点 / 幂等 / 回填 / 验收）。

**核心落点**
- 计分触发点：非流式 `pages/api/generate-battle-story.ts`（以及兼容的 `pages/api/arena/generate.ts`）与流式 `pages/api/arena/generate-stream.ts`（在写入 `battle_report_generations` + `battle_report_generation_combatants` 之后异步结算；当前前端非流式与 PVP 结算均走 `/api/generate-battle-story`）
- 排位持久化：新增 `arena_ratings`（当前分）+ `arena_rating_events`（审计/去重/回放）
- 技术值实现：已存在 `lib/metrics/techIndex.ts`（本文仅定义落库口径与对外接口）
- 标签体系：新增 `tags` / `data_card_tags`（v0.6.0 默认“只选不创”）
- 公共排行榜：默认只展示 `data_cards.is_public=1 AND review_status='approved'` + 预设；作者可额外看到“我的卡的当前位置”（不影响公共名次）

**必须明确的 3 个工程约束**
1. **幂等**：同一 `generation_id` 在同一天梯（strict/free）下最多只能结算一次（允许重试但不得重复加分）
2. **可审计**：任何分数变化必须能反查到 `battle_report_generations.id`
3. **Edge 友好**：计算必须可在 `executionContext.waitUntil(...)` 中执行，超时/失败不影响主链路返回

## 0. 目标与边界

### 0.1 已确认的口径（来自本次讨论）
- 排位分的“对象”统一以 **数据卡 ID（`data_cards.id`）** 为准；预设角色以 **`preset filename`** 作为 ID。
- strict 排位：**允许自由挑对手**，但 **必须登录才计分**。
- free 排位：**不强制登录** 也可计分。
- 平局：**计入对局数**，并按 Elo 的 `S=0.5` 微调分数。
- 预设角色：**出现在排行榜里**（与数据库角色卡同榜展示）。
- v0.6.0 对“是否只做 1v1 计分”的态度：你表示“都行”，本文按“先 1v1”做 MVP，后续再扩展多人/队伍。
- PVP 触发的战报：**允许计入排位**（仍需满足 strict/free 的计分资格；通常更偏向落在 free）。

### 0.2 术语表（本文统一口径）
- **实体（Entity）**：参与计分/榜单展示的对象。v0.6.0 仅包含：数据库角色卡（`data_cards.id` 且 `type='character'`）与预设角色（`preset filename`）。
- **实体键（entityKey）**：字符串标识，格式：`data_card:<id>` 或 `preset:<filename>`（用于事件去重与组合 key）。
- **天梯（queue/ladder，旧称“梯子”）**：`strict` / `free` 两套独立评分。
- **对局主键（generation_id）**：`battle_report_generations.id`，本文所有结算/审计均以它为锚点。

### 目标（v0.6.0）
- 在「生成战报」的链路上，**满足条件则计算并记录排位分**，并提供排行榜/筛选展示。
- 为角色卡/情景卡提供「定位标签」体系（从项目内标签库选择），并在 UI 中展示与筛选。
- 提供「技术值（tech index）」指标：尽量反映“技术/规则/提示词密集度”，并用于 UI 提示与筛选。
- 提供百科/教程入口：解释概念（竞技场、历战、升华、排位、标签、技术值等）。

### 非目标（建议 v0.6.0 先不做 / 或弱化）
- 不追求“电竞级公平”的排位：本项目胜负来自 LLM 叙事裁判，天然存在波动与可博弈空间。
- 不把排位当作「用户」排位：更贴合本项目的做法是把它视为「角色卡强度/稳定性指标」的近似统计。
- 不一次性解决所有对局形态（多人混战/多胜者/复杂队伍）：建议分阶段支持。

---

## 1. 排位分（Rank Rating）

### 1.1 关键原则（与你的想法对齐并补强）
1. **只在“可追溯、可复现、可归因”的对局上计分**：避免本地上传/临时编辑/注入引导导致的污染。
2. **计分必须可审计**：每一次分数变化要能追溯到某条战报生成记录（`battle_report_generations`）。
3. **宁可漏算，不可错算**：匹配不到参战者/胜者，或胜负不清晰 → 不计分，并记录原因。
4. **分数变化有上限且递减趋零**：推荐使用 Elo（或 Elo 的轻微改造），天然满足你的“上限 + 趋零”要求。

### 1.2 数据来源（利用现有表，减少新侵入）
现有落库点（已存在）：
- `battle_report_generations`：包含 `mode / has_user_guidance / has_adjudication_events / read_arena_history / read_current_state / combatant_count / winner / endpoint / user_id ...`
- `battle_report_generation_combatants`：包含每位参战者 `name / is_preset / data_card_id / template_id / character_guidance / team_id ...`

因此 v0.6.0 的排位系统可以按以下原则实现：
- **以 generation_id 作为“对局主键”**（而不是重新造一个“match id”）：排位事件与这条生成记录强绑定。
- 排位计算在 `api/arena/generate` / `api/arena/generate-stream` 生成成功后，用 `executionContext.waitUntil(...)` 非阻塞执行（与现有“写战报日志”一致）。

### 1.3 计分资格判定（Eligibility）

#### 基础资格（两类排位都必须满足）
- 参战者全部满足之一：
  - 来自数据库角色卡：`battle_report_generation_combatants.data_card_id IS NOT NULL`
  - 或系统预设：`battle_report_generation_combatants.is_preset = 1`
- `battle_report_generations.status = 'completed'`
- `battle_report_generations.ip_anonymized IS NOT NULL`（free 天梯限速所需；若为空则该局 strict/free 都不计分）
- 能从战报解析出胜负，且能把胜者与参战者**唯一匹配**：
  - `winner = '平局'` → 允许（视为平局）
  - `winner` 为单个名字 → 必须匹配到且仅匹配到 1 名参战者
  - `winner` 为多个名字（含顿号/逗号分隔）→ v0.6.0 建议先按“多人/非竞赛”处理：**默认不计分**（见 1.7 分阶段支持）
- 若出现以下任一情况：**不计分**
  - 胜者字符串为空/未知
  - 胜者无法与参战者匹配（或匹配到多个同名参战者）
  - 参战者存在“本地上传但非数据库卡、且非预设”的情况

> 备注：为了把预设角色稳定地当成一个可计分实体，建议在 `battle_report_generation_combatants` 将 “preset filename” 写入 `name/template_id` 或其他合适的字段（建议不必专门增加新字段）。

#### 参战者 → 计分实体 的解析规则（必须统一）
对每个 `battle_report_generation_combatants` 记录，按以下顺序解析：
1) `is_preset = 1`：
   - `entity_type = 'preset'`
   - `entity_id = template_id ?? name`（优先 `template_id`，兜底用 `name`）
2) 否则若 `data_card_id IS NOT NULL`：
   - `entity_type = 'data_card'`
   - `entity_id = data_card_id`
3) 其他情况：该参战者不具备计分资格（按“基础资格”整体跳过该局）

> 说明：这样做可以避免“同名角色”导致的歧义，并且与本项目现有落库字段完全兼容（不需要新加 combatant 字段）。

#### 胜者匹配规则（v0.6.0：宁可漏算，不可错算）
输入：`battle_report_generations.winner`（由 `extractWinnerFromText` 提取）
- 若 `winner` 为空：不计分（`skip_reason='winner-empty'`）
- 若 `winner = '平局'`：视为平局（`winner_slot=0`）
- 若 `winner` 包含明显分隔符（如 `,`/`，`/`、`/`/`/`/`&`/`和`）→ 视为多胜者：v0.6.0 默认不计分（`skip_reason='multi-winner'`）
- 否则：对 `winner` 做轻量归一化（建议：`trim()` + 去掉结尾括号注释 `（...）/(...)` + 去掉尾部标点），再与参战者的 `name`（同样归一化）做匹配：
  - 匹配到且仅匹配到 1 个参战者：`winner_slot = 1/2`
  - 0 个或 >1 个：不计分（`skip_reason='winner-ambiguous'`）

#### 严格排位（Strict）资格（在基础资格之上叠加）
严格排位的目标是尽量排除“额外操控/额外上下文”，仅限经典模式+无引导/随机判定+不读叙事历史/历战/当前状态（没有额外的操控或输入），并固定输出语言口径。对应到现有字段可落为：
- `mode = 'classic'`
- `language = 'zh-CN'`（简体中文）
- `selected_level IS NULL OR selected_level = ''`（等级为默认/未指定）
- `has_user_guidance = 0`
- `has_adjudication_events = 0`
- `read_arena_history = 0`
- `read_current_state = 0`
- `extra_json.readNarrativeHistory = 0`（禁止读取叙事历史；缺失则按“宁可漏算”处理为不具备资格）
- `battle_report_generation_combatants.character_guidance IS NULL`（或全为空串）
- `battle_report_generations.user_id IS NOT NULL`（必须登录才计分）
- v0.6.0 建议再加一条：`combatant_count = 2`（先只做 1v1，减少多人/队伍歧义）

注意：如果用户更新角色卡 JSON（即主表 `data_cards.data` 实际发生变化），则 **重置严格排位分** ，但不重置自由排位分；若更新仅提交到待审核表、线上仍在使用旧版本，则不会立即重置，直到该更新被应用到主表为止。

#### 自由排位（Free）资格
- 满足基础资格即可；不要求 classic/无引导/不读状态。
- v0.6.0 建议先限定 `combatant_count = 2`（你表示“都行”，此处按 MVP 落地）。

#### 严格与自由的关系（推荐）
- 若满足严格排位：**同时更新 strict 与 free**（strict 是 free 的子集，便于用户理解）
- 若仅满足自由排位：只更新 free

### 1.4 算法推荐：Elo（带 K 因子分段）

#### 为什么不直接上 TrueSkill/Glicko？
- TrueSkill/Glicko 更精细，但引入 RD/σ 等参数、以及多人/队伍的复杂更新逻辑；在“LLM 裁判”这个噪声源很大的场景里，过度精细反而更难解释。
- Elo 足够满足：
  - 分数变化有上限（由 K 控制）
  - 强弱差越大，变化越趋于 0（E 趋近 0/1）
  - 易解释、易调参、易审计

#### 基础公式（1v1）
- 期望胜率：`E_A = 1 / (1 + 10 ^ ((R_B - R_A) / 400))`
- 实际得分：胜=1，平=0.5，负=0
- 分数变化（允许双方 K 不同）：
  - `Δ_A = round(K_A * (S_A - E_A))`
  - `Δ_B = round(K_B * (S_B - E_B))`

> 说明：当 `K_A != K_B` 时，`Δ_A + Δ_B` 不一定为 0（这在 Elo 家族里是正常且可接受的）。如果你强烈希望“严格零和”，可以在 v0.6.1+ 改为 `K_common = min(K_A, K_B)` 或固定 K。本文 v0.6.0 默认采用“各算各的”，以满足“新卡收敛更快、老卡更稳”。

#### K 因子建议（可调）
推荐用“对局数分段”实现“新卡收敛更快、老卡更稳定”：
- `games < 10`：K=40（定级期）
- `10 <= games < 30`：K=24
- `games >= 30`：K=16

并且你想要“变动应当有上限”，可以再加硬上限：
- `abs(Δ) <= 50`（或直接让上限 = K，避免二次规则）

#### 初始分（必须定死，避免实现分歧）
- `initial_rating = 1000`
- `initial_games = 0`，`wins/losses/draws = 0`
- 任意实体首次参与计分时：`INSERT OR IGNORE` 初始化（见 1.8 DDL）

### 1.5 段位（Tier）设计（无牌/白牌/字牌/花牌/权杖）

#### 推荐做法（v0.6.0：固定阈值 + 可配置）
把段位当作 rating 的“视图层映射”，并放到配置中（未来可热更新）：
- 无牌：`games < placementGames`（例如 5）或 `rating < 900`
- 白牌：`900–1099`
- 字牌：`1100–1299`
- 花牌：`1300–1599`
- 权杖：`>= 1600`

细分 I/II/III 的两种方式：
- 方式 A：每档 100 分拆 3 段（例如 900-999/1000-1049/1050-1099）
- 方式 B：按分段对局数（I 要求 5 局、II 要求 15 局、III 要求 30 局），更抗刷分

> 建议：先做“分数阈值 + placementGames”，后续再决定是否引入“段位晋级赛/保护分”等复杂规则。

### 1.6 预设角色排位分：三种方案对比与推荐

#### 方案 1：预设分写入仓库（静态）
优点：
- 实现最简单，不依赖 DB 状态
缺点：
- 你已经指出的：难以调参、可能被用作刷分工具（因为用户可以挑对手）
- 无法反映环境变化（新卡强度导致整体分布变化）

#### 方案 2：预设角色在 DB 中有专属条目（动态）
优点：
- 可动态收敛；可做风控（限制预设参与的计分）
缺点：
- 需要“预设初始化/补全”机制，避免 DB 缺失导致异常

#### 方案 3（推荐）：Hybrid——预设的“身份”静态，排位分动态落库
做法：
- 预设列表仍由 `pages/api/get-presets.ts` 管理（静态、Edge 友好）
- 新增 `arena_ratings` 表时，允许 `entity_type='preset'`，`entity_id` 取预设 `filename`
- 若某预设首次参与计分但 DB 无记录：用“默认初始分 + games=0”初始化（`INSERT OR IGNORE`）

这样可以同时满足：
- 不需要把“预设角色本体数据”写进 DB（仍走 `public/presets/*.json`）
- 排位分可动态调整、可回滚、可审计

### 1.7 多人/多胜者/队伍：建议分阶段支持
你的设计已经考虑“胜者可能多个”。为了 v0.6.0 可控，建议：

#### v0.6.0（MVP）
- 仅对 `combatant_count=2` 的对局计分
- `winner` 仅允许：单一胜者或平局

#### v0.6.1+
- 支持“队伍对战”（team vs team）：
  - 以队伍平均分/最高分作为队伍分（两种都可，前者更稳）
  - 将胜负结果按“队伍”更新，再把变化分配给队伍成员（平均分摊或按个人分权重）
- 支持“多人混战”（FFA）：
  - 最简单可解释的方案：pairwise Elo（胜者对每个败者各算一次，再求和并做上限裁剪）
  - 但需要明确：多胜者/平局/名次制如何映射到 S 值（建议采用“名次”而不是“胜者列表”）

### 1.8 数据模型建议（D1 / SQLite）

#### 1) 当前分表（必须）
`arena_ratings`：保存每个实体在 strict/free 下的当前分、对局数与胜负统计。

#### 2) 变动事件表（必须）
`arena_rating_events`：保存每次变动的 before/delta/after，并关联 `generation_id`，用于：
- 幂等（同一局不重复计分）
- 审计（反查某次分数变化的原因）
- 风控（时间窗去重、限速）

#### 1.8.1 DDL（建议直接追加到 `lib/database/schema.sql`）
```sql
-- =================================================================
-- Arena 排位（v0.6.0）
-- =================================================================

CREATE TABLE IF NOT EXISTS arena_ratings (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('data_card', 'preset')),
  entity_id TEXT NOT NULL,
  queue TEXT NOT NULL CHECK(queue IN ('strict', 'free')),

  rating INTEGER NOT NULL DEFAULT 1000,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  PRIMARY KEY (entity_type, entity_id, queue)
);

CREATE INDEX IF NOT EXISTS idx_arena_ratings_queue_rating ON arena_ratings(queue, rating DESC);
CREATE INDEX IF NOT EXISTS idx_arena_ratings_queue_games ON arena_ratings(queue, games DESC);
CREATE INDEX IF NOT EXISTS idx_arena_ratings_updated_at ON arena_ratings(updated_at);

CREATE TABLE IF NOT EXISTS arena_rating_events (
  id TEXT PRIMARY KEY NOT NULL,
  generation_id TEXT NOT NULL,
  queue TEXT NOT NULL CHECK(queue IN ('strict', 'free')),

  status TEXT NOT NULL CHECK(status IN ('pending', 'applied', 'skipped', 'failed')),
  skip_reason TEXT,

  user_id INTEGER,
  ip_anonymized TEXT,

  pair_key TEXT NOT NULL, -- 规范化后的 entityKey 组合（无序）

  a_entity_type TEXT NOT NULL CHECK(a_entity_type IN ('data_card', 'preset')),
  a_entity_id TEXT NOT NULL,
  b_entity_type TEXT NOT NULL CHECK(b_entity_type IN ('data_card', 'preset')),
  b_entity_id TEXT NOT NULL,

  winner_slot INTEGER NOT NULL CHECK(winner_slot IN (0, 1, 2)), -- 0=平局, 1=A 胜, 2=B 胜

  a_before_rating INTEGER,
  a_after_rating INTEGER,
  a_delta INTEGER,
  a_before_games INTEGER,
  a_after_games INTEGER,

  b_before_rating INTEGER,
  b_after_rating INTEGER,
  b_delta INTEGER,
  b_before_games INTEGER,
  b_after_games INTEGER,

  details_json TEXT,

  created_at TEXT NOT NULL,
  applied_at TEXT,

  FOREIGN KEY (generation_id) REFERENCES battle_report_generations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE (generation_id, queue)
);

CREATE INDEX IF NOT EXISTS idx_arena_rating_events_queue_created_at ON arena_rating_events(queue, created_at);
CREATE INDEX IF NOT EXISTS idx_arena_rating_events_user_pair_created_at ON arena_rating_events(user_id, pair_key, created_at);
CREATE INDEX IF NOT EXISTS idx_arena_rating_events_ip_pair_created_at ON arena_rating_events(ip_anonymized, pair_key, created_at);
```

#### 1.8.2 幂等与并发处理（实现口径）
v0.6.0 推荐采用“事件先行”的两阶段：
1) **插入事件（pending/skipped）**：`INSERT OR IGNORE`，利用 `UNIQUE(generation_id, queue)` 保证幂等  
2) **若事件为 pending 才应用**：读出双方当前 rating → 计算 Δ → 更新 `arena_ratings` → 将事件置为 `applied` 并写入 before/after/delta  

> 注意：如果你担心“更新 ratings 成功但写 event 失败导致重复加分”，需要在实现中把事件状态更新做成**强重试**（例如最多 3 次 + 指数退避），并在失败时将事件标记为 `failed`（同时把本次 generation_id 加入告警/巡检列表）。这属于 v0.6.0 的关键验收点（见 6.1 验收标准）。

### 1.9 风控与反刷分（建议至少做基础版）
排位系统如果不加约束，很容易被“重复生成同一对局”刷分。建议的最低成本风控：
- strict：**必须登录**才计分（`battle_report_generations.user_id IS NOT NULL`）
- strict：**同一用户**在一定时间窗内（如 10 分钟）对同一对手组合只计分一次（用 `arena_rating_events` + 组合 key 实现；尤其适配“自由挑对手”）
- strict：每日计分上限（例如 strict 每日最多 80 局）
- free：因为允许匿名，建议至少做“弱风控”（例如按 `ip_anonymized + 对手组合` 限速），否则 free 更像“娱乐分”（可接受但需在 UI/百科中说明）

#### 1.9.1 对手组合 key（pair_key）定义（必须统一）
- `entityKey = "${entity_type}:${entity_id}"`（如：`data_card:xxxxxxxx` / `preset:homura.json`）
- `pair_key = sort([entityKeyA, entityKeyB]).join('|')`
- 目的：把 “A vs B” 与 “B vs A” 视为同一组合

#### 1.9.2 去重查询口径（示例）
- strict（按用户）：`queue='strict' AND status='applied' AND user_id=? AND pair_key=? AND created_at >= ?`
- free（按脱敏 IP）：`queue='free' AND status='applied' AND ip_anonymized=? AND pair_key=? AND created_at >= ?`

> 规则：如果 `ip_anonymized IS NULL`，则 free 天梯不计分（避免无法限速）。由于 strict 命中会同时更新 free，为保证 strict ⊆ free，v0.6.0 直接将该条件放入“基础资格”，使该局 strict/free 均跳过（宁可漏算）。

---

## 2. 技术值（Tech Index）

### 2.1 目标定义
技术值不是“强度值”，而是一个**提示风险/提示风格**的指标：
- 提醒用户：该卡可能包含大量规则、元叙事、提示词工程、结构化约束、代码/伪代码等内容
- 在一定程度上也可能预测强度（因为“规则密度高”往往更容易影响裁判）

### 2.2 计算输入与稳定性
技术值必须满足一个工程约束：**同一张卡，在不同页面/不同调用链路下计算结果一致**。因此输入需要“去噪 + 规范化”。推荐口径：

1) 输入对象：**数据卡 `data` 字段的 JSON**（即 `data_cards.data`，或预设的 `public/presets/*.json`）

2) 规范化（Canonicalization）：解析 JSON 后先做“剔除不应计入技术值的字段”，再做特征抽取  
建议默认忽略（不参与结构与文本统计）的字段/分支：
- `signature` / `templateId` / `isPreset`（非内容本体，且不同生成链路可能存在差异）
- `_author` / `_authorId`（写库时注入，避免把作者名当成“技术值”）
- `arena_history` / `adjudicationEvents` / `current_state`（运行态“对局上下文/历战/裁判事件”，不应污染“卡本体技术值”）

3) 文本抽取与资源上限（Edge Runtime 友好）：  
对 JSON 值做深度遍历抽取字符串，建议设置安全上限（防止极端卡导致耗时/内存飙升）：
- `max_depth = 6`（深层内容对“技术值”增益有限）
- `max_nodes = 6000`（遍历节点数上限）
- `max_chars = 250_000`（抽取字符串总字符上限；超过部分仍可统计结构，但不再拼接进文本 blob）

4) 特征类型：v0.6.0 先按两大类落地即可，后续可扩展
- **关键词/符号密度特征**：提示词工程/规则/代码/公式等“技术信号”的出现频率与覆盖面
- **结构复杂度特征**：对象深度、键数量、数组规模、行/列表结构等“复杂度信号”

参考资料（用于标定与自检）：`/mnt/d/04-生活与娱乐/魔法少女竞技场`  
其中包含大量历史角色卡 JSON 与强度榜单文本，可用于：
- 检查“高技法卡”是否能被指标拉高（例如：带大量规则/优先级/反注入的卡）
- 检查“纯长文本叙事卡”是否不会被误伤（长度高但技术密度低）
- 对照强度榜单做 sanity check（仅作参考，不作为监督学习标签）
  - 强度榜单：`/mnt/d/04-生活与娱乐/魔法少女竞技场/社群内排行榜单/AAA MLA V9.0/📘 魔法少女  残兽 强度排行榜（非原生篇）V8.0.txt`

### 2.3 v0.6.0 推荐的“可解释”指标结构
输出建议包含三层：
- `techScore`：0–100（连续值）
- `techLevel`：L0–L5（离散档位，用于 UI 徽章）
- `techNotes`：可选的解释信息

#### 2.3.1 从 JSON 抽取文本 blob（落地口径）
- 深度遍历 JSON 的**值**（不遍历 key 名作为正文，但 key 名会进入结构统计）
- 收集所有字符串（保留原始换行），并用换行拼接为 `text_blob`
- 在抽取阶段就执行 2.2 的“忽略字段”与资源上限

#### 2.3.2 建议纳入的“原始特征”（v0.6.0 最小闭环）
下面这些特征的共同点是：**可解释、可快速计算、对 Edge Runtime 友好**。建议全部落库（至少进 `details_json`），便于后续调权重/重算。

**A. 结构复杂度（JSON Structure）**
- `json_total_nodes`：遍历到的节点总数（含对象/数组/原子值）
- `json_total_keys`：所有对象的 key 总数（忽略字段不计入）
- `json_unique_key_count`：去重后的 key 数（反映 schema 丰富度）
- `json_max_depth`：最大深度（裁剪到 `max_depth`）
- `json_array_count`：数组节点数
- `json_total_array_elems`：数组元素总量（裁剪后）
- `json_max_array_len`：最大数组长度（常对应“规则清单/技能列表/约束列表”）
- `json_string_chars_total`：所有字符串累计字符数（与 `text_blob` 长度接近，但不受 `max_chars` 拼接策略影响）
- `json_longest_string_chars`：最长单段字符串长度（常对应“总规则声明/绝对条款”）

**B. 格式/结构化写作（Formatting & Layout）**
这些是“提示词工程常见外观特征”，即便没有明确关键词，也能抓到“结构化约束”的痕迹：
- `line_count`：`text_blob` 行数
- `unique_line_count`：去重后的非空行数（对“重复条款/模板化段落”敏感）
- `repeat_line_ratio`：重复行比例（`1 - unique_line_count / max(line_count, 1)`；建议对行做 `trim()` 后再去重）
- `bullet_line_count`：以 `-/*/数字序号/①②③…` 等开头的行数（规则/步骤/条款密集时会显著升高）
- `heading_line_count`：Markdown 标题行数（`#`）
- `code_fence_count`：``` 代码块出现次数（少见但信号很强）
- `uppercase_snake_count`：形如 `ENEMY_PRESENCE` 的变量 token 数（伪代码/规则引擎常见）

**C. 关键词/符号（Keyword & Symbol Signals）**
建议按“类别计数”，并同时保留一个“加权总和”，避免单一关键词被刷爆。

控制/提示词工程（Control / Prompting）
- `kw_must`：强制性/禁止性词（必须/务必/不得/禁止/只能/严格…；MUST/NEVER/DO NOT…）
- `kw_system`：系统/优先级/覆盖词（系统/system/sys/优先级/override/不可覆盖/最高优先级…）
- `kw_format`：输出格式/结构约束词（输出/格式/JSON/YAML/schema/字段/key/仅输出/不要输出…）
- `kw_role`：角色/对话角色词（你是/作为/扮演/role: /assistant/user/developer…）
- `kw_meta`：元叙事/元指令/反注入词（元叙事/元指令/meta/prompt/提示词/越狱/jailbreak/注入/忽略之前…）
- `kw_exploit`：强信号“技法/漏洞化”词（代码杀/战报控制/系统归零/重置系统/绕过裁判/overrideConflictResolution…）

规则/数值/机制（Mechanics）
- `kw_dice`：掷骰/判定（掷骰/骰子/判定/d20/1d100/d\\d+…）
- `kw_combat`：战斗系统词（回合/阶段/先攻/行动/冷却/CD/技能/效果/状态/HP/MP/buff/debuff/伤害/概率/%…）

代码/公式（Code / Math）
- `kw_code`：代码符号与语法（```/function/return/if/else/for/while/=>/==/&&/||/const/let/var/JSON.parse…）
- `kw_math`：数学与公式符号（∑/∏/∞/φ/log/exp/阶乘/13!/n!!/x^2 等）

> 备注：建议将 `kw_exploit` 单独存储（甚至可作为系统标签触发条件），因为它更像“风险提示”而不是一般复杂度。

#### 2.3.3 派生特征（密度/归一化用）
为了区分“纯堆料长文本”与“技术密集”，至少需要一个密度指标：
- `kw_control_weighted_sum`：对控制类关键词做加权求和（见 2.3.4）
- `tech_density_per_1k_chars = kw_control_weighted_sum / max(json_string_chars_total, 1) * 1000`
- `mechanics_density_per_1k_chars = (kw_dice + kw_combat) / max(json_string_chars_total, 1) * 1000`
- `code_density_per_1k_chars = (kw_code + kw_math + uppercase_snake_count + code_fence_count*10) / max(json_string_chars_total, 1) * 1000`

> v0.6.0 不强制落地“回归残差（residual）”，因为需要维护拟合参数；但可以把它作为 v0.6.1+ 的增强项（离线标定后固化系数）。

#### 2.3.4 v0.6.0 推荐的指标计算方式（权重 + 饱和函数）
目标：简单、可解释、可调参，并且对极端卡不会爆表。

1) 关键词加权（用于 `kw_control_weighted_sum`）
- `kw_must * 1.0`
- `kw_system * 1.2`
- `kw_format * 1.0`
- `kw_role * 0.8`
- `kw_meta * 0.8`
- `kw_exploit * 1.5`

2) 把各维度归一化到 0–1（建议用对数饱和，抗极端值）
- `kw_control_weighted_sum = 1.0*kw_must + 1.2*kw_system + 1.0*kw_format + 0.8*kw_role + 0.8*kw_meta + 1.5*kw_exploit`
- `clamp01(v) = min(1, max(0, v))`
- `norm(x; cap) = clamp01( ln(1+x) / ln(1+cap) )`（`ln` 为自然对数）

3) 维度得分（0–1）
- `score_control = norm(tech_density_per_1k_chars; cap=12)`
- `score_mechanics = norm(mechanics_density_per_1k_chars; cap=10)`
- `score_code = norm(code_density_per_1k_chars; cap=3)`（稀疏但强信号，cap 取小但留余量）
- `score_structure = 0.35*norm(json_total_keys; cap=120) + 0.35*norm(json_total_nodes; cap=320) + 0.20*norm(json_max_array_len; cap=90) + 0.10*norm(repeat_line_ratio; cap=0.35)`
- `score_size = norm(json_string_chars_total; cap=40000)`（仅作弱权重，避免长叙事误伤）

4) 合成 `techScore`（0–100）
- `techScore = round(100 * (0.35*score_control + 0.25*score_mechanics + 0.20*score_structure + 0.15*score_code + 0.05*score_size))`
- 额外规则（可选，风险提示更敏感）：若 `kw_exploit > 0`，则 `techScore = min(100, techScore + 10)`

5) `techLevel` 映射（可配置）
推荐先用固定阈值（后续可改成按分位数切档）：
- L0：`0–9`
- L1：`10–24`
- L2：`25–39`
- L3：`40–59`
- L4：`60–79`
- L5：`80–100`

#### 2.3.5 初始标定建议（来自参考语料的分布）
对 `/mnt/d/04-生活与娱乐/魔法少女竞技场` 下随机抽样的 JSON（约 600 份）做快速统计，可得到一组“够用”的初始 cap（便于让分数落在合理区间）：
- `json_string_chars_total`：P95 约 30k
- `tech_density_per_1k_chars`：P95 约 10
- `mechanics_density_per_1k_chars`：P95 约 8
- `json_total_keys`：P95 约 100
- `json_total_nodes`：P95 约 250
- `json_max_array_len`：P95 约 70
- `repeat_line_ratio`：P95 约 0.28
- `code_density_per_1k_chars`：P99 才开始明显抬头（大多数卡为 0）

考虑到你已说明：本地保存的是较早期角色卡，线上卡的技术密度/结构复杂度可能更高，建议 v0.6.0 默认 cap **在本地 P95 的基础上留 20%~30% 余量**，避免上线后大面积“顶格饱和”。一组推荐的默认 cap（带余量）示例：
- `json_string_chars_total_cap = 40000`
- `tech_density_per_1k_chars_cap = 12`
- `mechanics_density_per_1k_chars_cap = 10`
- `json_total_keys_cap = 120`
- `json_total_nodes_cap = 320`
- `json_max_array_len_cap = 90`
- `repeat_line_ratio_cap = 0.35`
- `code_density_per_1k_chars_cap = 3`

> 这些 cap 本质是“让指标饱和”的刻度尺；上线后应结合本项目线上数据分布（以及用户反馈）迭代。

**试算脚本（用于自检分布与榜单对照）**  
可以用项目内脚本快速跑一遍本地语料与强度榜单（输出分布、各 tier 的均值/分位数、以及 Spearman 相关性，仅作 sanity check）：
```bash
bun run scripts/tech-index-report.ts --input "/mnt/d/04-生活与娱乐/魔法少女竞技场" --sample 600 --seed 20260103 --ranking "/mnt/d/04-生活与娱乐/魔法少女竞技场/社群内排行榜单/AAA MLA V9.0/📘 魔法少女  残兽 强度排行榜（非原生篇）V8.0.txt" --ranking-search-root "/mnt/d/04-生活与娱乐/魔法少女竞技场/社群内排行榜单/AAA MLA V9.0"
```

#### 2.3.6 映射到本项目的建议
v0.6.0 建议至少落地：
- 总体综合指标（便于排序）
- `tech_density_per_1k_chars`（风险提示更贴近“科技与狠活”）
- 以及所有原始 proxy（便于后续迭代、重算与解释）

### 2.4 落库与更新策略
不建议每次列表查询都现场计算（成本高、也会拖慢排行榜）。

推荐 v0.6.0：新增表 `data_card_metrics`：
- `data_card_id`（PK）
- `tech_score / tech_level`（由总体综合指标或 `tech_density_per_1k_chars` 映射得到，口径可在后续迭代中调整）
- `is_native`（用于原生性筛选）
- `data_card_updated_at`（快照：对应 `data_cards.updated_at`，用于判断是否需要重算）
- `created_at / updated_at`
- 可选 `details_json`（解释信息，仅作者可见/或仅用于后台）

建议同步存下原始 proxy（可选列或放到 `details_json`）：
- 结构类：`json_string_chars_total / json_total_keys / json_unique_key_count / json_total_nodes / json_max_depth / json_max_array_len`
- 格式类：`line_count / bullet_line_count / heading_line_count / code_fence_count / uppercase_snake_count`
- （可选但推荐）重复度：`unique_line_count / repeat_line_ratio`
- 关键词类：`kw_must / kw_system / kw_format / kw_role / kw_meta / kw_exploit / kw_dice / kw_combat / kw_code / kw_math`
- 派生类：`kw_control_weighted_sum / tech_density_per_1k_chars / mechanics_density_per_1k_chars / code_density_per_1k_chars`
- （可选增强）`kw_sum_resid_on_text_len`：回归残差（v0.6.1+ 再上更稳）

更新策略三选一：
1) **保存/更新数据卡时计算**（最干净，需要改 data-card 写入 API）
2) **懒计算**：首次在列表/详情需要时计算并写回（实现快，但要小心并发与一致性）
3) **脚本批处理**：用 `scripts/` 统一回填（适合上线前一次性）

#### 2.4.1 DDL（建议直接追加到 `lib/database/schema.sql`）
```sql
-- =================================================================
-- Data Card Metrics（v0.6.0）
-- =================================================================
CREATE TABLE IF NOT EXISTS data_card_metrics (
  data_card_id TEXT PRIMARY KEY NOT NULL,
  tech_score INTEGER NOT NULL,
  tech_level TEXT NOT NULL CHECK(tech_level IN ('L0','L1','L2','L3','L4','L5')),
  is_native BOOLEAN,
  data_card_updated_at TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (data_card_id) REFERENCES data_cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_data_card_metrics_tech_score ON data_card_metrics(tech_score DESC);
CREATE INDEX IF NOT EXISTS idx_data_card_metrics_tech_level ON data_card_metrics(tech_level);
CREATE INDEX IF NOT EXISTS idx_data_card_metrics_is_native ON data_card_metrics(is_native);
```

#### 2.4.2 “原生性（is_native）”建议定义（避免各处口径不一致）
v0.6.0 建议：
- 若能解析 `data_cards.data` 为 JSON：以 `verifySignature(json)` 作为原生性判定（`true/false`）
- 若环境未配置 `SIGNATURE_SECRET_KEY` 或解析失败：`is_native = NULL`（表示“未知”，而不是强行 false）

> 说明：原生性判定属于“信任/来源标识”，最好不要因为缺少密钥而把所有卡标成非原生，否则筛选会误导用户。

---

## 3. 定位标签（Tags）

### 3.1 设计目标
- 用户可为自己的角色卡/情景卡选择任意多个标签（从“标签库”选择）
- 标签带说明文本，在选择时可查看
- 标签用于浏览/筛选/百科展示

### 3.2 治理建议：区分“自选标签”与“系统/管理员标签”
为了避免“强度标签被滥用/争议”，建议标签分层：
- `user`：用户自选（题材/风格/元素）
- `system`：系统计算/风控（如：疑似元叙事、技术值高）
- `admin`：管理员/审核通过后授予（如：推荐/活动）

### 3.3 数据模型建议
三张表即可：
- `tags`：`id / name / description / category / scope(user|system|admin) / is_active`
- `tag_aliases`（可选）：同义词映射（解决“代码杀/元角色”等命名分歧）
- `data_card_tags`：`data_card_id / tag_id / created_by_user_id / created_at`

#### 3.3.1 DDL（建议直接追加到 `lib/database/schema.sql`）
```sql
-- =================================================================
-- Tags（v0.6.0）
-- =================================================================
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,          -- 建议用稳定 slug（如 style:daily / risk:meta）
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  scope TEXT NOT NULL CHECK(scope IN ('user','system','admin')),
  is_active BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_scope ON tags(scope);
CREATE INDEX IF NOT EXISTS idx_tags_is_active ON tags(is_active);
CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);

CREATE TABLE IF NOT EXISTS tag_aliases (
  alias TEXT PRIMARY KEY NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tag_aliases_tag_id ON tag_aliases(tag_id);

CREATE TABLE IF NOT EXISTS data_card_tags (
  data_card_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_by_user_id INTEGER,            -- system/admin 赋予时可为 NULL
  created_at TEXT NOT NULL,
  PRIMARY KEY (data_card_id, tag_id),
  FOREIGN KEY (data_card_id) REFERENCES data_cards(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_data_card_tags_tag_id ON data_card_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_data_card_tags_data_card_id ON data_card_tags(data_card_id);
```

#### 3.3.2 v0.6.0 标签治理的默认策略（写死，减少争议）
- v0.6.0 **不允许用户创建新标签**：只能从 `tags` 表中选择（避免同义词泛滥与口径分裂）
- `scope='user'`：作者可自行绑定/解绑
- `scope='system'`：仅服务端自动写入（例如：技术值高、疑似 kw_exploit）
- `scope='admin'`：仅管理员接口写入（推荐/活动/精选）

#### 3.3.3 标签库种子（静态资源入库，作为单一真相来源）
你已确认：标签库的初始种子以静态资源形式随 Git 入库（类似 `public/flowers.json` / `public/journalists.json`）。推荐：
- 种子文件：`public/tags.seed.json`
- 文件仅用于“初始化/同步 DB”，**前端与业务查询一律以 DB 为准**（`GET /api/tags`）

建议的 JSON 结构（示例）：
```json
{
  "tags": [
    { "id": "style:daily", "name": "日常向", "description": "偏日常/轻剧情", "category": "题材/风格", "scope": "user", "isActive": true }
  ],
  "aliases": [
    { "alias": "代码杀", "tagId": "risk:code-kill" }
  ]
}
```

同步到 D1 的推荐方式（v0.6.0）：
- 新增脚本 `scripts/init-tags.ts`：读取 `public/tags.seed.json`，对 `tags` / `tag_aliases` 执行 upsert（幂等）
- 运行时机：上线前/上线后执行一次；或每次发布时执行（可选）
- 行为约定：
  - 以 seed 为准更新 `name/description/category/scope/is_active`
  - DB 中存在但 seed 不存在的标签：不删除，只置 `is_active=0`（避免破坏历史绑定）

### 3.4 你给的标签提案：建议的规范化（示例）
以下是“建议收敛”的方向（便于筛选与百科）：
- 题材/风格：`搞笑向`、`日常向`、`战友情`
- 设定/能力倾向：`反魔法`、`物理对抗系`、`包容类能力`、`凡人`
- 卡片属性：`自设`、`历战王`
- 风险提示：`代码杀`、`元角色`（建议增加多级：`元叙事`、`提示词工程`、`规则武器化`）

> 关于“代码杀”定义：非常适合作为百科条目与提示工具，但不建议在 UI 上以“批判性”语言呈现。

---

## 4. 百科（Encyclopedia）

### 4.1 内容组织建议
百科适合做成“可维护的 Markdown 集合”，同时从数据库拉取“标签说明”。考虑 Edge Runtime 不适合运行时读文件，v0.6.0 推荐：
- `public/encyclopedia/*.md`：概念条目（竞技场、历战、升华、PVP、排位、技术值、敏感词/屏蔽词等）
- `public/encyclopedia/index.json`：目录（标题/文件名/排序）
- `GET /api/tags`：标签列表与说明（动态维护）
- 前端 `pages/encyclopedia.tsx`：左侧目录（index.json）+ 右侧用 `react-markdown` 渲染（通过 `fetch('/encyclopedia/xxx.md')` 获取）

### 4.2 教程建议
v0.6.0 的最小教程集：
- 如何挑选合适的对手
- 如何理解 strict/free 排位差异
- 如何正确使用标签（自评与系统评的区别）

---

## 5. UI/UX 落点

### 5.1 卡片详情展示
在角色卡详情/个人资料卡中展示：
- strict/free 排位分、段位、对局数（以及最近一次变化）
- 技术值（score + level）
- 标签列表（可点击查看说明/百科）

### 5.2 排行榜模态框
排行榜数据源建议以“可计分实体”为主（数据卡 + 预设）：
- 公共榜：`data_cards.is_public=1 AND review_status='approved'`
- 私有卡：只对作者展示，不参与公共名次，但可以插入榜单中“显示我自己的位置”
- 预设角色：来自 `pages/api/get-presets.ts`（恒公开），参与公共名次；其排位实体 ID 建议使用 `preset filename`

支持排序：
- strict rating / free rating / 技术值

支持筛选：
- strict/free/tech 维度阈值
- 原生性（is_native）
- 标签（多选 AND/OR 需要定规则；v0.6.0 推荐 OR + 排除项）

交互增强（你提到的）：
- 在竞技场页面打开排行榜时，可直接把某角色加入参战列表（本质是“从数据卡加载到 combatants”）

### 5.3 个人页（Me）
在个人页/个人资料卡中增加：
- “我排位最高的角色卡”摘要（strict/free 各一个或只取 strict）
- 点击跳转到该卡详情

### 5.4 API 契约（MVP 建议）

> 原则：榜单/筛选走独立 API；卡详情尽量一次返回 rating + metrics + tags，避免前端多次 round-trip。

#### 5.4.1 `GET /api/arena/leaderboard`（排行榜）
Query（建议）：
- `queue=strict|free`（默认 strict）
- `sort=rating|tech`（默认 rating）
- `limit`（默认 50，建议上限 100）
- `offset`（默认 0）
- `tagIds`（逗号分隔，OR）
- `excludeTagIds`（逗号分隔）
- `isNative=1|0|any`（可选）
- `includePresets=1|0`（默认 1）

返回（建议字段）：
- `items[]`：`rank / entityType / entityId / displayName / rating / games / wins / losses / draws / tier / techScore / techLevel / isNative / tagIds[]`

> 说明：`tagIds[]` 只返回标签 ID；标签的 `name/description/category` 通过 `GET /api/tags` 获取并在前端映射展示。

#### 5.4.2 `GET /api/tags`（标签库）
- 默认仅返回 `is_active=1` 的标签（可加 `includeInactive=1` 给管理员/维护脚本用）

#### 5.4.3 `PUT /api/data-card-tags`（绑定用户标签）
Request body（建议）：`{ dataCardId: string, tagIds: string[] }`
- 需要登录，且仅允许作者修改自己的卡
- 仅允许绑定 `tags.scope='user'` 的标签；`system/admin` 绑定只能由服务端/管理员接口写入

---

## 6. v0.6.0 实施顺序（建议拆里程碑，避免一口吃成胖子）

1) **排位数据模型 + 计分链路（strict/free，先 1v1）**  
2) **排行榜 API + UI 模态框（排序/筛选先做最小集）**  
3) **技术值 metrics 表 + 详情展示（先懒计算或保存时计算）**  
4) **标签库 + 绑定关系 + UI 选择器**  
5) **百科页 MVP（Markdown 渲染 + 标签说明联动）**

### 6.1 v0.6.0 必须通过的验收标准（建议写进 PR Checklist）

**排位**
- 同一 `generation_id` 在 strict/free 下不会重复计分（接口重试、流中断重连等都不重复）
- strict/free 的 eligibility 与本文一致（含：1v1、strict 必须登录、PVP 允许计入）
- 可以根据 `arena_rating_events` 反查一次分数变化（含 before/delta/after、winner_slot）

**技术值**
- 同一张卡在不同页面/不同链路计算出的 `techScore/techLevel` 一致（使用 `lib/metrics/techIndex.ts`）
- `data_card_metrics.data_card_updated_at` 与 `data_cards.updated_at` 不一致时会触发重算

**标签**
- 用户只能从 `tags` 选择（不能自建），且无法篡改 `scope=system/admin` 的标签绑定

---

## 7. 已确认口径（实现依据）

确认时间：2026-01-04

1) 排位对象：数据卡 `data_cards.id`；预设用 `preset filename`。
2) v0.6.0 先按 1v1 计分 MVP（`combatant_count = 2`）。
3) strict：允许自由挑对手，但必须登录才计分；free：不强制登录。
4) PVP 触发的战报：允许计入排位（仍需满足 strict/free eligibility；通常更偏向落在 free）。
5) 平局：计入对局数，按 Elo 的 `S=0.5` 微调分数。
6) strict 命中：同时更新 strict 与 free（strict ⊆ free）。
7) free 天梯：`ip_anonymized IS NULL` 时不计分（为保证 strict ⊆ free，该条件已写入“基础资格”，使该局 strict/free 均跳过）。
8) 计分允许包含私有卡，但公共榜过滤：仅展示 `data_cards.is_public=1 AND review_status='approved'` + 预设。
9) 预设角色：出现在排行榜里（与数据库角色卡同榜展示）。
10) strict 风控：10 分钟同对手组合去重 + strict 每日计分上限 80 局（见 1.9）。
11) 段位阈值：沿用本文默认（900/1100/1300/1600）；初始分 `initial_rating=1000`。
12) Elo：允许双方 K 不同（非零和）。
13) 标签库种子：以静态资源入库（推荐 `public/tags.seed.json`），通过脚本同步到 D1（见 3.3.3）。
14) 排行榜 API 路径与命名：采用本文示例（`GET /api/arena/leaderboard`）。

---

## 8. 赛季机制 (Season System)

为了保持排位系统的活力与公平性，并提供历史数据回顾功能，可引入赛季制度。

**8.1 静态配置与存储**
- **赛季元数据**：维护在 `public/config/seasons.json` 中，包含赛季名称、ID、起止时间、状态及说明等所需信息。
- **历史归档**：赛季结束时，生成的历史快照存储于 `public/data/seasons/archive_{season_id}.json`。客户端直接读取此静态文件展示历史榜单。

**8.2 UI 展示变更**
- **排行榜 (Leaderboard)**：
  - 标题旁增加赛季切换下拉框（当前赛季 + 历史赛季列表）。
  - 显示赛季名称、ID、起止时间、状态及说明等信息。
  - 切换至历史赛季时，数据源从 API 转为读取对应的静态 JSON 文件。
- **个人资料卡 (Profile)**：
  - 在“数据卡高光”标题后方，以 Badge 形式展示当前赛季名称/ID。
- **模态框**：排位相关界面显示当前赛季标识。

**8.3 赛季结算流程**
1. **冻结与归档**：
   - 运行归档脚本，锁定当前榜单。
   - 提取全服 Top 50（最强）与 Bottom 20（最弱）的角色排行榜所需信息快照，写入静态文件。
2. **段位重置 (Soft Reset)**：
   - 参考成熟游戏的设计，将排位分重置到合适的段位。
3. **新赛季开启**：
   - 更新 `seasons.json`，标记旧赛季为结束，新赛季为当前。