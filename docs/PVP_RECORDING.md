# PVP 记录功能（对战记录 ↔ 战报生成记录关联）

更新时间：2025-12-21  
适用范围：房间制 PVP（2-6 人、轮询、回合制选牌→结算→战报）

> 本文聚焦“**PVP 对战记录如何持久化**”与“**如何将 PVP 结算产生的战报生成记录（battle_report_generations）可靠关联到某一场 PVP**”。  
> 玩法、房间状态机、API 详情见：`docs/PVP.md`；当前实现落地索引见：`docs/PVP_DEVLOG.md`。

---

## 0. 落地状态（截至 2025-12-21）

- [x] `pvp_matches` / `pvp_match_players`：持久化整场对战与参与者快照
- [x] `pvp_rounds.match_id`：回合绑定到 match
- [x] `POST /api/generate-battle-story`：支持 `pvpContext`，并在成功/失败分支写入 `battle_report_generations.pvp_*`
- [x] `POST /api/pvp/.../resolve`：读取 `generationId` 写回 `pvp_rounds.battle_generation_id`
- [ ] 线上 D1 已执行迁移（`schema.sql` 只是目标结构，需在实际环境 `ALTER TABLE/CREATE INDEX`）
- [ ] 对外“历史/复盘/统计”查询 API 与 UI（目前数据已可承载，但缺少产品形态）

## 1. 现状梳理（已实现）

### 1.1 PVP 流程与存储

- PVP 房间与对局状态使用 D1 表 `pvp_rooms` / `pvp_room_players` / `pvp_room_submissions` / `pvp_room_hands` / `pvp_room_card_snapshots` / `pvp_rounds` / `pvp_round_choices`，并引入 `pvp_matches` / `pvp_match_players` 持久化整场对战。
- PVP 结算由 `POST /api/pvp/rooms/:roomId/rounds/:roundId/resolve` 触发，内部调用 `POST /api/generate-battle-story` 生成战报。
- `pvp_rounds.battle_generation_id` 已串联：生成端点返回 `generationId`，PVP resolve 会写回（成功/失败场景都会 best-effort 记录）。

### 1.2 战报生成记录（battle_report_generations）

- `POST /api/generate-battle-story` 在成功/失败（含敏感词拒绝、顶层 catch）都会写入：
  - `battle_report_generations`
  - `battle_report_generation_combatants`
- `battle_report_generations` 已增加并写入可空字段 `pvp_room_id` / `pvp_match_id` / `pvp_round_id`，因此可以可靠筛选并定位 PVP 触发的生成记录。

### 1.3 当前“记录能力”的剩余缺口（产品化）

1. **缺少“对战历史/复盘/排行”的对外能力**  
   数据层已具备（`pvp_matches` / `pvp_rounds` / `battle_report_generations.pvp_*`），但尚未提供面向用户/运营的查询 API 与 UI。
2. **线上迁移落地不确定性**  
   由于 `lib/database/schema.sql` 仅是目标结构，实际 D1 环境若未执行 `ALTER TABLE/CREATE INDEX`，会出现“代码写入字段但线上缺列”的风险。

---

## 2. 目标与边界

### 2.1 目标

1. **可持久化的 PVP 对战记录**：至少支持未来做
   - 排行（胜场、胜率、连胜等）
   - 用户生涯（总场次、对手、近期战绩）
2. **可靠区分 PVP vs 非 PVP 战报生成记录**：可从 `battle_report_generations` 直接过滤出 PVP 触发的生成。
3. **可靠定位**：给定任一条 PVP 战报生成记录，能定位到对应的 PVP 对战（match/round）。
4. **失败也要可追踪**：即便生成失败/敏感词拒绝，也应能把失败的 generation 归属到对应 PVP 回合（便于排查与风控）。

### 2.2 非目标（本轮不强制）

- 不要求存储“完整战报正文”用于历史回放（当前 `battle_report_generations` 主要存 preview；未来若要回放可另行设计存储策略）。
- 不做“可验证随机性/反作弊”体系（只先把记录链路打通）。

---

## 3. 方案选型

### 方案 A（推荐）：在 battle_report_generations 增加 PVP 关联字段 + 引入 PVP Match 记录

核心点：
1. `battle_report_generations` 增加可空字段 `pvp_match_id` / `pvp_round_id`（可选再加 `pvp_room_id`）。
2. PVP 引入“持久化对战记录”概念：`pvp_matches`（整场）与 `pvp_rounds`（每回合）形成稳定主键，不再被 `restart` 清除。
3. `POST /api/generate-battle-story` 接收可选 `pvpContext`，在成功/失败分支都将该 context 写入 `battle_report_generations`。

优点：
- 查询简单：不用靠 endpoint 猜测，直接 `WHERE pvp_match_id IS NOT NULL`。
- 关联强：一个 generation 记录可以准确指向某个 PVP round/match。
- 失败可追踪：敏感词拒绝/异常也能落下关联字段。

代价：
- 需要 D1 变更（ALTER TABLE + 新增表/字段）。
- 需要调整生成端点与 PVP resolve 的调用参数（兼容性需设计）。

### 方案 B：新增一张“映射表”而不改 battle_report_generations

做法：
- 新增 `battle_report_generation_links(generation_id, link_type, link_id, created_at)`；
- PVP resolve 在拿到 generationId 后写入映射。

优点：
- 不需要改 `battle_report_generations` 主表结构。

缺点：
- 仍依赖“PVP 必须拿到 generationId 且写映射成功”，失败路径更容易丢关联。
- 查询需要 join，且更容易出现“孤儿 generation”。

### 方案 C：只把 generationId 写回 pvp_rounds（不改 battle_report_generations）

做法：
- 让 `/api/generate-battle-story` 返回 `generationId`；
- PVP resolve 把它写回 `pvp_rounds.battle_generation_id`。

优点：
- 改动点少。

缺点：
- `battle_report_generations` 仍无法可靠区分 PVP vs 非 PVP（只能通过 join/推断）。
- 失败/早退情况下更容易丢写回（仍需要额外“失败也写回”的兜底）。

> 推荐选择：**方案 A**（把“区分”和“关联”两件事都做到数据层的一等公民）。

落地说明：
- 当前实现已按 **方案 A** 执行；方案 B/C 可视为备选思路留档。

---

## 4. 推荐数据模型（方案 A）

> 说明：以下字段/表结构已经体现在 `lib/database/schema.sql` 与当前代码中；这里保留为“线上 D1 迁移参考”与设计留档。

### 4.1 battle_report_generations：新增 PVP 关联字段（可空）

新增字段（nullable）：
- `pvp_room_id TEXT`：房间 ID（便于从 generation 直接跳到房间；可选）
- `pvp_match_id TEXT`：对战（整场）ID
- `pvp_round_id TEXT`：回合 ID

索引建议：
- `idx_battle_report_generations_pvp_match_id(pvp_match_id)`
- `idx_battle_report_generations_pvp_round_id(pvp_round_id)`

DDL 草案（迁移时使用 `ALTER TABLE`）：

```sql
ALTER TABLE battle_report_generations ADD COLUMN pvp_room_id TEXT;
ALTER TABLE battle_report_generations ADD COLUMN pvp_match_id TEXT;
ALTER TABLE battle_report_generations ADD COLUMN pvp_round_id TEXT;

CREATE INDEX IF NOT EXISTS idx_battle_report_generations_pvp_match_id
  ON battle_report_generations(pvp_match_id);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_pvp_round_id
  ON battle_report_generations(pvp_round_id);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_pvp_room_id
  ON battle_report_generations(pvp_room_id);
```

> 说明：SQLite/D1 对 `ALTER TABLE ADD COLUMN` 支持良好；外键约束可先不加（避免线上已有脏数据导致迁移失败），先以逻辑一致性为主。

### 4.2 PVP：引入“对战（match）”持久化记录

现有 `pvp_rooms` 更像“会话/房间”，可能被 `restart` 复用；因此建议增加：

#### （建议新增）`pvp_rooms.current_match_id`：房间当前正在进行的对战

动机：
- `match` 是“整场”的主键；房间可能会 `restart` 复用，因此需要一个明确字段指向“当前这场”。
- 便于 API 在不额外推断的情况下拿到 `matchId`（例如：resolve 时直接从房间读到 matchId，并传给 `generate-battle-story` 的 `pvpContext`）。

DDL 草案：

```sql
ALTER TABLE pvp_rooms ADD COLUMN current_match_id TEXT;
CREATE INDEX IF NOT EXISTS idx_pvp_rooms_current_match_id ON pvp_rooms(current_match_id);
```

#### `pvp_matches`（整场对战）

建议字段（最小集）：
- `id TEXT PRIMARY KEY`：matchId
- `room_id TEXT NOT NULL`：来源房间（用于回溯）
- `status TEXT NOT NULL`：`active` / `completed` / `aborted`
- `rules_json TEXT NOT NULL`：对局开始时的规则快照
- `participants INTEGER NOT NULL`
- `started_at TEXT NOT NULL`
- `ended_at TEXT`
- `winner_user_id INTEGER`（平局/中止则 NULL）
- `result_json TEXT`（例如比分、平局原因、错误摘要等）
- `created_at` / `updated_at`

#### `pvp_match_players`（对战参与者快照）

建议字段：
- `match_id TEXT NOT NULL`
- `user_id INTEGER NOT NULL`
- `seat INTEGER NOT NULL`
- `username TEXT` / `user_prefix TEXT`（用于展示；以 user_id 为主键）
- `joined_at TEXT`
- `PRIMARY KEY(match_id, user_id)`

#### `pvp_rounds`（每回合）建议增加 `match_id`

当前表结构是 `pvp_rounds(room_id, round_index, ...)`，建议增补：
- `match_id TEXT NOT NULL`：将回合绑定到“哪一场 match”

索引建议：
- `idx_pvp_rounds_match_id(match_id)`
-（可选）唯一约束：`UNIQUE(match_id, round_index)`，避免同场重复回合序号。

DDL 草案：

```sql
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
  updated_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES pvp_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (winner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pvp_matches_room_id ON pvp_matches(room_id);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_status ON pvp_matches(status);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_started_at ON pvp_matches(started_at);

CREATE TABLE IF NOT EXISTS pvp_match_players (
  match_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  seat INTEGER NOT NULL,
  username TEXT,
  user_prefix TEXT,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (match_id, user_id),
  FOREIGN KEY (match_id) REFERENCES pvp_matches(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pvp_match_players_match_id ON pvp_match_players(match_id);
CREATE INDEX IF NOT EXISTS idx_pvp_match_players_user_id ON pvp_match_players(user_id);

ALTER TABLE pvp_rounds ADD COLUMN match_id TEXT;
CREATE INDEX IF NOT EXISTS idx_pvp_rounds_match_id ON pvp_rounds(match_id);
```

> 注：`ALTER TABLE pvp_rounds ADD COLUMN match_id TEXT;` 会让历史数据该列为 NULL。  
> 若要让历史数据可用，需要后续做一次 backfill（本轮可不做；也可接受历史数据不参与排行）。

### 4.3 关联关系（目标态）

- 一个 `pvp_matches.id` 对应多个 `pvp_rounds`（`pvp_rounds.match_id = pvp_matches.id`）。
- PVP 结算触发的 `battle_report_generations` 将带上：
  - `pvp_match_id = <matchId>`
  - `pvp_round_id = <roundId>`
  -（可选）`pvp_room_id = <roomId>`
- `pvp_rounds.battle_generation_id` 与 `battle_report_generations.id` 一一对应（同一回合若允许重试生成，需明确是否覆写或生成多条；建议“同回合只保留最后一次成功/失败 generationId”，旧记录仍可通过 `battle_report_generations.pvp_round_id` 查询到）。

---

## 5. API/实现改动点（仅设计）

### 5.1 `/api/generate-battle-story`：支持写入 PVP context

请求体新增可选字段（建议）：

```json
{
  "pvpContext": {
    "roomId": "text",
    "matchId": "text",
    "roundId": "text"
  }
}
```

写入要求：
- 在 **completed / failed / aborted** 的所有写库分支中，都应将 `pvpContext.*` 落到 `battle_report_generations` 新字段。
- 对非 PVP 调用者：不传 `pvpContext`，字段保持 NULL。

响应体建议新增（兼容字段）：
- `generationId: string`（即 `battle_report_generations.id`）

> 这样 PVP resolve 可以同时做到：
> - 把 `generationId` 写回 `pvp_rounds.battle_generation_id`
> - 即使 PVP 自己写回失败，也可通过 `battle_report_generations.pvp_round_id` 找回

### 5.2 PVP resolve：创建 match、传递 context、写回 generationId

建议时序（关键点）：
1. `start` 阶段创建 `pvp_matches`（status=active）与 `pvp_match_players` 快照；将 `matchId` 存在房间可读状态中（例如 `pvp_rooms.rules_json` 内或新增 `pvp_rooms.current_match_id` 字段 —— **建议新增字段更清晰**）。
2. `resolve` 调用 `generate-battle-story` 时带上 `pvpContext`。
3. 拿到响应 `generationId` 后，写回：
   - `pvp_rounds.battle_generation_id = generationId`
4. 结算整场后更新：
   - `pvp_matches.status = completed`
   - `pvp_matches.winner_user_id / ended_at / result_json`

失败/敏感词拒绝时的约定（建议）：
- 仍应创建/更新本回合 `pvp_rounds.status` 与 `result_json.error`，并把 `battle_generation_id` 写回（若拿到 generationId）。
- 生成失败但回合仍要“可结束/可继续”需要明确规则（例如：失败重试次数用尽则判平局并推进）。

---

## 6. 迁移与兼容性建议

### 6.1 数据库迁移顺序（建议）

你当前的线上状态是：
- **`battle_report_generations` 已存在**（需要增量加列/加索引）
- **PVP 相关表暂未创建**（可等 PVP 首次上线时再统一建表/加列）

因此建议分两步走：

#### 第一步：仅迁移 `battle_report_generations`（当前必须）

```sql
ALTER TABLE battle_report_generations ADD COLUMN pvp_room_id TEXT;
ALTER TABLE battle_report_generations ADD COLUMN pvp_match_id TEXT;
ALTER TABLE battle_report_generations ADD COLUMN pvp_round_id TEXT;

CREATE INDEX IF NOT EXISTS idx_battle_report_generations_pvp_room_id
  ON battle_report_generations(pvp_room_id);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_pvp_match_id
  ON battle_report_generations(pvp_match_id);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_pvp_round_id
  ON battle_report_generations(pvp_round_id);
```

> 说明：这些列均为可空，不影响现有战报生成与查询；新增索引用于后续高频筛选（例如“只看 PVP 生成记录”）。

#### 第二步：PVP 首次上线时执行（后续）

1. 新建 `pvp_matches` / `pvp_match_players`
2. `ALTER TABLE pvp_rooms ADD COLUMN current_match_id` + 索引
3. `ALTER TABLE pvp_rounds ADD COLUMN match_id` + 索引

### 6.2 兼容策略

- 旧调用方不传 `pvpContext`：生成端点保持兼容。
- 旧 PVP 记录（无 match_id / 无 generationId）：
  - 不参与排行可接受；
  - 若需要历史回填，可通过时间范围 + roomId 推断，但不建议自动推断（容易误关联）。

---

## 7. 未来查询示例（为排行/生涯预留）

### 7.1 某用户 PVP 总场次 / 胜场

```sql
SELECT
  COUNT(*) AS total_matches,
  SUM(CASE WHEN winner_user_id = :userId THEN 1 ELSE 0 END) AS win_matches
FROM pvp_matches
WHERE status = 'completed'
  AND id IN (
    SELECT match_id FROM pvp_match_players WHERE user_id = :userId
  );
```

### 7.2 某场对战的所有回合与对应战报生成记录

```sql
SELECT
  r.round_index,
  r.winner_user_id,
  r.winner_name,
  r.battle_generation_id,
  g.status AS generation_status,
  g.winner AS generation_winner,
  g.output_preview
FROM pvp_rounds r
LEFT JOIN battle_report_generations g ON g.id = r.battle_generation_id
WHERE r.match_id = :matchId
ORDER BY r.round_index ASC;
```

### 7.3 从战报生成记录反查 PVP 回合

```sql
SELECT pvp_match_id, pvp_round_id, pvp_room_id
FROM battle_report_generations
WHERE id = :generationId;
```

---

## 8. 待你确认的关键决策（请审查）

1. **match 的边界**：一个房间 `restart` 是否必然开启一场新 match？（推荐：是）
2. **是否允许“同回合多次生成”**：若允许重试生成，是覆盖 `pvp_rounds.battle_generation_id`，还是保留多条并标记哪条为当前？（推荐：覆盖写回 + 依靠 `battle_report_generations.pvp_round_id` 可追溯历史尝试）
3. **隐私/存储策略**：PVP 记录是否需要长期保存“卡牌快照/战报全文”？（本设计默认不强制）
