# 后台数据库清理能力设计方案（2026-02-08）

## 1. 背景与目标

为了给 Cloudflare D1 持续腾出空间，并降低长期存储成本，需要在后台提供一套**可控、可预览、可审计**的数据清理能力。该能力需要满足：

1. 管理员可按业务范围（战报、PVP、排位事件、大对象等）进行清理；
2. 支持**字段级**精细操作（不仅是整表/整行删除）；
3. 清理前必须有**影响预览**，降低误操作风险；
4. 支持三类核心动作：
   - 压缩（按长度截断，保留头尾）
   - 设为空/默认值
   - 删除整行记录
5. 与现有 Next.js Pages Router + Edge Runtime + D1 + R2 架构兼容。

---

## 2. 现状审计（结合仓库代码）

## 2.1 后台入口与现有能力

- 后台已有多个独立页面：`/admin/battle-report-generations`、`/admin/arena-rating-events`、`/admin/large-objects` 等。
- 现有后台 API 基本是查询/导出/局部管理，**尚无统一“清理引擎”**。
- 已存在的“清理”能力偏脚本化：`scripts/pvp-prune-ephemeral.ts`。

## 2.2 与清理需求强相关的数据域

### A. 战报域

- `battle_report_generations`
  - 大文本字段：`output_preview`、`user_guidance_preview`、`adjudication_events_preview`、`extra_json`。
  - 审计字段：`ip/user_agent/referer/accept_language/cf_ray`。
- `battle_report_generation_combatants`
  - 可增长字段：`character_guidance`（文本）、`size_bytes/size_chars`（统计值）。

### B. PVP 域

- 临时/过程表：`pvp_room_hands`、`pvp_room_submissions`、`pvp_room_card_snapshots`、`pvp_round_choices`、`pvp_room_chat_messages`。
- 战绩核心表：`pvp_matches`、`pvp_match_players`、`pvp_rounds`、`pvp_rooms`。
- 注意：`pvp_rooms.rules_json` 与 `pvp_rounds.result_json` 在进行中/刚结束对局中仍被业务读取，不能无条件清空。

### C. 排位事件域

- `arena_rating_events`
  - `details_json` 用于展示细节（如 rank delta），历史数据会持续累积。
- `arena_ratings` 属于当前有效状态，不应在“历史清理”中误删。

### D. 大对象索引域

- `large_objects`（目前主要是 `kind=battle_report_generation_output`）
- 与 R2 对象一一对应，需要“删索引是否连带删 R2”可选。

## 2.3 关键事实与边界

1. **历史赛季排行榜页面的核心归档在静态文件**（`public/data/seasons/archive_*.json`），不占 D1 行空间；
2. 旧赛季相关的 D1 可清理对象主要是 `arena_rating_events` 等运行时事件记录；
3. 现有后台 API 普遍未强制管理员鉴权，新清理能力必须独立补齐高危鉴权；
4. 项目运行于 Edge Runtime，清理执行需考虑请求时长上限与分批策略。

---

## 3. 设计原则

1. **白名单驱动**：仅允许预定义表/字段/操作，禁止自由 SQL。
2. **先预览后执行**：执行必须引用最新 preview 的签名（plan hash）。
3. **默认保守**：默认 dry-run，默认不清理“近期数据/进行中数据”。
4. **可审计可追溯**：每次执行记录计划、操作者、影响行数、错误。
5. **可中断可恢复**：分批执行，避免单请求超时导致半失败不可见。

---

## 4. 方案对比

## 方案 A：分散整合到现有管理页

- 做法：在 `battle-report-generations`、`arena-rating-events`、`large-objects` 各自加“清理”按钮。
- 优点：改动小，上线快。
- 缺点：
  - 规则分散，字段级能力难统一；
  - 预览/审计口径不一致；
  - 无法支持跨表依赖提示。

## 方案 B：新增统一页面（推荐）

- 做法：新增 `/admin/data-maintenance`（或 `/admin/database-cleanup`）作为统一清理工作台。
- 优点：
  - 统一 preview 与执行模型；
  - 支持字段级编排与预设策略；
  - 易扩展到后续新表/新业务。
- 缺点：初期开发量更高。

## 方案 C：纯脚本化

- 做法：继续通过 `scripts/*.ts` + 人工命令执行。
- 优点：实现最快。
- 缺点：
  - 不符合“管理员在后台细致操作”的目标；
  - 操作门槛高，误操作不可视。

**结论：采用方案 B**。脚本保留为兜底运维手段。

---

## 5. 推荐总体架构

## 5.1 页面与入口

- 新增页面：`pages/admin/data-maintenance.tsx`
- 后台主页新增入口卡片（可放在 `pages/admin/index.tsx` 管理工具区）。

页面分 4 个区块：

1. **预设策略区**：一键选“战报瘦身”“PVP 过程清理”“排位事件瘦身”等；
2. **高级配置区**：目标表、筛选范围、字段动作编排；
3. **预览区**：影响行数、估算节省字节、依赖影响、样本前后对比；
4. **执行与历史区**：二次确认、进度、执行日志、最近任务。

## 5.2 后端模块建议

- `lib/database/admin-data-maintenance.ts`
  - 目标白名单定义
  - 预览计算
  - 分批执行器
  - 依赖影响分析
- API：
  - `POST /api/admin/data-maintenance/preview`
  - `POST /api/admin/data-maintenance/execute`
  - `GET /api/admin/data-maintenance/jobs`
  - `GET /api/admin/data-maintenance/jobs/[id]`

---

## 6. 清理能力模型（字段级）

## 6.1 核心概念

### 1) 目标（Target）

- 代表可清理的一类实体（如 `battle_report_generations.output_preview`）。
- 每个 Target 绑定可用筛选字段与可用操作类型。

### 2) 筛选器（Scope）

- 时间范围（如 `started_at < 2025-10-01`）
- 状态条件（如 `status in ('completed','failed')`）
- 业务条件（如 `pvp_match_id IS NOT NULL`）

### 3) 字段动作（Field Action）

支持三类：

- `truncate`：截断压缩
  - 参数：`maxChars` 或 `headChars + tailChars`
  - 推荐：`head + "……" + tail`
- `set_null_or_default`：设空/默认
  - 参数：`mode = null | default | literal`
- `delete_rows`：删除整行
  - 作用于筛选命中的行

## 6.2 白名单配置（示意）

> 注意：这是设计层结构，开发时应落实为 TS 常量配置，而不是让前端拼 SQL。

```text
Target: battle_report_generations
  filterable: started_at, status, mode, generation_mode, user_id, pvp_match_id
  fieldActions:
    output_preview: truncate | set_null_or_default
    user_guidance_preview: truncate | set_null_or_default
    adjudication_events_preview: truncate | set_null_or_default
    extra_json: truncate | set_null_or_default
    user_agent/referer/accept_language/ip/cf_ray: truncate | set_null_or_default
  rowAction:
    delete_rows (需高危确认)

Target: pvp_rounds
  filterable: created_at, status, room_id, match_id
  fieldActions:
    public_snapshot_json: truncate | set_null_or_default
    result_json: truncate | set_null_or_default

Target: arena_rating_events
  filterable: created_at, queue, status, user_id
  fieldActions:
    details_json: truncate | set_null_or_default
  rowAction:
    delete_rows

Target: large_objects
  filterable: kind, created_at, owner_user_id
  rowAction:
    delete_rows (+ 可选 deleteR2)
```

---

## 7. 预览机制（防误操作核心）

预览接口必须输出以下信息：

1. `affectedRows`：命中行数
2. `estimatedBytesBefore`
3. `estimatedBytesAfter`
4. `estimatedBytesSaved`
5. `dependencyImpact`：关联影响（级联/关联行数）
6. `samples`：前 N 条样本（before/after）
7. `riskLevel`：`low | medium | high`

## 7.1 字节估算口径

- 统一使用 `LENGTH(CAST(column AS BLOB))` 统计 UTF-8 字节。
- 截断估算：
  - `before = SUM(LENGTH(...))`
  - `after = SUM(MIN(LENGTH(...), maxBytesEquivalent))`

## 7.2 依赖影响示例

若执行 `delete_rows` 于 `battle_report_generations`，预览应附带：

- 将影响 `battle_report_generation_combatants` 行数（FK cascade）
- 将影响 `arena_rating_events` 行数（FK cascade）
- 可能残留 `large_objects(kind='battle_report_generation_output')`（需提示是否联动删除）

## 7.3 高危阻断规则

以下场景在 preview 阶段直接报错或强提示：

- 命中 `pvp_rooms` 中仍 `status='open'` 或活跃窗口内房间；
- 命中 `arena_rating_events.status='pending'`；
- 尝试清理当前赛季核心状态表 `arena_ratings`（默认不开放）。

---

## 8. 执行机制设计

## 8.1 执行状态机

`draft -> previewed -> confirmed -> running -> completed/failed/cancelled`

## 8.2 分批执行（Edge 友好）

- 每批固定处理 `N` 条（建议 100~500）
- 每批执行后返回进度：`processed / total`
- 达到请求时间预算即中断并返回 `nextCursor`
- 前端轮询继续下一批，直到完成

## 8.3 幂等与并发控制

- 每个任务生成 `jobId + planHash`
- 同一 `jobId` 重放请求不重复执行已完成批次
- 对同一 target + scope 的运行中任务加互斥锁（逻辑锁）

## 8.4 审计记录（建议新增表）

建议新增：

- `admin_cleanup_jobs`
  - `id, created_by_user_id, target, scope_json, actions_json, preview_json, status, progress_json, started_at, finished_at, error`
- `admin_cleanup_job_logs`
  - `job_id, batch_no, affected_rows, bytes_saved, created_at, note`

如暂不建表，可先写入结构化日志，但长期建议落库以便追溯。

---

## 9. 安全与权限设计（必须优先落地）

## 9.1 鉴权

清理 API 必须启用管理员校验：

1. 读取 `Authorization: Bearer <authKey>`
2. `getUserByAuthKey(authKey)`
3. 判定 `user.is_admin === 1`（并可叠加白名单 env）

> 新清理 API 必须独立强制鉴权，即使历史 admin API 暂未全面收口。

## 9.2 二次确认

- 执行前要求输入确认短语（例如：`CLEANUP <jobIdSuffix>`）
- 高危动作（delete_rows）增加二次弹窗 + 风险标红

## 9.3 防注入

- 仅允许白名单字段、白名单操作、白名单排序
- 禁止前端传递原始 SQL 片段

## 9.4 最小权限原则

- 默认隐藏“删除整行”高级开关
- 默认仅开启“压缩/设空”模式

---

## 10. 推荐预设策略（首版可直接提供）

## 10.1 预设 A：战报历史瘦身（低风险）

- 目标：`battle_report_generations`
- 条件：`started_at < now - 90天`
- 动作：
  - `output_preview` -> `set_null_or_default(null)`
  - `user_guidance_preview` / `adjudication_events_preview` -> 截断到 200~500 字
  - `extra_json` -> 截断到 500~1000 字或置空
  - 可选：`user_agent/referer/accept_language/cf_ray` 置空

## 10.2 预设 B：PVP 过程数据清理（中风险）

- 条件：房间 `closed/finished/aborted` 且 `last_activity_at < now - 30天`
- 动作：
  - 删除 `pvp_room_hands / pvp_room_submissions / pvp_room_card_snapshots / pvp_round_choices`
  - 可选删除 `pvp_room_chat_messages`
  - 对 `pvp_rooms.rules_json` 执行“运行时字段剥离”（可复用 `clearPvpRoomRuntimeFromRulesJson`）

## 10.3 预设 C：排位事件历史瘦身（中风险）

- 目标：`arena_rating_events`
- 条件：`created_at < now - 120天` 且 `status != 'pending'`
- 动作：
  - 优先 `details_json -> set_null`
  - 超长期（如 > 365天）可考虑 `delete_rows`

## 10.4 预设 D：战报大对象清理（高风险）

- 目标：`large_objects(kind='battle_report_generation_output')`
- 条件：`created_at < now - 180天`
- 动作：
  - 删除索引记录
  - 可选联动删除 R2 对象（默认开启）

---

## 11. API 契约草案

## 11.1 `POST /api/admin/data-maintenance/preview`

请求示意：

```json
{
  "target": "battle_report_generations",
  "scope": {
    "dateField": "started_at",
    "dateTo": "2025-11-01",
    "statusIn": ["completed", "aborted", "failed"]
  },
  "actions": [
    { "type": "field", "field": "output_preview", "op": "set_null_or_default", "mode": "null" },
    { "type": "field", "field": "extra_json", "op": "truncate", "maxChars": 800 }
  ]
}
```

响应示意：

```json
{
  "success": true,
  "planHash": "sha256:...",
  "riskLevel": "medium",
  "affectedRows": 12345,
  "estimatedBytesBefore": 987654321,
  "estimatedBytesAfter": 123456789,
  "estimatedBytesSaved": 864197532,
  "dependencyImpact": {
    "battle_report_generation_combatants": 12345,
    "arena_rating_events": 233
  },
  "samples": [
    {
      "id": "...",
      "before": { "output_preview": "..." },
      "after": { "output_preview": null }
    }
  ],
  "warnings": ["..."]
}
```

## 11.2 `POST /api/admin/data-maintenance/execute`

请求示意：

```json
{
  "planHash": "sha256:...",
  "confirmText": "CLEANUP 9F2A",
  "dryRun": false,
  "batchSize": 200
}
```

响应示意：

```json
{
  "success": true,
  "jobId": "cleanup_20260208_xxx",
  "status": "running",
  "processed": 400,
  "total": 12345,
  "nextCursor": "..."
}
```

---

## 12. 分阶段落地计划

## Phase 0（必须）：权限与安全底座

1. 新增 `requireAdmin`（鉴权 + is_admin 判断）
2. 新增白名单 target/action 配置
3. 新增 plan hash + 二次确认机制

## Phase 1：预览 MVP

1. 完成 preview API（先支持 battle_report_generations / arena_rating_events / large_objects）
2. 完成后台页面预览面板
3. 上线仅 dry-run（不真实执行）验证口径

## Phase 2：执行 MVP

1. 分批执行引擎
2. 执行日志与任务状态
3. 预设策略 A/B/C

## Phase 3：增强

1. 大对象联动删 R2
2. 任务恢复/取消
3. 更丰富字段压缩策略（head/tail 模式）

---

## 13. 测试与验收

## 13.1 测试建议

- 单元测试（`bun test`）
  - scope 解析/校验
  - SQL 生成器（白名单与参数化）
  - 字节估算器
  - plan hash 幂等性
- 集成测试
  - preview 返回影响数与实际执行一致性
  - batch 执行中断恢复
  - 高危动作确认拦截

## 13.2 验收标准

1. 管理员可在 UI 完成“选择范围 -> 预览 -> 执行”；
2. 字段级三类操作均可用（截断、设空/默认、删行）；
3. 每次执行都有可追溯记录；
4. 清理后关键用户路径不崩（`/api/me/battle-reports`、`/api/me/pvp`、`/api/arena/generation-ranking`）；
5. D1 统计面板可观察到目标字段总字节下降。

---

## 14. 风险清单与缓解

1. **误删关键数据**
   - 缓解：白名单 + preview + 二次确认 + 高危默认关闭。
2. **对局进行中数据被清理**
   - 缓解：强制过滤 active/open 房间与 pending 事件。
3. **Edge 请求超时**
   - 缓解：分批执行 + 游标续跑。
4. **只删索引未删 R2 导致对象泄漏**
   - 缓解：`large_objects` 清理默认联动 `deleteR2=true`。
5. **与现有读取逻辑冲突**
   - 缓解：首版优先做“字段瘦身”而非“大规模删行”，并先在 dry-run 与小范围验证。

---

## 15. 结论（推荐决策）

建议采用**新增统一后台页面 + 清理引擎白名单化**的方案，并按“先安全、后执行、再扩展”推进：

1. 先落权限与预览（Phase 0~1）；
2. 再上线可控执行（Phase 2）；
3. 最后补任务恢复与 R2 联动增强（Phase 3）。

该方案可以在不引入自由 SQL 风险的前提下，满足你提出的“字段级细粒度清理 + 可视化预览 + 防误操作”目标，并可持续支持 D1 空间治理。

