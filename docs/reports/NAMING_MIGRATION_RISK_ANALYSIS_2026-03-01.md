# 历史 `snake_case` 字段与全局命名规范冲突风险分析（2026-03-01）

## 1. 背景

在提交 `e4c79f6a20e0e79b956ee4ec6107557c54c3fdb0` 中，项目明确了“分层统一 + 边界映射”的全局命名规范（见 `docs/NAMING_CONVENTIONS_2026-02-28.md`）。

该规范方向正确，但当前仓库存在大量历史 `snake_case` 字段，且它们分布在不同语义层：

- 数据库列与 SQL 查询层（天然 `snake_case`）
- TypeScript 业务对象层（目标应为 `camelCase`）
- 数据卡 JSON 内容层（历史事实标准大量为 `snake_case`）

如果把“全局 camelCase”直接应用到所有层，尤其是数据卡内容层，将触发高影响回归：

- 字段解析回退链断裂
- 元数据读写错配
- 历史卡结构不兼容
- 审核/公开状态判定异常

## 2. 关键结论（先行）

1. 当前项目中的“内容层数据卡结构”不能简单等同于“业务层 DTO”。
2. `arena_history`、`current_state`、`scenario_type`、`created_at/updated_at` 等在内容层属于历史兼容字段，短期内应视为稳定协议。
3. 现有系统已在多个边界实现 snake/camel 双读兜底，一次性移除会导致真实线上读写异常。
4. 推荐策略不是“全局重命名”，而是“边界收敛 + 内容层冻结 + 版本化迁移”。

## 3. 现状证据盘点（代码路径）

### 3.1 数据卡内容 Schema 已显式采用大量 `snake_case`

- `lib/schemas/magical-girl.ts`
  - 顶层字段：`arena_history`、`current_state`
  - 深层字段：`world_line_id`、`created_at`、`updated_at`、`last_sublimation_at`
- `lib/schemas/current-state.ts`
  - `updated_at`
- `lib/schemas/scenario.ts`
  - `scenario_type`
  - `metadata.created_at`
- `types/arena.d.ts`
  - `CharacterCurrentState.updated_at`
  - `ArenaHistory.attributes.world_line_id/created_at/updated_at`

这说明：内容层协议并非“偶发 snake_case”，而是系统性设计。

### 3.2 数据卡转换器与编辑流程直接依赖这些字段

- `lib/data-card-converter.ts`
  - 元字段清单中直接包含：`arena_history`、`current_state`、`scenario_type`、`created_at`
  - 转换流程中会保留/拷贝这些字段
- `pages/character-manager.tsx`
  - 加载与替换数据卡时读取 `card.is_public`
  - 历战与当前状态编辑直接操作 `arena_history` / `current_state` 及其 `world_line_id`、`updated_at`

如果字段改名但这些路径不同步，编辑器会出现“读到空结构”“写回丢字段”“原生性判断误判”等问题。

### 3.3 兼容读链路已广泛存在（说明历史混用是现实）

- `pages/sublimation.tsx`、`pages/details.tsx`、`pages/canshou.tsx`
  - 问卷卡读取采用：`card.data ?? card.dataJson ?? card.data_json ?? card.dataJSON`
- `lib/arena/stream-meta.ts`
  - 支持 `currentStateSummary` 与 `current_state_summary` 双字段
- `lib/magic-tea-party/jsonl.ts`
  - 同样双读 `currentStateSummary/current_state_summary`
- `lib/db/repositories/data-cards-core.ts`
  - `nativeAllowedOnly` 查询中兼容 `$.nativeAllowed` 与 `$.native_allowed`

这类回退是“线上兼容机制”，不是可随意删除的冗余。

### 3.4 数据库/仓储层目前刻意输出 `snake_case` 行对象

- `lib/db/schema/business.ts`：列名是 snake_case，属性映射是 camelCase（`isPublic` -> `is_public`）
- `lib/db/repositories/data-cards-core.ts`：对外 Row 类型与 select alias 大量保留 `snake_case`
  - 例如：`is_public`、`review_status`、`created_at`、`updated_at`
- `pages/api/data-cards.ts` 与 `lib/data-card-status.ts`：使用 `is_public` 做公开/封禁判定

说明当前处于“新旧仓储并存 + 兼容过渡”阶段，不能在未补齐 mapper 的情况下强推命名切换。

## 4. 高影响回归风险模型

| 风险ID | 风险描述 | 触发条件 | 影响范围 | 严重级别 |
|---|---|---|---|---|
| R1 | 字段解析回退失效 | 删除 `data_json/dataJSON/current_state_summary` 等兼容读 | 问卷导入、流式更新、茶会更新 | 高 |
| R2 | 元数据读写错配 | 读用 camel、写仍 snake（或反之） | 战报后处理、状态更新、历史落盘 | 高 |
| R3 | 历史数据卡写回污染 | 统一写成 camel 后，旧消费端只认 snake | 角色编辑器、模板转换、导出链路 | 高 |
| R4 | 审核/可见性逻辑异常 | `is_public` 三态被布尔化或字段名不一致 | 公开卡列表、封禁状态、审核流 | 高 |
| R5 | 查询/排序回归 | `created_at` 等排序键被替换但查询未同步 | 数据卡列表排序、统计页面 | 中高 |
| R6 | 原生签名/兼容策略误判 | 字段变更未更新原生性判断逻辑 | 保存流程、签名去留策略 | 中高 |

## 5. 为什么“全局规范化”在当前阶段会出问题

### 5.1 规范语义被误用

`docs/NAMING_CONVENTIONS_2026-02-28.md` 的核心是“跨层要显式映射”，不是“把所有历史数据载荷都改成 camelCase”。

若把“内容层 JSON 协议”也一并重写，会把“边界映射问题”升级为“历史数据迁移问题”。

### 5.2 数据卡内容层本质上是长期兼容协议

历史卡已入库、可导入导出、可跨页面消费。此层字段一旦变更，影响不是单点函数，而是全链路。

### 5.3 当前项目存在双轨数据库访问

仓储函数和 API 仍有历史接口形态，贸然统一命名会出现“部分路径改了、部分路径没改”的错配窗口。

## 6. 推荐策略：边界收敛 + 内容层冻结 + 版本化迁移

## 6.1 分层 canonical 重申（建议执行口径）

1. 数据库层：继续 `snake_case`
2. Drizzle 实体属性：可 `camelCase`（已有映射）
3. 服务/组件内部临时对象：优先 `camelCase`
4. 数据卡内容层（`data` JSON）：
   - **短期冻结为现有协议（含 snake_case）**
   - 非必要不做字段重命名
5. API 对外响应：
   - 新接口优先 `camelCase`
   - 旧接口保持兼容，逐步版本化

## 6.2 兼容原则（必须）

1. 读取：兼容双风格（snake/camel）
2. 写出：按“该层 canonical”统一写出
3. 同一对象禁止长期双写（除兼容窗口）
4. 兼容窗口必须有结束条件与迁移文档

## 6.3 迁移执行方式（避免连锁回归）

1. 先补 mapper，不先改消费方
2. 先加回归测试，再改命名
3. 内容层若要改名，必须走版本化（如 `schemaVersion`）
4. 灰度发布时记录兼容命中率与失败原因
5. 达到阈值后再清理旧字段

## 7. 最小回归测试矩阵（建议立即补齐）

1. 数据卡读取兼容
- 输入包含 `data` / `dataJson` / `data_json` / `dataJSON`
- 输出统一到单一 canonical 对象

2. 流式元数据兼容
- `currentStateSummary` 与 `current_state_summary` 都可被正确吸收
- 写入时只落一个 canonical 字段（当前建议保持现状）

3. 历战与当前状态回归
- `arena_history`、`current_state`、`world_line_id`、`updated_at` 的读写 round-trip 不变

4. 可见性与审核状态
- `is_public` 的 `-1/0/1` 三态逻辑不回归

5. 列表排序与统计
- `created_at` 排序、`usage_count/like_count/favorite_count` 统计结果稳定

## 8. 建议的落地优先级

1. P0：先把“内容层字段是否允许重命名”写成明确项目规则（建议：默认不允许，除版本迁移）
2. P0：为关键边界补测试（数据卡读取、流式 meta、茶会 updates、`is_public` 三态）
3. P1：在 repository/adapter 增加集中 mapper，减少页面层零散 fallback
4. P2：评估是否需要推出数据卡内容层 v2（仅在确有收益时）

## 9. 结语

当前最大风险不是“存在 snake_case”，而是“在缺乏版本化与边界映射的前提下直接全局改名”。

建议把本次问题定义为“兼容性工程”而不是“风格清理工程”：

- 先保稳定，再收敛
- 先边界，再全局
- 先测试，再迁移

