# 技术值（Tech Index）分布校准：填充 <10 区间并缓解 100 顶格（2026-02-05）

更新时间：2026-02-05  
数据来源：Cloudflare D1（`data_cards` / `data_card_metrics.details_json`）  
代码位置：`lib/metrics/techIndex.ts`  
关联文档：`docs/TECH_INDEX_RESEARCH_2026-02-04.md`、`docs/TECH_INDEX_USER_ANSWERS_STORAGE_IMPACT_2026-02-05.md`

目标：让技术值的 **0~9（<10）** 区间不再长期空置，同时缓解部分卡“顶格到 100”导致的区分度下降；并保持技术值稳定落在 **[0,100]**。

---

## 0. 结论先行（TL;DR）

### 0.1 现状核实：<10 区间存在长期空置风险

在现行 v1 算法下，全库角色卡的最小技术值曾出现过 `min=11` 的情况，导致 `<10` 区间长期空置（详见旧口径核实记录与 SQL 复现段落）。

与此同时，近期 `userAnswers` 的存储结构升级会系统性抬升技术值（不要求做 canonicalize 的前提下，我们只在“打分映射阶段”做校准），进一步放大 `<10` 空置的概率。

结论：需要一个**低侵入、可解释**的校准手段，把一部分“极低技术”卡拉回 `<10` 区间。

### 0.2 方案（推荐）：整体下移 `scoreShift=-10` + 输出限幅

在保持现有特征提取与加权合成不变的前提下，只在“最终分数落点”做一个 **整体下移校准**：

1) 先得到基础分（以及可选的风险加成）：

```
baseScore = round(100 * compositeScore)
rawScore = baseScore + (kwExploit>0 ? exploitBoost : 0)
```

2) 再做整体下移与限幅：

```
techScore = clamp(rawScore - scoreShift, 0, 100)
```

默认配置（已落地到代码默认配置）：

- `scoreShift = 10`（即整体 `-10`，低于 0 则钳制到 0）
- 保持 `exploitBoost = 10`（但由于我们在**最终落点**做校准，能显著缓解“加成 + 封顶”带来的 100 顶格堆叠）

这样做的直观效果：

- `<10` 会被填充：原本落在 `10~19` 的卡会落入 `0~9`（并保持不越界）
- `100` 顶格会减少：尤其是“因为 `exploitBoost` 被推到 100”的卡，不再集中在 100 上（区分度更好）
- 输出严格保持在 `[0,100]`

---

## 1. 为什么 <10 会空置：根因解释（算法角度）

现行技术值的主体是 5 个组件得分（均在 [0,1]）的加权和：

```
compositeScore =
  0.25 * scoreControl +
  0.05 * scoreMechanics +
  0.40 * scoreStructure +
  0.05 * scoreCode +
  0.25 * scoreSize
techScore = round(100 * compositeScore) + exploitBoost(可选)
```

其中 `scoreSize`、`scoreStructure` 在“正常数据卡”上很难接近 0（尤其角色卡通常至少有若干字段与一定文本），导致 `compositeScore` 的下界被“抬起来”，最终实际最小值停在 11 左右，使 0~9 无卡落入。

近期 `userAnswers` 新存储格式会进一步抬升部分卡的结构复杂度（详见另一份核实文档），从而增加 `<10` 空置的风险。

---

## 2. 为什么不采用“低分段压缩曲线”

先前文档里曾讨论过“只压低低分段、尽量不动中高分”的曲线方案，但它对另一个痛点——**部分卡顶格到 100**——帮助有限：

- 低分段曲线只能“把低分更低”，并不会直接减少高分段到达 100 的概率
- 反而整体下移 `-10` 同时对低分与高分都有效：既填充 `<10`，也能把一部分顶格卡从 100 拉回可区分的区间

因此本次选择更简单、效果更直接的 `scoreShift` 校准。

---

## 3. D1 核实 SQL（复现实验口径）

### 3.1 现状：<10 为空

```sql
SELECT
  COUNT(*) as total,
  MIN(dcm.tech_score) as minTech,
  SUM(CASE WHEN dcm.tech_score < 10 THEN 1 ELSE 0 END) as lt10,
  SUM(CASE WHEN dcm.tech_score < 15 THEN 1 ELSE 0 END) as lt15,
  SUM(CASE WHEN dcm.tech_score < 20 THEN 1 ELSE 0 END) as lt20,
  SUM(CASE WHEN dcm.tech_score < 25 THEN 1 ELSE 0 END) as lt25
FROM data_cards dc
JOIN data_card_metrics dcm ON dcm.data_card_id = dc.id
WHERE dc.type='character'
  AND dc.deleted_at IS NULL;
```

### 3.2 新口径等价重算（建议用脚本分页读取 details_json）

由于新算法只改变 `compositeScore -> techScore` 的映射（组件分不变），可以直接读取 `details_json.components` 做等价重算：

- `compositeScore = 0.25*c + 0.05*m + 0.40*s + 0.05*code + 0.25*size`
- `baseScore = round(100 * compositeScore)`
- `rawScore = baseScore + (kwExploit>0 ? exploitBoost : 0)`（`kwExploit` 可从 `details_json.raw.kwExploit` 获取）
- `techScore = clamp(rawScore - scoreShift, 0, 100)`

---

## 4. 落地与回填（很重要）

### 4.1 代码已更新

`lib/metrics/techIndex.ts` 已新增并启用默认配置：

- `scoreShift: 10`（最终分数整体下移 10，并在 `[0,100]` 限幅）

### 4.2 需要回填 data_card_metrics

注意：线上/数据库里现有 `data_card_metrics.tech_score` 不会自动因为“算法升级”而更新（目前 staleness 只看 `data_cards.updated_at`）。  
因此需要执行一次脚本回填（或在未来引入“算法版本号”做自动重算）。

推荐命令（谨慎在生产环境执行）：

```bash
bun scripts/backfill-data-card-tech-index.ts --force --type character
```

> 如果只想观察影响，可以先 `--dry-run`（但 dry-run 不会输出分布，需要配合额外统计脚本）。
