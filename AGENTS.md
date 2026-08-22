# MahoShojo-Generator 工作指引

本文件只保存全仓长期有效的导航、工作边界与高后果不变量，会快速变化的信息应从仓库当前文件和权威文档中读取。

## 工作原则

- 默认使用中文进行开发交流、文档和提交说明；代码标识符、协议字段及外部标准名称保持既有 canonical 写法。
- 用户只要求分析、审查、调研或规划时，默认只读取和报告；明确要求实现、修复或改文档时，再进行范围内修改和非破坏性验证。
- 先理解现状与约束，再改代码；无授权不顺手扩大范围、无关重构，或提前完成尚未进入当前阶段的工作。
- 优先修复根因并复用既有抽象、schema、contract、adapter 与测试工具；证据不足或规则冲突时明确指出，不要猜测。
- 这是开源公开仓库，不得写入私密信息。

## 先判断：当前事实还是目标口径

**当前实现事实**以当前分支中的代码、manifest、配置、测试和就近 README 为准。常用入口：

- `package.json`、`pnpm-workspace.yaml`：依赖、脚本和 workspace；
- `apps/README.md`：应用迁移状态与部署边界；
- `packages/README.md`：共享 package 职责、exports 与依赖边界；
- `server/README.md`、`config/hono-api-routes.json`：迁移期 Hono/API 现状；
- `.github/workflows/`：当前 CI、发布和部署自动化。

**目标与规范性口径**从 `docs/README.md` 进入。

再按主题页指向的 accepted ADR、architecture、spec 和 plan 继续读取；业务域存在自己的 accepted 规格时同时遵守。

若当前实现与 accepted 口径不一致，将其视为迁移差距：确认当前阶段并渐进闭合。不得用遗留实现否定已接受的目标，也不得把尚未落地的目标描述成当前事实。

## Monorepo 与依赖边界

- `apps/<a>` 不直接导入 `apps/<b>` 内部源码；跨应用共享通过 `packages/*` 或版本化协议完成。
- `packages/*` 不导入 `apps/*`；消费者使用显式 `exports`，不得把内部 `src/*` 深层路径当作稳定 API。
- 纯领域/协议层不得反向依赖具体 UI、服务器框架、数据库或平台 runtime。
- 客户端 package 不得导入服务器秘密、签名能力或管理权限实现。

## 全局架构与安全不变量

详细定义以适用的 accepted ADR/spec 为准，accepted ADR/spec 的强制要求不得只靠 feature flag、临时配置、PR 评论或实现技巧绕过；确需改变时先更新对应权威文档。

## 修改与验证

- 只改完成任务所需的文件；跨边界字段、wire contract、schema 或持久化格式变化时，同步检查 producer、consumer、mapper/adapter、类型、兼容策略和测试。
- 优先使用已有依赖和仓库工具；新增生产依赖时检查 runtime、license、bundle/部署和安全影响。
- 修改后运行“最小但充分”的验证：优先受影响 package/app 的 targeted tests、静态检查和必要 build；涉及 workspace 边界、共享 contract 或跨 runtime 改动时再做相应全局验证。
- 具体命令以当前 manifest 和更近层级的 `AGENTS.md` 为准。无法执行关键验证时说明原因、替代验证和剩余风险；不得声称未实际运行的检查已通过。

## 高风险操作

除非用户明确要求并授权，不得执行 production deploy/切流、remote production migration、生产数据库写操作、secret 或发布凭据变更、release/tag 发布、force push 或历史重写。调查这类流程时优先使用只读、local、dry-run、preview 或状态检查路径；不得为了通过 CI/部署而削弱安全检查或鉴权。

## 文档与可复用工作流

- 修改 `docs/` 前读取 `docs/AGENTS.md` 与 `docs/README.md`。
- 正式文档优先落在 `docs/`，不要把关键决策只写在提交信息里。
- 新文档命名规范：yyyy-MM-dd_HHmmss_中文名.md，现存文档若无要求可不遵循。
- 反复出现且需要多步骤、脚本或外部工具的流程，优先沉淀为 `.agents/skills/` 下的 repo skill。

## 提交与 PR

- 提交标题遵循 Conventional Commit 前缀（可附加类别如 `feat(api):`）；标题和 description 以中文为主，可保留必要英文术语。
- 单次原子化提交聚焦一个可解释主题；迁移骨架、行为修改和大量生成资产尽量分离。
- PR/交付说明列出范围、涉及的 accepted spec/ADR（如适用）、实际验证、未验证项，以及环境变量、迁移或发布影响。

## Code Review Rules

Review 优先找行为、安全、数据和兼容性退化，不把 lint、格式或可由 CI 自动发现的风格问题作为主要 finding。重点检查：

- accepted ADR/spec，尤其强制要求，是否被破坏；
- 是否出现 app→app、package→app、跨 runtime 深层导入或客户端→服务器秘密等非法依赖；
- 是否泄漏凭据、提升客户端信任或绕过服务器权威；
- API/DTO/schema/wire format 是否缺少 producer/consumer 同步、兼容处理或回归测试；
- 数据库迁移、发布、secret、权限或生产切流是否缺少 fail-closed、回滚、幂等或审计门禁；
- 测试是否覆盖实际风险，而不只是证明代码可编译或 happy path 可运行；
- 是否遵循项目规范（例如编码风格与命名约定）。
