# 后台管理冻结审阅与下一阶段设计建议（2026-03-09）

## 0. 摘要结论

基于提交区间 `5abcb4d74993869a8109c7602217ea65b3ea278b..HEAD` 的审阅，当前后台的核心事实非常明确：

1. 自“上次后台更新基线”以来，仓库新增了 **159 个提交**。
2. 但 `pages/admin/*` 与 `pages/api/admin/*` 在这个区间内 **没有发生代码变更**。
3. 因此，现有后台并不是“局部老化”，而是整体上仍停留在 28 天前的能力视角。

结论：

- 现有后台对“旧的内容审核、用户状态、标签、战报文本、排位结果、R2 正文索引”仍然可用；
- 但对这 159 个提交中新增的 **账号体系迁移、认证审计、严格排位反刷分、战报插图/视觉资产、PVP 运行时、扩展型清理对象** 等能力，后台覆盖明显不足；
- 下一阶段不应继续零散补按钮，而应先按“领域”重构后台信息架构，再逐步补页与补读模型。

---

## 1. 本次审阅范围与依据

本次主要审阅以下内容：

- 提交区间：`5abcb4d74993869a8109c7602217ea65b3ea278b..HEAD`
- 当前后台页面：`pages/admin/*`
- 当前后台 API：`pages/api/admin/*`
- 新增能力相关代码：
  - 账号与认证：`lib/auth/*`、`pages/api/me/account/*`、`lib/db/repositories/user-auth-links.ts`、`lib/db/repositories/auth-audit-logs.ts`
  - 排位与风控：`pages/api/arena/strict-preflight.ts`、`docs/STRICT_RANKING_ANTI_ABUSE_2026-03-08.md`
  - 战报与存储：`pages/admin/battle-report-generations.tsx`、`pages/admin/large-objects.tsx`、`lib/arena/battle-report-output-storage.ts`、`lib/arena/battle-report-record-utils.ts`
  - 内容与视觉资产：`docs/ARENA_BATTLE_REPORT_ILLUSTRATION_DESIGN_2026-02-10.md`、`docs/CARD_VISUAL_ASSET_EMBEDDING_DESIGN_2026-02-10.md`、`components/DataCardDetailsModal.tsx`
  - PVP：`lib/database/pvp.ts`、`lib/db/repositories/pvp-room-core.ts`、`lib/db/repositories/pvp-match-round-chat.ts`、`pages/api/pvp/rooms/*`
  - 数据维护：`pages/admin/data-maintenance.tsx`、`lib/database/admin-data-maintenance.ts`

本报告只讨论：

- 后台哪些地方需要更新；
- 后台还可以增加哪些功能；
- 哪些设计已经足够成熟，适合进入后续实现阶段。

本报告不讨论管理员鉴权本身，因为当前分支明确不做线上部署。

---

## 2. 现有后台覆盖矩阵

| 领域 | 近 159 提交新增能力 | 当前后台覆盖 | 结论 |
| --- | --- | --- | --- |
| 用户与账号系统 | Better Auth、迁移状态、改密码/改邮箱、一次性重置密码、迁移提醒、安全审计日志、邮件发送防滥用 | 只有 `user-dashboard` / `user-management` / `user-analytics`，仍主要围绕 `users` 旧字段与内容创作统计 | **明显过时，需优先补齐** |
| 内容与数据卡 | 待审核更新、native 标记、tech index、JSON 体积、运行时 source info、视觉资产嵌入 | `content-management` 仍是后台里最接近现状的一页，但缺图像审阅、大小预算与来源元数据视图 | **部分跟上，仍需扩展** |
| 排位与严格风控 | strict preflight、pair 冷却、pair 日上限、用户日上限、低局数额外分差保护 | `arena-ratings` / `arena-rating-events` 只能看结果，缺风控聚合与异常审计 | **部分跟上，缺关键观测层** |
| 战报与外部化存储 | 战报正文落 R2、`large_objects` 索引、R2 兜底重读、失败落库补全 | `battle-report-generations` 与 `large-objects` 覆盖了“正文文本”主链路，但缺来源/错误/孤儿对象/多 kind 资产视图 | **可用但不完整** |
| 战报插图与视觉资产 | 战报插图、角色立绘嵌入、视觉资产设计扩展 | 后台无独立入口；内容详情主要渲染 JSON 文本，不适合人工图像审查 | **基本缺失** |
| PVP | 房间、聊天、提交、手牌、轮次、投票、托管机器人、结算卡、房间浏览 | 后台没有任何 PVP 专用页面 | **完全缺失** |
| 运维与清理 | 清理任务工作台、任务日志、部分业务域瘦身 | 已有 `data-maintenance`，但目标表仍偏少，未覆盖 Auth/PVP 新表族 | **方向正确，但范围偏旧** |

---

## 3. 需要更新的地方

## 3.1 后台首页的信息架构已经落后于领域划分

当前 `/admin` 首页仍是“内容 / 用户 / 角色 / 用户管理 / 标签 / 战报 / 排位 / 大对象 / 清理”的平铺入口。

问题：

1. “用户状态”和“用户管理”重复并列，且都仍然是旧账号模型视角。
2. 新增的“账号与认证”“PVP”“视觉资产/插图”“风控审计”没有独立入口。
3. 首页统计卡片仍然只覆盖 core / arena / activity / tags / storage，未体现 Auth 与 PVP。

建议：

1. 后台首页改成按领域分组，而不是按历史页面堆叠。
2. 推荐一级分组：
   - 用户与账号
   - 内容与审核
   - 竞技场与排位
   - PVP
   - 存储与资产
   - 运维与清理
3. 首页统计卡片至少新增：
   - 迁移中用户数
   - legacy-only 用户数
   - 邮箱未验证用户数
   - 近 24h Auth 成功/失败次数
   - PVP 活跃房间数 / 进行中对局数
   - 视觉资产对象数（若纳入 `large_objects`）

## 3.2 用户后台仍停留在旧 `users` 单表视角

当前 `pages/admin/user-dashboard.tsx`、`pages/admin/user-management.tsx` 与 `lib/database/admin.ts` 读取的仍是：

- `username`
- `email`
- `is_banned`
- `is_review_exempt`
- `slot_count`
- `prefix`
- 内容卡数量与活跃时间

但近 159 提交后，用户系统实际已经拆成了：

- 业务用户：`users`
- 认证映射：`user_auth_links`
- Better Auth 用户：`ba_user`
- Better Auth 账号：`ba_account`
- 审计日志：`auth_audit_logs`
- 迁移状态接口：`/api/me/account/migration-status`

因此当前后台的主要缺口不是“少几个字段”，而是**没有新的账号读模型**。

建议更新点：

1. 合并 `/admin/user-dashboard` 与 `/admin/user-management`，改成单页多标签的“用户与账号”页面。
2. 页面标签建议至少拆成：
   - 基本信息
   - 认证状态
   - 迁移状态
   - 安全审计
   - 创作与活跃
3. 用户列表页新增字段/筛选：
   - `authSource` 最近一次来源（`better-auth-session` / `legacy-bearer`）
   - `hasAuthLink`
   - `hasPassword`
   - `emailVerified`
   - `legacyOnly`
   - 最近成功登录时间
   - 最近失败登录次数（24h / 7d）
4. 用户详情页新增只读块：
   - Better Auth 用户 ID
   - 认证邮箱与业务邮箱是否一致
   - 最近一次改密 / 改邮箱 / 重置密码时间
   - 最近一次邮件发送保护命中情况

这里应优先做“读侧可见性”，不要一上来堆太多后台写操作。

## 3.3 严格排位后台只看得到“结果”，看不到“风控”

`/admin/arena-ratings` 与 `/admin/arena-rating-events` 已经能看：

- 当前分数
- before / after / delta
- `skip_reason`
- 明细 JSON

但严格排位最近新增的核心变化，是：

- `strict-preflight`
- 同 pair 冷却窗
- 同 pair 每日上限
- 用户 strict 每日计分上限
- 低局数额外分差保护

当前后台的问题：

1. 没有“按 `skip_reason` 聚合”的监控面板。
2. 没有“按用户 / pair / 天”的风控集中度审计。
3. 没有“strict preflight 被拒绝”的后台可见性。
4. 没有异常 pair、异常用户、异常涨分路径的聚合视图。

建议更新点：

1. 在现有 `arena-rating-events` 之上补一个“风控审计”视图，而不是继续往表格里塞列。
2. 最少新增三个聚合块：
   - `skip_reason` 分布（近 24h / 7d / 30d）
   - 单用户 strict 计分量排行
   - 单 pair strict 计分量排行
3. 若后续要真正做反刷分后台，建议增加离线审计读模型：
   - pair 集中度
   - reciprocal win-trading 可疑样本
   - 低局数异常跃升样本
4. 是否记录 preflight 拒绝日志，需要先单独做设计决策；当前代码中 preflight 拒绝并不会自动进入后台审计面。

## 3.4 战报后台只覆盖“正文文本”，没有覆盖“资产与可恢复性”

现有后台已经能看：

- `battle_report_generations`
- R2 正文下载
- `large_objects(kind='battle_report_generation_output')`

但近 159 提交后，战报域新增的不只是正文文本：

- 正文外部化到 R2
- D1/R2 双读兜底
- 失败落库补全
- 战报插图链路
- 角色立绘与视觉资产嵌入能力

当前缺口：

1. `battle-report-generations` 看不到“正文当前来源是 D1 还是 R2”。
2. 看不到 R2 读取失败、兜底失败、对象缺失等恢复性信息。
3. `large-objects` 虽然是通用页，但当前使用体验仍偏“战报正文索引查看器”，不是资产工作台。
4. 对视觉资产缺少：
   - kind 级分类
   - 图片预览
   - hash / 去重 / 孤儿对象排查
   - 与数据卡/战报的双向关联视图

建议更新点：

1. `battle-report-generations` 列表与详情增加：
   - `outputSource`（D1 / R2 / none）
   - `outputReadError`
   - `hasStoredOutput`
2. `large-objects` 改为真正的“对象资产工作台”：
   - 支持按 kind 分组视图
   - 图片类对象支持缩略图/预览
   - 增加 orphan / dangling / missing-index 检查结果
3. 若视觉资产后续统一进入 `large_objects`，后台应提前按“文本对象”和“图片对象”分栏设计，而不是只围绕战报正文。

## 3.5 内容后台缺的不是审核按钮，而是“新内容形态”的审阅支持

`content-management` 目前已经具备：

- 待审卡筛选
- 待审核更新
- AI 辅助审查
- `questionnaire.nativeAllowed`
- tech index 重算

这页是当前后台里最不落后的页面。

但它仍有三个明显缺口：

1. 对视觉资产没有图像审阅体验。
   - `DataCardDetailsModal` 仍主要是递归渲染 JSON；
   - 对嵌入的 `portrait` / `illustration` 并没有“人工审核友好”的预览。
2. 对卡片体积没有后台告警。
   - 最近新增了 JSON 大小指示器，但后台没有把“体积过大 / 接近预算”的卡片筛出来。
3. 对运行时来源元数据没有后台可见性。
   - 近 159 提交里做了大量 mapper/source info 收敛，但后台仍按旧平面字段看卡。

建议更新点：

1. 内容详情增加“视觉资产”区块：
   - 缩略图
   - 来源 URL / 代理 URL
   - 资源类型
   - 尺寸与大小
2. 内容列表增加筛选：
   - “包含视觉资产”
   - “JSON 体积超阈值”
   - “metrics stale / 待重算”
   - “存在 pending update”
3. 审核详情增加“原版 vs 待审版”的结构化 diff，而不是只切换整份详情。

## 3.6 PVP 已经是独立子系统，但后台完全缺席

从代码看，PVP 已经具备独立运行时与历史数据体系：

- 房间
- 成员
- 聊天
- 手牌
- 提交
- 轮次
- 投票
- 机器人
- 结算卡
- 浏览与个人战绩

但后台当前没有任何：

- 房间列表
- 活跃对局列表
- 房间/对局详情
- 聊天审计
- 异常房间清理
- 历史对局检索

这意味着一旦 PVP 出现：

- 房间卡死
- 玩家争议
- 聊天异常
- 轮次状态错乱

后台没有专门的可观测性入口，只能靠数据库清理或脚本。

建议：

1. 新增独立的 `/admin/pvp` 域，而不是把 PVP 混进战报或数据清理页。
2. 首批先做读侧，不急于做强干预：
   - 活跃房间列表
   - 对局历史检索
   - 房间详情（成员、阶段、轮次、聊天）
   - 异常状态筛选（长时间停留某 phase、无人确认、提交不一致）
3. 后续再讨论写操作：
   - 强制结束房间
   - 清理运行时状态
   - 导出聊天/战况审计

## 3.7 数据清理工作台的目标集合已落后于数据域扩展

`data-maintenance` 是当前后台里方向最正确的一页，但它当前主要围绕：

- `battle_report_generations`
- `arena_rating_events`
- `pvp_rounds`
- `large_objects`

对新增的账号与认证子域，几乎没有覆盖。

建议扩展方向：

1. 只读/预览目标增加：
   - `auth_audit_logs`
   - `user_auth_links`
   - `auth_password_reset_tokens`
   - `ba_verification`
2. PVP 运行时清理目标补全：
   - `pvp_room_chat_messages`
   - `pvp_room_hands`
   - `pvp_room_submissions`
   - `pvp_room_card_snapshots`
3. 存储侧增加“索引与对象一致性检查”预览，而不只是删除。

---

## 4. 可以增加的功能

## 4.1 用户与账号

推荐新增功能：

1. 迁移漏斗面板：
   - 未建链
   - 已建链未设密
   - 已设密未验邮
   - 已完成迁移
2. 安全审计日志页：
   - 登录成功/失败
   - 重置密码
   - 修改邮箱
   - 修改密码
3. 用户账号健康度卡片：
   - 是否 legacy-only
   - 近 7d 是否连续失败登录
   - 是否存在业务邮箱 / Auth 邮箱不一致

## 4.2 内容与审核

推荐新增功能：

1. 视觉资产审阅模式
2. 待审核更新 diff 视图
3. 超大 JSON 卡片清单
4. 技术值 / 原生性 / 排位值 联动视图

## 4.3 排位与风控

推荐新增功能：

1. `skip_reason` 趋势图
2. 可疑 pair 排行榜
3. 可疑用户 strict 计分排行
4. 赛季维度风控摘要

## 4.4 战报与资产

推荐新增功能：

1. 战报对象完整性巡检
2. R2 读失败样本列表
3. 视觉资产对象工作台
4. orphan 对象 / 缺索引对象扫描

## 4.5 PVP

推荐新增功能：

1. 活跃房间面板
2. 对局历史检索
3. 聊天审计与导出
4. 卡死房间巡检面板

---

## 5. 推荐的后台下一阶段结构

推荐把后台重新组织为以下结构：

### A. 用户与账号

- `/admin/users`
- `/admin/users/[id]`
- `/admin/auth-audit`

### B. 内容与审核

- `/admin/content`
- `/admin/content/[id]`
- `/admin/content/review-updates`

### C. 竞技场与排位

- `/admin/arena/ratings`
- `/admin/arena/events`
- `/admin/arena/risk`

### D. PVP

- `/admin/pvp/rooms`
- `/admin/pvp/matches`

### E. 存储与资产

- `/admin/storage/large-objects`
- `/admin/storage/assets`

### F. 运维与清理

- `/admin/ops/maintenance`
- `/admin/ops/jobs`

注意：

1. 这里不是要求一次性改路由，而是先按这个结构做设计，再决定是否保留旧路径兼容。
2. 比起“继续在旧页面上缝补”，更推荐逐域重做读模型与页面。

---

## 6. 推荐实施优先级

## Phase 0：先定设计，不急着改代码

本次报告即为 Phase 0 产物。

在真正动工前，建议先明确以下决策：

1. 用户后台是否合并成一个“用户与账号”页面。
2. strict preflight 拒绝是否需要持久化，以便后台审计。
3. 视觉资产是否统一收口到 `large_objects`，作为后台资产中心的数据基础。
4. PVP 后台首版只读，还是允许做房间干预。

## Phase 1：优先补“用户与账号”

原因：

1. 这是近 159 提交里新增能力最多、且后台最落后的领域。
2. 当前 `user-dashboard` / `user-management` 的信息含量已经明显不够。

首批目标：

1. 合并用户后台
2. 接入 migration status
3. 接入 auth audit 聚合
4. 首页补 Auth 统计卡片

## Phase 2：补“排位风控 + 战报/资产”

首批目标：

1. strict 风控审计页
2. 战报来源/读错状态展示
3. large_objects 多 kind 资产视图
4. 视觉资产审阅支撑

## Phase 3：补 PVP 后台

首批目标：

1. 活跃房间列表
2. 历史对局检索
3. 房间详情审计

---

## 7. 设计原则建议

为避免后台再次快速过时，后续实现建议遵循：

1. **按领域建后台，不按历史页面加字段**
   - 用户/Auth、内容、Arena、PVP、存储、运维分开设计。
2. **先补读模型，再补按钮**
   - 先让后台“看得见”，再决定要不要提供写操作。
3. **后台 DTO 独立于底层 schema**
   - 不要让页面直接继续吃旧 `users.*` 平面字段。
4. **聚合页与详情页分离**
   - 排位事件表格不应承担风控分析页的职责。
5. **资产后台要区分文本对象与图片对象**
   - `battle_report_generation_output` 与未来插图/立绘不是同一种审阅模式。

---

## 8. 最终判断

当前后台不是“坏了”，而是**停在了 28 天前**。

它仍然能管理：

- 用户封禁与豁免
- 内容审核
- 标签
- 战报记录
- 排位结果
- 大对象索引
- 数据清理

但它还没有跟上这 159 个提交真正改变系统边界的几件事：

1. 用户系统已经从“单表用户”升级为“业务用户 + Auth 子域 + 迁移状态 + 安全审计”。
2. 严格排位已经从“简单结算”升级为“带 preflight 与反刷分策略的风控系统”。
3. 战报已经从“文本记录”升级为“文本 + R2 对象 + 视觉资产”的复合资产链路。
4. PVP 已经从“功能页”升级为“独立运行时子系统”。

因此，后续开发的正确方向不是继续零散补旧后台，而是：

**先按新领域重构后台设计，再分阶段补齐页面与读模型。**
