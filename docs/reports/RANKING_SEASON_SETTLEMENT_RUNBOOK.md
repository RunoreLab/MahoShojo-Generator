# 赛季结算 Runbook（排位 / 历史归档）

适用范围：当前排位系统采用“**D1 仅存当前分** + **历史赛季写静态快照**”的架构（`arena_ratings` 不带 `season_id`）。因此赛季切换必须严格遵循流程，避免历史榜单不可逆丢失。

## 关键原则（必须遵守）

1) **先归档，再重置（soft reset）**
- 一旦先执行 `scripts/season-soft-reset.ts`，上一赛季的最终 `arena_ratings` 将被覆盖，无法从 DB 重建“结算时榜单”。

2) **真实“封榜时间”= 归档文件生成时间**
- `endsAt` 目前主要用于 UI 展示与脚本校验；历史快照是否准确，取决于你何时执行归档脚本。

3) **历史榜单是快照子集（默认 Top 100 + Bottom 50）**
- 若需要历史赛季支持“全榜分页/筛选/搜索”，应使用 `--full` 归档全量实体（注意体积与前端排序成本）。

## 结算流程（推荐执行顺序）

### Step 0：准备与预检

1) 确认你要结算的赛季 ID（例如 `S0`）
2) 检查 `public/config/seasons.json`
- `status=current` **必须且仅有 1 个**（`scripts/season-archive.ts` 已内置校验，非 `--force/--snapshot-only` 会直接报错）
- 建议为本赛季填写 `endsAt`（否则脚本需要 `--force`）
3) 确认已配置 D1 访问（避免生成空快照）
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `D1_DATABASE_ID`
- 推荐在命令里加 `--require-db` 强制校验

### Step 1：生成快照（预览，不改赛季状态）

用于验证 SQL 过滤、快照范围、字段是否齐全。

```bash
bun tsx scripts/season-archive.ts --season-id S0 --snapshot-only --require-db
```

可选：
- 调整范围：`--top 100 --bottom 50`（默认）或 `--full`
- 生成后检查：`public/data/seasons/archive_S0.json`
- strict 队列新增写入的赛季 extrema facts：`season-archive.ts` 生成的归档会在实体快照（`entities[].queues.strict`）写入严格排位的 `seasonPeak / seasonLow / seasonPeakTier` 所需字段（对应 `seasonPeakRating/seasonPeakGames/seasonPeakAt/seasonPeakTier/seasonLowRating/seasonLowGames/seasonLowAt`），用于 `/ranking` 历史赛季主视图展示；旧归档文件若缺失这些字段，主视图会自动降级为空，不影响列表加载。

### Step 2：正式归档（写入快照 + 把赛季标记为 history）

```bash
bun tsx scripts/season-archive.ts --season-id S0 --require-db
```

脚本会做两件事：
1) 写入 `public/data/seasons/archive_S0.json`
2) 更新 `public/config/seasons.json`：把 `S0.status` 设为 `history` 并写入 `archivedAt`

注意：脚本会在归档后强提醒“如果没有任何 `status=current`”。这是正常的过渡态——你需要在 Step 4 创建/切换新赛季。

### Step 3：Soft Reset（新赛季段位回收）

先 dry-run（默认即 dry-run），观察参数与样例变化：

```bash
bun tsx scripts/season-soft-reset.ts --queue all --preview 10 --require-db
```

确认无误后再执行写入（会更新 `arena_ratings`，并清空局数/W-L-D 等用于新赛季重新定级）：

```bash
bun tsx scripts/season-soft-reset.ts --queue all --preview 10 --apply --require-db
```

说明：
- 默认启用 auto tuning，会基于数据库统计推导“按场次/活跃度的回收力度”；如需完全手动，传入 `--no-auto`
- strict 队列执行 soft reset 时，会同时把 `seasonPeakRating/seasonPeakGames/seasonPeakAt/seasonPeakTier/seasonLowRating/seasonLowGames/seasonLowAt` 重置到新赛季起始值语义（起始分 + 0 局 + 当前时间），其中 `seasonPeakTier` 固定重置为 `无牌`
- free 队列第一版仍不写 season extrema 相关字段（保持原值/NULL，不做污染）
- 更详细参数见：`bun tsx scripts/season-soft-reset.ts --help`

### Step 4：创建/切换新赛季（手动编辑静态配置）

在 `public/config/seasons.json` 中：
1) 添加新赛季条目（例如 `S1`）
2) 将新赛季设为 `status=current`
3) 确保**仅一个**赛季为 `current`

### Step 5：部署与验收

1) 部署静态资源（包含 `public/config/seasons.json`、`public/data/seasons/archive_*.json`）
2) 打开 `/ranking` 页面验收：
- 赛季下拉框是否正确显示
- 历史赛季是否能加载快照（页面会展示“快照生成/归档标记时间”并提示快照性质）
- 当前赛季榜单是否正常（API 读取 `arena_ratings`）

## 常见问题与处理建议

### Q1：为什么归档后详情弹窗内容和快照不一致？

历史列表来自静态快照，但“角色详情弹窗”会读取**当前公开的**数据卡/预设文件；如果角色卡在赛季后被修改、下架、转私有，弹窗内容会漂移或无法加载。这是当前架构的已知权衡。

补充：本轮（season extrema）仍不解决“历史赛季详情弹窗读取当前公开卡”的漂移问题，只保证历史赛季主视图能稳定展示 strict `seasonPeak / seasonLow / seasonPeakTier`（缺字段会自动降级为空，不影响列表加载）。

### Q2：我想历史赛季支持完整分页/筛选怎么办？

使用 `--full` 归档全量实体快照，但要评估：
- 静态 JSON 体积增长（建议结合 gzip/brotli）
- 前端排序/筛选成本

中长期方案是把 `season_id` 落到 DB（见 `docs/RANKING_SEASON_ARCHIVE_AUDIT_2026-02-05.md` 的长期建议）。
