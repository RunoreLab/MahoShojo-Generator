# PVP 开发备忘（实现记录）

更新时间：2025-12-21

> 本文用于记录实现细节、落地偏差与后续 TODO；设计稿请看 `docs/PVP.md`。

## 0. 当前实现范围（MVP）

- 2 人房间
- D1 持久化 + 前端轮询（React Query `refetchInterval=1500ms`）
- 流程：创建房间 → 加入 → 提交卡组 → 房主发牌 → 同时出牌 → 房主结算（生成战报）→（可选）多轮直到 `maxRounds`
- 结算调用：复用现有非流式端点 `POST /api/generate-battle-story`（并显式关闭 arena_history / current_state 的读写）

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

### 1.3 私有卡披露确认

你要求：私有卡提交后对手可查看完整 JSON（全量设定）。

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

### 2.2 数据库访问层
- `lib/database/pvp.ts:1`
- `lib/d1.ts:1`（re-export）

### 2.3 PVP 服务器工具
- `lib/pvp/server.ts:1`（鉴权/JSON）
- `lib/pvp/crypto.ts:1`（口令 hash + 常量时间比较）
- `lib/pvp/validate.ts:1`（规则校验，强制 `cardsPerPlayer > dealPerPlayer`）
- `lib/pvp/logic.ts:1`（发牌/赢家归一化）

### 2.4 API 路由（Edge Runtime）
- `pages/api/pvp/rooms/index.ts:1` 创建房间
- `pages/api/pvp/rooms/[roomId]/join.ts:1` 加入房间（`expectedVersion` 可不传）
- `pages/api/pvp/rooms/[roomId]/password.ts:1` 房主设/清口令
- `pages/api/pvp/rooms/[roomId]/leave.ts:1` 离开房间
- `pages/api/pvp/rooms/[roomId]/restart.ts:1` 房主重开（清理对局数据）
- `pages/api/pvp/rooms/[roomId]/kick.ts:1` 房主踢人
- `pages/api/pvp/rooms/[roomId]/submit.ts:1` 提交卡组
- `pages/api/pvp/rooms/[roomId]/start.ts:1` 房主发牌并创建首轮
- `pages/api/pvp/rooms/[roomId]/index.ts:1` 拉取房间状态（按身份过滤手牌）
- `pages/api/pvp/rooms/[roomId]/rounds/[roundId]/choose.ts:1` 出牌
- `pages/api/pvp/rooms/[roomId]/rounds/[roundId]/resolve.ts:1` 任一玩家可结算（生成战报，幂等）

> 备注：Pages Router 的 Edge API 动态路由未稳定提供 `params`，所以使用 `lib/pvp/route.ts` 从 `req.url` 解析 `roomId/roundId`。

### 2.5 前端页面
- `pages/pvp.tsx:1` 大厅
- `pages/pvp/[roomId].tsx:1` 房间页
- `components/pvp/PvpLobbyPage.tsx:1`
- `components/pvp/PvpRoomPage.tsx:1`

## 3. 运行与迁移提示

### 3.1 本地开发
- `bun run dev`
- 打开 `/pvp`

### 3.2 D1 表迁移
`lib/database/schema.sql` 只是“目标结构”，线上 D1 需要实际执行建表语句（具体方式取决于你当前的 wrangler / 管理脚本流程）。

## 4. 已知限制 / TODO

- 目前 `resolve` 仅房主可点；未来可改成“双方都已选则自动结算（幂等）”
- 暂未做观战视角
- 暂未做“重开一局/清空房间”的管理按钮
- `pvp_rounds.battle_generation_id` 暂未串联（`/api/generate-battle-story` 当前响应不返回 generationId）
- 目前 UI 的“卡选择器”是最小可用版本（列表 + 选择），后续可复用现有卡牌组件做更美观的卡片式选择
