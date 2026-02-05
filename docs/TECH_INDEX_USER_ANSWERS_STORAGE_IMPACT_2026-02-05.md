# 问卷答案新存储格式对技术值（Tech Index）的抬升效应核实与建议（2026-02-05）

更新时间：2026-02-05  
数据来源：Cloudflare D1（`data_cards` / `data_card_metrics`）  
关联文档：`docs/TECH_INDEX_RESEARCH_2026-02-04.md`

背景：近期问卷生成角色卡的 `userAnswers` 从旧版的“答案字符串数组（`string[]`）”升级为“问题 + 答案对象数组（`Array<{question, answer, ...}>`）”，以便在卡内完整保留问卷回顾信息。  
问题：`Tech Index` 目前直接对整份 data JSON 做结构/文本特征提取，因此这种“存储结构变更”会被误判为“更技术”，导致 **普通角色卡的技术值被系统性抬高**，并出现与旧卡不可比的口径断点。

> 本文仅讨论“技术值口径与算法鲁棒性”，不讨论是否要回退 `userAnswers` 的存储设计（保留问卷回顾对产品体验是正向的）。

---

## 0. TL;DR（结论先行）

截至 2026-02-05，在 D1 中共发现 **322 张**满足以下条件的角色卡：

- `type='character'`
- `deleted_at IS NULL`
- `json_type(data,'$.userAnswers')='array' AND json_type(data,'$.userAnswers[0]')='object'`

对这 322 张卡做“同卡对照”计算（只改变 `userAnswers` 的表示形式，不改其它字段）后，结论如下：

1) **总体抬升幅度显著**  
将 `userAnswers` 规范化为“仅答案字符串数组（answersOnly）”后：

- techScore：mean **60.12 → 53.91（-6.21）**
- P50：**-6**；P90：**-11**；max：**-26**

2) **抬升的主要来源是“结构复杂度”，不是问题文本本身**  
把抬升拆分为两段（同样是对同一批 322 张卡的对照）：

- 仅去掉问题文本但保留对象结构（`dropQuestionTextKeepStructure`）：mean **-1.34**（P50=-1，P90=-4，max=-7）
- 再把对象结构扁平为答案字符串数组（`answersOnlyStringArray`）：mean **-4.87**（P50=-4，P90≈-8.9，max=-26）

=> 约 **1/4** 的抬升来自“问题文本”，约 **3/4** 来自“对象数组导致的结构膨胀（keys/nodes）”。

3) **techLevel 阈值被明显推高（约 30% 卡发生等级抬升）**  
以当前阈值（L4>=60，L5>=80）计：

- base：L2=2 / L3=177 / L4=129 / L5=14
- answersOnly：L2=5 / L3=265 / L4=43 / L5=9
- techLevel 被抬高：**97/322（30.1%）**（无“被压低”的反向案例）

---

## 1. 为什么会抬分：机制解释（对照现有实现）

技术值算法位置：`lib/metrics/techIndex.ts`

核心点：`computeTechIndex` 会遍历整份 JSON：

- **结构特征**：`jsonTotalKeys/jsonTotalNodes/jsonUniqueKeyCount/jsonMaxArrayLen/...`（构成 `scoreStructure`，权重 40%）
- **文本特征**：遍历遇到的字符串内容，拼成 `textBlob`，抽取关键词/布局（构成 `scoreControl/scoreCode/...`）
- **规模特征**：`jsonStringCharsTotal`（构成 `scoreSize`，权重 25%）

新版 `userAnswers` 由：

- 旧版：`userAnswers: string[]`
- 新版：`userAnswers: Array<{ question: string; answer: string; ... }>`

带来的“非语义变化”包括：

- 每个答案项从“1 个 string node”变成“1 个 object node + 若干 string node + 若干 key”
- 总 keys/nodes/uniqueKeys 增加明显（直接抬高 `scoreStructure`）
- 问题文本被纳入字符串总量（抬高 `scoreSize`，并轻微影响 `scoreControl`）

结论：即使角色卡内容质量/强度不变，只要把答案从 `string[]` 换成 `[{question, answer}]`，`Tech Index` 就会把它识别成“更复杂、更技术”。

---

## 2. D1 核实：口径、SQL 与对照实验定义

### 2.1 新版卡识别条件（统计口径）

```sql
SELECT COUNT(*) as n
FROM data_cards
WHERE type='character'
  AND deleted_at IS NULL
  AND json_type(data, '$.userAnswers')='array'
  AND json_type(data, '$.userAnswers[0]')='object';
```

结果：**n=322**（截至 2026-02-05，本机执行）。

### 2.2 对照实验的“规范化视图”（只用于计算，不改存储）

对每张卡的 `data` JSON 分别计算三次 techScore：

- **base**：原始 data
- **dropQ**：保持 `userAnswers` 的对象数组结构不变，但把每项 `question` 置空（仅移除问题文本）
- **answersOnly**：把 `userAnswers` 扁平化为 `string[]`，仅保留 `answer/value` 文本（尽量语义等价，移除结构 + 问题文本）

> 注：`computeTechIndex` 当前不支持“按路径忽略结构计数”，因此这里使用“输入规范化”作为对照手段与未来落地候选方案。

---

## 3. 结果：对 322 张新版卡的完整对照统计

### 3.1 techScore 分布（N=322）

| 指标 | base | dropQ（仅去问题文本） | answersOnly（仅保留答案字符串） |
| --- | ---: | ---: | ---: |
| mean | 60.12 | 58.78 | 53.91 |
| P50 | 58 | 57 | 52.5 |
| P75 | 64 | 63 | 57 |
| P90 | 72 | 72 | 63 |
| max | 97 | 97 | 85 |
| min | 39 | 39 | 34 |

### 3.2 抬升拆分（N=322）

| 对照 | mean | P50 | P90 | max |
| --- | ---: | ---: | ---: | ---: |
| base - dropQ | 1.34 | 1 | 4 | 7 |
| dropQ - answersOnly | 4.87 | 4 | 8.9 | 26 |
| base - answersOnly | 6.21 | 6 | 11 | 26 |

解读：**结构膨胀贡献更大**（约 4.87 分），问题文本本身的贡献相对较小（约 1.34 分）。

### 3.3 techLevel 变化（N=322）

techLevel 计数：

- base：L2=2 / L3=177 / L4=129 / L5=14
- answersOnly：L2=5 / L3=265 / L4=43 / L5=9

techLevel 对照（base 相对 answersOnly）：

- 相同：225
- 被抬高：97
- 被压低：0

---

## 4. 影响评估（为什么这会变成“普通卡也很技术”）

1) **口径断点：同一语义内容在新旧卡之间不可比**  
旧卡以 `string[]` 存储、结构轻；新卡以对象数组存储、结构重；`Tech Index` 本质上在给“存储结构复杂度”打分。

2) **阈值效应：-6 分左右足以让大量卡跨过 L4(60) 门槛**  
对 322 张新版卡而言，约 30% 卡的 techLevel 会因为这一表示法而抬升，常见路径是 **L3 → L4**。

3) **长期趋势：随着新版卡数量增长，全库 techScore 分布会整体右移**  
即便算法不变，指标分布也会被“数据表示变化”持续推高，导致：

- 技术值标签的区分度下降（更多卡堆在 L4/L5）
- 与排位分/强度的统计关系被引入额外噪声（因为引入了非语义变量）

---

## 5. 调整建议（按侵入性从低到高）

### 方案 A（推荐，最小侵入）：技术值计算前对输入做 canonicalize（仅用于计分）

思路：保留新版 `userAnswers` 的存储格式不变，但在计算 techScore 前，把它规范化为稳定视图（例如 `string[]` 的 answersOnly），避免结构变化导致的抬分。

建议规则（与本文对照一致）：

- `userAnswers` 无论是 `string[]`、对象数组、还是 record，都统一转换为 `string[]`（只取 `answer/value`）
- 可选：保留一个 `userAnswersText`（拼接后的纯文本）用于关键词/风险扫描，但不让对象结构参与 `scoreStructure`

优点：

- 不影响产品功能与数据存储
- 能让新旧卡的 techScore 更可比
- 改动面可控：只影响“计算 techScore 的入口”（写入 `data_card_metrics` 的链路）

注意点：

- 如果有人在问题文本里写入“越狱/控制词”，dropQ 会降低这部分信号；可以把“风险扫描（kwExploit/注入词）”独立出来，避免与 techScore 强耦合（见方案 C）。

### 方案 B：让 `userAnswers` 只贡献文本，不贡献结构

思路：改造 `extractTextAndStructure`，引入 path-aware 策略：对 `userAnswers` 路径下的数据只 `pushText()`，不累加 `jsonTotalKeys/jsonTotalNodes/jsonUniqueKeyCount/...`。

优点：

- 更贴近直觉：问卷内容是“语义上下文”，而不是“提示词工程结构”

成本：

- 需要修改特征提取器的遍历逻辑与测试（影响面比方案 A 更大）

### 方案 C：拆分“技术值”与“风险值”（概念清晰，但需要产品配合）

思路：

- `techScore` 专注于“提示词工程密度/格式复杂度/结构复杂度（可解释）”
- `riskScore` 专注于注入/越权/战报控制等风险信号（例如当前的 `kwExploit`）

优点：

- 避免把“风险信号”与“技术值”混在一起（例如当前 `exploitBoost=+10` 的阈值效应）

成本：

- 需要同步排行榜标签、UI 文案、以及数据回填策略

---

## 6. 如果决定改：推荐的落地步骤（工程化清单）

1) 新增一个“techIndex 视图”规范化函数（例如 `normalizeDataCardForTechIndex`），实现 `userAnswers` 的 answersOnly 扁平化  
2) 在写入 `data_card_metrics` 的链路统一调用该规范化视图（包括 API 与 backfill 脚本）  
3) 对历史数据做一次 backfill 重算（至少覆盖 `userAnswers=array<object>` 的 322 张卡）  
4) 增加回归测试：同一份答案以 `string[]` 与 `[{question, answer}]` 两种形式输入时，techScore 差异应接近 0（或小于约定阈值）  
5) 更新百科/说明：明确 techIndex 的口径（`userAnswers` 是否参与结构计分）与版本变更点

