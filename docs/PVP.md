# PVP 对战功能设计草案（房间制卡组对战）

更新时间：2025-12-22  
适用项目：Next.js（Edge Runtime）+ Cloudflare D1 + Tailwind 4 + Vercel AI SDK 1.x

## 1. 背景与目标

### 目标
- 创建可用于PVP的新页面和功能。
- 引入“可操作、可博弈”的 PVP：玩家通过**选牌/猜牌**影响胜负，而不是单纯“单机生成战报”。
- 保持项目核心卖点：战斗结果以**战报叙事**呈现（可复用现有 `api/arena/generate` / `api/arena/generate-stream`）。
- 规则能逐步演进：先做 MVP（房间制 + 单局，默认 2 人，支持 2-6 人），再扩展情景卡、观战、排行等。

### 非目标（建议先不做）
- 不追求“绝对公平可验证”的加密级随机性（可做成可选增强）。
- 不做复杂实时战斗（逐回合技能交互 / 动画），优先做“选牌→结算→战报”这一条清晰闭环。

### 开发原则
- 避免硬编码
- 建议通过多个小组件的组合实现，以免单个代码文件过大难以维护（可参考 `pages\arena.tsx`）

---

## 2. 玩法总结

核心机制可以抽象成 4 个阶段：
1. **建房/入房**：房主创建房间，其他用户加入。
2. **提交卡组（公开）**：每人提交 N 张角色卡（来源：预设/公开库/自己的私有库；若 `cardsPerPlayer=0` 则跳过该阶段）。
3. **合池洗混并发牌（私密）**：把所有提交卡去重后混洗，平均发到每人手里（多余丢弃或进弃牌堆）。
4. **同时选牌对战→生成战报判胜负**：每人从“自己手牌”选 1 张上场；房间里能看见每人初始提交了哪些卡（可浏览详情），但看不见对方手牌；结算后给出胜负与战报。

这套设计的优点是：
- “卡组强度不平衡”被合池与随机发牌削弱，强调临场决策。
- 信息不对称（已知提交池、未知手牌）天然带来猜拳式博弈。

需要提前想清/补齐的关键点（否则后续实现会卡住）：
- **去重规则**：按什么去重？`data_card_id` / 预设 `filename` / 内容 hash？去重会让“撞车”成为一种策略（好/坏都要明确）。
  - 你的决策：不允许 PVP 上传 JSON，因此**数据库卡可按 `data_cards.id` 去重**。
  - 建议微调：预设卡用 `filename` 作为唯一标识即可；用“内容 hash”在 Edge Runtime 下需要额外取内容并算 hash，反而增加复杂度。若未来开放 `inline` 卡，再引入 `contentHash` 更合适。
  - 版本一致性补充（很关键）：同一张 `data_cards.id` 在提交后可能被作者编辑，导致“提交时看到的设定”和“结算时读到的设定”不一致。建议在提交时同时记录 `data_cards.updated_at`，并在 `start` 时校验版本；不一致就要求重新提交，或将卡内容做快照（见第 6 节补充建议）。
- **多局制语义**：多局是“每局重新发牌”，还是“同一手牌打多轮（打出即弃）”？两者的体验与实现差异很大。
  - 你的决策：同一手牌 **打出即弃**；若有人手牌打空但对局未结束，将弃牌堆重新平均分配。
  - 建议补齐“终局保证”：为了避免循环与争议，建议把“手牌用尽后再分牌”作为**可选规则**，并提供一个更稳定的默认方案：  
    - 默认：要求 `dealPerPlayer >= maxRounds`（例如 BO5 则手牌至少 5），手牌打完即比赛结束（比分相同判平局或触发加赛规则）；  
    - 可选：引入“公共抽牌堆”（发牌时多余的牌进入 `drawPile`），每轮结束双方各从 `drawPile` 补到固定手牌数，直到 `drawPile` 用尽。  
    这两种都比“循环弃牌堆”更容易保证对局可结束、也更像卡牌游戏体验。
- **胜负裁判可信度**：仅靠 LLM 解析战报赢家会有波动、被提示词注入影响；需要“结果约束/兜底”。
  - 你的决策：允许解析出 0 个或多个胜利者；未解析出胜利者视为 0 个胜利者。
  - 强烈建议改成“对 PVP 更可控的三值结论”：  
    - 解析结果只允许 `A` / `B` / `平局` 三种；  
    - 解析出“两人都像赢家/多赢家”通常意味着模型输出不规范，应视为**无效** → 触发“纠错重试（低温度/更强约束）” → 再失败判平局；  
    - “0 个胜利者”在 PVP 里建议统一映射为 `平局`（除非你想引入 `void/aborted` 这种“对局无效”状态，见第 5 节建议）。

---

## 2.1 决策复核（我理解的最终口径）

基于你当前写入的决策，我建议我们把 MVP 的“确定口径”写死为下面这组（方便后续实现、测试、对外文案一致）：
- 人数：默认 2 人；当前实现支持 2-6 人
- 卡来源：预设 + 数据库卡（公开库 / 自己私库），不允许 inline 上传
- 私有卡披露：私有卡一旦提交到房间内，对手可查看**完整 JSON（问卷/能力/设定全量）**；前端需要醒目告知并要求确认
- 卡可用性：允许使用 `review_status=pending` 的卡；禁止 `review_status=rejected` 的卡；禁止被封禁用户的卡（见第 12 节校验规则）
- 卡封禁：禁止使用 `is_public = -1` 的卡（表示卡被封禁，与 `review_status` 语义不同）
- 去重：按（`kind`,`idOrFilename`）去重；`data_card` 额外带 `updatedAt` 做版本校验
- 对局：默认单局；多局制采用“弃牌制”，默认 `mostWinsAfterMaxRounds`
- 结算：winner ∈ {A,B,平局}，不在集合则纠错重试→平局

---

## 2.2 机器人玩家（Bot）
目标：在人数不足或想快速开局时，允许房主向房间中加入机器人玩家，以便凑满 `participants` 并参与对局流程。

规则约束（当前口径）：
- **加入方式**：仅房主可添加，且仅允许在 `waiting/submitting` 阶段添加。
- **存储形态**：机器人不创建用户、不新增表/列；仅作为房间内临时配置写入 `pvp_rooms.rules_json` 的服务端私有字段，并在“重开一局”时清空。
- **命名**：从 `public/journalists.json` 的 `journalists[].name` 随机抽取；若已存在同名，则在后面追加后缀（如 `#2`、`#3`）。
- **战绩**：Bot 不显示/不统计战绩；统计接口需过滤 Bot 用户，不参与胜负汇总展示。
- **提交卡组**：Bot 自动提交 `cardsPerPlayer` 张 **角色卡**，来源为：公开库角色卡（`data_cards`）+ 预设角色卡（`public/presets/*.json`）。
  - 优先避免与房间内其他玩家已提交的卡重复；若候选不足允许回退重复。
- **出牌策略**：Bot 会为每个房间实例随机分配一个策略，并在后续回合沿用该策略（策略定义需独立维护，便于后续切换/调参）。
  - 【默认】按权重随机：公开库卡牌的权重与 `usage_count + like_count + favorite_count*3` 正相关；预设/无统计卡为基础权重；任何卡权重上限为基础权重的 3 倍。
  - 【随机】等权随机。
  - 【偷师】若手牌里存在真人玩家提交的卡，则选择该“提交者胜率最高”的那张；否则回退【默认】。
  - 可扩展：可在策略文件中加入“关键词加权”等特殊策略（例如包含“大道至简”“代码”等字样的卡牌更倾向被打出）。

---

## 3. 最小可用版本（MVP）

### 规则（建议锁定，便于快速上线）
- 人数建议：MVP 默认 2 人；当前实现已支持 2-6 人（建议先从 3-4 人开始压测体验与成本）。
- 默认规则建议改为“提交数 > 发牌数”，否则玩家在拿到手牌后可直接推导出对手手牌集合，失去信息博弈：
  - 每人提交 **4 张角色卡**（`cardsPerPlayer=4`）
  - 合池去重后洗牌，**各发 3 张**（`dealPerPlayer=3`）
  - 剩余牌进入“暗置区”（不对任一方展示），用于保持手牌不可推导
- 房主可调整设置，例如对局模式、每人提交数据卡数量等等。
  - 建议对“模式”做白名单：PVP 默认只开放 `classic` / `kizuna` / `scenario`；不建议开放 `daily`，因为 `winner` 字段在日常语义下允许“列出多人”，会让 PVP 结算变得不确定。
- 单局：双方从手牌**同时**选择 1 张对战（服务器在双方都选好前不向对方暴露选择）。
- 胜负：复用现有“战报生成+解析 winner”的机制，必要时增加“校验失败→重试/判平局”的兜底。

### 多局制（建议作为 v1.1）
- 每局双方各出 1 张，上场的牌**弃置**；
- 房主可设置结束条件，例如直到手牌打完或一方先达到胜场（如 BO3 / BO5）。

这样能产生更强的策略性：玩家需要考虑保牌、读牌、节奏，而不仅是单轮猜拳。

### 建议补齐：多局制的“明确数学规则”（避免实现时互相理解不一致）
强烈建议把多局制拆成三个可配置参数：
- `maxRounds`：最多进行多少轮（建议默认 = `dealPerPlayer`，保证必定结束）
- `winCondition`：胜利条件（`firstToWins` / `mostWinsAfterMaxRounds`）
- `tieBreaker`：平局处理（`draw` / `suddenDeath`）

推荐默认（易实现、体验稳定）：
- `dealPerPlayer >= maxRounds`（例如 BO5 → 每人至少 5 张）
- `winCondition = mostWinsAfterMaxRounds`（你已确认的默认规则）
- `tieBreaker = draw`（保守且避免无限加赛）

---

## 4. 系统架构选择（从易到难）

本项目部署环境是 Edge Runtime + D1，实时协同有三种可选实现：

### 方案 A：D1 + 轮询（推荐 MVP）
- 前端用 React Query 轮询 `GET /api/pvp/rooms/:roomId`（例如 1~2 秒一次）。
- 所有状态变更都走 `POST` API，服务端写 D1。

优点：实现最快、与现有工程形态一致。  
缺点：延迟略高；并发更新要做好乐观锁；房间多人时成本上升。

### 方案 B：D1 + SSE（中期增强）
- 用 `text/event-stream` 推送房间事件，减少轮询频率。

优点：体验更接近实时，成本可控。  
缺点：Edge streaming/代理链路稳定性需要实际验证，断线重连与补偿更复杂。

### 方案 C：Durable Objects + WebSocket（最佳体验，最重）
- 每个房间一个 DO，负责 WebSocket 广播与房间状态机。
- D1 负责持久化与统计。

优点：实时性最好，状态一致性强。  
缺点：工程改造大（需要新增 DO、绑定、部署配置与容灾策略）。

---

## 5. 房间状态机（强烈建议用“显式阶段”来约束 API）

建议以“状态机”驱动所有 API 校验，避免出现：
“有人已经开始选牌，但另一个人还在提交卡组”等脏状态。

### 状态定义（MVP 版）
- `waiting`：房间创建完毕，等待玩家加入（达到人数后可进入下一步；若 `cardsPerPlayer=0` 则达到人数后仍保持 `waiting`，等待房主直接开始发牌）。**补充（已落地实现）**：当参与者数量 ≥2 但未满员时，房主也可“提前开局”，系统会把房间人数从目标人数缩减为当前人数，再推进到下一阶段（`cardsPerPlayer>0` 进入 `submitting`；`cardsPerPlayer=0` 可直接开始发牌）。
- `submitting`：提交卡组阶段
- `dealing`：服务端合池/去重/洗牌/发牌（短暂中间态）
- `choosing`：玩家选择出战卡（私密）
- `resolving`：生成战报 & 判定胜负（短暂中间态）
- `finished`：本局结束（可重开下一局或关闭房间）

### 状态定义（建议扩展）
- `closed`：房间关闭（不再接受加入/提交）
- `aborted`：对局中止（房主关闭、风控拦截、AI 连续失败等；**普通玩家退出/被踢优先走“托管机器人接管”而不是直接中止**）

> `finished` 表示“正常完局”；`aborted` 表示“非正常终止”。两者在 UI 呈现、统计、是否计入战绩上应区别对待。

### 状态推进规则（核心）
- 任何写操作都必须检查当前 `phase`，不符合则拒绝。
- 任何会影响公平性的动作（如重新发牌、重开本局）必须只允许房主发起，并且需要全员同意或明确规则（建议 MVP 不提供“重发”）。

### 建议补齐：超时/退出/无效局（避免房间卡死）
- **最后一位未操作倒计时 + 房主强制**：当仅剩最后一位真人玩家未操作（`submitting/choosing/reviewing`），前端展示 30s 倒计时；倒计时结束后房主可强制随机提交/出牌/确认（服务端仍做校验）。
- **退出/踢出 → 托管机器人接管**：真人玩家在对局中途退出或被房主踢出后，自动用机器人接管其座位，继承其提交/手牌/当轮出牌状态继续游戏（忙碌阶段如 `dealing/resolving/advancing` 建议先限制操作，避免一致性问题）。
- `aborted`（或 `void`）结局仍保留作为兜底：房主关闭、风控拦截、AI 连续失败等，统一进入“本局无效/直接判负/判平局”的策略。
- D1 没有后台定时任务时，可在 `GET room` 时做“懒清理”：若 `now > expires_at` 则将房间置 `closed` 并返回提示。

---

## 6. 数据模型（D1 / SQLite 设计建议）

目标：实现“安全的私密手牌 + 可审计的对局记录 + 并发一致性”。

> 说明：本节更偏“对局运行态（room/round）”。关于“PVP 对战历史持久化、排行/生涯统计、以及 PVP 战报生成记录如何关联”的改进方案，见：`docs/PVP_RECORDING.md`。

### 最小表设计（推荐）

#### `pvp_rooms`
- `id`：TEXT（roomId）
- `host_user_id`：INTEGER
- `status`：TEXT（open/closed）
- `phase`：TEXT（waiting/submitting/choosing/resolving/finished）
- `rules_json`：TEXT（卡数、BO、去重策略、是否展示提交详情、是否洗混卡组、是否情景模式等）
- `version`：INTEGER（乐观锁，每次写入 +1）
- `created_at` / `updated_at`

建议补齐字段：
- `expires_at`：TEXT（ISO），用于懒清理与 UI 倒计时
- `last_activity_at`：TEXT（ISO），用于活跃判定
- `join_code_hash` / `join_code_salt`：TEXT（可选，房间口令；默认不设置，但房主可按需开启）

#### `pvp_room_players`
- `room_id`：TEXT
- `user_id`：INTEGER
- `seat`：INTEGER（0/1，或扩展多人）
- `joined_at`
- `PRIMARY KEY(room_id, user_id)`

#### `pvp_room_submissions`
- `room_id`：TEXT
- `user_id`：INTEGER
- `submission_json`：TEXT  
  建议保存为“引用集合”而不是整段卡数据：  
  - 数据库卡：`{ kind: "data_card", id: "...", updatedAt: "..." }`  
  - 预设卡：`{ kind: "preset", filename: "M01_..." }`  
  - 临时卡（若允许）：`{ kind: "inline", content: {...}, contentHash: "..." }`
- `created_at`
- `PRIMARY KEY(room_id, user_id)`

#### （建议新增）`pvp_room_card_snapshots`：冻结卡内容，保证复盘一致
动机：解决“提交后卡被编辑/删除/改名”导致的对局不可复现与争议。
- `id`：TEXT（snapshotId）
- `room_id`：TEXT
- `owner_user_id`：INTEGER（提交者）
- `ref_json`：TEXT（原始引用：data_card/preset）
- `card_type`：TEXT（magical-girl/canshou/general-character）
- `name`：TEXT
- `data_json`：TEXT（用于喂给 AI 的最终卡内容；可做字段白名单）
- `source_updated_at`：TEXT（对 data_card 记录 `data_cards.updated_at`；preset 可留空或填构建版本）
- `created_at`

> 如果你非常在意“隐私/存储”，也可以只存 `data_json` 的 hash + 在结算时现取内容；但这样会牺牲复盘稳定性。PVP 作为竞技玩法，我更推荐快照。

#### `pvp_room_hands`
- `room_id`：TEXT
- `user_id`：INTEGER
- `hand_json`：TEXT（服务端发牌结果，包含每张牌的引用信息）
- `created_at`
- `PRIMARY KEY(room_id, user_id)`

#### `pvp_rounds`
- `id`：TEXT（roundId）
- `room_id`：TEXT
- `match_id`：TEXT（matchId；用于将回合绑定到“哪一场对战”，便于复盘/统计；房间可 `restart` 复用时尤为重要）
- `round_index`：INTEGER（从 1 开始）
- `battle_generation_id`：TEXT（复用现有 `battle_report_generations.id`，便于日志与统计串起来）
- `public_snapshot_json`：TEXT（公开信息：提交池摘要、情景信息、双方出战牌的公开展示等）
- `result_json`：TEXT（winner、raw、错误原因等）
- `created_at`

字段（当前实现已使用）：
- `status`：TEXT（pending/resolving/completed/aborted）
- `winner_user_id`：INTEGER（可选，便于统计；平局为空）
- `winner_name`：TEXT（与战报一致，便于 UI 展示）

#### `pvp_round_choices`
- `round_id`：TEXT
- `user_id`：INTEGER
- `choice_ref_json`：TEXT（玩家选出的牌引用）
- `created_at`
- `PRIMARY KEY(round_id, user_id)`

> 私密数据边界：`hand_json` 与 `choice_ref_json` 必须在 API 输出层按用户身份做过滤，绝不能“前端自己不展示但接口照样返回”。

### 6.1 D1 建表 DDL 草案（可直接追加到 `lib/database/schema.sql`）

```sql
-- PVP 房间
CREATE TABLE IF NOT EXISTS pvp_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  host_user_id INTEGER NOT NULL,
  status TEXT NOT NULL,            -- open / closed
  phase TEXT NOT NULL,             -- waiting / submitting / dealing / choosing / resolving / finished / aborted / closed
  rules_json TEXT NOT NULL,
  current_match_id TEXT,
  join_code_hash TEXT,
  join_code_salt TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  last_activity_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pvp_rooms_status ON pvp_rooms(status);
CREATE INDEX IF NOT EXISTS idx_pvp_rooms_current_match_id ON pvp_rooms(current_match_id);
CREATE INDEX IF NOT EXISTS idx_pvp_rooms_updated_at ON pvp_rooms(updated_at);

-- PVP 房间玩家
CREATE TABLE IF NOT EXISTS pvp_room_players (
  room_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'player', -- player / spectator
  seat INTEGER,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pvp_room_players_room_id ON pvp_room_players(room_id);

-- PVP 提交
CREATE TABLE IF NOT EXISTS pvp_room_submissions (
  room_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  submission_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

-- PVP 手牌
CREATE TABLE IF NOT EXISTS pvp_room_hands (
  room_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  hand_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

-- PVP 卡快照（建议）
CREATE TABLE IF NOT EXISTS pvp_room_card_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL,
  ref_json TEXT NOT NULL,
  card_type TEXT NOT NULL,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  source_updated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pvp_room_card_snapshots_room_id ON pvp_room_card_snapshots(room_id);

-- PVP 回合
CREATE TABLE IF NOT EXISTS pvp_rounds (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  match_id TEXT,
  round_index INTEGER NOT NULL,
  status TEXT NOT NULL,           -- pending / resolving / completed / aborted
  battle_generation_id TEXT,
  public_snapshot_json TEXT,
  result_json TEXT,
  winner_user_id INTEGER,
  winner_name TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pvp_rounds_room_id ON pvp_rounds(room_id);
CREATE INDEX IF NOT EXISTS idx_pvp_rounds_match_id ON pvp_rounds(match_id);

-- PVP 对战（整场）记录：用于排行/生涯统计（与 room 可复用解耦）
CREATE TABLE IF NOT EXISTS pvp_matches (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  status TEXT NOT NULL, -- active / completed / aborted
  rules_json TEXT NOT NULL,
  participants INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  winner_user_id INTEGER,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pvp_matches_room_id ON pvp_matches(room_id);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_status ON pvp_matches(status);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_started_at ON pvp_matches(started_at);

-- PVP 对战参与者快照
CREATE TABLE IF NOT EXISTS pvp_match_players (
  match_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  seat INTEGER NOT NULL,
  username TEXT,
  user_prefix TEXT,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (match_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pvp_match_players_match_id ON pvp_match_players(match_id);
CREATE INDEX IF NOT EXISTS idx_pvp_match_players_user_id ON pvp_match_players(user_id);

-- PVP 回合出牌
CREATE TABLE IF NOT EXISTS pvp_round_choices (
  round_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  choice_ref_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (round_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pvp_round_choices_round_id ON pvp_round_choices(round_id);
```

> DDL 里时间字段全部用 ISO 字符串是为了与现有项目保持一致（你也可以换成 DATETIME + CURRENT_TIMESTAMP，但要确保读写一致）。

### 权限矩阵（建议写死，便于实现 API 过滤）
- 未登录：不可创建/加入/查看房间详情（可选：允许只读观战，但 MVP 建议不开放）
- 房间玩家：可看公开区；仅自己可看手牌与自己选择
- 房主：拥有 `start/close/kick` 等管理权（MVP 最少需要 `start`）
- 观战者：可看公开区与战报，但不可看任何手牌/选择；不可提交/出牌/确认；在 `waiting/submitting` 且有空位时可切换为玩家（玩家也可切回观众）

---

## 7. API 设计（建议）

### 鉴权
沿用现有 Bearer `auth_key`（参考 `pages/api/auth/verify.ts`）。
MVP 建议“必须登录才能玩”，以降低刷房/恶意占位成本。

### 端点草案
- `POST /api/pvp/rooms`：创建房间（返回 `roomId`；可选携带房间口令）
- `POST /api/pvp/rooms/:roomId/join`：加入房间（若启用口令则需 `password`）
- `POST /api/pvp/rooms/:roomId/rules`：房主更新房间规则（仅 `waiting/submitting`；修改提交数通常需要清空已提交卡组）
- `POST /api/pvp/rooms/:roomId/password`：房主设置/清空房间口令（可选，MVP 可延后）
- `POST /api/pvp/rooms/:roomId/leave`：离开房间（房主离开会关闭房间；非房主在 `submitting/choosing/reviewing` 离开会触发“托管机器人接管”）
- `POST /api/pvp/rooms/:roomId/kick`：房主踢人（`submitting/choosing/reviewing` 默认同样走“托管机器人接管”）
- `POST /api/pvp/rooms/:roomId/role`：切换身份（`player/spectator`；默认入房为观众；仅 `waiting/submitting` 可切换）
- `POST /api/pvp/rooms/:roomId/force`：房主强制随机操作（最后一位未操作玩家的 `submit/choose/confirm`）
- `POST /api/pvp/rooms/:roomId/submit`：提交卡组
- `POST /api/pvp/rooms/:roomId/start`：房主开始（锁定提交 → 发牌 → 进入 choosing）
- `GET /api/pvp/rooms/:roomId`：拉取房间状态（按身份过滤私密字段）
- `POST /api/pvp/rooms/:roomId/rounds/:roundId/choose`：提交本轮选择（不对他人暴露）
- `POST /api/pvp/rooms/:roomId/rounds/:roundId/resolve`：房主或系统触发结算（也可由服务端检测“双方已选”自动触发）
- `POST /api/pvp/rooms/:roomId/rounds/:roundId/confirm`：确认已阅读本轮战报（全员确认后才推进下一回合或结束）
- `POST /api/pvp/rooms/:roomId/permissions`：房主设置：允许非房主结算 / 开启观战

### 7.1 请求/响应约定（建议，便于前后端对齐）

通用：
- 鉴权：`Authorization: Bearer <auth_key>`
- 并发控制：所有“会改变房间状态”的写接口都带 `expectedVersion`
- 错误返回建议统一：`{ error: string, code?: string, details?: unknown }`

`POST /api/pvp/rooms`（创建房间）
```json
{
  "rules": {
    "participants": 2,
    "cardsPerPlayer": 4,
    "dealPerPlayer": 3,
    "dealWhenEmpty": 3,
    "drawSource": "public",
    "dedupe": true,
    "showAllSubmissions": true,
    "shuffleDecks": true,
    "mode": "classic",
    "bestOf": { "enabled": false, "maxRounds": 3, "winCondition": "mostWinsAfterMaxRounds", "tieBreaker": "draw" },
    "readArenaHistory": false,
    "readArenaHistoryLimit": 3,
    "isArenaHistoryUnlimited": false,
    "writeArenaHistory": false,
    "readCurrentState": false,
    "writeCurrentState": false,
    "selectedLevel": "",
    "userGuidance": "",
    "storyLength": "default",
    "language": "",
    "adjudicationEvents": []
  },
  "password": "可选，房间口令明文，仅用于一次性设置"
}
```

- 说明：`cardsPerPlayer=0` 将跳过提交阶段，房主可在 `waiting` 直接开始对局（开局按 `dealWhenEmpty` 发牌）。

`POST /api/pvp/rooms/:roomId/join`（加入房间）
```json
{ "expectedVersion": 0, "password": "若房间启用口令则必填" }
```

`POST /api/pvp/rooms/:roomId/password`（设置/清空房间口令）
- 仅房主可调用
- 仅允许在 `waiting/submitting` 阶段修改（`choosing/resolving` 禁止改，避免恶意锁人）
- 建议只保存 `hash+salt`，不保存明文

`POST /api/pvp/rooms/:roomId/rules`（更新房间规则）
- 仅房主可调用
- 仅允许在 `waiting/submitting` 阶段修改
- 修改 `cardsPerPlayer` 时，若房间内已存在提交，通常需要清空提交并要求全员重新提交（否则会出现“提交数与规则不一致”的冲突）

`POST /api/pvp/rooms/:roomId/rounds/:roundId/confirm`（确认已阅读）
- 用途：避免战报刚生成就立即推进到下一回合/结束，用户来不及阅读
- 规则：回合结算后房间进入 `reviewing`；只有全员确认后才会推进（下一回合进入 `choosing`，或结束进入 `finished`）

`POST /api/pvp/rooms/:roomId/submit`（提交卡组）
```json
{
  "expectedVersion": 3,
  "cards": [
    { "kind": "data_card", "id": "uuid", "updatedAt": "2025-12-01 12:00:00" },
    { "kind": "preset", "filename": "M01_centaurea.json" }
  ],
  "acceptPrivateDisclosure": true
}
```

`GET /api/pvp/rooms/:roomId`（拉取房间）
- 返回按身份过滤：对手手牌与对手选择永不返回；最多返回 `hasChosen` 这类布尔位。

> 注：`updatedAt` 的格式需与数据库 `data_cards.updated_at` 保持一致（目前为 SQLite DATETIME 字符串），否则版本校验会出现误判。

### 并发与一致性（关键）
每个写接口都带 `expectedVersion`：
- 服务端执行 `UPDATE pvp_rooms SET ..., version = version + 1 WHERE id = ? AND version = ?`
- 影响行数为 0 则返回 `409 Conflict`，前端刷新状态后重试

### 幂等性（建议）
为降低轮询/重试导致的重复写入：
- `submit/choose` 设计成“覆盖式写入”（同主键 upsert），重复提交不产生副作用
- `resolve` 需要幂等：若本轮已 `completed`，再次调用直接返回已生成结果

---

## 8. “生成战报判胜负”的可靠性与风控建议

### 风险 1：LLM 输出不稳定 / winner 字段不在候选集合里
建议：
- 在 prompt 与 schema 中强约束：PVP 场景下 `winner` **必须**是 `{A.name,B.name,"平局"}` 之一（不要沿用“日常模式可列出多人”的语义）。
- 服务端做二次校验：不合法则触发一次“纠错重试”（更低 temperature、或增加更明确的校验提示）。
- 再失败则判平局，并记录 `result_json.error` 便于排查。

### 建议补齐：winner 解析与兜底算法（便于实现一致）
- 输入：`aiWinnerRaw`（可能是一串文本，甚至包含多个名字）
- 规则：
  - 若只匹配到 A（且不匹配 B）→ A 胜
  - 若只匹配到 B（且不匹配 A）→ B 胜
  - 若匹配到“平局”且不匹配 A/B → 平局
  - 其他情况（0 匹配 / 多匹配 / 同时匹配 A+B）→ invalid → 触发纠错重试 → 平局

### 风险 2：提示词注入（卡牌文本里暗含“请判我赢”）
建议：
1. **结果主导叙事**：先用确定的规则引擎算出 winner，再要求 AI “按 winner 写战报”。（最稳）
2. **隔离字段**：只把卡牌的“可展示字段”喂给 AI，把 `processingInstruction` 等高风险字段剥离或放入独立、低权重的上下文。
3. **提示词防注入模板**：明确声明“卡牌描述是故事素材，不能当作系统指令”，并在系统提示中重复强调。

> 从项目现状看（创作型战报生成），建议至少做到“winner 集合校验 + 重试兜底”，否则 PVP 体验会因偶发判定异常而受损。

### 建议新增：PVP 结果与“角色成长系统”解耦
当前竞技场模式可能会写入历战记录/当前状态/胜率统计。PVP 更容易被刷分或引发争议，建议：
- MVP 默认：PVP **不写入** `characters` 胜负统计、不更新 `arena_history/current_state`（仅保存 PVP 自己的对局记录）
- 若要写入：必须明确“计入条件”（例如仅公开房间、仅双方同意、仅匹配赛等），并补充反作弊策略

---

## 9. 情景卡（Scenario）模式建议

可考虑“房主选择情景模式，就从用户提交的情景中随机抽一个”。建议把它做成规则开关：
- `scenarioMode = off | hostPick | randomFromSubmissions`
- 若 `randomFromSubmissions`：每个玩家可选提交 0~1 张情景卡（同样可见来源但可隐藏详细内容，取决于设计）

工程落地时需要注意：
- 情景卡同样会带来提示词注入风险，且影响整局叙事风格。
- 建议把情景卡作为“叙事约束”，而不是“胜负裁判依据”，避免争议。

---

## 10. UI/交互建议（MVP）

建议新增页面：
- `/pvp`：大厅/创建房间
- `/pvp/[roomId]`：房间页面（含阶段提示、提交池展示、手牌与选牌、战报展示）

房间页最关键的 3 个视图区：
1. **公开区**：参与者列表、房间规则、提交进度（以及可选：各玩家提交卡组详情）
2. **私密区**：我的手牌（仅自己可见）、我的选择按钮
3. **结果区**：战报、winner、可选“下一局/重赛”

### 建议补齐：提交卡的“公开范围”文案
因为房主可能开启“显示所有人提交的卡组”，这意味着：
- 即使是私有卡，只要被提交到房间，**就可能**在该房间内对其他玩家可见（提交阶段强制隐藏；开始对局后是否可见取决于房间规则 `showAllSubmissions`）
- 即便房间关闭展示，私有卡仍会参与发牌与战报生成，战报也可能间接暴露设定
- 前端与 API 需要明确提示用户：提交即视为同意在房间内使用该卡（并可能在房间内展示其完整 JSON）

建议 UI 做到“可证明的告知与确认”：
- 在用户尝试提交私有卡时，弹出确认对话框，明确说明“对手可查看完整 JSON（含问卷/能力/设定全量）”
- `submit` API 要求显式字段 `acceptPrivateDisclosure=true`（若提交内容包含私有卡），避免纯前端拦截被绕过

---

## 11. 里程碑路线图（建议）

### M0：可玩的 2 人单局
- 房间创建/加入/离开
- 提交卡组 → 发牌 → 同时选牌 → 结算 → 战报
- 状态机 + 乐观锁 + 私密字段过滤

### M1：BO3 与弃牌机制
- 一局多轮、记录比分
- 支持“重新开局”（重新发牌），并明确权限与规则

### M2：情景卡 & 观战
- 情景模式开关、随机抽情景
- 观战只读视角（不显示任一方手牌）

### M3：排行与反作弊增强（可选）
- PVP 专用战绩/胜率/连胜
- 可验证随机性（commit-reveal）与更多审计字段

---

## 12. 关键流程细化（面向实现的最小闭环）

> 这一节的目标是把“写代码时最容易踩坑的分支”提前写清楚，减少返工。

### 12.1 创建房间
- 输入：房间规则（人数=2、每人提交数、是否去重、模式、BO 配置、是否情景等）
- 输出：`roomId`（推荐 UUID）、房间口令状态（可选）
- 默认阶段：`waiting`
- 写入：`pvp_rooms` + `pvp_room_players(房主)`
 - 口令：默认不设置；若房主设置口令，应只保存 `join_code_hash/join_code_salt`，不保存明文

### 12.2 加入房间
- 校验：房间存在、未 `closed`、人数未满、口令正确（若启用）
  - 若 `pvp_rooms.join_code_hash` 非空：`join` 请求必须携带 `password`，服务端用 `salt` 计算 hash 后做常量时间比较
- 幂等：重复 join 返回同一结果
- 达到人数后：房主可点击“开始提交”（或自动进入 `submitting`）

### 12.3 提交卡组
- 校验：玩家在房间内，`phase=submitting`
- 校验：每张卡引用有效，且玩家有权选择（自己的私库卡 / 公开卡 / 预设）
- 校验：卡可用性
  - `data_cards.deleted_at IS NULL`
  - `data_cards.review_status != 'rejected'`（允许 `pending`）
  - `data_cards.is_public != -1`（卡被封禁：无论公开/私有都不可用于 PVP）
  - 卡作者未被封禁（建议按 `users.is_banned` 判断）
  - 重要：如果数据库存在 `data_card_updates`（待审核新版本），PVP 默认只使用主表 `data_cards.data`，避免“未审核内容在 PVP 中生效”
- 私有披露：若提交列表中包含私有卡，必须要求用户确认（`acceptPrivateDisclosure=true`）
- 写入：`pvp_room_submissions`（覆盖式 upsert）
- UI：展示双方提交列表（允许查看详情）

建议写死一条“可用卡查询”的 SQL 模板（便于实现一致、减少漏判）：

```sql
-- 参数：:cardId, :requestUserId
SELECT
  dc.*,
  u.username AS author_username,
  u.is_banned AS author_is_banned
FROM data_cards dc
JOIN users u ON u.id = dc.user_id
WHERE
  dc.id = :cardId
  AND dc.deleted_at IS NULL
  AND dc.is_public != -1
  AND dc.review_status IN ('approved', 'pending')
  AND (dc.user_id = :requestUserId OR dc.is_public = 1)
  AND (u.is_banned IS NULL OR u.is_banned = '');
```

> 说明：`dc.is_public` 在本项目里实际是“整数枚举”（-1 封禁 / 0 私有 / 1 公开），因此不要用“BOOLEAN 语义”写死判断。

### 12.4 开始对局（锁定提交 → 发牌）
建议把 `start` 设计成“可重试的幂等流程”，防止中途失败导致房间卡死。

推荐步骤（逻辑顺序）：
1. CAS 更新房间：`phase=submitting -> dealing`（带 `expectedVersion`）
2. 拉取双方提交 → 解析为 card refs
3. 版本校验：对 `data_card` 检查 `updated_at` 是否与提交时一致（不一致则要求重新提交）
4. 生成快照：写入 `pvp_room_card_snapshots`
5. 合池：按（`kind`,`idOrFilename`）去重（若启用），不足则返回错误并回滚到 `submitting`（或保持 `dealing` 但标记错误，提示房主处理）
6. 洗牌并发牌：生成 `hands`（与 `drawPile` 可选）
7. 创建首轮：写入 `pvp_rounds(status=pending)`
8. CAS 更新房间：`phase=choosing`

### 12.5 选择出战卡
- 校验：玩家在房间内，`phase=choosing`
- 校验：选择必须来自自己的 `hand_json`
- 写入：`pvp_round_choices`（覆盖式 upsert）
- 隐私：在双方都提交前，不向对方返回任何“已选哪张”的信息（最多返回 `hasChosen=true/false`）

### 12.6 结算与生成战报
触发方式二选一（建议先做简单的）：
- A) 房主点击“结算”
- B) 服务端在 `choose` 后检测“双方都已选”则自动结算（注意幂等）

结算步骤：
1. CAS：`round.status=pending -> resolving`
2. 构造战报请求：只喂给 AI “双方本轮出战卡 + 可选情景”，不要喂对手手牌
3. 强约束 winner：PVP 模式下只允许 `A/B/平局`（不允许“列出多人”语义）
4. 写入：`battle_report_generations`（复用现有日志体系）
5. 校验 winner：无效则纠错重试（可限制 1~2 次），仍失败判平局并记录原因
6. 写入：`pvp_rounds(status=completed, winner_*)`
7. 更新手牌：从双方手牌移除已出牌（写回 `pvp_room_hands`），并根据规则创建下一轮或结束比赛

建议补齐两条实现策略（能显著降低线上诡异问题）：
- PVP 结算优先使用 **non-stream + schema** 的生成方式（减少“流式内容解析 winner”的不确定性）；房间 UI 可用 loading/进度条替代流式输出
- 在 `submit`/`start` 阶段对“将要喂给 AI 的最终卡内容”做一次 `quickCheck`，提前拦截敏感词，避免对局结算阶段才失败导致体验很差

异常处理建议（防对局卡死/被恶意卡牌拖垮）：
- 若触发敏感词拦截：建议直接将本轮标记为 `aborted` 或 `completed+draw`（你已选择平局优先的保守策略），并返回通用错误文案；不要把“具体触发内容”回传给对手
- 若 AI 连续失败（网络/供应商错误）：按重试上限后判 `draw`，并记录 `result_json.error`

---

## 13. 我建议你回答的几个问题（决定实现复杂度）

你已经确认了：
1. 私有卡提交后对手可见完整 JSON，并需要醒目告知
2. 允许 `pending`，禁止 `rejected` 与被封禁的卡
3. BO 默认 `mostWinsAfterMaxRounds`
4. 默认无口令，但房主可按需设置密码

实现口径补充（你已确认）：
1. `mostWinsAfterMaxRounds` 的平局规则：默认直接 `draw`
2. 房主密码的中途修改：仅 `waiting/submitting` 可改，`choosing/resolving` 禁止改
