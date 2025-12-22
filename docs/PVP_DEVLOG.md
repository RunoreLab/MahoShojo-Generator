# PVP 开发备忘（实现记录）

更新时间：2025-12-22

> 本文用于记录实现细节、落地偏差与后续 TODO；设计稿请看 `docs/PVP.md`。

## 0.1 变更记录（最近）

- 2025-12-22：choosing 阶段若手牌尚未发放/同步，出牌区域显示“发牌中…”加载提示（不再无提示/仅提示刷新）。
- 2025-12-22：房间写入接口发生 `VERSION_CONFLICT` 时，UI 展示 3 秒倒计时并自动刷新重试（减少手动刷新成本）。

## 0. 当前实现范围（MVP）

- 2-6 人房间（同局同时出牌）
- D1 持久化 + 前端轮询（React Query `refetchInterval=1500ms`）
- 流程：创建房间 → 加入 → 提交卡组 → 房主发牌 → 同时出牌 → 自动/手动结算（生成战报）→（可选）多轮直到 `maxRounds`
- 结算调用：复用现有非流式端点 `POST /api/generate-battle-story`（并显式关闭 arena_history / current_state 的读写）
- 多局制配置：大厅创建房间可启用/设置；房间内（房主）可在 `waiting/submitting` 阶段调整规则
- 结算推进策略：生成战报后进入 `reviewing`，只有全员“确认已阅读”后才推进下一回合或结束
- 新增房间规则：
  - `showAllSubmissions`：是否显示所有人提交的卡组详情（默认 true；但在 `submitting` 提交阶段强制隐藏他人详情，仅展示提交进度；开始对局后再按该开关决定是否可查看）
  - `shuffleDecks`：是否合池洗混后发牌（默认 true；关闭时每位玩家仅从自己提交的卡组中按提交顺序抽取手牌）
- 大厅“创建房间”规则设置已用 localStorage 持久化（与竞技场类似的 zustand persist）：`pvp-lobby-storage`

## 1. 关键工程决策

### 1.1 “手牌不可推导”约束

如果“提交数 == 发牌数”，玩家拿到自己的手牌后可用补集直接推导对手手牌集合，信息博弈失效。

因此在规则校验中强制：
- `cardsPerPlayer > dealPerPlayer`

默认规则：
- `cardsPerPlayer=4`，`dealPerPlayer=3`

### 1.2 卡可用性过滤（你确认的口径）

PVP 可用卡必须满足：
- `deleted_at IS NULL`
- `review_status IN ('approved','pending')`
- `is_public != -1`（卡被封禁）
- `rejected` 禁用
- 作者 `users.is_banned` 为空（简化处理：非空即封禁）
- 权限：`dc.user_id = requestUserId OR dc.is_public = 1`

实现点：
- 统一封装在 `lib/database/pvp.ts` 的 `getPvpEligibleDataCard`

### 1.3 私有卡披露确认（含提交阶段隐藏）

你要求：私有卡提交后对手可查看完整 JSON（全量设定），但为公平性在提交阶段强制隐藏他人卡组详情。

实现：
- 前端：提交区显式文案 + 勾选确认
- 后端：`submit` 要求 `acceptPrivateDisclosure=true`（当提交包含私有卡时）

### 1.4 房间口令存储

- 默认不需要口令
- 房主可按需设置/清空
- 仅 `waiting/submitting` 可修改，`choosing/resolving` 禁止改

存储：
- `pvp_rooms.join_code_hash` / `join_code_salt`（SHA-256）
- 不保存明文口令

## 2. 代码落地点（索引）

### 2.1 D1 Schema
- `lib/database/schema.sql:1`（已追加 `pvp_*` 表）
  - 机器人不新增表/列：仅作为房间内的临时设置写入 `pvp_rooms.rules_json`（服务端私有字段）

### 2.2 数据库访问层
- `lib/database/pvp.ts:1`
- `lib/d1.ts:1`（re-export）

### 2.3 PVP 服务器工具
- `lib/pvp/server.ts:1`（鉴权/JSON）
- `lib/pvp/crypto.ts:1`（口令 hash + 常量时间比较）
- `lib/pvp/validate.ts:1`（规则校验，强制 `cardsPerPlayer > dealPerPlayer`）
 - `lib/pvp/logic.ts:1`（发牌/赢家归一化）
 - `lib/pvp/bot/*`（机器人策略与出牌逻辑）

### 2.4 API 路由（Edge Runtime）
- `pages/api/pvp/rooms/index.ts:1` 创建房间
- `pages/api/pvp/rooms/[roomId]/join.ts:1` 加入房间（`expectedVersion` 可不传）
- `pages/api/pvp/rooms/[roomId]/rules.ts:1` 房主设置房间规则（仅 `waiting/submitting`；修改提交数可能要求清空已提交卡组）
- `pages/api/pvp/rooms/[roomId]/password.ts:1` 房主设/清口令
- `pages/api/pvp/rooms/[roomId]/leave.ts:1` 离开房间
- `pages/api/pvp/rooms/[roomId]/restart.ts:1` 房主重开（清理对局数据）
- `pages/api/pvp/rooms/[roomId]/kick.ts:1` 房主踢人
- `pages/api/pvp/rooms/[roomId]/bots/add.ts:1` 房主添加机器人（自动提交卡组/自动出牌）
- `pages/api/pvp/rooms/[roomId]/bots/add.ts:1` 房主添加机器人（写入 rules_json 临时配置；自动提交卡组/自动出牌）
- `pages/api/pvp/rooms/[roomId]/bots/remove.ts:1` 房主移除机器人
- `pages/api/pvp/rooms/[roomId]/submit.ts:1` 提交卡组
- `pages/api/pvp/rooms/[roomId]/start.ts:1` 房主发牌并创建首轮
- `pages/api/pvp/rooms/[roomId]/permissions.ts:1` 房主设置：是否允许其他玩家调整 AI 设置并结算
- `pages/api/pvp/rooms/[roomId]/index.ts:1` 拉取房间状态（按身份过滤手牌）
- `pages/api/pvp/rooms/[roomId]/rounds/[roundId]/choose.ts:1` 出牌
- `pages/api/pvp/rooms/[roomId]/rounds/[roundId]/resolve.ts:1` 结算回合（生成战报，幂等；默认仅房主可结算）

> 备注：Pages Router 的 Edge API 动态路由未稳定提供 `params`，所以使用 `lib/pvp/route.ts` 从 `req.url` 解析 `roomId/roundId`。

### 2.5 前端页面
- `pages/pvp.tsx:1` 大厅
- `pages/pvp/[roomId].tsx:1` 房间页
- `components/pvp/PvpLobbyPage.tsx:1`
- `components/pvp/PvpRoomPage.tsx:1`
- `pages/me.tsx:1` 个人页（战报记录 / PVP 战绩，提示“可能被清理”）

### 2.6 统计/战绩接口
- `pages/api/pvp/users/summary.ts:1` 房间内查询玩家简要战绩（wins/losses/draws）
- `pages/api/me/battle-reports.ts:1` 我的战报记录列表
- `pages/api/me/battle-reports/[generationId]/regenerate.ts:1` 根据记录重生战报（尽力复现）
- `pages/api/me/pvp.ts:1` 我的 PVP 战绩 + 最近对局

## 3. 运行与迁移提示

### 3.1 本地开发
- `bun run dev`
- 打开 `/pvp`

### 3.2 D1 表迁移
`lib/database/schema.sql` 只是“目标结构”，线上 D1 需要实际执行建表语句（具体方式取决于你当前的 wrangler / 管理脚本流程）。

## 4. 已知限制 / TODO

- 已支持“全员都已选则自动结算（幂等）”：当房主结算/或房主允许其他玩家结算时，出牌接口会尝试自动触发结算；仍保留手动结算按钮作为兜底
- 暂未做观战视角
- 已串联“战报生成记录 ↔ PVP”：`resolve` 会把 `POST /api/generate-battle-story` 返回的 `generationId` 写入 `pvp_rounds.battle_generation_id`；同时生成端点支持 `pvpContext` 并写入 `battle_report_generations.pvp_*` 字段（注意：线上 D1 仍需执行迁移）
- 暂未提供“对战历史/复盘/排行”的独立页面与 API（虽然 `pvp_matches` / `pvp_rounds` 已可持久化承载）
- 暂未做“阶段超时/自动中止”的规则与 UI（目前仅有 `expires_at` 的房间过期懒清理）
- `scenario` 模式尚未引入“情景选择/抽取与透传”，当前仅透传 `mode` 给战报生成端点（体验与规则需进一步定义）
- 目前 UI 的“卡选择器”是最小可用版本（列表 + 选择），后续可复用现有卡牌组件做更美观的卡片式选择

## 5. 后续开发建议（优先级）

### P1：可复盘与可运营（强烈建议先做）
- **对战历史（Match/Round）查询 API**：按 `userId` 列表、按 `matchId` 详情；与 `battle_report_generations` 的 `pvp_*` 字段联动（用于排查失败、风控、统计）
- **PVP 历史 UI**：用户个人战绩页（最近 N 场、胜负/比分、回合战报）；房间页可快捷跳转到当前 match 的详情
- **迁移落地流程**：把 `lib/database/schema.sql` 的新增列/索引在实际 D1 环境执行，并补一份“上线迁移 checklist”（避免“代码已写但线上缺列”）

### P2：玩法与体验增强（可并行推进）
- **观战视角**：允许只读访问 `finished`（或 `aborted`）后的公开区与战报，不暴露任何手牌/选择
- **阶段超时与中止规则**：`submitting/choosing/resolving` 超时策略 + 懒清理/房主一键结束
- **Scenario 模式**：明确情景来源与公开范围，透传 `scenario`（及来源信息）给战报生成端点

### P3：实时性与更强一致性（成本更高）
- 将轮询升级为 SSE / Durable Objects（房间级广播），减少延迟与请求量，并提升状态一致性
