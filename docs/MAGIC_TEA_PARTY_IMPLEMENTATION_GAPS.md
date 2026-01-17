# 魔法茶会：设计-实现差异与缺口清单

日期：2026-01-17
范围：docs/MAGIC_TEA_PARTY_2026-01-15.md 与当前代码实现

## 一、已规划但未落地（需排期/取舍）
- `outputPlan` 合并输出（summary/updates 与主流合并）尚未实现；JSONL 解析仅支持 narration/dialogue/choices/notice（`lib/magic-tea-party/jsonl.ts`）。
- `updateApplyMode` 自动写入/降级/回滚未接入；当前仅手动“生成草案 → 确认写入”（`components/magic-tea-party/SummaryPanel.tsx`）。
- 角色面板（角色管理/历战全量编辑/下载与云端保存/替换）未落地；仅有摘要面板的简化更新流程。
- 预设角色面板（`PresetGridPicker` 无状态化）与卡组导入（`DecksModal`）未接入；现为 BattleDataModal 多选 + 本地上传/粘贴。
- 会话保留与自动清理（`maxSessions` / `sessionRetentionDays`）未实现；目前仅立绘缓存清理。
- ZIP 归档导出与资源打包未实现；当前归档为 JSON，且不含二进制资源。
- 选项数量弹性（1~16）未实现；当前 UI/API 仅 2~4。
- 角色更新的“撤销/回滚快照”入口未实现（计划保留最近 3~5 次）。

## 二、部分实现但仍需对齐/补强
- 更新草案的“差异预览”与“自动写入”策略未落地，UI 仅展示草案内容与确认写入按钮。
- 预设角色徽章/折叠状态持久化与角色排序拖拽尚未接入。
- 导入/导出虽然支持 SillyTavern JSONL，但仍需用最新样例验证字段映射与兼容性。

## 三、关键对齐点（改动会影响多处）
- 若启用 `summary/updates` 合并输出，需要同步更新：JSONL 解析、时间轴落库规则、notice 剥离逻辑、更新草案存储与 UI。
- 若放宽 `choiceCount` 至 1~16，需要同步更新：前端设置、API 参数校验、提示词与选项生成策略。

