# 魔法茶会：设计-实现差异与缺口清单

日期：2026-01-17
范围：docs/MAGIC_TEA_PARTY_2026-01-15.md 与当前代码实现

## 一、已确认待落地（优先）
- `outputPlan` 合并输出（summary/updates 与主流合并，JSONL 侧信道解析落库）。
- `updateApplyMode` 自动写入策略（auto/confirm/draft）与降级/回滚机制。
- `PresetCharacterPanel` + `DecksModal` 角色卡组导入与预设角色选择面板。
- `CharacterPanel`（角色卡管理/更新/历战全量查看/编辑/导出/云端保存/替换）。
- 会话清理（`sessionRetentionDays/maxSessions`、预览确认、排除当前会话与未来置顶）。
- 归档增强（默认 JSON 已有；可选 ZIP 含图片需要新增）。

## 二、部分实现仍需补强
- 更新草案差异预览与“撤销/回滚快照”入口（自动写入场景必需）。
- JSONL `summary/updates` 与 notice 的剥离规则一致化，避免混入时间轴。
- SillyTavern JSONL 互转样例验证与字段映射补齐（以最新版本为准）。
- 预设角色徽章与折叠持久化、角色排序/拖拽与角色面板联动。

## 三、主要风险点
- 合并输出若未严格侧信道处理，易污染对话历史与摘要上下文。
- 自动写入误判会污染角色卡，需要快照与撤销兜底。
- 自动清理若无预览与保护规则，容易误删会话（需排除当前会话）。

