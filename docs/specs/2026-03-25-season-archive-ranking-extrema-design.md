# 赛季归档极值与排行榜主视图统一设计稿

日期：2026-03-25  
状态：已完成设计讨论，待人工评审  
范围：历史赛季归档 + `/ranking` 当前/历史赛季主视图统一展示 strict 赛季极值信息

---

## 1. 背景

当前仓库已经具备以下能力：

- `arena_ratings` 已记录 strict 当前赛季的 `seasonPeak / seasonLow / seasonPeakTier`
- strict 结算、strict reset、season soft reset 已维护这些字段
- 数据卡详情弹窗与个人资料卡已能展示当前赛季 strict 赛季极值信息

但历史赛季链路仍存在缺口：

- `scripts/season-archive.ts` 当前只把 `rating / games / wins / losses / draws / ratingUpdatedAt` 写入历史归档
- `/ranking` 的历史赛季模式只能读取这些基础快照字段，无法展示 strict 赛季极值
- `/ranking` 的当前赛季主榜单 API 也尚未返回这组字段，因此当前赛季与历史赛季主视图无法保持一致

本次目标是把“strict 赛季最高分 / 最低分 / 赛季最高段位”补进历史归档，并让 `/ranking` 页面在当前赛季与历史赛季主视图中采用统一展示口径。

---

## 2. 范围与非目标

### 2.1 本次范围

1. 扩展历史赛季归档 schema 与生成逻辑，保存 strict 赛季极值事实字段
2. 扩展 live 当前赛季排行榜 API，返回与历史视图一致的赛季极值展示数据
3. 调整 `/ranking` 页面，使当前赛季与历史赛季主视图显示同一组 strict 赛季极值信息
4. 为旧历史归档提供前端降级兼容

### 2.2 明确非目标

1. **不改历史赛季点击后详情弹窗的数据来源**
   - 详情弹窗仍读取当前公开数据卡/预设内容
   - 因此历史赛季主视图与详情弹窗之间仍可能存在漂移
2. **不扩展 free 队列的赛季极值**
   - 当前阶段继续只处理 strict
3. **不把排行榜页面改造成新的赛季荣誉页**
   - 本次只补已有赛季极值信息的主视图展示
4. **不强制回填旧归档文件的赛季极值**
   - 旧归档缺字段时以前端降级兼容为主

---

## 3. 方案对比与结论

### 方案 A：只补历史归档事实层

做法：

- 扩展 `archive_<season>.json`
- 不改 `/ranking` 当前赛季 live API
- 历史赛季暂不展示或只做局部展示

优点：

- 改动最小
- 风险最低

缺点：

- 用户仍会看到“当前赛季有、历史赛季没有”或“双口径展示”
- 不能满足“历史赛季与当前赛季主视图一致”的目标

### 方案 B：补历史归档，并统一 `/ranking` 主视图展示（推荐）

做法：

- 扩展 archive facts
- 扩展 live leaderboard API
- 在 `/ranking` 页面内部统一当前赛季与历史赛季的榜单视图模型

优点：

- 满足本次产品目标
- 只改主视图，不卷入历史详情弹窗重构
- 对现有代码边界影响可控

缺点：

- 需要同时改 archive、live API、页面视图模型三处

### 方案 C：连同历史详情弹窗一并快照化

优点：

- 一致性最完整

缺点：

- 超出本轮范围
- 需要重做 `LeaderboardEntityDetailsModal` 的数据来源设计

### 结论

本次采用 **方案 B**：  
补历史归档事实层，并让 `/ranking` 当前赛季与历史赛季主视图统一展示 strict 赛季极值信息；历史详情弹窗继续保持现状。

---

## 4. 数据模型设计

### 4.1 归档事实层

当前 `SeasonArchiveQueueSnapshot` 仅包含：

- `rating`
- `games`
- `wins`
- `losses`
- `draws`
- `ratingUpdatedAt`

本次在 `queues.strict` 上追加以下可选字段：

- `seasonPeakRating?: number | null`
- `seasonPeakGames?: number | null`
- `seasonPeakAt?: string | null`
- `seasonPeakTier?: string | null`
- `seasonLowRating?: number | null`
- `seasonLowGames?: number | null`
- `seasonLowAt?: string | null`

设计原则：

- 归档保存 **facts**，不保存额外展示态对象
- `seasonPeak.tier` 与 `seasonLow.tier` 继续由前端使用 `rating + games` 推导
- `seasonPeakTier` 单独保存，因为它表达的是“赛季曾达到过的最高显示段位”，允许为 `女王`

### 4.2 队列约束

- 仅 `strict` 写入以上字段
- `free` 不写这组字段，保持缺省或 `null`

### 4.3 旧归档兼容

- 历史 `archive_*.json` 没有这组字段时，视为 `null`
- 前端不得因为缺字段报错

---

## 5. 读写链路设计

### 5.1 历史归档写入链路

涉及文件：

- `lib/db/repositories/season-archive.ts`
- `lib/database/season-archive.ts`
- `scripts/season-archive.ts`
- `lib/seasons.ts`

做法：

1. `season-archive` 仓储查询从 `arena_ratings` 读取 strict 行上的：
   - `season_peak_rating`
   - `season_peak_games`
   - `season_peak_at`
   - `season_peak_tier`
   - `season_low_rating`
   - `season_low_games`
   - `season_low_at`
2. `scripts/season-archive.ts` 把这些值写入 `entity.queues.strict`
3. `lib/seasons.ts` 扩展归档类型定义，声明这些字段为可选字段

### 5.2 live 当前赛季排行榜链路

涉及文件：

- `lib/db/repositories/arena-read.ts`
- `pages/api/arena/leaderboard.ts`

做法：

1. 榜单查询结果增加 strict 赛季极值原始字段
2. API 层对 strict 组装展示态：
   - `seasonPeak`
   - `seasonPeakTier`
   - `seasonLow`
3. `seasonPeak / seasonLow` 结构与 `data-card-meta` 现有结构保持一致：

```ts
type ApiRatingSeasonExtreme = {
  rating: number;
  games: number;
  occurredAt: string;
  tier: string;
};
```

规则：

- `tier` 使用 `computeArenaBaseTier(rating, games)` 推导
- `seasonPeakTier` 直接透传已落库的 canonical 值
- `free` 统一返回 `null`

### 5.3 `/ranking` 页面内部统一视图模型

涉及文件：

- `components/ranking/RankingPage.tsx`

做法：

1. live 榜单数据源直接消费 API 返回的 `seasonPeak / seasonPeakTier / seasonLow`
2. 历史归档数据源从 archive flat facts 映射出同样结构
3. 页面内部统一使用一个包含以下字段的榜单行视图模型：

```ts
type LeaderboardSeasonExtreme = {
  rating: number;
  games: number;
  occurredAt: string;
  tier: string;
};

type LeaderboardItem = {
  ...
  seasonPeak: LeaderboardSeasonExtreme | null;
  seasonPeakTier: string | null;
  seasonLow: LeaderboardSeasonExtreme | null;
};
```

这样可以保证当前赛季与历史赛季使用同一段渲染逻辑。

---

## 6. 展示设计

### 6.1 展示位置

不新增独立表格列。  
赛季极值信息放在排行榜名称列的次级信息区。

理由：

- 当前表格列已较满
- 移动端与窄屏下新增列会明显压缩可读性
- 赛季极值更适合作为角色履历信息，而非核心排序列

### 6.2 展示规则

仅在 `strict` 队列显示，展示顺序为：

1. `赛季最高 <rating>（<baseTier>） <occurredAt>`
2. `赛季最低 <rating>（<baseTier>） <occurredAt>`
3. `赛季最高段位 <seasonPeakTier>`

其中：

- `baseTier` 来自 `computeArenaBaseTier(rating, games)`
- `seasonPeakTier` 独立显示，不得误用 `seasonPeak.tier`
- 缺值时整段不渲染

### 6.3 历史赛季提示文案

保留当前提示：

- 历史赛季主视图基于快照重算显示规则
- 点击“角色详情”后读取的是当前公开卡内容，可能与快照不一致

---

## 7. 测试策略

### 7.1 数据与归档层

新增或扩展测试，覆盖：

1. `season-archive` 仓储查询能读取 strict 赛季极值字段
2. `scripts/season-archive.ts` 生成的 `queues.strict` 包含赛季极值字段
3. `free` 队列不会被写入赛季极值字段

### 7.2 live API

新增或扩展测试，覆盖：

1. 当前赛季 strict 榜单 API 返回 `seasonPeak / seasonPeakTier / seasonLow`
2. `seasonPeak / seasonLow` 的 `tier` 为现场推导结果
3. `free` 榜单 API 返回这组字段时为 `null`

### 7.3 页面渲染

新增或扩展测试，覆盖：

1. 当前赛季 strict 榜单显示赛季极值块
2. 历史赛季 strict 榜单显示同样结构的赛季极值块
3. `free` 队列不显示赛季极值块
4. 老归档缺字段时页面正常降级

### 7.4 回归边界

显式保证以下行为不变：

- 历史详情弹窗仍读取当前公开卡
- 详情弹窗现有赛季极值显示逻辑不在本轮改动范围内

---

## 8. 风险与约束

### 风险 1：历史详情弹窗与榜单主视图不一致

这是当前架构的已知权衡，本次不处理。  
通过保留现有提示文案降低认知偏差。

### 风险 2：旧归档缺字段

通过前端可选字段降级处理解决，不强制迁移旧文件。

### 风险 3：当前赛季与历史赛季走两套渲染逻辑导致后续漂移

通过在 `RankingPage` 内统一视图模型解决，避免一套页面里保留两段 season 渲染实现。

---

## 9. 实施顺序

1. 扩展 `lib/seasons.ts` 与 `season-archive` 读写链路
2. 扩展 `scripts/season-archive.ts` 的快照输出
3. 扩展 `arena-read` 与 `/api/arena/leaderboard`
4. 统一 `RankingPage` 当前/历史赛季的 season 视图模型和渲染
5. 补齐测试并运行 `bun test`、`bun run lint`、`bun run build`

---

## 10. 最终结论

本次改动采用以下边界：

- 历史归档开始保存 strict 赛季极值 facts
- `/ranking` 当前赛季与历史赛季主视图统一展示 strict 赛季极值
- 历史赛季详情弹窗继续读取当前公开卡，不纳入本轮

这是当前仓库状态下，投入、风险与用户感知收益最平衡的实现路径。
