# 命名规范化分支对比评估（2026-03-01）

## 1. 评估对象

- `feature/v0.2.0_Battle_Growth_MahoShojo`（Mapper 化）
- `style/命名分层统一化`（全局命名收敛）

## 2. 评估方法与实测口径

1. 以共同祖先提交 `e4c79f6a20e0e79b956ee4ec6107557c54c3fdb0` 为基线做分支差异统计。
2. 对关键命名兼容路径做代码抽样（问卷数据卡解析、Deck/DataCard 状态、边界 mapper 落点）。
3. 两个分支分别实测质量门禁：
   - `bun run lint`
   - `bun test`
   - `bun run build`

## 3. 事实对比

### 3.1 变更规模

- 提交分叉：`feature 17` vs `style 21`（`git rev-list --left-right --count`）。
- 相对共同祖先改动量：
  - `feature`：`57 files changed, +2301/-736`
  - `style`：`145 files changed, +6041/-1830`
- 结论：`style` 爆炸半径约为 `feature` 的 2.5x。

### 3.2 质量门禁

两分支均通过：
- `bun run lint`
- `bun test`
- `bun run build`

补充差异：
- `feature`：`bun test` 为 `497 pass / 0 fail`。
- `style`：`bun test` 为 `482 pass / 0 fail`。
- `style` 的 `lint` 会额外运行 `check:naming`，当前仍有 report-only 审计项（本次实测输出 7 条）。

### 3.3 设计策略差异

1. `feature` 更偏“边界集中映射”
- 新增集中 mapper 与状态工具：
  - `lib/data-card-read-mappers.ts`
  - `lib/deck-read-mappers.ts`
  - `lib/deck-client-mappers.ts`
  - `lib/deck-write-mappers.ts`
  - `lib/db/repositories/arena-read-mappers.ts`
  - `lib/deck-status.ts`
- 对应补了专门回归测试（如 `tests/questionnaire-data-card-payload.test.ts`、`tests/deck-*.test.ts`）。

2. `style` 更偏“全局替换 + 多点收敛”
- 覆盖面非常广，触及大量 `pages/api/pvp/**`、`lib/database/**`、`lib/db/repositories/**`。
- 引入了命名检查器与迁移脚本：
  - `scripts/check-naming-conventions.mjs`
  - `scripts/migrate-snake-members-to-camel.mjs`

## 4. 关键风险证据（决定性）

### 4.1 `style` 分支在问卷数据卡解析上出现“去中心化回归”

`feature` 的统一解析函数支持 `data/dataJson/data_json/dataJSON` 四种输入：
- `lib/questionnaires.ts:177-215`
- 覆盖测试：`tests/questionnaire-data-card-payload.test.ts:6-49`

但 `style` 删除了该统一函数（见 `style/命名分层统一化:lib/questionnaires.ts:177` 开始已直接进入其他逻辑），并在 4 处手写解析，且都写成：
- `card?.data ?? card?.dataJson ?? card?.dataJson ?? card?.dataJSON ?? null`

证据位置：
- `style/命名分层统一化:pages/details.tsx:790`
- `style/命名分层统一化:pages/canshou.tsx:694`
- `style/命名分层统一化:pages/sublimation.tsx:732`
- `style/命名分层统一化:components/arena/components/QuestionnaireLorePanel.tsx:29`

该写法重复 `dataJson`、漏掉 `data_json`，会直接影响历史卡兼容读取。

### 4.2 `style` 分支自身文档已记录多轮“命名迁移引发回归”

`style` 分支内文档明确记录了“调用层先改 camel、边界未收敛导致回归”：
- `style/命名分层统一化:docs/NAMING_COMPAT_REGRESSION_FIX_2026-03-01.md:5-27`
- `style/命名分层统一化:docs/NAMING_COMPAT_REGRESSION_FIX_2026-03-01_SESSION2.md:5-23`

同时其合并评估文档本身也给出“不建议整分支一次性并线”：
- `style/命名分层统一化:docs/NAMING_UNIFICATION_BRANCH_MERGE_ASSESSMENT_2026-03-01.md:51-53`
- `style/命名分层统一化:docs/NAMING_UNIFICATION_BRANCH_MERGE_ASSESSMENT_2026-03-01.md:85-86`

## 5. 结论

从“稳定性优先 + 边界映射优先 + 与当前项目命名策略一致”三个维度看，**`feature/v0.2.0_Battle_Growth_MahoShojo` 的做法更好，更适合作为主并线基线**。

原因：
1. 变更面更可控，回归定位成本显著更低。
2. Mapper 设计更集中，减少跨页面重复兼容代码。
3. 对历史协议字段（尤其内容层）兼容处理更完整，且有针对性测试支撑。
4. `style` 虽有治理价值，但当前分支形态存在“大范围改动 + 多轮回归修复”的客观事实，不适合直接整分支并入。

## 6. 建议落地方案（推荐）

1. 以 `feature` 作为主线并线。
2. 从 `style` 选择性吸收“护栏能力”，不要整分支硬并：
   - 吸收 `scripts/check-naming-conventions.mjs`，先保持 `report-only` 为主。
   - 吸收已证明安全的边界 mapper 测试（逐文件挑拣）。
3. 禁止直接使用 `scripts/migrate-snake-members-to-camel.mjs` 做全量盲改。
4. 后续命名治理按业务域拆小批次（每批可回滚），优先顺序：
   - 先规则/测试
   - 再低耦合模块
   - 最后 PVP 核心链路

## 7. 最终建议（给决策）

**选择 `feature/v0.2.0_Battle_Growth_MahoShojo` 作为更优方案。**

`style/命名分层统一化` 不建议整体并入；建议作为“规则与局部改进素材库”，按小批次、可回滚方式择优吸收。
