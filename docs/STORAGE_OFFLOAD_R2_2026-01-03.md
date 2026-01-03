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

- `v1/<kind>/YYYY/MM/DD/<id>/<part>.<ext>[.gz]`

示例：

- 战报正文：
  - `v1/battle-report-generations/2025/12/31/49e6ce5b-aa5c-43dc-9250-589805835c94/output.md.gz`
- PVP 房间规则：
  - `v1/pvp-rooms/2025/12/31/07f62e9f-4b12-4a1f-b4bb-091e36d7abde/rules.json.gz`
- PVP 提交：
  - `v1/pvp-room-submissions/2025/12/31/<roomId>/<submissionId>.json.gz`
- 卡牌快照：
  - `v1/pvp-room-card-snapshots/2025/12/31/<snapshotId>/data.json.gz`

备注：

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

## 9. 需要你确认/回答的问题（决定最终落地形态）

1) 你所说的 “R1 数据库容量不足” 具体是指：Cloudflare D1 的单库大小上限、还是自建/别家 R1（例如 PlanetScale/Neon/自建 Postgres）的配额？当前离上限还有多少？  
2) `battle_report_generations.output_preview` 在前端的使用场景：
   - 是否用于“列表页直接展示全文/长文”？  
   - 是否需要全文检索（SQL LIKE/FTS）？如果需要，外部化会影响检索，需要配套索引策略（例如只索引摘要/标题/关键词）。  
3) PVP 数据保留策略：
   - 结束后的房间/对局数据需要永久保留、还是只保留 N 天？  
   - 是否要求“历史回放时完全复现当时卡牌内容”（这会决定快照是否必须保留）。  
4) R2 访问控制：
   - 战报/回放内容是否只对登录用户可见？是否存在“公开分享链接”的需求？  
5) 你更偏好“方案 A（原表加列）”还是“方案 B（统一大对象索引表）”？（我倾向 B：后续扩展更轻松，但 A 改动最小、上线最快）

---

## 10. 附：本次统计中观察到的风险点（简述）

- **freelist 膨胀**：删除/迁移不等于容量下降，必须配套 VACUUM/重建策略。  
- **PVP JSON 内嵌重复**：`submission_json` 内嵌卡牌全量 JSON 是典型“空间指数型增长点”，应尽早改为“引用 + 可选快照”。  
- **R2 外部化不是银弹**：若需要 SQL 级全文检索/统计，必须保留可检索的字段（如标题、摘要、结构化事件）在 D1。  

