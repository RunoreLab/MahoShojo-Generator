# 本地库 Web 落地与 BattleDataModal 一等数据源规格

状态：`accepted`

日期：2026-09-29
规格标识：`SPEC-local-library-web-landing-v1`

适用范围：Web 端本地库（数据卡与 Web 包）的存储、选择、复制与删除体验。

本文件是 [`ADR-local-library-data-ownership`](../decisions/2026-08-22_022300_本地库与数据所有权决策.md)
与 [平台重整实施规格 §7](./2026-08-22_022600_平台重整实施规格.md) `LIB-001..012` 的落地口径。
两者继续有效；本文件只补充「在 Web 上具体怎么落地」，冲突时以 ADR 为准。

---

## 1. 背景与当前状态

Phase 2 已在 `packages/local-library` 建立 runtime-neutral 的记录契约、软删仓储端口、单调迁移与
archive manifest，但**没有任何 runtime 消费它**：无 IndexedDB adapter、无 CRUD UI、无复制入口。
2026-09-29 前，Web 上与「本地」相关的持久化全部是缓存或会话状态：

| 层 | 位置 | 性质 |
| --- | --- | --- |
| Web 包 session staging | `packages/web-package/src/session-staging.ts` | 进程内 Map，刷新即失 |
| Web 包 archive cache | `apps/web/lib/web-package/cache.ts` `mahoshojo-web-package-cache:v1` | best-effort、无上限、无删除入口 |
| Web 包同源信任 | `apps/web/lib/web-package/trust.ts` localStorage | 永久，撤销入口只挂在战报重放页 |

它们各自独立地让一个「用户认定不可信的包」无法从浏览器移除，并且同源授权会在重新导入同样字节时
静默复用、跳过三秒确认。这与 ADR「本地库是用户拥有的设备数据」不是同一件事。

本轮把本地库落地为正式一等数据源，同时承接 Web 包。

---

## 2. 决定

### 2.1 存储

- Web 本地库 MUST 使用独立 IndexedDB `mahoshojo-local-library`（`LIB-002`），不复用 AI session DB、
  公开卡 cache、rank cache 或 localStorage。
- 数据卡与 Web 包分表存放；Web 包的 ZIP 字节另存一表，使列表查询不必反序列化包内容。
- 记录与 archive 字节 MUST 在同一事务写入：只有记录没有字节的行视为损坏，MUST 在 UI 上点名，
  而不是等用户点下去才失败。
- `mahoshojo-web-package-cache:v1` 降级为**一次性迁移源**。迁移成功且旧表已清空才写完成标记；
  读不到旧库时 MUST NOT 清空它，MUST 保留下次重试的机会。

### 2.2 记录模型

`LocalCardRecordV1` 保持不变用于数据卡。Web 包不是数据卡，MUST NOT 通过往 `cardType`
里塞 `'web-package'` 来表达——`OnlineDataCardType` 是线上数据卡枚举，被 16 处消费点依赖。
本轮新增正交维度 `LocalWebPackageRecordV1`（`entityKind: 'web-package'`），两者共享
`storageLocation` / `contentDigest` / `provenance` / 时间戳这几条不变量，但各自保留身份与载荷形状。

### 2.3 内容身份与去重

- 数据卡：摘要 MUST 只覆盖卡正文，NOT 覆盖标题、作者、时间戳、云端 ID 与签名。改一次标题或换一次
  签名 MUST NOT 产生新记录，否则本地库会被同一张卡的每次微调填满。
- Web 包：内容身份就是 `ref.digest`（canonical manifest 的 SHA-256），天然满足该要求。
- 摘要命中时 MUST **整卡替换**。字段级合并会造出用户从未写过的第三态；本地库一旦开始堆积
  似曾相识的条目，用户就再也分不清哪条是真的。
- 仓储禁止普通 `put` 清除 tombstone。导入路径 MUST 在写入前显式 `restore`：用户删掉之后再导入
  同一份文件是明确的"我要它回来"，不是隐式复活。

### 2.4 选择体验

- `BattleDataModal` 新增 `local` tab，与「我的 / 公开 / 管理员推荐 / 我的收藏」并列。
- 本地库 MUST **不做登录门控**：未登录、断网时仍可用，这正是它与 `my`/`favorites` 的根本差异。
- 本地库卡片复用 `DataCard` 的渲染路径，但以 `storageLocation: 'local'` 切换动作集：
  点赞/收藏/分享/审核徽章 MUST NOT 出现，改为删除/导出/详情，并显式标注「本地库」。
- 本地库记录 MUST NOT 参与服务器侧批量元数据与技术值请求，也 MUST NOT 走单卡读取接口。
- **本地库记录 MUST NOT 携带服务器身份**：选择本地卡产出的 payload MUST NOT 含 `sourceDataCardId`。
  一旦带上，`arena-room/shared-config` 会把它归类为 online content reference 发布进房间共享配置，
  PVP 提交同样会带上它——那是把 device-owned 数据冒充成 server-authoritative 实体，
  直接违反 `ADR-local-library-data-ownership` §2。同时它也就无法参与 Strict 排位，
  这与[平台重整目标架构 §7.3](../architecture/2026-08-22_022500_平台重整目标架构.md)
  「本地库记录必须先显式进入线上库并获得服务器实体 ID 才能参与 Strict」一致。
- Web 包的选择、搜索、导入、删除与详情 MUST 位于独立模态框，复用 `BattleDataModal` 的产品模式
  但不复用它的组件：Web 包不是数据卡，塞进去会让 `onSelectCard(payload)` 契约分裂。
- **未落本地库、只存在于会话 staging 的包 MUST 仍然可见可选**，并标注为「仅本次会话」。
  导入默认不落盘（见 §2.6），若这类包不可选，用户刚导入完就会看到「不可用的 Web 包」，
  而重新勾选偏好再导入一次并不是用户预期中的补救。
- sessionOnly 的条目 MUST NOT 提供删除入口：本地库没有对应行可删，给一个按钮只是假动作。
- 内置预设与本地库 MUST 分属两个 tab。

### 2.5 复制与删除（`LIB-007` 的本轮范围）

本轮实现：

- 保存到本地库：本地导入时按偏好自动保存；线上数据卡可在详情弹窗「存到本地库」复制一份
  （`cloudRef` 与线上记录保持可辨认的对应关系）。
- 从本机删除：独立于「移除选择」，MUST 二次确认并说明历史战报退化为 `missing-package`。

本轮 **NOT** 实现，且 MUST NOT 声称已满足：

- `LIB-007` 的**导出与备份/恢复**。`packages/local-library` 的 archive manifest 契约已具备
  （路径安全、内容寻址 assets、checksum），但 ZIP 打包、覆盖前备份、恢复时的冲突策略与
  「导入不触网」验证尚未实现。半成品的导出比没有导出更危险：用户会以为有备份。
- `LIB-004` Installed APP 的 SQLite adapter。

### 2.6 偏好与风险提示

- 「导入时保存到本地库」是**设备偏好**，不是库内容，默认关闭。它与本地库记录分开存放，
  且在 IndexedDB 不可用时仍然可改——否则用户连「不要再自动保存」都选不了。
- 本地库界面 MUST 展示持久化存储状态与空间占用，未获授权时提供申请入口（`LIB-003`），
  并 MUST 提醒清除站点数据会删除本地库、不会跨设备同步。
- 空间读数 MUST 按量级选单位；把 1 KB 显示成「0.0 MB」会让用户以为读数坏了。

### 2.7 多人边界

本地库内容不进入房间共享状态。`ArenaRoomProposalWorkspace` 通过 `visibleTabs` 天然只暴露
`public` / `recommended`；Proposal adapter 的 `manageLibrary` 为 `false`，任何本地库动作都只
报「多人模式不支持」，不静默失败。

---

## 3. 与既有文档的关系

- `SPEC-web-package-unified-v1` §10 与 §16.1 已按本轮结论原位修订（可选缓存 → 本地库；
  删除闭环；独立模态框）。
- `SPEC-web-package-unified-v1` 的「未来线上 Web 包库复用 `BattleDataModal` 产品模式」仍然有效，
  但 Web 包本地库没有并入 `BattleDataModal` 组件本身，理由见 §2.4。

---

## 4. 验证

- `packages/local-library`：记录契约、repository 端口、archive manifest 有独立测试。
- `apps/web/tests/local-library-repository.test.ts`：IndexedDB adapter 的软删、幂等、
  不得隐式复活、损坏行不得冒充空库、跨 realm 字节读取、时钟回拨下的单调时间戳。
- `apps/web/tests/local-library-data-cards.test.ts`：内容摘要的稳定性与去重、整卡替换、行映射。
- `apps/web/tests/battle-data-modal-local-library.test.tsx`：未登录可用、本地动作集、删除二次确认、
  详情与选择都不发线上请求。
- `apps/web/tests/local-library-status.test.tsx`：持久化状态、申请入口、不支持时的保守措辞。
- `apps/web/tests/local-library-page-cards.test.tsx`：`/local-library` 回用共源数据卡列表，软删进入回收站、
  恢复走真实 IndexedDB adapter，全程不触网。
- `apps/web/tests/web-package-cache.test.ts`：导入不再写旧缓存、重新导入整卡替换、会话与历史
  水合、一次性迁移的幂等与失败保留。
- `apps/web/tests/data-card-local-library.test.tsx`：真实 `DataCard` 的本地分支（不是只断言 prop 回显）。
- `apps/web/tests/web-package-import-library.test.tsx`：走真实 adapter 的导入路径——默认不落盘时
  仍可选可见、重导入不新增行、保存偏好生效。
- `apps/web/tests/arena-web-package-section.test.tsx` / `arena-web-package-removal.test.tsx`：
  两个来源分 tab、下载在生成期间可用、删除闭环四处状态同时清理。

## 5. 未决事项

- `LIB-007` 导出/备份/恢复的完整实现。
- `LIB-004` Installed APP（SQLite + 文件内容寻址区 + Secure Vault）。
- ~~本地库回收站 UI~~（数据卡部分 2026-10-04 已由 Desktop 计划 D3.2a 落地）：`/local-library` 挂载共源
  `@mahoshojo/ui-web/local-cards`，提供数据卡回收站的恢复与彻底删除（`purge`，二次确认）。Web 包仍无回收站：
  「从本机删除 Web 包」（`removeLocalWebPackage`）对用户的承诺是彻底移除而非移入回收站。
- 导入同内容但已被软删的数据卡：§2.3 要求显式 `restore`，当前 Web 自动保存路径遇墓碑只记为失败，
  待 D3.2b 单卡导入一并收口。
