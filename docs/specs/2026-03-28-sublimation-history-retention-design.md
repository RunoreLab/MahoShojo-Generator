# 成长升华历战保留策略设计稿

日期：2026-03-28  
状态：已完成设计讨论，待人工评审  
范围：`/sublimation` 升华页历战写回策略可配置化，统一流式与非流式结果语义

---

## 1. 背景

当前“成长升华”已提供以下能力：

- 可分别控制升华时是否读取 `arena_history`
- 可分别控制升华后是否写入 `arena_history`
- 可分别控制升华时是否读取、升华后是否写入 `current_state`

但现存实现存在两个直接影响用户体验的问题：

1. 非流式升华在写回 `arena_history` 时，固定只保留 `type === "sublimation"` 的历战，再追加本次升华记录  
   这会导致普通对战、剧情推进等非升华历战被隐式清理，用户无法调整。
2. 流式升华当前并未真正消费历战读写策略  
   页面会传 `readArenaHistory` / `writeArenaHistory`，但流式 API 仍会裁掉 `arena_history`，最终只是把 Markdown 组装成一张通用角色卡。

因此，本次需要把“升华后如何保留历战”从固定逻辑升级为明确、可配置、可记忆的策略，并保证流式与非流式最终下载/保存出的 JSON 语义一致。

---

## 2. 范围与非目标

### 2.1 本次范围

1. 为升华页新增“历战保留策略”配置项
2. 支持三种写回策略：
   - `保留全部历史`
   - `只保留升华记录`
   - `清空全部历史`
3. 统一非流式与流式最终 JSON 的 `arena_history` 写回语义
4. 记住用户上次选择的策略偏好
5. 为结果组装逻辑补充共享实现与回归测试

### 2.2 明确非目标

1. **不改变 `readArenaHistory` 的语义**
   - 它仍只控制“生成时是否把旧历战给 AI 看”
2. **不在本期为 `current_state` 引入同等级保留/重置策略**
   - 仅在设计上预留未来扩展位
3. **不改内容层字段命名**
   - `arena_history`、`world_line_id`、`created_at`、`updated_at`、`last_sublimation_at` 继续沿用现有兼容协议
4. **不引入按条数/按时间自动裁剪**
   - 本期只有三种明确策略，不附带隐藏规则
5. **不重做流式升华为结构化输出链路**
   - 流式仍以 Markdown 预览为主，只统一最终落地 JSON 语义

---

## 3. 现状调研结论

### 3.1 非流式固定清理点

当前非流式升华在 [`pages/api/generate-sublimation.ts`](/home/muofu/code/MahoShojo-Generator/pages/api/generate-sublimation.ts#L926) 中存在以下固定逻辑：

- 从原始 `arena_history.entries` 中仅筛出 `type === "sublimation"` 的条目
- 再追加本次升华事件
- 最终覆写整个 `arena_history`

这意味着：

- 非升华类历战会被清理
- 用户无法选择“完全保留”或“完全清空”
- 当前页面文案“关闭写入后，本次升华不会新增历史条目”不足以表达真实语义

### 3.2 流式链路能力缺口

当前流式升华：

- 前端仍会发送 `readArenaHistory` / `writeArenaHistory`
- 但 [`pages/api/generate-sublimation-stream.ts`](/home/muofu/code/MahoShojo-Generator/pages/api/generate-sublimation-stream.ts) 会直接裁掉 `arena_history`
- 返回结果是 Markdown，前端再把 Markdown 解析成通用角色卡

这意味着：

- 页面里的历战读写勾选项对流式结果并不真正生效
- 流式和非流式当前不存在统一的 `arena_history` 结果语义

---

## 4. 方案对比与结论

### 方案 A：只修非流式

做法：

- 只改非流式接口的 `arena_history` 写回逻辑
- 流式继续保持现状

优点：

- 改动最小
- 风险最低

缺点：

- 无法满足“流式 / 非流式都支持”的产品目标
- 同一页上的配置项仍会出现模式语义不一致

### 方案 B：生成层分离，结果层统一（推荐）

做法：

- 非流式继续生成结构化结果
- 流式继续生成 Markdown 并展示通用角色卡
- 两条链路在“最终 JSON 结果组装”阶段统一应用同一套 `arena_history` 写回策略

优点：

- 满足产品要求的统一结果语义
- 不需要重做流式生成范式
- 可通过共享纯函数降低回归风险

缺点：

- 需要补齐流式最终结果组装链路
- 页面与接口之间要新增一层明确的结果语义桥接

### 方案 C：完全统一为结构化输出

做法：

- 流式结束后也生成一份与非流式尽量同构的结构化结果
- 页面仍显示 Markdown，但保存/下载一律使用结构化结果

优点：

- 长期架构最整齐

缺点：

- 超出本次范围
- 等于部分重做流式升华链路

### 结论

本次采用 **方案 B**：

- 保留当前“非流式结构化 / 流式 Markdown”的生成差异
- 把真正影响用户数据保留结果的 `arena_history` 写回语义统一到结果层

---

## 5. 核心设计决策

本次设计已明确以下产品决策：

1. 历战保留策略只影响“升华完成后如何写回 `arena_history`”
2. `readArenaHistory` 保持原语义，不与保留策略绑定
3. 策略共三种：
   - `保留全部历史`
   - `只保留升华记录`
   - `清空全部历史`
4. 默认策略保持当前行为，即 `只保留升华记录`
5. 用户改过策略后，后续进入页面应恢复上次选择
6. UI 使用“保留现有 `升华后写入` 复选框，勾选后展开单选组”的方式
7. 文案采用直接型命名，不做包装式命名
8. `清空全部历史` 时，重置为新世界线，`sublimation_count` 从 1 开始
9. 本期不为 `current_state` 做对应的保留/重置策略，但保留扩展空间

---

## 6. 数据语义与写回规则

### 6.1 总体原则

- `writeArenaHistory = false` 时：
  - 不应用保留策略
  - 原卡有 `arena_history` 就原样保留
  - 原卡没有 `arena_history` 就不补

- `writeArenaHistory = true` 时：
  - 必定生成 1 条新的 `type = "sublimation"` 历战记录
  - 然后按所选策略生成最终 `arena_history`

- `readArenaHistory` 只影响提示词构造，不影响最终写回计算  
  即使 `readArenaHistory = false`，写回时仍基于原始 `arena_history` 与当前策略计算最终结果。

### 6.2 新增升华记录的统一结构

新增记录继续沿用当前协议字段：

- `id`
- `type = "sublimation"`
- `title`
- `participants`
- `winner`
- `impact`
- `metadata.user_guidance`
- `metadata.scenario_title = null`
- `metadata.non_native_data_involved`
- `metadata.questionnaire_lore_used`
- `metadata.questionnaire_selection_count`

本次不修改内容层字段命名，也不改变现有元数据结构。

### 6.3 策略 1：保留全部历史

规则：

- 保留全部原始 `entries`
- 在末尾追加本次新的升华记录
- `world_line_id` 继承旧值；若不存在则新建
- `created_at` 继承旧值；若不存在则设为 `now`
- `updated_at = now`
- `sublimation_count = previous + 1`
- `last_sublimation_at = now`

适用语义：

- 用户希望完整保留对战、剧情、升华等全部长期履历

### 6.4 策略 2：只保留升华记录

规则：

- 仅保留原始 `entries` 中 `type === "sublimation"` 的条目
- 在末尾追加本次新的升华记录
- `world_line_id` 继承旧值；若不存在则新建
- `created_at` 继承旧值；若不存在则设为 `now`
- `updated_at = now`
- `sublimation_count = previous + 1`
- `last_sublimation_at = now`

适用语义：

- 用户只想保留“成长轨迹”，不想带入大量普通历战

兼容性说明：

- 这是当前实现的既有行为，因此作为默认策略保留

### 6.5 策略 3：清空全部历史

规则：

- 丢弃全部原始 `entries`
- 最终仅保留本次新的升华记录
- 生成新的 `world_line_id`
- `created_at = now`
- `updated_at = now`
- `sublimation_count = 1`
- `last_sublimation_at = now`

适用语义：

- 用户希望把本次升华视为新世界线起点

### 6.6 统一不变式

- 新记录 `id` 基于“本次策略最终保留下来的 `entries` 集合”计算：
  - 取其中最大可解析数值 `id + 1`
  - 若为空或均不可解析，则从 `1` 开始
- 不额外引入按条数/按时间裁剪
- 若原始 `attributes` 缺失，不应导致结果异常

---

## 7. 页面交互设计

### 7.1 展示位置

沿用 [`pages/sublimation.tsx`](/home/muofu/code/MahoShojo-Generator/pages/sublimation.tsx) 现有“资料读写策略”区域，不新增独立设置面板。

### 7.2 历战记录分组结构

继续保留两个复选框：

- `升华时读取`
- `升华后写入`

仅当 `升华后写入 = true` 时，在其下展开三项单选组：

- `保留全部历史`
- `只保留升华记录`
- `清空全部历史`

### 7.3 辅助说明文案

单选组下方显示即时说明：

- `保留全部历史`：保留全部既有历战，并追加本次升华记录
- `只保留升华记录`：仅保留历次升华记录，并追加本次升华记录
- `清空全部历史`：清空既有历战，仅保留本次升华记录，并重置世界线

### 7.4 交互细节

- 当 `升华后写入 = false`：
  - 单选组收起
  - 但不清空已选策略
  - 再次勾选时恢复上次选择

- 生成中：
  - 这组控件全部禁用
  - 避免请求进行中切换策略

- 切换流式 / 非流式模式：
  - 不重置策略

- 本期不为 `清空全部历史` 增加二次确认

### 7.5 偏好记忆

沿用现有升华页面本地偏好机制：

- 默认值：`只保留升华记录`
- 用户修改后持久化到 `localStorage`
- 流式 / 非流式共用同一个策略偏好

---

## 8. 流式与非流式落地方式

### 8.1 非流式

非流式接口继续负责：

- 结构化生成
- 目标模板转换
- 最终 `sublimatedData` 返回

要求：

- 服务端返回的 `sublimatedData` 必须已经是“按所选策略写回 `arena_history` 后”的最终 JSON
- 下载、保存到云端、再次继续升华时，均以此最终 JSON 为准

### 8.2 流式

流式体验保持现状：

- 实时返回 Markdown
- 页面继续展示通用角色卡预览

但在最终结果层面：

- 下载/保存所使用的 JSON 也必须应用同一套 `arena_history` 写回策略
- 页面预览不要求展示完整 `arena_history` 元数据

页面可增加一条轻提示：

`下载/保存的 JSON 已按所选历战策略写回；页面预览不展示这部分历史元数据。`

### 8.3 一致性边界

本次统一的是：

- 最终下载/保存 JSON 的 `arena_history` 语义

本次不统一的是：

- 流式与非流式的正文生成形式
- 流式是否具备完整目标模板结构

---

## 9. 接口契约与共享组装层

### 9.1 新增请求字段

前端到后端新增字段：

- `arenaHistoryRetentionStrategy`

取值固定为：

- `keep-all`
- `keep-sublimation-only`
- `reset-all`

设计原则：

- 该字段只描述“写回保留策略”
- 不复用 `readArenaHistory` / `writeArenaHistory` 的布尔含义
- 当 `writeArenaHistory = false` 时，服务端忽略该字段，但允许前端继续传递

### 9.2 非流式接口调整

涉及文件：

- [`pages/api/generate-sublimation.ts`](/home/muofu/code/MahoShojo-Generator/pages/api/generate-sublimation.ts)

调整方式：

- 不再在 handler 内直接写死“只保留 `type === "sublimation"`”
- 改为调用共享的 `arena_history` 结果组装函数

### 9.3 流式接口与前端结果组装调整

涉及文件：

- [`pages/api/generate-sublimation-stream.ts`](/home/muofu/code/MahoShojo-Generator/pages/api/generate-sublimation-stream.ts)
- [`pages/sublimation.tsx`](/home/muofu/code/MahoShojo-Generator/pages/sublimation.tsx)

调整方式：

- 流式接口接收同一个 `arenaHistoryRetentionStrategy`
- 页面在最终下载/保存用 JSON 组装时，调用同一套 `arena_history` 写回规则

### 9.4 共享纯函数建议

建议抽出独立模块，例如：

- `lib/sublimation/arena-history.ts`

建议暴露纯函数：

```ts
type ArenaHistoryRetentionStrategy =
  | 'keep-all'
  | 'keep-sublimation-only'
  | 'reset-all';

type BuildSublimationArenaHistoryInput = {
  sourceArenaHistory: unknown;
  newEntry: unknown;
  strategy: ArenaHistoryRetentionStrategy;
  nowIso: string;
};

function buildSublimationArenaHistory(input: BuildSublimationArenaHistoryInput): unknown;
```

职责：

- 根据输入历史、本次新增记录、策略与时间，返回完整 `arena_history`
- 不关心 AI 生成过程，不关心页面状态，只负责结果语义

这样做的好处：

- 非流式 / 流式共用一套规则
- 便于单测
- 后续如需扩展 `current_state` 策略，可在同层继续演进

---

## 10. 错误处理与兼容策略

### 10.1 非法策略值

若收到非法 `arenaHistoryRetentionStrategy`：

- 服务端回退为默认值 `keep-sublimation-only`
- 记录日志
- 不直接返回 400

原因：

- 这是偏好型字段，非核心业务输入
- 回退默认值更稳，能减少因为本地缓存脏数据导致的请求失败

### 10.2 原始数据缺失容错

需要兼容以下输入：

- 原卡没有 `arena_history`
- `arena_history.attributes` 缺失
- `entries` 不是数组或为空数组
- `entries.id` 不可解析为数值

目标：

- 结果仍能生成合法的 `arena_history`
- 不因旧数据格式不规范导致升华失败

---

## 11. 测试设计

### 11.1 共享纯函数单测

至少覆盖：

1. `keep-all` 正常保留所有历史并追加新记录
2. `keep-sublimation-only` 仅保留升华记录并追加新记录
3. `reset-all` 仅保留新记录，并重置世界线与计数
4. `writeArenaHistory = false` 场景下不应用策略
5. 无历史 / 空历史 / 缺失 attributes / 非数值 id
6. `reset-all` 时 `world_line_id` 变化且 `sublimation_count = 1`

### 11.2 非流式接口测试

至少覆盖：

1. 请求携带三种合法策略时，返回正确的 `sublimatedData.arena_history`
2. 非法策略值时回退默认策略
3. `writeArenaHistory = false` 时原历史保持不变

### 11.3 页面测试

至少覆盖：

1. 勾选 `升华后写入` 才显示策略单选组
2. 关闭后重新开启可恢复上次所选策略
3. 切换策略会写入本地偏好
4. 切换生成模式不会重置策略

### 11.4 流式结果测试

至少覆盖：

1. 页面预览仍是通用角色卡，不要求展示完整 `arena_history`
2. 最终下载/保存所用 JSON 已按策略写回 `arena_history`

---

## 12. 风险与实现注意点

1. **流式预览与最终 JSON 不完全同构**
   - 这是本次刻意保留的边界
   - 需要在 UI 上用轻提示说明，避免用户误以为预览即最终完整 JSON

2. **页面状态继续堆积的风险**
   - `pages/sublimation.tsx` 已较长
   - 不应把更多结果组装逻辑直接继续堆在页面组件中
   - 建议抽出前端 helper 与共享结果组装层

3. **内容层字段不可随意重命名**
   - `arena_history` 属于兼容协议层
   - 本次只调策略，不碰 snake_case 协议字段

4. **默认行为保持兼容，但文案必须更清晰**
   - 即使默认仍为“只保留升华记录”，也要在 UI 上明确暴露该策略
   - 避免继续出现“用户以为只是追加，实际被过滤”的误解

---

## 13. 后续扩展位

本期不实现，但可在后续计划中评估：

1. `current_state` 的保留 / 重置策略
2. 流式升华最终结构化结果的进一步统一
3. 更多精细化历战策略（如按条数、按来源、按时间裁剪）

---

## 14. 结论

本次设计的核心是：

- 把“升华后如何保留历战”从隐式固定逻辑升级为显式策略
- 在不重做流式升华生成范式的前提下，统一流式与非流式最终 JSON 的 `arena_history` 语义
- 保持默认行为兼容现状，同时给用户真正可控的历史保留选择

推荐按本稿进入实现计划阶段。
