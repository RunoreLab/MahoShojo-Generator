# 技术值（Tech Index）算法调查研究与改进草案（2026-02-04）

更新时间：2026-02-04  
数据来源：Cloudflare D1（`data_card_metrics` / `data_cards` / `arena_ratings`），统计口径以“公开 + 已审核通过的角色卡”为主  
目标：解释为何“顶格/上界”现象在高段位卡上明显、为何对排位分的区分度变差，并给出可落地的改进方案（含推荐 v2 参数）

> 2026-02-05 补充：问卷生成角色卡的 `userAnswers` 新存储格式（对象数组 + 问题文本）会系统性推高 techScore，并造成新旧卡口径不可比。详见：`docs/TECH_INDEX_USER_ANSWERS_STORAGE_IMPACT_2026-02-05.md`。

> 注意：百科条目里强调过“技术值 ≠ 强度值”。本文仍以“风险/风格提示”为本意进行讨论，但会额外评估其对排位分（`arena_ratings.rating`）的**统计相关性**，因为你提出了“预测能力下降”的诉求。

---

## 0. TL;DR（结论先行）

### 0.1 “大量触及上界”主要发生在**榜单顶端**，而非全库

以「公开 + 已审核通过」角色卡为总体样本（N=5847）：

- `techScore=100` 只有 **11 张**（0.19%）
- `techLevel=L5（techScore>=80）` 只有 **134 张**（2.29%）

但在榜单顶端（按排位分排序），“L5/100”出现频率会显著升高：

- strict Top50：**L5 占 54%**，`techScore=100` 占 8%
- free Top50：**L5 占 46%**，`techScore=100` 占 8%

### 0.2 顶端“上界化”的首要推手：`exploitBoost=+10`（二值加成）

当前实现中：只要 `kwExploit>0`，就会额外 `techScore += 10`（封顶 100）。

实测 strict Top60：

- **41/60**（68%）的卡会触发 +10
- Top60 的 L5 数量：**从 17（不加成）→ 31（加成后）**

这会把大量卡“推上 L5”，并在高段位区间制造**阈值效应**（同样触发=同样 +10），导致上界拥挤、区分度下降。

### 0.3 推荐的 v2（最小侵入，优先解决上界拥挤）

在不改变特征提取框架的前提下，推荐先做一个“v2.0（保守版）”：

- **移除** `exploitBoost`（将 `kwExploit>0` 改为“风险标记”，不再直接加分）
- 将 `techDensityPer1kCharsCap` 从 **12 → 30**（降低 `scoreControl` 在高段位的饱和）

对 strict（公开已审角色卡、minGames>=10，N=417）的对比结果：

- baseline（当前）：Spearman ≈ **0.524**；`L5` 占 **14.9%**；存在 `techScore=100`（1.4%）
- v2（无 +10，cap=30）：Spearman ≈ **0.515**；`L5` 占 **3.8%**；`techScore=100` **归零**

对 strict Top50（高段位最关心区分度）：

- baseline：Spearman ≈ **0.183**；`L5` 占 **54%**
- v2：Spearman ≈ **0.234**；`L5` 占 **18%**

> 含义：相关性几乎不变（仅小幅下降），但“顶端挤在 L5/100”显著缓解，顶端区分度回升。

---

## 1. 当前技术值算法（v1）复盘

代码位置：`lib/metrics/techIndex.ts`

### 1.1 输入与稳定性约束

- 输入：数据卡 JSON（`data_cards.data` 或预设 JSON）
- 忽略字段（不参与遍历/统计）：`signature` / `templateId` / `isPreset` / `_author` / `_authorId` / `arena_history` / `adjudicationEvents` / `current_state`
- Edge 友好上限：`maxDepth=6` / `maxNodes=6000` / `maxChars=250000`

### 1.2 关键特征（简化归类）

- **结构复杂度**：`jsonTotalKeys` / `jsonTotalNodes` / `jsonUniqueKeyCount` / `jsonMaxArrayLen` 等
- **布局特征**：bullet 行数、heading 行数、重复行比例、代码围栏等
- **关键词计数**：
  - 控制/提示词工程：`kwMust/kwSystem/kwFormat/kwRole/kwMeta/kwExploit`
  - 机制：`kwDice/kwCombat`
  - 代码/公式：`kwCode/kwMath`
- **派生密度**：`techDensityPer1kChars` / `mechanicsDensityPer1kChars` / `codeDensityPer1kChars`

### 1.3 归一化与合成（现行实现）

- 单维归一化（对数饱和 + 截断）：
  - `norm(x; cap) = clamp01( log(1+x) / log(1+cap) )`
- 组件得分：
  - `scoreControl = norm(techDensityPer1kChars, cap=12)`
  - `scoreMechanics = norm(mechanicsCount, cap=220)`（注意：这里是 **count**，不是 density）
  - `scoreCode = norm(codeDensityPer1kChars, cap=3)`
  - `scoreStructure =`（keys/nodes/arrayLen/uniqueKeys/bullets/headings/repeatRatio 的加权和）
  - `scoreSize = norm(jsonStringCharsTotal, cap=40000)`
- techScore：
  - `techScore = round(100 * (0.25*control + 0.05*mechanics + 0.40*structure + 0.05*code + 0.25*size))`
  - 若 `kwExploit>0`：`techScore = min(100, techScore + 10)`（`exploitBoost=10`）
- techLevel（固定阈值）：
  - L5>=80，L4>=60，L3>=40，L2>=25，L1>=10，其余 L0

> 备注：`docs/V0_6_0_RANKING_TECH_TAGS.md` 的初稿权重与当前实现不同（特别是 `scoreSize` 权重与 `scoreStructure` 公式），这会直接影响“顶端上界化”的速度。

---

## 2. 数据库现状：技术值分布与“上界”命中率

统计时间：2026-02-04（本机执行）  
统计样本默认过滤：`data_cards.deleted_at IS NULL`

### 2.1 全库 vs 公开已审角色卡（基准分布）

`public+approved characters`（N=5847）：

- techScore：mean **52.12**；P50 **51**；P90 **64**；P95 **71**；P99 **88.54**；max **100**
- `techScore=100`：**11**（0.19%）
- `techScore>=80（L5）`：**134**（2.29%）

结论：从“全库/全公开”的角度看，`techScore=100` 并不算泛滥；“上界化”更多体现为 **榜单顶端的 L5 聚集**。

### 2.2 榜单顶端的“上界化”显著

按排位分排序的 TopN（公开已审角色卡）：

| 队列 | TopN | L5 数量 | L5 占比 | tech=100 数量 | tech=100 占比 |
| --- | --- | ---: | ---: | ---: | ---: |
| strict | 50 | 27 | 54% | 4 | 8% |
| strict | 100 | 40 | 40% | 5 | 5% |
| strict | 200 | 58 | 29% | 5 | 2.5% |
| free | 50 | 23 | 46% | 4 | 8% |
| free | 100 | 38 | 38% | 8 | 8% |
| free | 200 | 53 | 26.5% | 11 | 5.5% |

---

## 3. 技术值对排位分的“预测能力”评估（相关性）

这里用相关性做“可量化替身”：

- Pearson：线性相关（对异常值敏感）
- Spearman：秩相关（更贴近“能否排序”）

> 口径：仅 `entity_type='data_card'` 且公开已审角色卡；strict 额外包含项目内的 `public_since` 限制（与现有严格榜口径一致）。

### 3.1 strict（整体相关性随对局数上升）

| minGames | 样本数 N | Pearson | Spearman |
| ---: | ---: | ---: | ---: |
| 0 | 3258 | 0.394 | 0.258 |
| 5 | 855 | 0.496 | 0.433 |
| 10 | 417 | 0.506 | 0.524 |
| 20 | 228 | 0.505 | 0.587 |

解读：对局数越多，rating 噪声越低，技术值与 rating 的秩相关越高（这符合“rating 越收敛越像真实强度”的直觉）。

### 3.2 free（整体相关性略低）

| minGames | 样本数 N | Pearson | Spearman |
| ---: | ---: | ---: | ---: |
| 0 | 4224 | 0.351 | 0.247 |
| 5 | 1548 | 0.389 | 0.326 |
| 10 | 870 | 0.406 | 0.364 |
| 20 | 484 | 0.403 | 0.416 |

### 3.3 顶端窗口（Top50）区分度明显下降

strict Top50（按 rating 排序）：

- baseline：Spearman ≈ **0.197**

解读：顶端区间里，rating 的细微差异更可能来自“对局噪声/对手分布/风控过滤/偶然波动”，而技术值在该区间又更容易饱和（尤其是被 +10 推上 L5），因此“预测能力下降”会首先出现在 Top 窗口。

---

## 4. 诊断：为什么顶端容易“挤在上界”？

### 4.1 `exploitBoost=+10` 造成强烈的阈值效应

公开已审角色卡总体：`kwExploit>0` 约 **7.2%**（422/5847）  
但 strict Top50：`kwExploit>0` 约 **76%**（38/50）

并且 strict Top60 的实际影响更直观：

- **41/60** 触发 +10
- L5 数量：**17（不加成）→ 31（加成后）**

结论：+10 既会“推上界”，又会让“是否触发 kwExploit”变成顶端的主要分层因子之一，而它本质更接近**风险提示**，不一定等价于强度。

### 4.2 `scoreControl` 在顶端大量饱和（cap=12 偏低）

strict Top60 的 `techDensityPer1kChars`：

- mean **12.55**
- P90 **25.10**
- max **39.03**
- `>=12` 占 **46.7%**

也就是说，接近一半的顶端卡在 `scoreControl` 上已经“顶到 1”，进一步增加提示词工程密度不会带来区分度。

### 4.3 `scoreSize` 的“高基线”会抬高整体分数、压缩差异

公开已审角色卡的 `jsonStringCharsTotal`：

- P50 **2865**，P80 **4568**，P95 **7917**，P99 **32613**

由于 `scoreSize` 使用 `log(1+x)/log(1+40000)`，即使是 P50（2865）也会得到约 **0.75** 的 size 分数——这相当于给绝大多数卡都加了一块“几乎固定”的高底座（在 techScore 中占 25% 权重），会压缩其它维度对最终分数的贡献空间。

> 这并不一定是 bug，但它会让“上界”更容易被碰到，也会让 techScore 更像“复杂度/长度指标”，而不是“技法密度指标”。

---

## 5. 改进方向（候选方案对比）

### 方案 A：最小侵入 v2（推荐优先落地）

目标：先把“顶端上界拥挤”打散，尽量不引入新概念/新字段。

改动：

1) `exploitBoost: 10 → 0`（不再因为 `kwExploit>0` 直接 +10）
2) `techDensityPer1kCharsCap: 12 → 30`（降低 `scoreControl` 在顶端的饱和）

优点：

- 改动小，可快速回填
- 对整体相关性影响小，但顶端 L5/100 拥挤明显缓解

缺点：

- `kwExploit` 的“风险提示”弱化（但可通过 UI/标签补回）

### 方案 B：把 `kwExploit` 从“加分”改成“风险标记/标签”

思路：`kwExploit` 更像“可能触及代码杀/越权/裁判操控”的信号，建议不直接污染综合分，而是输出：

- `hasExploitSignals = kwExploit>0`（或分档）
- UI：在技术值旁边显示一个「风险」徽章/tooltip
- 标签：可考虑自动写入 `scope=system` 的系统标签（例如 `risk:exploit-signal`）

优点：减少阈值效应；解释性更强；便于社区治理  
缺点：需要 UI/标签链路做一点改造

### 方案 C：重做 `scoreSize`（降低高基线，提升区分度）

思路：让 size 只在“明显超大卡”上贡献分数，例如：

- 以 P50/P80 作为 baseline，P99 作为 cap
- 或者改为分段函数（小于阈值不加分，超过阈值线性/对数上升）

优点：减少“长度=高技术值”的误导；让控制/结构更有话语权  
缺点：需要重新标定阈值；可能影响与 rating 的相关性（需要数据验证）

### 方案 D：techLevel 改为“分位数映射”（避免长期上界化）

把 L0-L5 视为“人群分层”，而不是固定阈值：

- 例如 L5=Top5%，L4=Top20%，L3=中位层……
- 每赛季冻结一次阈值（写入 `public/config/seasons.json` 或新表/配置）

优点：不管总体分布怎么漂移，L5 都不会无限膨胀  
缺点：需要“阈值生成/冻结”的运维流程；跨赛季可比性需额外说明

### 方案 E：拆分为两条指标（“风险/技法” vs “复杂度/强度先验”）

如果你确实希望“预测排位分”，而技术值又希望保持“风险/风格提示”，那么建议拆成：

- `techRiskScore`：以控制/元叙事/越权等信号为主（更接近当前 tech 的初衷）
- `strengthPriorScore`：以结构/机制/规模等信号为主（用于“新卡强度直觉/匹配先验”）

优点：概念清晰、可解释性强；也更不容易“一个分数背负两种含义”  
缺点：产品与数据表需要新增字段，迁移成本更高

---

## 6. 推荐 v2 参数（可落地 & 可回滚）

### 6.1 v2 参数建议

在 `DEFAULT_TECH_INDEX_CONFIG` 基础上：

- `exploitBoost: 0`
- `caps.techDensityPer1kCharsCap: 30`

其余 cap 暂不动，先解决顶端拥挤。

### 6.2 v2 的量化收益（strict、minGames>=10，N=417）

- baseline：Spearman ≈ **0.524**；L5 ≈ **14.9%**；`tech=100` ≈ **1.4%**
- v2：Spearman ≈ **0.515**；L5 ≈ **3.8%**；`tech=100` ≈ **0%**

### 6.3 对榜单顶端（strict Top50）的改善

- baseline：Spearman ≈ **0.183**；L5 ≈ **54%**
- v2：Spearman ≈ **0.234**；L5 ≈ **18%**

---

## 7. 落地与回填建议（工程化）

### 7.1 版本化建议（避免口径漂移）

不要直接“覆盖”旧的 `tech_score/tech_level`（否则历史档案与用户认知会漂移），建议：

- 在 `data_card_metrics` 增加：
  - `tech_score_v2` / `tech_level_v2`
  - `details_json_v2`
  - `tech_version`（或分别记录 v1/v2）

并在 API 返回里增加 `metricsV2`，前端逐步切换展示/筛选口径。

### 7.2 回填策略

- 复用现有脚本 `scripts/backfill-data-card-tech-index.ts` 的框架
- 新增 `--version v2` / `--config preset` 之类参数：
  - v2 先仅回填 `public+approved characters`（收益最大、风险最小）
  - 观察分布与榜单效果后再全库重算

### 7.3 验收指标（上线前后对比）

至少监控这三类指标：

1) 顶端拥挤度：
   - strict/free Top50 的 `L5` 占比、`tech=100` 占比、Top50 的 uniqueScore 数
2) 相关性（作为“预测能力”替身）：
   - strict/free（minGames>=10、>=20）的 Spearman
3) 风险提示能力：
   - `kwExploit>0` 的命中率与误报反馈（如果改为标签/徽章，也要看点击/举报/投诉反馈）

---

## 8. 复现方式（在本仓库内）

前置：本地 `.env` 已配置 `CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID`。

### 8.1 分布与榜单顶端占比

- 直接用 SQL + `queryFromD1()` 统计（本文的数字来自此类查询）

### 8.2 相关性（现有脚本）

- strict/free 的抽样审计：`scripts/tech-index-strict-rating-audit.ts`
- 权重网格搜索：`scripts/tech-index-tune-strict-weights.ts`

### 8.3 v2 快速试算（建议做成脚本）

本文的 v2 试算是在本地用 `computeTechIndex(..., { exploitBoost:0, caps:{ techDensityPer1kCharsCap:30 } })` 进行对比计算。

