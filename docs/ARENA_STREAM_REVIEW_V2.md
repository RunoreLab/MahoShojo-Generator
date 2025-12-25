# 竞技场「流式生成」二次复查报告（含元数据方案 A 落地后）

生成时间：2025-12-23  
范围：流式生成（`/api/arena/generate-stream`）→ 前端消费（`useBattleEngine`）→ 元数据解析（`extractStreamUpdateMeta`）→ 角色更新（`useStreamCombatantUpdater` → `/api/arena/update-combatants-after-stream`）

---

## 1. 本轮复查结论

元数据方案 A（HTML 注释尾部 JSON）已经实现了“最大化角色更新成功率”的关键路径，且具备较强的修复能力（`jsonrepair` + 归一化）。  
本轮在此基础上又补齐了若干会导致“明明有元数据但仍然无法更新”的细节，并加强了对“错误/不完整元数据”的兜底处理。

---

## 2. 本轮已落地的改进（确定无误、已直接修改代码）

### 2.1 修复提示词自相矛盾（正文禁止 JSON vs 元数据需要 JSON）

此前流式提示词里存在“不要输出 JSON/字段名”与“输出元数据 JSON”之间的冲突，容易让模型选择性遵循导致元数据缺失。  
已改为：

- **正文部分**禁止 JSON/字段名  
- **仅允许最后一行 HTML 注释元数据**包含 JSON/字段名（用于解析更新）

涉及文件：`lib/arena/logic.ts:391`

### 2.2 元数据要求包含 `report.headline/report.winner`（提升兜底能力）

仅靠正文解析 headline/winner 仍可能被截断/格式漂移影响；元数据中补齐 report 字段可显著降低“写历战记录被服务端拒绝”的概率。  

涉及文件：`lib/arena/logic.ts:391`

### 2.3 “meta-only/短内容”不再被 120 字门槛拦截

当成功提取到 `meta.impacts` 时，已绕过 `trimmed.length >= 120` 的完成态判定，避免“有元数据但因为正文很短而直接失败”。  
同时增加 UI 提示：若正文为空但元数据存在，会提示仍在尝试更新角色。

涉及文件：`components/arena/hooks/useBattleEngine.ts:544`

### 2.4 元数据 impacts 在发送前做阵容校验、歧义拒绝、去重与截断

为避免模型输出的 impacts：
- 名字不匹配导致服务端找不到角色 → 更新丢失
- 名字模糊匹配导致错绑（如“明”匹配到多个参战者）  
已实现：

- 先精确匹配，再做**唯一**包含匹配（多命中则拒绝该条）
- 对 impacts 做去重
- 覆盖不完整会 `warn`，但仍对已匹配角色尽量更新
- `impact/currentStateSummary` 做 2000 字符截断，降低超大输出导致请求/写入失败的概率

涉及文件：`components/arena/hooks/useStreamCombatantUpdater.ts:41`

### 2.5 元数据提取性能与安全性：仅扫描尾部窗口

注释元数据设计为“文末追加”，因此提取时只扫描尾部固定窗口可避免极长文本下的多次 `lastIndexOf` 退化。  
已实现尾部扫描窗口 `120_000` 字符。

涉及文件：`lib/arena/stream-meta.ts:56`

---

## 3. 仍建议继续改进的点（需要评审/可能涉及产品取舍）

### P0：服务端再做一次 meta 兜底解析（更可靠）

当前 meta 解析发生在前端：如果用户浏览器异常/脚本中断，更新就不会触发。  
建议：在 `/api/arena/generate-stream` 的“旁路日志收集”阶段，也做一次尾部 meta 提取（仅用于日志/诊断，或在未来扩展为服务端自动更新）。

收益：更强可观测性（能统计 meta 输出成功率/修复率/失败原因）。  
风险：需要谨慎避免把 meta JSON 大段写进日志字段，建议“剥离 meta 后再做 preview”。

### P1：当用户开启 `writeCurrentState` 且 meta 缺失时，自动触发一次“重做更新”

如果模型偶尔漏写元数据，那么“写当前状态”仍可能不生效。  
可选策略：
- 流式完成后，若 `writeCurrentState=true` 且 meta 缺失（或覆盖不全），自动调用 `/api/arena/redo-combatant-updates` 生成 impacts/currentStateSummary 做补齐。

收益：最终一致性最强。  
代价：额外一次模型调用（成本/耗时），UI 需要明确“战报已出，角色更新补齐中”。

### P1：将 “更新成功/覆盖率” 显式反馈给用户

目前覆盖不完整只在 console/logger 中记录。  
建议在 UI 上以非阻塞方式提示：
- “已更新 X/Y 位角色（其余角色未在元数据中出现）”
- 提供一键“重做角色更新”

### P2：协议演进：SSE 分通道（markdown/meta/done）

长期最稳健的方式仍是把正文与结构化数据分通道传输（SSE 或分块 JSON），彻底避免“靠 Markdown 解析结构”的天然不确定性。  
该改动较大，建议作为后续版本规划项。

---

## 4. 回归情况

- 已通过：`bun test`、`bun run lint`

