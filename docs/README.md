# 文档导航

`docs/` 负责存放主题入口、决策记录、目标架构、实施规格、阶段计划、报告、参考资料与过程日志。

## 当前权威入口

Arena 战报正文存储与有限保留工作使用以下专项入口：

- [Arena 战报正文分层与有限保留实施规格](./specs/2026-08-31_102000_Arena战报正文分层与有限保留实施规格.md)
- [R2 战报 540 天 Lifecycle 上线 Runbook](./runbooks/2026-08-31_102100_R2战报540天Lifecycle上线Runbook.md)
- [D1、R2、Redis 存储优化实施计划](./plans/2026-08-31_102200_D1_R2_Redis存储优化实施计划.md)

该专项冻结 D1 metadata、existing Redis replay 与 finite R2 的正文分层；540 天是基于 2026-08-31 已知 bucket 数据的候选值，production Lifecycle 在账户其他 R2 使用和现有规则完成管理权限 read-back 前仍为 blocked。

平台重整、本地优先、Monorepo、管理后台、Desktop/Mobile、本地库、Direct AI、发行与服务器权威相关工作，从下列主题页进入：

- [低成本 Hosted DR 与客户端预检切换主题](./topics/2026-08-29_070000_低成本HostedDR与客户端预检切换.md)
  - Hosted Hono/Next DR、流量选择、付费控制面、故障切换与重放边界的当前专项入口；
  - 在该专项范围内，本文档列出的新 ADR/spec 优先于较早的 stable control plane / Cloudflare LB 目标口径。
  - 当前仓库实现与审查证据见 [低成本 Hosted DR 客户端预检实施与审查日志](./logs/2026-08-29_085000_低成本HostedDR客户端预检实施与审查日志.md)。
- [平台重整与本地优先架构主题](./topics/2026-08-22_022000_平台重整与本地优先架构.md)
  - 平台重整、Local-first、Monorepo、应用边界、管理后台、Desktop/Mobile、数据所有权与发行的综合入口。
  - Admin G3-P0 当前实现与审查证据见
    [Admin 回归 G3-P0 安全基座实施与审查日志](./logs/2026-08-29_184200_Admin回归G3-P0安全基座实施与审查日志.md)。

两个主题页共同明确当前稳定决策、目标架构、可测试实施规格、阶段计划、仍然有效的领域规格与只作为历史背景的旧方案；发生 Hosted DR 专项冲突时，以 2026-08-29 的专项主题及其 accepted ADR/spec 为准。

## 目录说明

- `topics/`：主题级稳定入口，汇总当前口径、权威文档、取代关系和延后事项。
- `decisions/`：单点架构决策记录（ADR），适合长期引用。
- `architecture/`：长期系统边界、部署单元、依赖方向、信任区与数据所有权。
- `specs/`：规范性定义、结构设计和可测试的实施要求。
- `plans/`：阶段顺序、退出门禁、回滚点和交付拆分。
- `migration/`：迁移台账、字段映射、兼容损耗和生产切换记录。
- `reports/`：阶段评估、专题研究和历史推演。
- `references/`：来源笔记、外部标准与其他仓库复用证据。
- `logs/`：实施证据与过程留痕，不作为稳定结论源。

## 推荐阅读顺序

1. 先读对应 `topics/` 主题页，确认当前权威口径和取代关系。
2. 需要稳定单点结论时读 `decisions/`。
3. 设计系统边界时读 `architecture/`。
4. 编码、测试和验收时读 `specs/`。
5. 安排实施顺序、生产门禁和回滚时读 `plans/`。
6. 需要历史论证和调研背景时再读 `reports/` 与旧计划。
7. `logs/` 只用于核对实施证据，不得覆盖 ADR、架构或规格。
