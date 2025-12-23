# PVP 开发备忘（实现记录）

更新时间：2025-12-23

> 本文用于记录实现细节、落地偏差与后续 TODO；设计稿请看 `docs/PVP.md`。

## 0.1 变更记录（最近）

- 2025-12-23：新增“仅房主提交牌堆”模式：房主可选择让卡组由房主统一提交（任意张卡牌作为公共牌堆供所有玩家抽取），其他玩家无需提交卡牌；该模式下不再需要设置“每人提交数量”，提交阶段仅等待房主完成提交。
- 2025-12-23：重构“房间浏览器”UI/UX（参考 `BattleDataModal` 风格）：修复顶部按钮挤压导致标题竖排的问题；将搜索/筛选区收敛为清晰的卡片面板；房间列表改为栅格布局并统一按钮尺寸；支持 `Esc` 关闭与搜索框自动聚焦；房间口令可自动读取会话缓存，减少重复输入。
- 2025-12-23：新增“胜者投票”机制：当回合结算生成战报后，若无法从 `officialReport.winner` 解析出**胜者或平局**（即 winner 不在候选集合内且不为“平局”），房间将进入 `voting` 阶段，所有房间成员可对“哪位参战者获胜 / 平局”进行投票；得票最高者获胜，若出现平票则判平局。投票以房间运行时私有字段 `pvp_rooms.rules_json._winnerVote` 存储并轮询展示；投票结束后恢复到 `reviewing`（阅读确认）阶段并进入原有推进流程。房主也可在 `reviewing` 主动发起投票以复核 AI 判定（`POST /api/pvp/rooms/:roomId/rounds/:roundId/vote/start|submit|finalize`）。
- 2025-12-23：支持“未满员提前开局”：当房间参与者数量 ≥2 且未达到规则人数时，房主可在 `waiting` 直接点击“提前开局”，系统会自动将 `rules.participants` 从目标人数缩减为当前人数，并对玩家/机器人座位进行压缩整理（确保 `seat < participants`），随后进入 `submitting`（若 `cardsPerPlayer>0`）或继续走发牌开局流程（`cardsPerPlayer=0`）。发牌接口 `POST /api/pvp/rooms/:roomId/start` 已内置该逻辑。
- 2025-12-23：PVP 房间新增“对局生成设置”（与竞技场对齐）：资料读写策略、等级、故事引导、随机判定器、期望字数、生成语言；默认全关/不指定；房主在 `waiting/submitting` 保存后对局内固定。结算端将 PVP 系统裁判提示词改为 `internalGuidance` 注入，不再混入 `userGuidance`；开启资料写入时房间页仅**只读展示**“历战记录/当前状态”的更新摘要（不提供下载/保存/替换）。
- 2025-12-23：新增观战模式：房主可开关观战（默认开启）；用户进入开启观战的房间默认成为观众，可在 `waiting/submitting` 且有空位时切换为玩家；玩家也可在 `waiting/submitting` 切回观众（非房主）。观众视角不返回手牌/提交详情/出牌选择等私密信息（`POST /api/pvp/rooms/:roomId/role`、`POST /api/pvp/rooms/:roomId/permissions`、`GET /api/pvp/rooms/:roomId`）。
- 2025-12-22：当仅剩最后一位真人玩家未操作（提交/出牌/确认）时，房间页展示 30s 倒计时；倒计时结束后房主可强制随机提交/出牌/确认（`POST /api/pvp/rooms/:roomId/force`）。
- 2025-12-22：真人玩家在 `submitting/choosing/reviewing` 阶段退出或被房主踢出时，不再直接 `aborted`；将自动用“托管机器人”接管该座位，继承其提交/手牌/当轮出牌状态继续游戏（`dealing/resolving/advancing` 为忙碌阶段，暂不允许踢出/退出）。
- 2025-12-22：choosing 阶段若手牌尚未发放/同步，出牌区域显示“发牌中…”加载提示（不再无提示/仅提示刷新）。
- 2025-12-22：房间写入接口发生 `VERSION_CONFLICT` 时，UI 展示 3 秒倒计时并自动刷新重试（减少手动刷新成本）。
- 2025-12-22：大厅新增“房间浏览器”（搜索/筛选/加入）与“快速匹配”（优先加入无口令 2 人经典房间，否则用默认规则建房）。
- 2025-12-22：新增房主可配置“抽取来源”（公开库/预设/预设+公开库）；支持 `cardsPerPlayer=0` 跳过提交阶段并按“手牌为空时补发”开局发牌。

## 0. 当前实现范围（MVP）

- 2-6 人房间（同局同时出牌）
- D1 持久化 + 前端轮询（React Query `refetchInterval=1500ms`）
- 流程：创建房间 → 加入 →（可选）提交卡组 → 房主发牌 → 同时出牌 → 自动/手动结算（生成战报）→（可选）多轮直到 `maxRounds`
- 结算调用：复用现有非流式端点 `POST /api/generate-battle-story`（按房间“对局生成设置”透传：资料读写、等级、引导、判定器、期望字数、语言；默认全关/不指定）
- 多局制配置：大厅创建房间可启用/设置；房间内（房主）可在 `waiting/submitting` 阶段调整规则
- 结算推进策略：生成战报后进入 `reviewing`，只有全员“确认已阅读”后才推进下一回合或结束
- 大厅支持房间浏览器（搜索/筛选/浏览可加入房间并加入）与快速匹配（无可加入房间则按默认规则创建）
- 新增房间规则：
  - `showAllSubmissions`：是否显示所有人提交的卡组详情（默认 true；但在 `submitting` 提交阶段强制隐藏他人详情，仅展示提交进度；开始对局后再按该开关决定是否可查看）
  - `shuffleDecks`：是否合池洗混后发牌（默认 true；关闭时每位玩家仅从自己提交的卡组中按提交顺序抽取手牌）
  - `drawSource`：当“提交牌池/弃牌”不足时，补牌从哪里抽取（默认 `public`；可选 `preset` / `preset+public`）
  - `cardsPerPlayer`：允许设置为 `0`（跳过提交阶段；开局直接按 `dealWhenEmpty` 发牌）
- 大厅“创建房间”规则设置已用 localStorage 持久化（与竞技场类似的 zustand persist）：`pvp-lobby-storage`

## 1. 关键工程决策

### 1.1 “手牌不可推导”约束

如果“提交数 == 发牌数”，玩家拿到自己的手牌后可用补集直接推导对手手牌集合，信息博弈失效。

当前实现已不再强制 `cardsPerPlayer > dealPerPlayer`（允许更自由的配置，含 `cardsPerPlayer=0` 跳过提交）。
建议在对外玩法说明中明确：当提交数过低/等于发牌数时，信息可推导风险会上升。

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
  - 观战模式：`pvp_room_players.role = player/spectator`；房间规则增加 `allowSpectators`（默认 true）

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
- `pages/api/pvp/rooms/browse.ts:1` 房间浏览器（查询可加入房间，支持筛选/搜索）
- `pages/api/pvp/rooms/quick-match.ts:1` 快速匹配（无口令 2 人经典房间优先）
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
- `pages/api/pvp/rooms/[roomId]/permissions.ts:1` 房主设置：是否允许其他玩家调整 AI 设置并结算 / 是否开启观战
- `pages/api/pvp/rooms/[roomId]/role.ts:1` 切换身份（player/spectator）
- `pages/api/pvp/rooms/[roomId]/index.ts:1` 拉取房间状态（按身份过滤手牌）
- `pages/api/pvp/rooms/[roomId]/rounds/[roundId]/choose.ts:1` 出牌
- `pages/api/pvp/rooms/[roomId]/rounds/[roundId]/resolve.ts:1` 结算回合（生成战报，幂等；默认仅房主可结算）

> 备注：Pages Router 的 Edge API 动态路由未稳定提供 `params`，所以使用 `lib/pvp/route.ts` 从 `req.url` 解析 `roomId/roundId`。

### 2.5 前端页面
- `pages/pvp.tsx:1` 大厅
- `pages/pvp/[roomId].tsx:1` 房间页
- `components/pvp/PvpLobbyPage.tsx:1`
- `components/pvp/PvpRoomBrowserModal.tsx:1` 房间浏览器模态框
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

观战模式新增字段（需迁移）：
```sql
ALTER TABLE pvp_room_players ADD COLUMN role TEXT NOT NULL DEFAULT 'player';
```

## 4. 已知限制 / TODO

- 已支持“全员都已选则自动结算（幂等）”：当房主结算/或房主允许其他玩家结算时，出牌接口会尝试自动触发结算；仍保留手动结算按钮作为兜底
- 目前“中途托管机器人接管”不会阻止对战记录落库：若开局时无机器人（已创建 `pvp_matches`），后续托管发生后仍会按原逻辑写入结束状态；若你希望“发生托管即不计入战绩”，建议在 `pvp_matches.result_json` 追加 `hasBotTakeover=true` 并在统计侧过滤
- 已串联“战报生成记录 ↔ PVP”：`resolve` 会把 `POST /api/generate-battle-story` 返回的 `generationId` 写入 `pvp_rounds.battle_generation_id`；同时生成端点支持 `pvpContext` 并写入 `battle_report_generations.pvp_*` 字段（注意：线上 D1 仍需执行迁移）
- 注意：PVP 场景即使开启“资料写入”也不会更新全局战斗统计（避免污染竞技场统计口径）
- 暂未提供“对战历史/复盘/排行”的独立页面与 API（虽然 `pvp_matches` / `pvp_rounds` 已可持久化承载）
- 暂未做“阶段超时/自动中止”的规则与 UI（目前仅有 `expires_at` 的房间过期懒清理）
- `scenario` 模式已支持房间内选择/透传情景；后续可继续增强情景来源、公开范围与复盘稳定性（例如强制快照情景来源）
- 目前 UI 的“卡选择器”是最小可用版本（列表 + 选择），后续可复用现有卡牌组件做更美观的卡片式选择

## 5. 后续开发建议（优先级）

### P1：可复盘与可运营（强烈建议先做）
- **对战历史（Match/Round）查询 API**：按 `userId` 列表、按 `matchId` 详情；与 `battle_report_generations` 的 `pvp_*` 字段联动（用于排查失败、风控、统计）
- **PVP 历史 UI**：用户个人战绩页（最近 N 场、胜负/比分、回合战报）；房间页可快捷跳转到当前 match 的详情
- **迁移落地流程**：把 `lib/database/schema.sql` 的新增列/索引在实际 D1 环境执行，并补一份“上线迁移 checklist”（避免“代码已写但线上缺列”）

### P2：玩法与体验增强（可并行推进）
- **观战增强**：支持“无需加入房间成员即可只读观战”（公开房间）/ 观众数量上限与踢出策略 / 更细粒度的脱敏字段清单与回归测试
- **阶段超时与中止规则**：`submitting/choosing/resolving` 超时策略 + 懒清理/房主一键结束
- **Scenario 模式**：明确情景来源与公开范围，透传 `scenario`（及来源信息）给战报生成端点

### P3：实时性与更强一致性（成本更高）
- 将轮询升级为 SSE / Durable Objects（房间级广播），减少延迟与请求量，并提升状态一致性
