# style 分支能力择优吸收记录（2026-03-01）

## 1. 目标

在不引入回归与兼容问题的前提下，吸收 `style/命名分层统一化` 的低风险工程能力。

## 2. 本次已吸收

1. 命名检查工具（非阻断接入）
- 新增：`scripts/check-naming-conventions.mjs`
- `package.json` 新增脚本：
  - `check:naming`：`node scripts/check-naming-conventions.mjs --report-only`
  - `check:naming:strict`：`node scripts/check-naming-conventions.mjs`
- 说明：默认使用 `report-only`，仅做审计，不阻断现有开发流程。

2. 兼容回归测试
- 新增：`tests/arena-history-compat.test.ts`
- 新增：`tests/current-state-panel.test.tsx`
- 目的：补齐历史 snake 字段兼容的自动化回归保护。

## 3. 本次明确暂缓

1. `scripts/migrate-snake-members-to-camel.mjs`（自动迁移脚本）
- 原因：属于批量改写工具，误改面大，不符合“当前回归风险最小化”目标。
- 策略：后续仅在专门迁移批次中使用，并配套模块级回归与灰度方案。

2. `style` 分支业务代码整段并入
- 原因：变更面跨 `pages/api/pvp`、`lib/database`、`components`，一次并线爆炸半径过大。
- 策略：继续按模块小批次吸收，保持可回滚。

## 4. 验证结果

本次改动后已通过：

1. `bun run check:naming`（report-only，命令成功）
2. `bun test tests/arena-history-compat.test.ts tests/current-state-panel.test.tsx`
3. `bun run lint`
4. `bun test`（全量）
5. `bun run build`

结论：当前吸收项未引入编译、测试或构建回归。
