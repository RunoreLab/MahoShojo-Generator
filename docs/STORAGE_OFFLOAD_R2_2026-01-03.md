# 大对象外部化（D1/R1 → R2）分析与方案（基于 2025-12-24 / 2025-12-31 备份）

日期：2026-01-03  
分析对象（本地备份）：  
- `/mnt/d/04-生活与娱乐/魔法少女竞技场/mahoshojo_20251224.db`  
- `/mnt/d/04-生活与娱乐/魔法少女竞技场/mahoshojo_20251231.db`  

> 目标：量化“真实字节量”（不是字段类型声明的大小），找出近期增长最快的大字段，并据此拟定把大对象外部化到 R2 的分层与迁移方案。  

---

## 1. 统计口径与方法

### 1.1 “真实字节量”的定义

本次统计采用 SQLite 表达式：

- 单行字节量：`LENGTH(CAST(col AS BLOB))`  
  - 对 `TEXT`：按 UTF-8 编码后的字节数计量（比 `LENGTH(col)` 的“字符数”更贴近网络/存储成本）。  
  - 对 `BLOB`：为原始字节数。
- 列总字节量：`SUM(LENGTH(CAST(col AS BLOB)))`

这衡量的是“逻辑内容字节量”，不等同于 SQLite 页面/索引等“物理占用”，但对判断“哪些字段值得外部化”非常有效。

### 1.2 数据库膨胀（freelist）口径

SQLite 文件大小包含已释放但未回收的页面（freelist）。本次用：

- `PRAGMA page_size`
- `PRAGMA page_count`
- `PRAGMA freelist_count`

估算：

- `used_bytes ≈ (page_count - freelist_count) * page_size`
- `free_bytes ≈ freelist_count * page_size`

---

## 2. 关键结论（先看这个）

### 2.0 需求确认（你在 2026-01-03 的补充结论）

- D1 单库大小上限：目前距离上限约 **1.5 GB**（仍有缓冲，但需要尽快控制“持续增长项”）。  
- `battle_report_generations.output_preview` 主要用于“重生战报”（允许慢一些），迁移后可接受 **直接置 NULL**（不要求列表/详情快速展示全文）。  
- PVP：除“战绩记录/个人资料卡/统计”外，其它房间过程数据都可在 **全员退出或超时后立即清理**；不要求历史回放完全复现，但个人资料卡需要展示“每回合打出卡牌/胜利者”的**卡牌名字**。  
- R2 对象访问：只对登录用户可见，不需要公开分享链接。  
- 方案偏好：倾向 **方案 B（统一大对象索引表 large_objects）**，便于后续扩展（例如角色立绘）。  

> 这会显著影响方案：战报正文不必保留 excerpt；PVP 可以更激进地“结算后清场”；同时必须确保“重生战报”在 output_preview 置空后仍能工作（需要改为从 R2 取全文）。  

### 2.1 近期增长最快、且体量最大的字段：`battle_report_generations.output_preview`

对比 2025-12-24 → 2025-12-31：

- `battle_report_generations.output_preview` 总量从 **99.92 MB** 增长到 **551.69 MB**，净增 **+451.77 MB**（压倒性第一）。

这说明“战报输出内容”目前是容量压力的主因，优先外部化它能立刻显著降压。

### 2.2 数据库文件“看起来变大”的主要原因之一：存在大量 freelist（可通过 VACUUM 回收）

两份备份对比：

- `mahoshojo_20251224.db`
  - 文件大小：**982.68 MB**
  - 估算 used：**981.84 MB**
  - 估算 free：**0.84 MB**
- `mahoshojo_20251231.db`
  - 文件大小：**1633.55 MB**
  - 估算 used：**1106.03 MB**
  - 估算 free：**527.52 MB**

也就是说：

- “真实使用量”仅增长约 **+124.19 MB**
- 但文件膨胀约 **+650.86 MB**
- 其中约 **527.52 MB** 是“已删除但未回收”的空洞页面

并且在 2025-12-24 备份中存在 `shojo(data TEXT, created_at TEXT)` 表，且 `shojo.data` 逻辑字节量约 **475.30 MB**；到 2025-12-31 备份中该表已不存在（或数据为 0），这与 freelist 激增高度吻合：**删除/迁移带来的空洞没有被 VACUUM 回收**。

> 如果你的容量瓶颈是“数据库文件大小上限”，那么仅做外部化还不够；需要配合一次可控的 VACUUM/重建才能把空洞空间真正释放掉。

### 2.3 PVP 相关表存在明显的“内容重复/嵌套快照”问题

体量与增长较明显的字段（2025-12-31 备份）：

- `pvp_room_submissions.submission_json`：**28.91 MB**（最大单行 **518.32 KB**）
- `pvp_room_card_snapshots.data_json`：**37.42 MB**（最大单行 **261.29 KB**）
- `pvp_rooms.rules_json`：**18.73 MB**（最大单行 **570.36 KB**）

抽样显示 `submission_json` 内包含 `dataJson`（卡牌完整 JSON 的字符串化快照），而 `rules_json` 里也可能包含体积非常夸张的嵌套内容（例如 base64 内容）。这类“重复内嵌”会让容量以非线性方式增长，且非常适合做：

1) 结构改造（只存引用，不存全量快照）  
2) 或“快照”统一外部化到 R2（并 gzip）

---

## 3. 2025-12-31 备份：大字段总量排行（Top）

按“列总字节量”排序（Top 10）：

1. `battle_report_generations.output_preview`：**551.69 MB**
2. `data_cards.data`：**255.64 MB**
3. `pvp_room_card_snapshots.data_json`：**37.42 MB**
4. `pvp_room_submissions.submission_json`：**28.91 MB**
5. `pvp_rooms.rules_json`：**18.73 MB**
6. `battle_report_generations.user_agent`：**12.02 MB**
7. `battle_report_generations.adjudication_events_preview`：**9.25 MB**
8. `battle_report_generation_combatants.template_id`：**7.11 MB**
9. `battle_report_generation_combatants.generation_id`：**5.91 MB**
10. `battle_report_generations.headline`：**5.72 MB**

> 备注：`user_agent / referer / accept_language / ip` 这类字段虽然“看着大”，但与前 5 的数量级完全不同；外部化优先级远低于战报正文与 PVP 大 JSON。

---

## 4. 2025-12-24 → 2025-12-31：增长最快字段（Top）

按“列总字节量净增”排序（Top 10）：

1. `battle_report_generations.output_preview`：**+451.77 MB**
2. `pvp_room_card_snapshots.data_json`：**+19.54 MB**
3. `data_cards.data`：**+17.71 MB**
4. `pvp_room_submissions.submission_json`：**+14.84 MB**
5. `pvp_rooms.rules_json`：**+8.59 MB**
6. `battle_report_generations.user_agent`：**+8.28 MB**
7. `battle_report_generations.adjudication_events_preview`：**+6.58 MB**
8. `battle_report_generation_combatants.template_id`：**+4.89 MB**
9. `battle_report_generation_combatants.name`：**+4.53 MB**
10. `battle_report_generation_combatants.generation_id`：**+4.05 MB**

净减少（与 freelist 激增强相关）：

- `shojo.data`：约 **-475.30 MB**（2025-12-24 有，2025-12-31 为 0/不存在）

---

## 5. 分布与“该保留多大的预览”建议

### 5.1 `battle_report_generations.output_preview` 分布（2025-12-31 备份）

共 **77,633** 行有值，均值 **7.28 KB**，分位数：

- P50：**4.57 KB**
- P90：**12.82 KB**
- P95：**14.16 KB**
- P99：**17.66 KB**
- P99.9：**24.84 KB**
- 最大值：**62.68 KB**

建议：如果把“全文”外部化到 R2，则 D1 内只保留 **2–4 KB** 的 excerpt 足够支撑列表/摘要展示；全文按需从 R2 拉取（并用边缘缓存加速）。

---

## 6. 推荐方案（按优先级分阶段）

### 6.1 P0：战报正文外部化到 R2（立刻止血）

目标：把 `battle_report_generations.output_preview` 从“正文存储”降级为“摘要存储”，把全文（建议 gzip）放到 R2。

建议的数据模型（两种可选）：

**方案 A：在原表加列（改动最小）**

- `battle_report_generations` 新增：
  - `output_r2_key TEXT`：R2 对象 key（空值表示仍走旧逻辑）
  - `output_bytes INTEGER`：全文字节量（便于统计）
  - `output_sha256 TEXT`：可选（便于一致性校验/去重）
  - `output_excerpt TEXT`：固定上限（如 2048 或 4096 字节/字符，需明确口径）
- 将现有 `output_preview`：
  - 迁移后置空（`NULL`）或仅保留短摘要（并考虑重命名以避免语义误导）

**方案 B：引入统一“大对象索引表”（长期更易扩展）**

新增 `large_objects`（D1/R1）：

- `id TEXT PRIMARY KEY`（可用 UUID/ULID）
- `kind TEXT`（如 `battle_report_output` / `pvp_rules` / `pvp_submission`）
- `owner_id TEXT`（如 generation_id / room_id 等）
- `r2_key TEXT NOT NULL`
- `bytes INTEGER NOT NULL`
- `sha256 TEXT`（可选）
- `content_type TEXT`（如 `text/markdown; charset=utf-8` / `application/json`）
- `content_encoding TEXT`（如 `gzip`）
- `created_at TEXT`

业务表只存 `large_object_id` 或 `r2_key`，便于后续把更多字段迁移出去。

#### 6.1.1 代码审阅要点：`重生战报` 当前依赖 `output_preview`

当前实现中，`/api/me/battle-reports/:generationId/regenerate` 会把 `battle_report_generations.output_preview` 作为输入传给 `hydrateBattleReportCardFromGenerationRecord(...)`。  
因此如果你希望迁移后 `output_preview = NULL`，则必须在 regenerate 路径做“**双读**”：

- `output_preview` 有值：沿用旧逻辑（纯 D1 兼容）。  
- `output_preview` 为空且存在 `large_objects` 引用：从 R2 读取全文（JSON/Markdown），再继续 hydrate。  
- 读取失败：给出明确错误（不要 silent 生成空战报）。  

这也是你强调“兼容 D1/R2 两种存储方式”的关键落点之一。

#### 6.1.2 结合“登录可见、无公开分享”的落地建议

- 不向客户端直接暴露 R2 公网 URL；由后端在校验权限后，用服务端签名请求读取 R2（或返回短期 presigned URL 也行，但你目前不需要公开分享，优先服务端直读更简单）。  
- 建议把战报正文以 **`application/json; charset=utf-8` + gzip** 存 R2（内容本身高度可压缩，前期抽样 ratio ≈ 0.37–0.49）。  
- `output_preview` 可以迁移后置 `NULL`（符合你的使用偏好），但建议保留 `output_bytes` / `headline` / `winner` 等可统计字段在 D1。  

#### 6.1.3 large_objects（方案 B）推荐字段（可作为 schema 草案）

> 以“未来可能保存/分享角色立绘”为前提，建议从一开始就做成通用对象索引表。

- `id TEXT PRIMARY KEY`  
- `kind TEXT NOT NULL`（例如：`battle_report_output_json` / `pvp_room_rules_json` / `tachie_image_webp`）  
- `owner_user_id INTEGER`（可空；PVP 共享/系统生成可为空）  
- `owner_ref_id TEXT`（generationId / roomId / dataCardId 等）  
- `r2_key TEXT NOT NULL`  
- `bytes INTEGER NOT NULL`  
- `sha256 TEXT`（可选，用于去重/校验）  
- `content_type TEXT`（如 `application/json; charset=utf-8`、`image/webp`）  
- `content_encoding TEXT`（如 `gzip`，无则为空）  
- `created_at TEXT NOT NULL`  
- `updated_at TEXT NOT NULL`  

（可选）约束/索引：

- `UNIQUE(kind, owner_ref_id)`：保证“一个业务实体只挂一个同类大对象”。  
- `INDEX(kind, created_at)`：便于做清理/统计。  
- `INDEX(owner_user_id, created_at)`：便于按用户追踪体积/用量。  

### 6.2 P1：PVP 大 JSON 的“去内嵌 + 外部化快照”

优先改造目标：

- `pvp_room_submissions.submission_json`
  - 现状：内嵌 `dataJson` 导致重复存储（同一张卡在多个 submission 里反复出现）
  - 建议：
    1) `submission_json` 仅保留 `ref(id, updatedAt)` + 必要展示字段（name/type 的 snapshot 可留）
    2) 如果确实需要“可复现回放”，则把“当时的卡牌快照”统一写入 `pvp_room_card_snapshots` 并外部化到 R2（或用 CAS 按 sha256 去重）

- `pvp_rooms.rules_json`
  - 若其内包含大块嵌套（甚至 base64），建议拆分：
    - “可索引的小配置”（人数、规则开关、卡池引用）保留在 D1
    - “卡池/预设/大对象”放 R2

### 6.3 P2：`data_cards.data` 的处理建议（慎重）

`data_cards.data` 目前约 **255.64 MB**，属于“第二大”。但它很可能是“高频读取热数据”（对战/组卡/检索）。

建议默认 **先不动**，只做两类优化：

1) **结构优化**：避免在 PVP 等日志表中重复内嵌 `data_cards.data`（优先级高于把 data_cards 外部化）  
2) **有条件外部化**（可选）：只把超过阈值的超大卡（比如 >128KB）外部化到 R2（但根据统计，>64KB 的卡只有 271 行、约 28.94MB，总收益有限）

---

## 7. R2 Key 目录分层（建议）

目标：可归类、可按时间做生命周期管理、避免 key 冲突，并保留未来版本演进空间。

建议统一使用：

- `v1/<kind>/YYYY/MM/DD/<id>/<part>.<ext>`

示例：

- 战报正文：
  - `v1/battle-report-generations/2025/12/31/49e6ce5b-aa5c-43dc-9250-589805835c94/output.md`
- PVP 房间规则：
  - `v1/pvp-rooms/2025/12/31/07f62e9f-4b12-4a1f-b4bb-091e36d7abde/rules.json`
- PVP 提交：
  - `v1/pvp-room-submissions/2025/12/31/<roomId>/<submissionId>.json`
- 卡牌快照：
  - `v1/pvp-room-card-snapshots/2025/12/31/<snapshotId>/data.json`

备注：

- 是否 gzip 由 `Content-Encoding: gzip` 决定；不建议把 `.gz` 作为业务语义的一部分（避免在少数运行时不支持 `CompressionStream` 时出现“key 是 .gz 但内容未压缩”的不一致）。
- 如果某些表的时间字段不稳定/缺失，可退化为 `YYYY/MM=0000/00` 或直接用 `created_at`/`started_at` 中可解析的日期部分。  
- 不建议依赖 R2 的 list 做业务逻辑；D1 中应始终保存“直接可用的 key”。  

---

## 8. 迁移与上线策略（推荐执行顺序）

1) **先做 schema 扩展**（新增 key/bytes/excerpt 等列或新增 `large_objects` 表）  
2) **双写**：新生成内容同时写 D1（excerpt）+ 写 R2（全文），D1 记录 key  
3) **双读**：读取时优先 R2（有 key 就读 R2），没有 key 则回退旧列  
4) **回填历史数据**：批处理把旧 `output_preview` 全量迁移到 R2，并写回 key/excerpt  
5) **清理与回收空间**：将旧大字段置空后，在合适窗口执行一次 VACUUM/重建（否则 freelist 仍会占用容量上限）  
6) **监控**：定期统计“列总字节量 / 新增字节量 / freelist”并出告警阈值

---

## 8.1 当前仓库已落地的改动点（便于对照）

### 8.1.1 PVP：结算/关房自动清理过程数据（已实现）

- 新增清理函数：`lib/database/pvp.ts` 的 `clearPvpRoomEphemeralState`  
- 触发点：
  - 对局结束（最后一回合确认推进到 finished）：`pages/api/pvp/rooms/[roomId]/rounds/[roundId]/confirm.ts`  
  - 房间关闭（全员退出/房主关闭/踢出导致空房间）：`pages/api/pvp/rooms/[roomId]/leave.ts`、`pages/api/pvp/rooms/[roomId]/kick.ts`  

### 8.1.2 战报：流式/非流式输出写入 R2 + regenerate 双读（已实现，需建表）

- 非流式（JSON）：`pages/api/generate-battle-story.ts`、`pages/api/arena/generate.ts` 会把完整 `reportJson` 写入 R2（支持时 gzip）。  
- 流式（Markdown）：`pages/api/arena/generate-stream.ts` 会把“客户端实际收到的 Markdown（含 telemetry 注释）”同步 tee 到 R2（支持时 gzip）。  
- regenerate 双读：当 D1 的 `output_preview` 为空时，`pages/api/me/battle-reports/[generationId]/regenerate.ts` 会从 `large_objects` → R2 读取正文再重生。  

### 8.1.3 环境变量开关（可选）

- `BATTLE_REPORT_OUTPUT_PREVIEW_PERSIST`
  - 默认：保留（等价于 true）
  - 设为 `0/false/off`：在“R2 写入 + large_objects 索引成功”后，将 `battle_report_generations.output_preview` 置 `NULL`
- `BATTLE_REPORT_OUTPUT_PREVIEW_MODE`
  - 默认 `full`（等价于把全文写进 `output_preview`，会显著推高 D1 体积）
  - 可设为 `truncate`（仅保留 head/tail 拼接的摘要；适合你后续如果决定“D1 仍保留摘要但不保留全文”的折中策略）

---

## 8.2 D1 建表/运维脚本（仓库内提供）

1) 初始化 `large_objects` 表（必须先做，才会真正开始“置空 output_preview + 从 R2 双读”）：

- `bun tsx scripts/init-large-objects.ts`

2) 立即清理历史遗留的 PVP 过程数据（推荐先 dry-run 再执行）：

- `bun tsx scripts/pvp-prune-ephemeral.ts --dry-run --limit=500`
- `bun tsx scripts/pvp-prune-ephemeral.ts --limit=500`（可重复执行直到候选为空）

---

## 9. 已确认前提与仍需拍板事项

### 9.1 已确认（2026-01-03）

- 容量瓶颈：Cloudflare D1 单库大小上限，当前距离上限约 **1.5 GB**。  
- `battle_report_generations.output_preview` 主要用于“重生战报”，允许慢；迁移后可接受置 `NULL`。  
- PVP：除战绩/资料卡必需数据外，其它房间过程数据可在全员退出或超时后立即清理；不要求历史回放完全复现，但资料卡需要卡牌名字/胜者名字。  
- R2 仅登录用户可见；当前不需要“公开分享链接”。  
- 方向偏好：方案 B（统一 `large_objects` 索引表），便于未来扩展（例如角色立绘）。  

### 9.2 仍需你拍板（影响后续迁移脚本/长期成本）

1) **历史战报回填到 R2 的范围**：你希望迁移“全部历史”还是“只迁移近 N 天 / 近 N 条 / 只迁移活跃用户”？（这决定一次性脚本成本与风险窗口）  
2) **D1 是否保留摘要**：当前已支持“R2 成功后置空 `output_preview`”。如果你希望列表/详情首屏仍有摘要，建议新增 `output_excerpt`（避免 `output_preview` 语义混乱），并把 `output_preview` 永久用于“兼容旧数据”。  
3) **VACUUM/重建的执行方式**：你更偏好
   - A：导出 → 新库导入/重建 → 切换绑定（更稳，通常能真正回收 freelist，但需要一次切换窗口）  
   - B：低峰直接执行 `VACUUM`（如果 D1 支持且你接受锁库/临时空间/超时风险）  
4) **R2 生命周期规则**：你现在倾向默认长期保留；是否需要先约定一个“PVP 快照类对象”的保留期（例如 7/30 天）以防后续再次膨胀？（战报正文可永久）  

---

## 10. PVP：战绩/资料卡依赖梳理与“可清理清单”（基于代码审阅）

### 10.1 个人资料卡与战绩页面依赖哪些表？

从 `pages/api/me/profile-card.ts` 与 `pages/api/me/pvp.ts` 的调用链看：

- 生涯战绩摘要：`pvp_match_players` + `pvp_matches`（completed/wins/losses/draws/aborted、last_played_at）。  
- 最近对局列表：`pvp_matches` + `pvp_match_players`（对手昵称/前缀快照）。  
- 回合胜负统计：`pvp_rounds`（按 match_id 聚合 winner_user_id）。  
- 单场详情（我的对局 → 详情）：`pvp_matches` + `pvp_match_players` + `pvp_rounds`。  

并且在回合结算写入 `pvp_rounds.result_json` 时，已经包含每个参战者的 `name`（卡牌名）与 `winnerName`（胜者名）。  
因此“个人资料卡显示每回合打出卡牌/胜利者”在数据层面可以只依赖：

- `pvp_rounds.winner_name` 与/或 `pvp_rounds.result_json.combatants[].name`  

无需永久保留“房间提交/手牌/卡快照”等过程数据。

### 10.2 结算后可立即清理的表/字段（不影响战绩统计）

建议在“整场对局结束（phase=finished）”或“全员退出/超时关闭”后，清理以下内容：

- `pvp_room_submissions`（submission_json 很大，且为过程数据）  
- `pvp_room_hands`（过程数据）  
- `pvp_room_card_snapshots`（用于结算时取卡牌全量 JSON；无历史回放需求时可删）  
- `pvp_room_chat_messages`（可选，量不大但属于过程数据）  
- `pvp_round_choices`（可选，结算后 result_json 已含参战卡名/快照 id，choices 冗余）  
- `pvp_rooms.rules_json`：建议清理运行时字段（如 `_bots/_postRound/_winnerVote/_drawPile/_usedPile/...`），只保留规则配置与必要元数据，避免 rules_json 变成“房间状态垃圾桶”

### 10.3 推荐触发点（实现层面）

- **最后一回合确认推进（match 完结）**：在将房间推进到 `phase=finished` 时立刻清理一次（收益最大，且不再需要快照/手牌）。  
- **房间关闭（全员退出/房主关闭）**：在 `status/phase` 进入 `closed` 时再兜底清理一次（覆盖“未打完就散场”的情况）。  

两类触发点叠加，可以把“过程数据的留存时间”压到最短，从而显著减缓 D1 的持续增长。

### 10.4 重要约束：不要直接删 `pvp_rooms` 行

当前 schema 中，`pvp_matches.room_id` 与 `pvp_rounds.room_id` 均外键引用 `pvp_rooms(id)`（并可能存在级联删除）。  
如果直接删除 `pvp_rooms` 行，存在把战绩主表一起删掉的风险。  

在不做 schema 级解耦（例如把外键改为 `ON DELETE SET NULL`）之前，推荐策略是：

- **保留 `pvp_rooms` 行**（仅作为历史关联占位），但把大字段/过程数据清空。  


---

## 11. 附：本次统计中观察到的风险点（简述）

- **freelist 膨胀**：删除/迁移不等于容量下降，必须配套 VACUUM/重建策略。  
- **PVP JSON 内嵌重复**：`submission_json` 内嵌卡牌全量 JSON 是典型“空间指数型增长点”，应尽早改为“引用 + 可选快照”。  
- **R2 外部化不是银弹**：若需要 SQL 级全文检索/统计，必须保留可检索的字段（如标题、摘要、结构化事件）在 D1。  
