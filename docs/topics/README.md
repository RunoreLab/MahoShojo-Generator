# 主题入口

更新时间：2026-08-22
状态：`active`

`docs/topics/` 用来提供稳定主题的入口，负责说明主题范围、权威文档、已稳定口径、取代关系和仍需门禁验证的事项。

## 使用顺序

1. 先进入对应主题页，确认稳定结论和权威文档。
2. 需要稳定单点结论时，跳转到 `docs/decisions/`。
3. 需要长期系统边界时，跳转到 `docs/architecture/`。
4. 需要可测试要求时，跳转到 `docs/specs/`。
5. 需要推进顺序时，跳转到 `docs/plans/`。
6. 需要推演背景时，跳转到 `docs/reports/`。
7. 过程日志不得覆盖主题页、ADR、架构或规格。

## 当前主题

- `active`：[平台重整与本地优先架构](./2026-08-22_022000_平台重整与本地优先架构.md)
  - Monorepo、Admin 回归、Direct AI、自定义 Endpoint、本地库、Desktop/Mobile、GitHub Release、服务器权威、多人与 PVP 门禁、Legacy 本轮边界。

## 目录职责

- `docs/decisions/`：单点稳定决策。
- `docs/architecture/`：系统与仓库长期边界。
- `docs/specs/`：规范性定义和可测试要求。
- `docs/plans/`：阶段顺序、门禁与回滚。
- `docs/reports/`：专题研究和历史推演。
- `docs/references/`：来源与外部资料。
- `docs/logs/`：过程记录，不作为稳定结论源。

## 编写规则

主题页应明确：

- 状态与更新时间；
- 权威文档；
- 已稳定口径；
- 历史文档取代关系；
- 已延后事项和进入决策的门禁；
- 后续开发入口。
