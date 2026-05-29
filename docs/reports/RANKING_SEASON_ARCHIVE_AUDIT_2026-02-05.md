# 排位历史赛季归档：设计与代码审计（2026-02-05）

审计目标：梳理「排位排行榜」的**历史赛季归档**能力现状，评估当前设计/实现是否合理，识别潜在漏洞或错误，并给出可落地的优化建议。

## 0. 范围与现状快照

本次关注的“赛季归档”指：**赛季结束时把当期排位快照写成静态 JSON**，供前端在“历史赛季”模式下展示。

仓库内与现状相关的关键文件（截至 2026-02-05）：
- 赛季配置：`public/config/seasons.json`
  - 当前赛季：`S0`，`endsAt = 2026-02-05`，`status = current`
  - 历史赛季：`Alpha`，`archivedAt = 2026-01-04T08:35:20.181Z`，`status = history`
- 历史归档文件：`public/data/seasons/archive_Alpha.json`

## 1. 设计梳理（数据源与链路）

### 1.1 数据源分层

- **实时榜单（当前赛季）**
  - 数据源：D1 表 `arena_ratings`（当前分 / 局数 / W-L-D）
  - 读取接口：`GET /api/arena/leaderboard`（`pages/api/arena/leaderboard.ts`）

- **历史榜单（历史赛季）**
  - 数据源：静态归档 `public/data/seasons/archive_<seasonId>.json`
  - 读取位置：`components/ranking/RankingPage.tsx`（历史赛季 or “快照测试”时直接 fetch 静态 JSON）

> 结论：当前架构是“**DB 只保留当前赛季的可变状态** + **历史赛季用静态文件保存快照**”。

### 1.2 赛季元数据来源

- 元数据存放：`public/config/seasons.json`（静态）
- 客户端读取：`components/ranking/RankingPage.tsx` 直接请求 `/config/seasons.json`
- 服务端读取（用于 strict 规则、写入生成记录的 extraJson 等）：`lib/seasons-config.ts` 通过 `fetch(origin + /config/seasons.json)` 拉取并缓存 60 秒

### 1.3 归档生成方式

- 归档脚本：`scripts/season-archive.ts`
  - 从 D1 读取榜单“可公开展示”的实体集合（与线上公共榜过滤口径对齐）
  - 生成 `schemaVersion=3` 的归档 JSON（默认 Top 100 + Bottom 50，可用 `--full` 全量）
  - 默认会把被归档赛季在 `public/config/seasons.json` 标记为 `status=history` 并写入 `archivedAt`
  - 提供 `--snapshot-only` 用于“只生成快照，不改变赛季状态”（对应 UI 的“快照（测试）”入口）

### 1.4 赛季切换/结算（当前是运维流程，不是线上逻辑）

代码层面没有“自动结算/自动封榜”的在线机制；赛季切换通常需要人工按流程执行：
1) 运行 `scripts/season-archive.ts` 生成快照并更新 `seasons.json`
2) 运行 `scripts/season-soft-reset.ts` 对 `arena_ratings` 做软重置（可选自动调参）
3) 手动更新 `public/config/seasons.json`：把新赛季标成 `current`（脚本不会自动创建新赛季）
4) 重新部署静态资源（`public/config/*`、`public/data/*`）

## 2. 代码逻辑评估：是否“合适”

### 2.1 优点（当前阶段很合理的点）

- **实现成本低、迁移风险小**：不引入 `season_id` 维度到主业务表（`arena_ratings`），避免 D1 大规模结构改造。
- **静态可回放**：历史榜单读取静态 JSON，稳定、不依赖 DB 历史数据保留策略。
- **口径复用**：历史赛季页面复用当前赛季的排序/筛选规则（`RankingPage` 内已对齐“预设不受标签筛选影响”等口径），减少两套逻辑分叉。
- **归档 schema v3 的方向正确**：只存 facts（`entities` + `snapshotPolicy/totalEligible`），不强依赖 views（`leaderboards`），降低冗余与迁移成本。

### 2.2 不足与权衡（需要明确接受的代价）

- **历史展示会“漂移”**：历史榜单在前端用“当前代码”重算段位/女王/排序 tie-breaker；未来若 `tier` 阈值、女王规则、排序细节变更，历史赛季显示会变化。
- **Top/Bottom 快照不支持“全榜查询”**：默认 `Top 100 + Bottom 50` 意味着历史页无法支持“完整分页/筛选/搜索”，只能在快照子集里操作。
- **赛季生命周期靠人工流程保证**：`endsAt` 目前更多是展示/脚本的“存在性校验”，不是线上强约束；真实“封榜时刻”由归档脚本执行时间决定。

## 3. 可能的漏洞 / 错误点（按优先级）

### P0（高风险）：运维流程导致历史数据不可逆丢失

因为 `arena_ratings` 不带 `season_id`，一旦先做 `season-soft-reset` 再归档，**上一赛季的最终榜单将无法从 DB 重建**。

建议：把“先归档、后重置”写成强制 checklist，并在脚本层做保护（见第 4 节）。

### P1（中风险）：历史赛季的“详情弹窗”可能与快照不一致/甚至打不开

`RankingPage` 的列表数据来自归档快照，但点击条目后：
- `LeaderboardEntityDetailsModal` 会请求 `/api/public-data-cards?id=...` 或读取 `/presets/...`
- 若角色卡在赛季结束后被改名、改描述、转私有、删除、下线，弹窗展示可能与历史快照不一致，或直接加载失败

这不是安全漏洞，但会削弱“历史归档”的可信度与可用性。

### P2（中风险）：归档 JSON 可能暴露不必要的内部字段

归档 schema 支持写入 `authorId`（内部用户 ID）等字段；即使 UI 不展示，静态文件仍可被直接下载查看。

建议：评估是否需要公开该字段；若不需要，应在归档生成阶段剔除或脱敏。

### P3（低风险）：配置拉取的信任边界

服务端通过 `lib/seasons-config.ts` 从 `new URL(req.url).origin` 回源拉取 `/config/seasons.json`。

通常在受控部署环境下这没问题；但若存在 Host 头可被利用的边界情况，可能导致“赛季规则来源可被影响”。建议至少在文档中明确假设（仅允许本域名访问/由平台保证 Host 不可伪造），或引入可选的“固定 origin”配置以加固。

### P4（低风险）：历史快照的 tie-break 字段质量不稳定

现有 `archive_Alpha.json` 的 `ratingUpdatedAt` 全为 `null`（可能是历史数据/旧结构遗留）。该字段主要用于 tie-break 与“女王”候选比较，缺失不会导致崩溃，但会让历史排名在极端平分条件下更依赖 `entityType/entityId` 字典序。

## 4. 优化建议（从易到难）

### 4.1 立刻可做（低成本，高收益）

1) **补齐“赛季结算 Runbook”并固化为 checklist**
   - 目标：降低误操作导致的历史丢失风险（P0）
   - 推荐放在：`docs/` 下单独文档（或并入 `DEPLOY.md` 的“赛季结算”小节）

2) **历史赛季 UI 增加信息提示**
   - 展示 `archive.generatedAt` 与 `season.archivedAt`（若存在），明确“快照生成时间”
   - 提示“详情弹窗读取的是当前公开卡信息，可能与历史快照不一致/不可用”

3) **归档脚本增强校验**
   - 归档前检查：`seasons.json` 是否存在且仅有 1 个 `status=current`
   - 归档后提示：若更新后没有任何 `current` 赛季，给出强警告（避免线上进入“无当前赛季”状态）

### 4.2 中期改进（需要少量代码/数据演进）

1) **在归档里记录 `rulesVersion` / `tierParams`**
   - 若希望历史显示尽量稳定，可在归档写入：
     - `rankingRulesVersion`（排序/筛选/预设标签规则的版本号）
     - `tierParams`（段位阈值、女王规则关键常量）
   - 前端按归档版本选择回放策略（或至少在 UI 上提示“历史显示可能随版本变化而漂移”）

2) **归档文件按队列拆分（可选）**
   - `archive_<id>_strict.json` / `archive_<id>_free.json`，降低单文件体积与前端解析成本

3) **减少公开快照字段**
   - 只保留渲染必要字段；把 `authorId` 等改为可选并默认不写入

### 4.3 长期演进（结构性方案）

1) **把赛季维度落到 DB**
   - 方案 A：`arena_ratings` 增加 `season_id` 作为主键维度（需要迁移+索引调整）
   - 方案 B：新增 `arena_season_ratings`/`arena_season_archives` 表，赛季结算时写入（当前赛季仍用 `arena_ratings`）
   - 好处：历史榜单可 server-side 分页/筛选；无需前端加载大 JSON；也更易做“全榜历史”

2) **从 rating_events 推导赛季**
   - 当前 generation 的 `extraJson` 已记录 `seasonId`；可考虑在 `arena_rating_events` 追加冗余列 `season_id`（写入时同步），以便按赛季查询/审计/统计。

## 5. 推荐的“赛季结算 Checklist”（可直接执行）

1) 运行 `pnpm exec tsx scripts/season-archive.ts --season-id <当前赛季>`（必要时先用 `--snapshot-only` 预览）
2) 确认生成了 `public/data/seasons/archive_<id>.json`，并且 `public/config/seasons.json` 中目标赛季已写入 `archivedAt`
3) 再运行 `pnpm exec tsx scripts/season-soft-reset.ts`（按需要选择队列与 policy）
4) 在 `public/config/seasons.json` 里新增/更新新赛季，并确保**仅一个** `status=current`
5) 部署并在 `/ranking` 页面验证：赛季切换、历史赛季能正确读取快照、当前赛季榜单正常

---

## 结论

当前“静态归档 + 前端重算”的方案对 v0.6.x 阶段是**合适且工程上性价比高**的：实现简单、依赖少、可快速上线历史回顾能力；但它强依赖运维流程正确性，并天然存在“历史显示漂移”和“快照范围有限”的权衡。建议优先补齐结算流程的保护与 UI 提示，再根据历史榜单需求逐步决定是否把赛季维度落入 DB。

