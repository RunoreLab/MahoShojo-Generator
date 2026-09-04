# 文档导航

`docs/` 负责存放主题入口、决策记录、目标架构、实施规格、阶段计划、报告、参考资料与过程日志。

## 当前权威入口

平台机制简化、复杂度预算和 Arena 多人发布使用以下最新权威入口：

- [平台复杂度预算与故障降级决策](./decisions/2026-09-01_193200_平台复杂度预算与故障降级决策.md)
- [平台机制简化实施计划](./plans/2026-09-01_193201_平台机制简化实施计划.md)
- [Arena 多人发布最小检查清单](./runbooks/2026-09-01_193300_Arena多人发布最小检查清单.md)
- [平台机制简化建议](./reports/2026-09-01_185700_平台机制简化建议.md)

该 ADR 已接受并覆盖与其冲突的旧口径：Arena 普通战后更新不再由完整角色
`baseRevisionHash` / provenance 连续性阻断；GMR-10Q、GMR-11、source digest、review evidence
和多层 release gate 不再是多人发布前置；已经交付的 AI 结果也不应仅因附加归档失败被改判失败。
认证授权、严格排位、secret、多人 host/member 权限、Provider 防重复 dispatch 与有界资源限制仍然有效。

Arena 多人 v1 production ingress 重整与后续激活使用以下专项入口：

- [Arena 生产 Room 入口复用 Hono Primary 决策](./decisions/2026-08-31_080000_Arena生产Room入口复用HonoPrimary决策.md)
- [Arena 生产 Room 入口简化与架构重整规格](./specs/2026-08-31_080100_Arena生产Room入口简化与架构重整规格.md)
- [Arena 多人生产激活与回滚实施计划](./plans/2026-08-30_231000_Arena多人生产激活与回滚实施计划.md)

Arena 多人 GMR-10P 产品一致性整改使用以下权威入口：

- [Arena 多人产品一致性与既有 Arena 复用修订](./specs/2026-08-31_150000_Arena多人产品一致性与既有Arena复用修订.md)
- [Arena 多人生成眼—手一致与 preflight 收敛修订](./specs/2026-09-04_091400_Arena多人生成眼手一致与preflight收敛修订.md)（覆盖上文的 7.3 preflight 选项，补充 7.2 命令响应收敛）
- [Arena 多人 GMR-10P 产品一致性整改实施计划](./plans/2026-08-31_150000_Arena多人GMR-10P产品一致性整改实施计划.md)
- [Arena 多人 GMR-10P 产品一致性实施与退出审计](./logs/2026-09-01_002500_Arena多人GMR-10P产品一致性实施与退出审计.md)

GMR-10P 的历史整改状态为 `DONE`。原 GMR-11 reviewed source / production activation 证明门禁已由上述复杂度预算
ADR 撤回；当前发布判断以正常 CI、feature flag、运行时 smoke、health 与回滚能力为准。

Arena 多人 GMR-10Q 门禁最小化与单人一致性整改使用以下权威入口：

- [Arena 多人门禁分层、最小化与单人一致性修订](./specs/2026-09-01_073000_Arena多人门禁分层最小化与单人一致性修订.md)
- [Arena 多人 GMR-10Q 门禁最小化与一致性整改实施计划](./plans/2026-09-01_073000_Arena多人GMR-10Q门禁最小化与一致性整改实施计划.md)
- [Arena 多人 GMR-10Q 门禁最小化与一致性实施与退出审计](./logs/2026-09-01_092555_Arena多人GMR-10Q门禁最小化与一致性实施与退出审计.md)

GMR-10Q 的历史整改状态为 `DONE`：房间存在、配置共享、协作、生成就绪、runtime 资源与结果权限已分层，0 角色可先建房，
角色/参考项容量继承 canonical Arena/runtime，未声明例外的多人语义默认继承单人。其 machine evidence 不再构成发布条件。

production ingress 专项关于 Room HTTP/WSS 直接复用 Hosted Hono primary、caller Origin 与 service origin 分离的架构结论
继续有效；旧的 immutable release tuple 与独立 source-review 批准门禁由最新复杂度预算 ADR 取代。运行控制继续保留
服务端 request kill switch 与 Web exposure switch。

Arena 战报正文存储与有限保留工作使用以下专项入口：

- [Arena 战报正文分层与有限保留实施规格](./specs/2026-08-31_102000_Arena战报正文分层与有限保留实施规格.md)
- [R2 战报 540 天 Lifecycle 上线 Runbook](./runbooks/2026-08-31_102100_R2战报540天Lifecycle上线Runbook.md)
- [D1、R2、Redis 存储优化实施计划](./plans/2026-08-31_102200_D1_R2_Redis存储优化实施计划.md)

该专项冻结 D1 metadata、existing Redis replay 与 finite R2 的正文分层；540 天是基于 2026-08-31 已知 bucket 数据的候选值，production Lifecycle 在账户其他 R2 使用和现有规则完成管理权限 read-back 前仍为 blocked。

Arena 战后角色更新的权威对账与可编辑修复使用以下专项入口：

- [Arena 战后角色更新双信任通道规格](./specs/2026-09-01_133000_Arena战后角色更新双信任通道规格.md)
- [Arena 战后角色可编辑修复实施计划](./plans/2026-09-01_133100_Arena战后角色可编辑修复实施计划.md)

该专项关于 generation owner、服务器冻结 effect，以及用户/AI 修复只产生 unsigned、non-canonical 本地派生版本的边界继续有效；
完整角色 base revision 与 provenance 连续性作为普通战后更新许可的要求，已由最新复杂度预算 ADR 撤回。

平台重整、本地优先、Monorepo、管理后台、Desktop/Mobile、本地库、Direct AI、发行与服务器权威相关工作，从下列主题页进入：

- [低成本 Hosted DR 与客户端预检切换主题](./topics/2026-08-29_070000_低成本HostedDR与客户端预检切换.md)
  - Hosted Hono/Next DR、流量选择、付费控制面、故障切换与重放边界的当前专项入口；
  - 在该专项范围内，本文档列出的新 ADR/spec 优先于较早的 stable control plane / Cloudflare LB 目标口径。
  - 2026-09-01 复杂度预算 ADR 已进一步撤回大型 manifest/generated projection/version gate/evidence CI；
    `config/hosted-routing.json`、真实 fault tests 与 dispatch 后 no-replay 是当前口径。
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
