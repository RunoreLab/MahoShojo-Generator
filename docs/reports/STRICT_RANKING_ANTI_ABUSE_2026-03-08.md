# 严格排位反刷分策略（2026-03-08）

## 1. 背景

严格排位当前已不再依赖“随机匹配票据”，而是采用“自选对手 + 服务端资格校验 + 结算时二次校验”的模式。

在这种模式下，重复挑战同一名对手的门槛更低，因此必须在 **不显著增加 D1 热路径读写成本** 的前提下，降低以下风险：

- 同一对手短时间连刷
- 同一对手跨时间窗反复互刷
- 新号 / 低局数账号通过熟人快速定级
- 用户以高频生成数量占满 strict 榜单曝光与涨分空间

## 2. 现行规则

### 2.1 strict 基础限制

- strict 仍然要求登录
- strict 仍然要求满足赛季 / 语言 / 引导 / 上下文读取等资格限制
- strict 结算继续复用 `arena_rating_events` 作为幂等、审计与风控依据

### 2.2 strict 反刷分规则

截至 2026-03-08，生产实现采用以下阈值：

- **每日计分上限：20 局**
- **同一对手组合冷却窗：360 分钟**
- **同一对手组合每日最多计 2 局**
- **低局数额外分差保护**：若进入 `strict-out-of-range` 检查，且任一方 strict 对局数 `< 10`，则允许分差上限进一步收紧到 `400`

### 2.3 free 队列

- free 仍使用弱风控
- 当前继续沿用 `ip_anonymized + pair_key + 时间窗` 的重复对局去重

## 3. 为什么这样设计

### 3.1 控制数据库成本

本轮策略优先复用现有表与索引：

- `arena_rating_events(user_id, pair_key, created_at)`
- `arena_rating_events(user_id, queue, status, created_at)`

因此可以做到：

- 不新增热路径写入
- 不新增风控缓存表
- 不引入额外事务
- 大多数新增判断只是在现有查询上补充聚合字段

### 3.2 为什么是“20 / 360 分钟 / 2 局”

- `20 局/日`：足以保留正常活跃用户的体验，同时显著压低纯刷量收益
- `360 分钟`：对“短时间二人互刷”足够严格，也能减少玩家“打一局就换标题继续刷”的试探空间
- `同组合每日 2 局`：允许合理 rematch，但不允许同一 pair 成为全天主要涨分来源

### 3.3 为什么要加“低局数额外分差保护”

现有 strict 已有分差检查，但对低局数账号仍可能出现：

- 熟人拿大号给新号喂分
- 新号在很少样本下快速冲到不稳定分段

因此本次不是引入新的复杂算法，而是在 **已有分差检查触发时**，对低局数场景再做一次保守收紧。

## 4. 实现口径

### 4.1 pair_key 仍然必须无序归一

- `entity_key = "${entity_type}:${entity_id}"`
- `pair_key = sort([entityKeyA, entityKeyB]).join('|')`

这样可以保证：

- `A vs B`
- `B vs A`

会命中同一条风控记录。

### 4.2 双阶段校验

当前 strict 风控必须同时存在于两个阶段：

1. **预检阶段**
   - 用于在开打前提示玩家“这一局是否可计 strict”
   - 应尽量给出明确原因，如冷却期、同组合日上限、strict 总日上限、分差过大

2. **结算阶段**
   - 作为最终兜底
   - 避免绕过前端或在生成期间状态变化后仍被错误计分

### 4.3 skip reason 约定

本轮新增 / 强化的 strict skip reason：

- `dedup-user-pair`
- `pair-daily-limit`
- `daily-limit`
- `strict-out-of-range`

前端展示应尽量收敛为清晰提示，避免玩家把“未计分”误解为系统故障。

## 5. 代码落点

当前实现主要位于以下文件：

- `lib/database/arena-ratings.ts`
- `lib/db/repositories/arena-ratings-write.ts`
- `pages/api/arena/strict-preflight.ts`
- `components/arena/components/RankingQuickActions.tsx`
- `components/arena/components/CombatantList.tsx`
- `components/ranking/RankedMatchReportPanel.tsx`

## 6. 后续建议

本轮不进入热路径、但建议后续补上的离线审计：

- 每日扫描 `arena_rating_events`
- 识别“某用户对局是否过度集中在少数 pair”
- 识别“某 pair 是否存在异常高频互打”
- 识别“明显 reciprocal win-trading”

若后续确实需要升级风控，建议优先顺序为：

1. 离线审计与人工复核
2. 封禁 / 清分 / 标记异常账号
3. 必要时再引入更重的在线风控

不建议在没有充分误伤评估之前，直接上：

- 强 IP 封禁
- 复杂衰减公式
- 多维实时风控评分

## 7. 变更摘要

本次策略调整的目标不是“把 strict 变得更难玩”，而是：

- 保留正常对战体验
- 明确限制重复刷分收益
- 尽量不增加数据库热路径成本
- 保持规则对玩家可解释
