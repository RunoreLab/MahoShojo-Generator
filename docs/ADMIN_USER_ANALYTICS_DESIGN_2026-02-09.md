# 后台用户统计/追踪增强设计方案（2026-02-09）

## 0. 背景与目标

当前后台已具备：

- 用户管理页：`/admin/users`（历史别名：`/admin/user-dashboard`，含筛选、批量操作、用户明细）
- 仪表盘概览：`/admin`（含 24h / 7d 活跃用户卡片）
- 用户活动记录：`user_last_activity`（按 `user_id` 存最近活跃时间）

本方案目标是在不破坏现有管理流程的前提下，新增一套**可解释、可扩展、低成本**的用户统计能力，重点覆盖：

1. 活跃情况（分时段活跃规模、趋势、结构）
2. 留存情况（按注册周期与用户生命周期的回访/留存）
3. 活跃用户构成（新/老用户占比、注册时长分层）
4. 现有数据库可直接拉取的其他用户价值与风险指标

---

## 1. 现状盘点（基于当前仓库）

## 1.1 已有数据基础

### A. 用户主表 `users`

关键字段：

- `id`
- `created_at`（注册时间）
- `last_login_at`（最后登录）
- `is_banned` / `is_review_exempt`
- `slot_count`

说明：`created_at + last_login_at` 可用于“注册与登录行为”统计。

### B. 活跃追踪表 `user_last_activity`

关键字段：

- `user_id`（主键）
- `last_seen_at`
- `updated_at`

说明：当前为**每个用户一行**，仅保存“最近一次活跃时间”。

### C. 可关联的用户行为表（可扩展统计）

- `data_cards`（创作数量、公开数量、封禁/拒绝、互动计数）
- `battle_report_generations`（生成次数、状态、耗时、时间分布）
- `pvp_match_players` + `pvp_matches`（PVP 参与与战绩）
- `user_badges`（徽章覆盖）
- `favorites` / `deck_favorites`（收藏偏好）

## 1.2 当前统计能力与不足

已支持：

- 仪表盘统计活跃用户（24h / 7d）
- 用户列表可筛选 `last_active_at`

不足：

1. **缺少留存视图**：没有 D1/D7/D30 等留存统计展示。
2. **缺少活跃结构视图**：无法看“当前活跃里新老用户占比”。
3. **缺少趋势视图**：仅有单点值，缺乏时间序列。
4. **口径提示不足**：`user_last_activity` 为“最近一次触达”，不是完整行为流水。

## 1.3 关键口径限制（必须在页面显式声明）

1. `user_last_activity` 仅记录“最后一次活跃”，不含全量活跃历史。
2. 当前 touch 主要覆盖登录后业务 API 调用，不等同于页面浏览 PV/UV。
3. 因为只有“最后活跃时间”，可以准确算“累计达到某留存时长”，但不能精确还原“某天窗口内是否活跃（严格日留存曲线）”。

---

## 2. 页面方案对比与推荐

## 2.1 方案 A：整合进 `/admin/users`

优点：

- 用户管理与统计同页，切换少。

缺点：

- 页面已偏复杂（筛选+批量管理）；再叠加图表会过载。
- 管理操作与分析操作耦合，后续扩展成本高。

## 2.2 方案 B：新增 `/admin/user-analytics`（推荐）

优点：

- 职责清晰：`/admin/users` 做管理，`/admin/user-analytics` 做洞察。
- 可按模块分区加载（概览/留存/结构/价值），便于控读与缓存。
- 后续可平滑扩展到 cohort 热力图、导出、预警。

缺点：

- 需要新增页面与 API。

## 2.3 方案 C：仅增强 `/admin` 仪表盘

优点：

- 实现快。

缺点：

- 容量不足，只能放少量卡片，难承载完整用户分析。

**结论：采用方案 B，并在 `/admin` 增加入口卡片，在 `/admin/users` 增加“查看统计”跳转。**

---

## 3. 指标体系设计（先用现有数据可落地）

## 3.1 活跃指标（Activity）

1. `activeUsers24h / 7d / 30d / 90d`
2. `activityCoverageRate = trackedUsers / totalUsers`
3. `untrackedUsers = totalUsers - trackedUsers`
4. `inactiveUsers30d = trackedUsers 中 last_seen_at < now-30d`

用途：

- 识别总体活跃趋势与跟踪覆盖质量。

## 3.2 留存指标（Retention，基于“最后活跃时间”）

这里定义为**累计回访留存**（不是严格 day-N 当日留存）：

- `D1/D3/D7/D14/D30/D60/D90 累计回访率`
- 口径：`last_seen_at - created_at >= N 天`

补充指标：

- 平均留存时长（天）
- 中位数留存时长（天）
- P90 留存时长（天）

## 3.3 活跃用户结构（Composition）

以“最近 7d 活跃用户”为样本，计算：

1. 注册年龄分桶占比：`0-3d / 4-7d / 8-30d / 31-90d / 91-180d / 180d+`
2. 新老用户占比（示例：注册 <=30 天为新）
3. 活跃用户的平均/中位注册年龄

## 3.4 生命周期分层（Lifecycle Segments）

建议分层（首版规则）：

- `new`: 注册 <= 7d
- `active`: 最近 7d 活跃
- `warm`: 最近 8~30d 活跃
- `at_risk`: 最近 31~60d 未活跃
- `dormant`: 最近 >60d 未活跃
- `never_tracked`: 从未有活跃记录

用途：

- 为运营/风控提供分层视角与后续自动化策略入口。

## 3.5 现有数据库可直接追加的其他功能（建议第二优先级）

1. **创作参与度**
   - 指标：近 7d / 30d 有新增 `data_cards` 的用户数
   - 衍生：活跃用户中“创作者占比”

2. **生成行为深度**
   - 指标：近 30d 人均 `battle_report_generations` 次数
   - 分层：按 30d 生成次数分层（见 `3.6`，不再使用单一 `>=10` 阈值）

3. **PVP 参与度**
   - 指标：近 30d 参与 `pvp_matches` 的用户占比

4. **内容风险信号**
   - 指标：有封禁卡/拒绝卡用户占比
   - 用于支持运营判断“活跃增长是否伴随审核压力上升”

5. **用户价值分布（轻量）**
   - 指标：按用户聚合 `usage_count + like_count + favorite_count`
   - 用于识别高价值创作者群体

## 3.6 高频生成用户分层（基于 2026-02-09 实测快照）

> 本节基于一次在线抽样统计（UTC 时间 `2026-02-09T11:02~11:04`）更新。  
> 统计窗口：近 30 天（`2026-01-10` 至 `2026-02-09`）。

### A. 关键观测（用于校准阈值）

1. 用户规模与活跃
   - 总用户：`2852`
   - 有 `user_last_activity` 记录用户：`288`
   - 24h 活跃用户（touch 口径）：`179`

2. 近 30 天生成规模
   - 全平台战报生成总量：`211,284`
   - 可关联到当前 `users` 表的用户生成量：`170,242`
   - 说明：两者差值主要来自“无法关联到当前用户主表”的历史记录（例如用户已删除或历史孤立 user_id）。

3. 活跃用户 30 天生成分布（`active_7d` 样本，n=288）
   - 中位数：`219`
   - P75：`774.75`
   - P90：`1498.8`
   - P95：`1964.25`
   - `>=10` 占比：`84.03%`（明显过宽，不适合作为“高频”定义）

### B. 推荐分层（30d 总生成次数，面向活跃用户）

1. `silent`：`0`
2. `light`：`1~29`
3. `regular`：`30~99`
4. `high`：`100~499`
5. `very_high`：`500~999`
6. `extreme`：`>=1000`

### C. 实测占比（`active_7d` 样本）

- `silent`（0）：`3.47%`（10 人）
- `light`（1~29）：`18.40%`（53 人）
- `regular`（30~99）：`14.58%`（42 人）
- `high`（100~499）：`27.08%`（78 人）
- `very_high`（500~999）：`18.40%`（53 人）
- `extreme`（>=1000）：`18.06%`（52 人）

> 结论：当前平台用户强度明显偏高，`>=10 / 30d` 仅能区分“非低频”，无法识别真正高频人群。

### D. 补充质量维度（避免只看次数）

建议同时输出“完成质量”指标，避免失败请求放大频次：

1. `completed30`（近 30 天成功完成次数）
2. `successRate30 = completed30 / total30`

本次快照中位成功率（`active_7d`）约 `87.75%`，可追加健康分层：

- `healthy`：`successRate30 >= 90%`
- `stable`：`75% <= successRate30 < 90%`
- `risk`：`successRate30 < 75%`

### E. 后台展示建议（替代旧“高频占比”）

首屏建议展示三档占比，而非单点阈值：

1. `high+`：`>=100 / 30d`
2. `very_high+`：`>=500 / 30d`
3. `extreme`：`>=1000 / 30d`

并在图例明确“统计窗口”和“是否基于 active_7d 样本”。

---

## 4. 指标口径与 SQL 草案

以下 SQL 为设计草案（后续可封装进 `lib/database/admin-user-analytics.ts`）。

## 4.1 概览（活跃+覆盖）

```sql
WITH base AS (
  SELECT
    u.id,
    u.created_at,
    u.last_login_at,
    ula.last_seen_at,
    CAST((julianday(COALESCE(ula.last_seen_at, u.last_login_at, u.created_at)) - julianday(u.created_at)) AS INTEGER) AS observed_retention_days
  FROM users u
  LEFT JOIN user_last_activity ula ON ula.user_id = u.id
)
SELECT
  COUNT(*) AS total_users,
  SUM(CASE WHEN last_seen_at IS NOT NULL THEN 1 ELSE 0 END) AS tracked_users,
  SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS active_24h,
  SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS active_7d,
  SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS active_30d,
  AVG(observed_retention_days) AS avg_retention_days
FROM base;
```

参数顺序：`since24hIso, since7dIso, since30dIso`。

## 4.2 留存阈值统计（累计回访）

```sql
WITH base AS (
  SELECT
    u.id,
    CAST((julianday(?) - julianday(u.created_at)) AS INTEGER) AS user_age_days,
    CAST((julianday(COALESCE(ula.last_seen_at, u.last_login_at, u.created_at)) - julianday(u.created_at)) AS INTEGER) AS retention_days
  FROM users u
  LEFT JOIN user_last_activity ula ON ula.user_id = u.id
)
SELECT
  COUNT(*) AS total_users,
  SUM(CASE WHEN user_age_days >= 1 THEN 1 ELSE 0 END) AS d1_eligible,
  SUM(CASE WHEN user_age_days >= 1 AND retention_days >= 1 THEN 1 ELSE 0 END) AS d1_retained,
  SUM(CASE WHEN user_age_days >= 7 THEN 1 ELSE 0 END) AS d7_eligible,
  SUM(CASE WHEN user_age_days >= 7 AND retention_days >= 7 THEN 1 ELSE 0 END) AS d7_retained,
  SUM(CASE WHEN user_age_days >= 30 THEN 1 ELSE 0 END) AS d30_eligible,
  SUM(CASE WHEN user_age_days >= 30 AND retention_days >= 30 THEN 1 ELSE 0 END) AS d30_retained,
  SUM(CASE WHEN user_age_days >= 90 THEN 1 ELSE 0 END) AS d90_eligible,
  SUM(CASE WHEN user_age_days >= 90 AND retention_days >= 90 THEN 1 ELSE 0 END) AS d90_retained
FROM base;
```

说明：

- 必须区分 `eligible`（达到观察窗口）与 `retained`，避免新注册用户拉低长周期留存。

## 4.3 Cohort 留存（按周/按月）

```sql
WITH base AS (
  SELECT
    strftime('%Y-%W', u.created_at) AS cohort_week,
    CAST((julianday(?) - julianday(u.created_at)) AS INTEGER) AS user_age_days,
    CAST((julianday(COALESCE(ula.last_seen_at, u.last_login_at, u.created_at)) - julianday(u.created_at)) AS INTEGER) AS retention_days
  FROM users u
  LEFT JOIN user_last_activity ula ON ula.user_id = u.id
  WHERE u.created_at >= datetime(?, '-180 day')
)
SELECT
  cohort_week,
  COUNT(*) AS cohort_size,
  SUM(CASE WHEN user_age_days >= 7 THEN 1 ELSE 0 END) AS d7_eligible,
  SUM(CASE WHEN user_age_days >= 7 AND retention_days >= 7 THEN 1 ELSE 0 END) AS d7_retained,
  SUM(CASE WHEN user_age_days >= 30 THEN 1 ELSE 0 END) AS d30_eligible,
  SUM(CASE WHEN user_age_days >= 30 AND retention_days >= 30 THEN 1 ELSE 0 END) AS d30_retained
FROM base
GROUP BY cohort_week
ORDER BY cohort_week DESC;
```

## 4.4 活跃用户结构（最近 7d）

```sql
WITH active_users AS (
  SELECT
    u.id,
    CAST((julianday(?) - julianday(u.created_at)) AS INTEGER) AS tenure_days
  FROM users u
  JOIN user_last_activity ula ON ula.user_id = u.id
  WHERE ula.last_seen_at >= ?
)
SELECT
  CASE
    WHEN tenure_days BETWEEN 0 AND 3 THEN '0-3d'
    WHEN tenure_days BETWEEN 4 AND 7 THEN '4-7d'
    WHEN tenure_days BETWEEN 8 AND 30 THEN '8-30d'
    WHEN tenure_days BETWEEN 31 AND 90 THEN '31-90d'
    WHEN tenure_days BETWEEN 91 AND 180 THEN '91-180d'
    ELSE '180d+'
  END AS tenure_bucket,
  COUNT(*) AS users
FROM active_users
GROUP BY tenure_bucket;
```

---

## 5. 后台页面信息架构（推荐）

## 5.1 新页面

- 路径：`/admin/user-analytics`
- 页面定位：只读分析页（不承载批量封禁/改状态）

## 5.2 页面分区

1. **总览区（默认）**
   - KPI 卡片：总用户、活跃窗口、覆盖率、留存时长中位数
   - 趋势条（可先用表格 + mini bar，不引入新图表库）

2. **留存区**
   - D1/D7/D30/D90 累计回访留存
   - 按周 cohort 表（首版用表格，二期可加热力图）
   - Cohort 需提供中文语义名称（`注册周 Cohort` / `注册月 Cohort`），避免仅展示英文术语
   - 周分群需展示日期范围（例如 `2026-W00（2026-01-01 ~ 2026-01-04）`），月分群同理展示整月范围

3. **活跃构成区**
   - 活跃用户注册年龄分布
   - 新老用户占比

4. **行为价值区（可选开关）**
   - 创作参与率、战报生成深度、PVP 参与率

5. **口径说明区（固定展示）**
   - 显式说明“统计基于最近活跃时间，不是完整行为流水”。

## 5.3 跳转关系

- `/admin` 增加“用户统计分析”入口卡片
- `/admin/users` 增加“查看用户统计分析”按钮（保持管理与分析联动）

---

## 6. API 设计（Edge Runtime 友好）

建议新增：`pages/api/admin/user-analytics.ts`

请求方式：`GET`

参数：

- `section=overview|retention|composition|value`
- `lookbackDays`（默认 180，最大 365）
- `activeWindowDays`（默认 7，可选 1/7/30/90）
- `cohort=week|month`
- `frequencySample=active7d|tracked|all`（默认 `active7d`，用于高频分层口径）
- `frequencyProfile=v20260209|custom`（默认 `v20260209`）

返回结构示例：

```json
{
  "success": true,
  "section": "retention",
  "stats": {
    "d7": { "eligible": 1200, "retained": 430, "rate": 0.3583 },
    "d30": { "eligible": 900, "retained": 210, "rate": 0.2333 },
    "cohorts": []
  },
  "meta": {
    "asOf": "2026-02-09T10:00:00.000Z",
    "definition": "累计回访留存"
  }
}
```

工程建议：

1. 数据层新建 `lib/database/admin-user-analytics.ts`
2. 每个 `section` 一条聚合 SQL，避免接口内循环查询
3. 使用 `withEdgeCache` 做 60~300 秒短缓存
4. 参数白名单与上限校验（防止大窗口扫表）

---

## 7. 性能与 D1_ROWS_READ 控制策略

1. **分区加载**：首屏只拉 `overview`，留存/价值分区按需加载。
2. **窗口限制**：`lookbackDays` 默认 180，硬上限 365。
3. **聚合优先**：尽量单 SQL 聚合，避免先拉明细再前端聚合。
4. **缓存**：
   - 概览：TTL 60s
   - 留存与构成：TTL 5min
5. **分页/明细导出分离**：分析页只出聚合；明细导出走独立 API。

## 7.1 建议补充索引（可选但推荐）

```sql
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_user_started_at ON battle_report_generations(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_data_cards_user_created_at ON data_cards(user_id, created_at);
```

说明：以上索引用于 cohort、时间窗与用户行为联表统计的常见路径。

---

## 8. 数据质量与风险提示

1. **活跃口径风险**：未携带 activity header 的调用不会更新 `last_seen_at`。
2. **历史趋势缺口**：只有“最后活跃时间”时，难还原日级 DAU 历史曲线。
3. **时区统一**：统计统一使用 UTC ISO（页面再做本地展示转换）。
4. **空值处理**：`last_seen_at`/`last_login_at` 为空需显式归类为“未追踪/未登录”。

---

## 9. 二期演进建议（实现“严格留存与趋势”）

为支持严格日留存与历史活跃趋势，建议新增日粒度事实表：

```sql
CREATE TABLE IF NOT EXISTS user_activity_daily (
  user_id INTEGER NOT NULL,
  activity_date TEXT NOT NULL,      -- YYYY-MM-DD (UTC)
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  touch_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, activity_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_activity_daily_date_user
  ON user_activity_daily(activity_date, user_id);
```

这样可实现：

1. 严格 D1/D7/D30（按注册后第 N 天窗口）
2. DAU/WAU/MAU 历史趋势
3. 留存热力图与回流分析（reactivation）

---

## 10. 分期实施计划（建议）

### Phase 1（快速落地，1~2 次迭代）

- 新增 `user-analytics` 页面 + API
- 上线活跃/留存/构成 3 大模块（均基于现有表）
- 上线高频生成分层卡片（`>=100 / >=500 / >=1000`，窗口 30d）
- 管理后台与用户管理页补入口

### Phase 2（质量增强，1 次迭代）

- 增加行为价值模块（创作/PVP/生成）
- 增加导出与筛选（窗口、cohort 粒度）
- 导出文件补充 Cohort 中文周期信息与日期范围字段
- 导出 CSV 文件名附带 UTC 时间戳（如 `20260209_153045Z`），文件内容使用 UTF-8 BOM 并写入 `data_generated_at_utc` / `exported_at_utc` 元信息行
- 加入口径说明与指标帮助提示

### Phase 3（数据基础升级，2~3 次迭代）

- 新增 `user_activity_daily` 日表
- 提供严格日留存与趋势图
- 引入异常预警（活跃突降、追踪覆盖下降）

---

## 11. 验收标准（面向后续开发）

1. 能在后台稳定展示：`activeUsers24h/7d/30d`、`D1/D7/D30/D90 累计回访率`、活跃构成分布。
2. 能稳定展示高频分层指标：`high+ (>=100)`、`very_high+ (>=500)`、`extreme (>=1000)`。
3. 页面明确展示口径与限制，不误导为“严格日留存”。
4. `lookbackDays=180` 情况下接口响应可控（建议 P95 < 1.5s）。
5. 统计接口具备参数校验与缓存，不出现明显 D1_ROWS_READ 异常增长。
6. 与现有用户管理流程解耦：管理操作仍在 `/admin/users`，分析在 `/admin/user-analytics`。

---

## 12. 实施文件建议（供后续任务拆解）

- 新增：`pages/admin/user-analytics.tsx`
- 新增：`pages/api/admin/user-analytics.ts`
- 新增：`lib/database/admin-user-analytics.ts`
- 可选：`types/admin-user-analytics.ts`
- 修改：`pages/admin/index.tsx`（增加入口）
- 修改：`pages/admin/users.tsx`（增加跳转按钮；旧路由仅保留 redirect）
