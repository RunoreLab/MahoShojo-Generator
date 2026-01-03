# v0.6.0 设计记录：排位分 / 技术值 / 定位标签 / 百科 / 排行榜

更新时间：2026-01-02  
适用项目：Next.js（Edge Runtime）+ Cloudflare D1 + Tailwind 4 + Vercel AI SDK 1.x

> 说明：本文是「可落地」的设计草案，用于讨论与实现对齐；具体数值（K 因子、段位阈值、技术值权重等）允许在上线后根据分布与反馈迭代。

---

## 0. 目标与边界

### 0.1 已确认的口径（来自本次讨论）
- 排位分的“对象”统一以 **数据卡 ID（`data_cards.id`）** 为准；预设角色以 **`preset filename`** 作为 ID。
- strict 排位：**允许自由挑对手**，但 **必须登录才计分**。
- free 排位：**不强制登录** 也可计分。
- 平局：**计入对局数**，并按 Elo 的 `S=0.5` 微调分数。
- 预设角色：**出现在排行榜里**（与数据库角色卡同榜展示）。
- v0.6.0 对“是否只做 1v1 计分”的态度：你表示“都行”，本文按“先 1v1”做 MVP，后续再扩展多人/队伍。

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
- 能从战报解析出胜负，且能把胜者与参战者**唯一匹配**：
  - `winner = '平局'` → 允许（视为平局）
  - `winner` 为单个名字 → 必须匹配到且仅匹配到 1 名参战者
  - `winner` 为多个名字（含顿号/逗号分隔）→ v0.6.0 建议先按“多人/非竞赛”处理：**默认不计分**（见 1.7 分阶段支持）
- 若出现以下任一情况：**不计分**
  - 胜者字符串为空/未知
  - 胜者无法与参战者匹配（或匹配到多个同名参战者）
  - 参战者存在“本地上传但非数据库卡、且非预设”的情况

> 备注：为了把预设角色稳定地当成一个可计分实体，建议在 `battle_report_generation_combatants` 将 “preset filename” 写入 `name/template_id` 或其他合适的字段（建议不必专门增加新字段）。

#### 严格排位（Strict）资格（在基础资格之上叠加）
严格排位的目标是尽量排除“额外操控/额外上下文”，仅限经典模式+无引导/随机判定+不读历战/当前状态（没有额外的操控或输入）。对应到现有字段可落为：
- `mode = 'classic'`
- `has_user_guidance = 0`
- `has_adjudication_events = 0`
- `read_arena_history = 0`
- `read_current_state = 0`
- `battle_report_generation_combatants.character_guidance IS NULL`（或全为空串）
- `battle_report_generations.user_id IS NOT NULL`（必须登录才计分）
- v0.6.0 建议再加一条：`combatant_count = 2`（先只做 1v1，减少多人/队伍歧义）

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
- 分数变化：`Δ_A = round(K_A * (S_A - E_A))`，`Δ_B = -Δ_A`

#### K 因子建议（可调）
推荐用“对局数分段”实现“新卡收敛更快、老卡更稳定”：
- `games < 10`：K=40（定级期）
- `10 <= games < 30`：K=24
- `games >= 30`：K=16

并且你想要“变动应当有上限”，可以再加硬上限：
- `abs(Δ) <= 50`（或直接让上限 = K，避免二次规则）

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

#### 1) 当前分表（推荐）
`arena_ratings`：保存每个实体在 strict/free 下的当前分与对局数。

#### 2) 变动事件表（强烈建议）
`arena_rating_events`：保存每次变动的 before/delta/after，并关联 `generation_id`，用于审计与防重复计分。

#### 3) 可选：对局摘要表
若你希望“快速查为什么没计分”，可加 `arena_ranked_match_summaries`，记录：
- `generation_id`
- `eligible_strict / eligible_free`
- `applied_strict / applied_free`
- `skip_reason`
- `winners_json / participants_json`

> 注意：v0.6.0 不一定要一次把三张表全上；但至少应有 events 表，否则很难排查与回滚。

### 1.9 风控与反刷分（建议至少做基础版）
排位系统如果不加约束，很容易被“重复生成同一对局”刷分。建议的最低成本风控：
- strict：**必须登录**才计分（`battle_report_generations.user_id IS NOT NULL`）
- strict：**同一用户**在一定时间窗内（如 10 分钟）对同一对手组合只计分一次（用 `arena_rating_events` + 组合 key 实现；尤其适配“自由挑对手”）
- strict：每日计分上限（例如 strict 每日最多 30 局）
- free：因为允许匿名，建议至少做“弱风控”（例如按 `ip_anonymized + 对手组合` 限速），否则 free 更像“娱乐分”（可接受但需在 UI/百科中说明）

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
- `updated_at`
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
百科适合做成“可维护的 Markdown 集合”，同时从数据库拉取“标签说明”：
- `docs/encyclopedia/*.md`：概念条目（竞技场、历战、升华、PVP、排位、技术值、敏感词/屏蔽词等）
- `GET /api/tags`：标签列表与说明（动态维护）
- 前端 `pages/encyclopedia.tsx`：左侧目录 + 右侧内容渲染（`react-markdown`）

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

---

## 6. v0.6.0 实施顺序（建议拆里程碑，避免一口吃成胖子）

1) **排位数据模型 + 计分链路（strict/free，先 1v1）**  
2) **排行榜 API + UI 模态框（排序/筛选先做最小集）**  
3) **技术值 metrics 表 + 详情展示（先懒计算或保存时计算）**  
4) **标签库 + 绑定关系 + UI 选择器**  
5) **百科页 MVP（Markdown 渲染 + 标签说明联动）**

---

## 7. 需要你确认/补充的问题（决定实现细节）

已确认：
1) 排位对象：数据卡 `data_cards.id`（预设用 preset filename）。  
2) v0.6.0 先按 1v1 计分 MVP。  
3) strict 允许自由挑对手。  
4) strict 必须登录才计分；free 不强制登录。  
5) 平局计入并微调分数。  
6) 预设角色出现在排行榜。  
7) tech_index 参考仓库可访问，已摘取并迁移其 proxy/公式到本文第 2 节。
8) strict 的反刷分规则目前只做 10 分钟同对手去重。
9) 段位阈值可沿用本文默认（900/1100/1300/1600）。
