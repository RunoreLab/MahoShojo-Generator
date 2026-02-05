# 技术值（Tech Index）低分段区间（<10）校准：问题核实与算法调整（2026-02-05）

更新时间：2026-02-05  
数据来源：Cloudflare D1（`data_cards` / `data_card_metrics.details_json`）  
代码位置：`lib/metrics/techIndex.ts`  
关联文档：`docs/TECH_INDEX_RESEARCH_2026-02-04.md`、`docs/TECH_INDEX_USER_ANSWERS_STORAGE_IMPACT_2026-02-05.md`

目标：让技术值的 **0~9（<10）** 区间不再长期空置，同时保持技术值稳定落在 **[0,100]**，并尽量不扰动主分布（中位数/P90 等）。

---

## 0. 结论先行（TL;DR）

### 0.1 现状核实：<10 区间确实“全库空置”

统计时间：2026-02-05（本机执行）  
统计对象：`type='character' AND deleted_at IS NULL`

现行算法（旧口径）下：

- `min(tech_score)=11`
- `<10`：**0 张**
- `<15`：**6 张**
- `<20`：**19 张**
- `<25`：**约 40 张**

结论：**L0（<10）在实际数据中完全不触发**，这个区间等于被浪费。

### 0.2 方案：只对“低分段”做曲线压缩（不动中高分）

在 `computeTechIndex` 的“组件加权合成得到 compositeScore”之后，新增一个“低分段压缩曲线（lowEndCurve）”：

- 当 `compositeScore <= pivot` 时：`f(s) = pivot * (s / pivot) ^ gamma`
- 当 `compositeScore > pivot` 时：`f(s) = s`（完全不改）

默认参数（已落地到代码默认配置）：

- `pivot = 0.4`
- `gamma = 8`

性质：

- 输出严格保持在 `[0,1]`（进而 `techScore` 保持在 `[0,100]`）
- `f(pivot)=pivot`，且 **只会压低** 低分段（不会抬高任何卡）
- 由于仅影响 `compositeScore<0.4` 的卡，整体分布基本不动

### 0.3 影响评估（基于 D1 已落库的组件分等价重算）

使用 `data_card_metrics.details_json` 中保存的组件分（`scoreControl/scoreStructure/...`）按新曲线“等价重算”：

- `<10`：**≈ 200 张**（从 0 变为“有一定数量”）
- `min`：**11 → 0**
- `max`：保持 **100**
- 受影响的卡数量：**≈ 800 张**（仅占全库角色卡约 4%）
- `P50 / P90`：保持不变（实测仍为 50 / 63）
- mean：仅小幅下降（约 -0.6 分）

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

近期 `userAnswers` 新存储格式会进一步抬升部分卡的结构复杂度（详见另一份核实文档），但这不是 <10 空置的唯一原因：**即便不考虑问卷问题文本，旧口径也已经没有 <10。**

---

## 2. 低分段压缩曲线（lowEndCurve）设计说明

### 2.1 公式与直觉

对低分段使用幂函数压缩：

- `pivot` 控制“从哪开始不动”：`compositeScore >= pivot` 完全保持原值
- `gamma` 控制“压缩力度”：越大，越会把接近 0 的分数压向 0

这相当于“把本来挤在 10~40 的少量低分卡，向 0~20 拉开”，从而腾出并填充 <10 区间，同时避免破坏中高分段的可读性。

### 2.2 为什么选 pivot=0.4

实测全库角色卡中，`techScore < 40` 的占比很小（约几个百分点）。  
因此把 pivot 定在 0.4，天然做到：

- 只影响少量卡（主要是最简单/最短/结构最薄的卡）
- 榜单与大多数卡的技术值不变（更符合“轻量修补”的目标）

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
- `techScore = round(100 * lowEndCurve(compositeScore))`
- `kwExploit>0` 仍保留原有 `exploitBoost`

---

## 4. 落地与回填（很重要）

### 4.1 代码已更新

`lib/metrics/techIndex.ts` 已新增并启用默认配置：

- `lowEndCurve: { pivot: 0.4, gamma: 8 }`

### 4.2 需要回填 data_card_metrics

注意：线上/数据库里现有 `data_card_metrics.tech_score` 不会自动因为“算法升级”而更新（目前 staleness 只看 `data_cards.updated_at`）。  
因此需要执行一次脚本回填（或在未来引入“算法版本号”做自动重算）。

推荐命令（谨慎在生产环境执行）：

```bash
bun scripts/backfill-data-card-tech-index.ts --force --type character
```

> 如果只想观察影响，可以先 `--dry-run`（但 dry-run 不会输出分布，需要配合额外统计脚本）。

