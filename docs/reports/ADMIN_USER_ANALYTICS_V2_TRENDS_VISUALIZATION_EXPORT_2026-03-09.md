# 用户统计分析后台 V2 设计：趋势、图表与导出增强（2026-03-09）

## 0. 背景

当前 `/admin/user-analytics` 已经具备四类统计内容：

1. `overview`：总用户、活跃用户、追踪覆盖、战报生成概览
2. `frequency`：高频生成分层
3. `retention`：累计回访留存 + cohort 表
4. `composition`：活跃用户注册时长构成

但从管理员使用体验看，当前版本仍然明显停留在 **“静态数字 + 表格”** 阶段，距离“可观察趋势、可直观看图、可完整导出分析结果”的后台还有较大差距。

本设计聚焦解决三类问题：

1. 当前页面只能看到“现在这一刻”的统计值，无法看历史变化趋势。
2. 页面几乎没有真正的可视化图表，管理员很难快速把握走势与异常。
3. 导出能力只覆盖 `retention` 与 `composition`，没有形成完整分析包。

---

## 1. 当前实现审阅

## 1.1 前端现状

当前 `pages/admin/user-analytics.tsx` 的特点：

1. 顶部只有参数筛选：
   - `lookbackDays`
   - `frequencySample`
   - `activeWindowDays`
   - `cohort`
2. 页面主体主要由：
   - KPI 卡片
   - 多个纯数字卡片
   - 多张表格
3. 目前没有任何：
   - 折线图
   - 柱状图
   - 堆叠图
   - 热力图
   - 迷你趋势图（sparkline）

当前页面虽然“有数据”，但并没有真正形成“洞察面板”。

## 1.2 后端现状

当前 `pages/api/admin/user-analytics.ts` + `lib/database/admin-user-analytics.ts` 提供的是 **当前快照聚合**：

1. `overview`
2. `frequency`
3. `retention`
4. `composition`

但没有任何“时间序列”返回结构：

1. 没有按日/周的用户增长序列
2. 没有按日的活跃变化序列
3. 没有按日的生成成功/失败趋势
4. 没有分层结构随时间变化的序列

因此当前页面无法画趋势图，不是因为“还没写图表组件”，而是因为 **后端当前就没有趋势数据模型**。

## 1.3 导出现状

当前只有两个导出按钮：

1. 留存 CSV
2. 构成 CSV

当前缺失的导出内容：

1. `overview` 快照
2. `overview` 趋势
3. 高频分层
4. 高频分层趋势
5. 战报生成状态趋势
6. 过滤器与口径元信息汇总
7. 一次导出全分析包的能力

结论：

- 当前“导出”不是分析导出，只是局部明细下载。

---

## 2. V2 目标

V2 的目标不是简单“加几张图”，而是把用户统计分析页升级成真正的后台分析面板：

1. **有趋势**
   - 能看不同时间的指标变化，而不只是当前快照
2. **有图表**
   - 管理员能在 10 秒内理解走势
3. **有完整导出**
   - 可以把当前筛选条件下的分析结果整体打包带走
4. **保留口径可解释性**
   - 明确哪些曲线是严格历史，哪些是从某天起开始有快照
5. **避免引入过重依赖**
   - 优先利用当前技术栈与已有依赖落地

---

## 3. 设计约束与关键事实

## 3.1 当前数据并不能还原所有历史趋势

这是 V2 设计必须正视的核心事实。

当前与趋势相关的数据源分两类：

### A. 可以直接从现有事实表回算历史趋势的数据

这类数据天然带时间戳：

1. `users.created_at`
   - 可做每日新增用户
   - 可做累计总用户
2. `battle_report_generations.started_at`
   - 可做每日生成总量
   - 可做完成/中断/失败趋势
   - 可做每日参与生成用户数
3. `auth_audit_logs.created_at`
   - 可做登录成功/失败趋势
   - 但只有该表上线后的时间段才有数据

### B. 不能从现有数据准确回算历史趋势的数据

这类指标当前只有“最新状态”，没有历史快照：

1. `trackedUsers`
2. `activeUsers24h`
3. `activeUsers7d`
4. `activeUsers30d`
5. `activityCoverageRate`

原因很简单：

- `user_last_activity` 每个用户只有一行“最后一次活跃时间”；
- 它只能告诉我们“现在往回看 7 天谁活跃过”，
- 但不能告诉我们“2026-02-20 当天往回看 7 天是谁活跃过”。

因此：

- “当前 7 日活跃用户数”可以算；
- “过去 60 天每天的 7 日活跃趋势”当前 **无法严格回算**。

## 3.2 现有仓库没有图表库依赖

`package.json` 当前没有现成图表依赖，如：

- `recharts`
- `echarts`
- `visx`

这意味着 V2 要么：

1. 引入新的图表库；
2. 用自定义 SVG / CSS 图表组件实现。

## 3.3 CSV 不是最适合承载“多板块分析结果”的单文件格式

一张 CSV 更适合一张表。

而 V2 想导出的内容天然是多板块：

1. overview snapshot
2. overview trends
3. frequency buckets
4. retention points
5. retention cohorts
6. composition buckets
7. composition cohorts

因此 V2 不应该只思考“再加几种 CSV”，还应考虑：

- **一键导出 ZIP 分析包**

---

## 4. 趋势数据模型设计

## 4.1 趋势分层策略

V2 趋势建议拆成两类：

### 第一类：可立即落地的“严格历史趋势”

这些可以直接从事实表回算，不需要新增表：

1. 每日新增用户
2. 累计总用户
3. 每日战报生成总量
4. 每日完成/中断/失败量
5. 每日参与生成用户数
6. 每日 Auth 成功/失败量
   - 仅从 `auth_audit_logs` 建表后的日期开始有效

### 第二类：必须新增快照/事实表的“窗口型趋势”

这些不能从现有单点状态回算：

1. 24h 活跃趋势
2. 7d 活跃趋势
3. 30d 活跃趋势
4. 追踪覆盖率趋势
5. 7d 活跃构成趋势
6. 高频样本占比趋势

结论：

- V2 第一阶段不必等新表就可以先上线部分趋势图；
- 但要想真正解决“7 日活跃随时间变化”的问题，必须增加新数据层。

## 4.2 推荐新增表：`admin_user_analytics_daily`

推荐新增一个“日快照表”，专门存后台需要的窗口型指标：

```sql
CREATE TABLE IF NOT EXISTS admin_user_analytics_daily (
  metric_date TEXT PRIMARY KEY,            -- YYYY-MM-DD (UTC)
  total_users INTEGER NOT NULL DEFAULT 0,
  tracked_users INTEGER NOT NULL DEFAULT 0,
  untracked_users INTEGER NOT NULL DEFAULT 0,
  active_users_24h INTEGER NOT NULL DEFAULT 0,
  active_users_7d INTEGER NOT NULL DEFAULT 0,
  active_users_30d INTEGER NOT NULL DEFAULT 0,
  activity_coverage_rate REAL NOT NULL DEFAULT 0,
  generation_total_1d INTEGER NOT NULL DEFAULT 0,
  generation_completed_1d INTEGER NOT NULL DEFAULT 0,
  generation_aborted_1d INTEGER NOT NULL DEFAULT 0,
  generation_failed_1d INTEGER NOT NULL DEFAULT 0,
  generation_distinct_users_1d INTEGER NOT NULL DEFAULT 0,
  auth_success_1d INTEGER NOT NULL DEFAULT 0,
  auth_failed_1d INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

这张表的职责很明确：

1. 为趋势图提供按日时间序列
2. 避免每次页面读取都回算窗口指标
3. 明确“从何日起开始具备历史趋势”

## 4.3 是否需要 `user_activity_daily`

如果目标只是后台图表与概览趋势，`admin_user_analytics_daily` 已够用。

如果目标进一步升级为：

1. 严格 DAU/WAU/MAU 历史回算
2. 严格日留存
3. 回流/复活分析
4. 更细的 cohort 热力图

则最终仍应新增：

```sql
CREATE TABLE IF NOT EXISTS user_activity_daily (
  user_id INTEGER NOT NULL,
  activity_date TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  touch_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, activity_date)
);
```

但这张表属于更高成本的数据基础设施，不必作为 V2 第一阶段前置。

### 建议决策

1. **V2 第一阶段**
   - 先上 `admin_user_analytics_daily`
2. **V2 第二阶段**
   - 再评估是否需要 `user_activity_daily`

这样更符合当前后台升级节奏。

## 4.4 快照生成方式

推荐顺序：

1. **首选：定时任务 / cron**
2. **次选：后台手动触发“补快照”**
3. **不推荐：普通读接口读时写库**

理由：

1. 趋势快照本质上是离线统计，不应该混入普通读接口
2. 读时写库会让页面加载语义变复杂
3. 后台统计数据允许分钟级或小时级延迟，不必强求实时

推荐落地方案：

1. 新增脚本或定时任务：每日 UTC 00:05 跑一次
2. 后台提供“补齐缺失日期快照”按钮，仅用于运维

### 4.4.1 2026-03-10 落地补充

当前仓库已补充：

1. GitHub Actions 定时触发脚本
2. `/api/admin/user-analytics/snapshot` 的 token 校验入口
3. 最近 7 天缺失日期自动补洞
4. 后台手动“补缺失快照”入口

详细运行方式与 token 设计说明见：

- `docs/ADMIN_USER_ANALYTICS_SNAPSHOT_AUTOMATION_RUNBOOK_2026-03-10.md`

## 4.5 历史回填策略

### 可回填

以下可直接从现有表回填：

1. 新增用户趋势
2. 战报生成趋势
3. Auth 审计趋势（从 `auth_audit_logs` 创建日开始）

### 不可严格回填

以下只能从“快照启用日”开始有趋势：

1. 24h/7d/30d 活跃
2. 追踪覆盖率
3. 高频样本趋势
4. 活跃构成趋势

因此页面必须显式标注：

- “该趋势自 YYYY-MM-DD 起开始记录”

补充说明：

- 当前自动补洞已经落地，但对 `user_last_activity` 派生出的窗口型指标仍只能做 best-effort，不应宣传为严格历史回填。

---

## 5. 可视化设计

## 5.1 总体原则

V2 图表不追求炫技，目标是让管理员快速理解：

1. 规模是涨是跌
2. 结构是否偏移
3. 异常点在哪一天
4. 当前窗口相对过去是否异常

因此图表优先级是：

1. 线图
2. 堆叠柱图
3. 横向条形图
4. cohort 热力图

## 5.2 图表库方案对比

### 方案 A：引入新图表库

候选：

1. `recharts`
2. `echarts-for-react`
3. `visx`

优点：

1. 开发速度快
2. 交互与 tooltip 成熟

缺点：

1. 新增依赖
2. 增加 bundle 体积
3. 后台只需要少量基础图，库价值未必足够高

### 方案 B：自定义 SVG/CSS 图表组件

需要实现的基础组件：

1. `Sparkline`
2. `LineChart`
3. `StackedBarChart`
4. `HorizontalBarList`
5. `HeatmapGrid`

优点：

1. 不增加依赖
2. 样式可完全贴合现有后台
3. 对当前需求足够

缺点：

1. 初次实现要多写一点基础组件
2. 复杂交互能力不如成熟库

### 推荐结论

**推荐先选方案 B：自定义 SVG/CSS 图表组件。**

原因：

1. 当前后台只需要 4~5 类基础图
2. 仓库当前无图表依赖，先不引入新的维护成本
3. 后台页面本身不是高频复杂交互场景

如果后续需要：

1. 缩放
2. brush
3. 多轴
4. 大量交互筛选

再评估图表库也不迟。

## 5.3 V2 首批图表清单

### A. 总览区

1. **新增用户趋势折线图**
   - X：日期
   - Y：每日新增用户
   - 辅助线：7 日移动平均
2. **累计用户趋势面积/折线图**
   - X：日期
   - Y：累计总用户
3. **活跃窗口趋势多折线图**
   - 24h / 7d / 30d 三条线
   - 来源：`admin_user_analytics_daily`
4. **战报生成状态堆叠柱图**
   - completed / aborted / failed
   - 让异常失败日更直观
5. **追踪覆盖率折线图**
   - tracked / total 或直接画 coverage%

### B. 高频生成分层区

1. **当前分层横向条形图**
   - 比现在纯表格更直观
2. **高强度占比趋势图**
   - `high+ / very_high+ / extreme`
   - 来源：日快照或周期快照

### C. 留存区

1. **D1/D7/D30/D90 留存曲线**
   - 当前值做折线/点图
2. **cohort 热力图**
   - 行：注册周/月
   - 列：D7 / D30
   - 色深：留存率

### D. 活跃构成区

1. **注册时长分层横向条形图**
2. **新/老用户占比 100% 堆叠条**
3. **活跃构成趋势堆叠面积图**（二期）

## 5.4 可视化布局建议

推荐布局：

1. 第一屏：
   - KPI 卡片 + 迷你 sparkline
   - 新增用户趋势
   - 活跃窗口趋势
2. 第二屏：
   - 战报生成趋势
   - 高频分层横向条
3. 第三屏：
   - 留存曲线
   - cohort 热力图
4. 第四屏：
   - 活跃构成图
   - 结构表格

这样管理员先看“规模与趋势”，再看“结构与留存”。

---

## 6. 指标与图表映射建议

## 6.1 总览趋势（首批必须做）

| 指标 | 当前是否可算历史趋势 | 图表 | 备注 |
| --- | --- | --- | --- |
| 每日新增用户 | 可以 | 折线图 | 从 `users.created_at` 回算 |
| 累计总用户 | 可以 | 折线图 | 基于新增累计 |
| 每日战报生成总量 | 可以 | 折线图/柱图 | 从 `battle_report_generations.started_at` 回算 |
| 每日成功/失败/中断 | 可以 | 堆叠柱图 | 最适合看异常 |
| 24h/7d/30d 活跃 | 当前不可严格回算 | 多折线图 | 依赖 `admin_user_analytics_daily` |
| 覆盖率 | 当前不可严格回算 | 折线图 | 依赖 `admin_user_analytics_daily` |

## 6.2 高频生成

| 指标 | 当前状态 | V2 方案 |
| --- | --- | --- |
| 当前 buckets | 已有 | 改成横向条形图 + 表格 |
| `high+` 占比趋势 | 无 | 快照化后画折线 |
| `extreme` 占比趋势 | 无 | 快照化后画折线 |

## 6.3 留存

| 指标 | 当前状态 | V2 方案 |
| --- | --- | --- |
| D1/D7/D30/D90 | 已有当前值 | 改为点线图 |
| cohort 表 | 已有 | 改为热力图 + 表格双视图 |
| 严格日留存 | 无 | 后续依赖 `user_activity_daily` |

## 6.4 构成

| 指标 | 当前状态 | V2 方案 |
| --- | --- | --- |
| tenure buckets | 只有表格 | 改为横向条形图 |
| 新/老用户占比 | 只有数字 | 改为 100% 堆叠条 |
| 构成趋势 | 无 | 依赖日快照或更细事实表 |

---

## 7. 导出设计

## 7.1 导出目标

V2 导出需要满足两类需求：

### A. 单板块快速下载

例如：

1. 只导出 retention
2. 只导出 overview trend
3. 只导出 frequency buckets

### B. 全分析包下载

管理员希望把当前页面所有数据整体导出时，不应手动点 5 次 CSV。

因此推荐新增：

- **导出当前分析包 ZIP**

## 7.2 导出格式方案对比

### 方案 A：继续单文件 CSV

优点：

1. 简单

缺点：

1. 多板块只能硬塞进一张表
2. 结构不清晰
3. 不利于后续自动化处理

### 方案 B：ZIP + 多 CSV + manifest（推荐）

优点：

1. 每个板块独立成表
2. 容易补充元信息
3. 对分析/归档更友好

仓库中已有 `fflate` 依赖，可直接使用。

### 推荐结论

1. 保留每块单独导出 CSV
2. 新增“一键导出 ZIP 分析包”

## 7.3 推荐导出清单

### 单文件 CSV

建议新增以下按钮：

1. 导出 `overview_snapshot.csv`
2. 导出 `overview_trends_daily.csv`
3. 导出 `frequency_buckets.csv`
4. 导出 `frequency_trends.csv`
5. 导出 `retention_points.csv`
6. 导出 `retention_cohorts.csv`
7. 导出 `composition_buckets.csv`
8. 导出 `composition_cohorts.csv`

### ZIP 分析包

建议打包内容：

1. `overview_snapshot.csv`
2. `overview_trends_daily.csv`
3. `generation_trends_daily.csv`
4. `activity_trends_daily.csv`
5. `frequency_buckets.csv`
6. `frequency_trends.csv`
7. `retention_points.csv`
8. `retention_cohorts.csv`
9. `composition_buckets.csv`
10. `composition_cohorts.csv`
11. `meta.json`

其中 `meta.json` 应包含：

```json
{
  "generatedAtUtc": "2026-03-09T08:00:00.000Z",
  "exportedAtUtc": "2026-03-09T08:00:12.000Z",
  "filters": {
    "lookbackDays": 90,
    "activeWindowDays": 7,
    "frequencySample": "active7d",
    "cohort": "week"
  },
  "definitions": {
    "retention": "累计回访留存",
    "activityTrend": "admin_user_analytics_daily 快照"
  }
}
```

## 7.4 导出接口建议

新增接口：

- `GET /api/admin/user-analytics/export?format=csv&section=...`
- `GET /api/admin/user-analytics/export?format=zip&sections=all`

不建议继续在页面内部直接拼 CSV 所有逻辑，原因：

1. 趋势数据会越来越多
2. ZIP 打包必须放到服务端
3. 导出逻辑应与页面展示解耦

## 7.5 文件命名建议

沿用现有 UTC 时间戳风格，例如：

- `user_analytics_overview_snapshot_20260309_081233Z.csv`
- `user_analytics_bundle_20260309_081233Z.zip`

---

## 8. API 设计建议

## 8.1 当前接口的问题

当前 `/api/admin/user-analytics` 以 `section=all` 返回：

- overview
- frequency
- retention
- composition

这适合纯快照页面，但不适合趋势与图表增强后继续无限扩展。

## 8.2 推荐 API 分层

### 方案 A：继续用一个接口，不断扩 section

优点：

1. 改动少

缺点：

1. `section` 语义会越来越臃肿
2. 页面难以按需加载

### 方案 B：保持主接口 + 增加 trends/export 子接口（推荐）

推荐：

1. `GET /api/admin/user-analytics`
   - 负责快照类数据
2. `GET /api/admin/user-analytics/trends`
   - 负责时间序列数据
3. `GET /api/admin/user-analytics/export`
   - 负责 CSV / ZIP 导出

### 推荐结论

采用方案 B。

原因：

1. 趋势接口与快照接口缓存策略不同
2. 导出接口与页面接口职责不同
3. 后续更容易扩展

## 8.3 趋势接口建议

示例：

```http
GET /api/admin/user-analytics/trends?lookbackDays=90&frequencySample=active7d
```

返回：

```json
{
  "success": true,
  "meta": {
    "generatedAt": "2026-03-09T08:00:00.000Z",
    "lookbackDays": 90
  },
  "stats": {
    "registrations": [
      { "date": "2026-03-01", "newUsers": 12, "totalUsers": 3201 }
    ],
    "activity": [
      { "date": "2026-03-01", "activeUsers24h": 180, "activeUsers7d": 426, "activeUsers30d": 801, "coverageRate": 0.31 }
    ],
    "generations": [
      { "date": "2026-03-01", "total": 1240, "completed": 1130, "aborted": 60, "failed": 50, "distinctUsers": 118 }
    ],
    "auth": [
      { "date": "2026-03-01", "success": 84, "failed": 11 }
    ]
  }
}
```

## 8.4 缓存建议

推荐：

1. 快照接口：TTL 60~120s
2. 趋势接口：TTL 300s
3. 导出接口：不缓存或弱缓存

---

## 9. 页面交互设计建议

## 9.1 交互原则

1. 首屏看到最重要的走势
2. 图表和表格并存
3. 每个模块都能单独导出
4. 口径说明必须始终可见

## 9.2 首屏推荐布局

### 第一行

1. KPI 卡片
2. 每张卡片右下角带 sparkline

### 第二行

1. 新增用户趋势
2. 活跃窗口趋势

### 第三行

1. 战报生成趋势
2. 覆盖率趋势 / Auth 趋势

### 第四行起

1. 高频分层
2. 留存
3. 构成

## 9.3 表格不应删除

虽然 V2 要加图表，但表格仍应保留：

1. 图表适合发现趋势
2. 表格适合核数与导出前确认

因此推荐每个模块采用：

- 图表在上
- 明细表在下

---

## 10. 分阶段实施建议

## Phase 1：低风险快赢

目标：

1. 页面从“数字页”升级为“基础图表页”
2. 不引入图表库
3. 不依赖新事实表即可先上可回算趋势

实施内容：

1. 新增前端基础图表组件（SVG）
2. 新增：
   - 新增用户趋势
   - 战报生成趋势
   - 生成成功/中断/失败堆叠图
3. 补 `overview` / `frequency` 单独 CSV 导出
4. 新增 ZIP 分析包导出骨架

## Phase 2：补齐窗口型趋势

目标：

1. 真正解决“7 日活跃怎么看趋势”

实施内容：

1. 新增 `admin_user_analytics_daily`
2. 加入：
   - 活跃窗口趋势
   - 覆盖率趋势
   - 高频占比趋势
3. 页面显式标记“趋势起始日期”

## Phase 3：升级留存与结构分析

目标：

1. 从“静态 cohort 表”升级为更强的留存分析

实施内容：

1. retention 曲线图
2. cohort 热力图
3. 构成趋势图
4. 如有必要，再评估 `user_activity_daily`

---

## 11. 最终推荐结论

针对这次提出的三个问题，推荐结论如下。

### 11.1 趋势问题

当前后台确实只能看时点值，不能看“过去每天的 7 日活跃/覆盖率/结构变化”。

推荐方案：

1. 能回算的趋势先直接做
2. 不能回算的窗口型指标，用 `admin_user_analytics_daily` 补历史快照

### 11.2 可视化问题

当前页面主要是数字与表格，确实不利于管理者快速理解趋势。

推荐方案：

1. 不新增图表库
2. 先用自定义 SVG/CSS 图表组件实现
3. 首批优先上：折线图、堆叠柱图、横向条形图、cohort 热力图

### 11.3 导出问题

当前只导出 retention 与 composition 两块，覆盖明显不足。

推荐方案：

1. 每块单独 CSV 导出补齐
2. 额外新增“ZIP 分析包导出”
3. 由服务端导出接口统一生成

综合判断：

**用户统计分析页的下一阶段不应只做“样式优化”，而应同步完成：趋势数据层、图表组件层、导出体系层 三件事。**

只有三者一起升级，后台才会从“统计数字页”真正变成“分析与观察页”。
