# 全局命名规范与落地指南（2026-02-28）

## 1. 背景与目标

近期在 Auth + ORM 升级后出现了权限字段兼容缺失问题：数据库字段与业务字段命名风格不一致，边界映射未覆盖完整，导致关键逻辑退化。

本规范目标：
- 在**全项目范围**建立统一、可执行、可测试的命名策略；
- 将命名差异收敛在边界层，避免业务层反复处理字段别名；
- 降低迁移、重构与 AI 辅助开发时的回归风险。

## 2. 总体策略

采用“**分层统一 + 边界映射**”：
- 每一层内部只使用一种命名风格；
- 层与层之间通过显式 mapper/adapter 转换；
- 禁止跨层直接透传原始对象。

## 3. 分层命名矩阵（全局适用）

1. 数据库层（D1/SQL/迁移脚本）
- 统一使用 `snake_case`
- 例：`is_review_exempt`、`review_status`

2. ORM/Repository 输出到业务层
- 统一转换为 `camelCase`
- 例：`isReviewExempt`、`reviewStatus`

3. 服务层/业务层（`lib/` 业务模块）
- 统一使用 `camelCase`
- 禁止直接访问 `snake_case` 字段

4. API 契约层（`pages/api` 与 `app/api`）
- 输入：可在兼容期接受 snake/camel 双风格
- 输出：统一 `camelCase`（单一 canonical）

5. 前端层（`components/`、`pages/*.tsx`）
- 统一使用 `camelCase`
- 类型名、组件名使用 `PascalCase`

6. 常量与枚举
- 常量：`UPPER_SNAKE_CASE`
- 枚举成员：按现有 TS 习惯统一（建议 PascalCase 或语义字符串值）

## 4. 关键约束

1. 禁止长期双字段并存
- 例如：`is_review_exempt` 与 `isReviewExempt` 不得在同一领域对象中长期共存。

2. 兼容期策略
- 读取可兼容双字段；
- 写出必须归一到 canonical（默认 `camelCase`）；
- 兼容期结束移除旧字段，补迁移说明。

3. 边界集中化
- 命名转换必须放在 repository/adapter/mapper；
- 业务层禁止零散 `record.xxx ?? record.yyy` 的临时写法。

4. 测试兜底
- 每个关键边界 mapper 至少 1 条测试；
- 覆盖场景：snake 输入、camel 输入、canonical 输出。

## 5. 新增字段落地流程（适用于所有模块）

1. 先定义 canonical 字段名
- 业务与 API 统一使用 `camelCase`。

2. 数据层建模
- schema/SQL 使用 `snake_case` 列名；
- repository 映射到 `camelCase`。

3. 边界映射
- 在单一 mapper 内完成 snake <-> camel 转换；
- 禁止在调用方重复实现。

4. 类型与契约
- 更新 TypeScript 类型定义；
- 更新 API 输入输出约束与文档。

5. 验证
- 添加单测/集成测试；
- 至少验证 1 条历史兼容路径（如旧字段输入）。

## 6. 旧字段治理流程（适用于全局存量模块）

1. 标记旧字段为 deprecated
- 文档记录兼容窗口与移除时间。

2. 兼容读 + 统一写
- 读：双字段兜底；
- 写：只写 canonical。

3. 回归验证
- 关键业务路径（鉴权、审核、权限、计费、数据卡）必须补回归。

4. 移除旧字段
- 版本窗口结束后删除兼容分支；
- 清理对应测试并更新文档。

## 7. PR 检查清单（必须勾选）

1. 是否引入了跨层字段？若是，是否有 mapper？
2. 业务层是否仍出现数据库 `snake_case` 字段访问？
3. API 输出是否仍保持单一 canonical 命名？
4. 是否补了命名兼容回归测试？
5. 是否更新了相关文档与类型定义？

## 8. 适用范围声明

本规范适用于项目全部模块。

## 9. AI 驱动开发附加要求

1. 生成代码前先确认当前层的 canonical 命名；
2. 仅在边界层处理命名兼容，不在业务层散落兼容逻辑；
3. 提交改动时必须同步提交 mapper 测试或更新现有测试；
4. 若发现历史命名混用，优先补边界收敛，再做业务改造。
