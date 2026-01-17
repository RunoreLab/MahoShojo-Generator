# 魔法茶会：设计-实现差异与缺口清单

日期：2026-01-17
范围：docs/MAGIC_TEA_PARTY_2026-01-15.md 与当前代码实现

## 一、已完成（本轮落地）
- `outputPlan` + JSONL 侧信道解析：`summary/updates` 不再混入正文，输出计划与提示语已打通。
- `updateApplyMode` 自动写入策略：支持 auto/confirm/draft，并具备自动写入快照与撤销入口。
- `PresetCharacterPanel` + `DecksModal`：预设角色选择、卡组导入落地。
- `CharacterPanel` 基础能力：角色列表、设为玩家、导出 JSON、移除角色。
- 会话清理与归档 UI + 后台清理逻辑：`sessionRetentionDays/maxSessions` 预览、排除当前会话。

## 二、仍需补强
- 更新草案差异预览（角色卡变更对比视图）。
- `CharacterPanel` 高级功能：角色编辑、历战全量查看、云端保存/替换。
- 预设角色徽章展示、角色排序/拖拽与面板联动。
- SillyTavern JSONL 互转样例验证与字段映射补齐（以最新版本为准）。
- 归档增强：ZIP（含图片与附件）导出。

## 三、主要风险点
- 合并输出若未严格侧信道处理，易污染对话历史与摘要上下文。
- 自动写入误判会污染角色卡，需要快照与撤销兜底。
- 自动清理若无预览与保护规则，容易误删会话（需排除当前会话）。
