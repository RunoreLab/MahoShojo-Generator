# 共享 Package 边界占位

`packages/*` 只承载可被多个应用复用、且有明确公共契约的代码。依赖方向为：应用可以依赖共享 package；共享 package 不得导入 `apps/*`。`packages/domain` 必须保持纯领域边界，不依赖 Next、React、Hono、Cloudflare、Node、Tauri、Electron、DOM 或数据库 runtime；客户端 package 不得读取服务端秘密、签名或环境模块。

共享 package 必须在自己的 `package.json` 中声明显式 `exports`，消费者只能导入导出的公共入口或已声明子路径，不能把 `src/*` 等内部目录当作稳定 API。

当前 workspace 先采用 source-export/bundler 模式：`exports` 直接指向 `src/*.ts`，`build` 只执行可从 clean checkout 独立运行的 `tsc --noEmit`。其中 `@mahoshojo/config` 用于验证 workspace 配置边界，`@mahoshojo/contracts` 承载可在 Node、Worker 与浏览器消费者间共享的版本化 wire contract、schema 和安全限制。`contracts` 不得读取环境变量，也不得依赖应用、框架或运行时实现。package 中的 `esbuild` devDependency 仅用于固定 Vitest/Vite transform toolchain 的 peer variant，不是业务运行时依赖。

后续发布型 package 再单独设计稳定的 `dist` exports，不把当前 source export 当作发布约定。

D3.1a 增加 `@mahoshojo/ai-core/magical-girl-details-generation` 显式入口：结构化/Markdown Prompt、
输出 schema 与未签名角色卡构造由 Web Hosted 和 Desktop Direct 共用；问卷答案分组/精简规则在
`domain/questionnaire`。Hosted 模型设置、原生问卷许可、限流和签名不进入客户端共享核。

Desktop/Web 的新增共享边界按[产品共源 ADR](../docs/decisions/2026-10-02_184000_Desktop产品架构与Web共源决策.md)逐切片提取：`ui-web` 承载共源 React DOM 页面/控件、主题、产品导航及资源，不能导入 Next/Tauri/服务器 runtime；现有纯业务与执行契约仍归专职包。`cloud-client` 只在真实在线能力接入时建立，**当前尚未实现**，也不因文档修订而创建占位包。

`ui-web` **已于 D2.5a 建立**（见下方清单）。它的边界由 `check-workspace-boundaries.mjs` 的
`MONO-005-SHARED-UI-RUNTIME` 与 `MONO-005-SHARED-UI-DYNAMIC-MODULE` 强制：禁止导入任何宿主 runtime
（Next / Tauri / Hono / Cloudflare / Node builtin / 数据库客户端，且故意不含 react 与 react-dom），
并禁止非字面量 `import()`——后者必需，因为一条能被计算路径绕过的规则不是门禁。样式入口
`./styles.css` 自带 `@source`，Tailwind v4 的自动探测不会向上走到 `packages/`，缺了它的症状是不报错的
无样式页面。

本目录不设一个无边界的 `common`/`shared` 倾倒包。新增 package 应按领域职责命名，并同步维护类型、exports、测试和依赖边界。当前真实 package 为：

- `@mahoshojo/ui-web`：共源 React DOM 页面、控件、功能 hooks、主题与产品资源。显式 feature subpath
  （`./styles.css`、`/navigation`、`/shell`、`/capability`、`/encyclopedia`、`/markdown`、`/home`、`/local-archive`、`/local-cards`、`/card-editor` 等），**不开根 barrel**——
  ADR 要求它不成为 `common/shared` 倾倒包。对归档与本地卡契约只做 `import type`，运行时导入由两端 adapter 承担。
  不导入 Next/Tauri/服务器 runtime，也不用平台探测决定数据所有权或执行权威。**产品内容不进这个包**：
  百科正文与首页品牌资源的权威是仓库根 `content/`，由 `scripts/generate-encyclopedia-content.mjs`
  复制到两个 app 的静态服务根；包内只保留目录数据与由宿主注入的 base URL 契约，共享源码里不出现
  `import.meta.glob` / `?raw` 这类打包器专有语法；
- `@mahoshojo/config`：仅导出非秘密的 workspace/layout 常量与类型；
- `@mahoshojo/web-package`：共享 Web Standards 实现，校验不可变 Web Package 文件、构建 bounded Prompt Projection、验证单文件 overlay，并按精确 revision 解析 builtin 预设与 staged 本地 ZIP；通用根入口保持 Node / Worker / browser 可共享，DOM-dependent 的浏览器 materialization 只从显式 browser subpath 导出。Arena 当前统一通过 browser-local materialization 展示 Web Package，不依赖预设专用 renderer；默认 Restricted Mode，Trusted Same-Origin 为独立用户授权路径。generic resource-space 保留 transport-neutral 纯逻辑，不使用 Service Worker 作为资源传输方案；线上 source adapter / 独立 sandbox origin 仍是未来扩展。公开 manifest/ref/artifact schema 位于 `@mahoshojo/contracts/web-package`，含通用 Draft 2020-12 子集校验（未实现的标准 assertion fail-closed）；不提供宿主权限或线上上传；
- `@mahoshojo/contracts`：导出版本化协议 DTO、Zod schema、错误码和 wire 安全限制；当前已覆盖 Arena Room v1、线上数据卡元数据、Game Card 卡面 wire schema、runtime-neutral `AiExecution` request/result v1、`DirectProviderProfileV1`，以及通用 API version/success/error envelope。AI 请求契约不携带 Provider Profile、Endpoint 或凭据，canonical result 会限制 UTF-8 总量并拒绝危险结构化键；Profile 只保存非秘密配置与 Vault reference，并限制总量、header/default 数量，拒绝非 HTTP(S) URL、URL 内嵌凭据、HTTP 控制字符、已知秘密 header 的明文值和传输层受控 header；API/AI 输出只接受 JSON-safe 数据；stream event 和执行端口分别由 `ai-core`、`ai-direct` 承担。`contracts/desktop-ipc` 子路径承载 Desktop IPC 的纯数据形状（secret 引用字符集与长度、secret 取值字节上限、secret 存储失败的公开投影），供渲染层与 Rust 侧共同引用，并由 `contracts/fixtures/desktop-secret-refs.json` 作为跨运行时一致性 fixture 驱动两侧测试；
- `@mahoshojo/ai-core`：通过 `provider-catalog` 公共入口共享非秘密供应商/系统模型目录和模型选择校验；目录分两层——`AI_PROVIDER_PRESETS` 是项目预设（`endpointKind` 标注 `provider-public`/`project-forward` 端点归属；Direct 能力由显式 `direct` 核验声明给出——单协议端点用 preset 级声明、多协议端点逐模型标注，缺省 `unverified` fail-closed，不从 provider `type` 推导；`describeAiPreset*DirectWire` 给端点侧核验结论，`describeAiPreset*DirectSupport`/`listDirectCapableAiPresets` 叠加调用方注入的宿主已实现 adapter 集给出最终支持度——本包不镜像 native 实现状态），`SYSTEM_PROVIDER_OPTION` 是服务器策略展示项，`AI_PROVIDER_CATALOG` 仅为旧选择器/wire 兼容的派生视图；原 Hosted runtime 目录入口保留兼容 re-export。`ai-connections` 入口把 `DirectProviderProfileV1` 投影为无秘密的自定义连接列表项 `AiConnectionListItem`——display-only 投影（不含 headers/defaults/transport），持久化权威始终是完整 Profile；端点相同不会把自定义连接认领为预设（模块不提供端点到预设的匹配 API）。承载 strict `AiStreamEvent`、流身份/顺序/唯一终态归约，以及生产 Web AI 路径复用的结构化 JSON candidate 提取、repair、schema 校验、Prompt schema 指令生成、Arena 角色修复 schema/precheck/prompt 与 Game Card runtime-neutral Prompt/生成策略；模型输出在 schema/coercion 前受到输入长度、嵌套深度、节点数和危险键限制，stream 另有单 delta、事件数、累计 delta 与 terminal result 限制。结构化解析公共面当前显式接受 legacy `zod/v3` compatibility schema，Zod v4 repair adapter 尚未提供；该包不依赖 Provider、HTTP/Fetch、UI、服务器配置或秘密；
- `@mahoshojo/hosted-api`：承载 Hono 与 Next/OpenNext 共同调用的 Hosted application service；当前真实纵切覆盖 `generate-magical-girl`，Game Card、Free generate/stream、Scenario generate/stream 五条常规生成 route，Creator、残兽、Details 与 Sublimation generate/stream 深 composition route，以及 Arena 可恢复 generation 的 create/request lookup/replay/status/cancel lifecycle。Arena lifecycle 以稳定 request identity、single-producer reservation、server-owned signal、严格递增 SSE cursor 和幂等 terminal 为边界，subscriber disconnect 不再拥有 producer。G25E-1 又增加纯 Hosted DR runtime selector、共享 fail-closed CORS policy 与 `GET|HEAD /api/hosted/dr-readiness` application contract；package selector 只返回服务器侧 placement/fail-closed 决策，不探测、dispatch 或重放请求，readiness 只执行固定 safe read 并投影最小公开状态。Web 的 per-intent `client-preflight` selector 位于 `apps/web`，只消费 manifest 生成的非秘密投影，不反向进入 package。CORS policy 只接受 production HTTPS exact/wildcard origin，拒绝空值、`*`、HTTP 与 loopback。所有 Hosted service 统一不可信请求校验、Provider/限速/安全/生成/活动记录/签名或输出策略顺序、短路和错误 wire，并通过端口注入具体实现。该包业务层只依赖 Web Standards、Zod 与 dependency-neutral `@mahoshojo/contracts` capability/error taxonomy，不导入 Next、Hono、环境变量、服务器秘密或 `apps/web` 内部源码；当前 24 条 shared-service route 均有 Next 与 Hono adapter，另外 6 条 capability 保持退出 Hono；
- `@mahoshojo/hosted-runtime`：承载 Hosted server-only runtime 与显式 Node ports。当前 shared Hosted capability 的默认 service composition、AI/stream、D1/data、签名/活动、限速、安全、静态资产与 response adapter 均由该包持有；G25E-1 的 `DatabaseProvider` 为 Hono primary HTTP client 与 Cloudflare native D1 binding/Sessions 提供同一 `primary | replica-ok`、bookmark lineage 与 unavailable contract。Cloudflare provider 在 binding/`withSession` 缺失时 fail closed，不回退 Hono 的 Gateway/管理 API 路径；Hono provider不伪造 D1 bookmark，也不扩张既有 HTTP retry。Sublimation 的卡片转换、Arena history/current_state finalize 属于 `@mahoshojo/domain` 纯规则，native questionnaire preset 在 package 内置并与 Web public 资产逐项校验，不通过公开 Web URL self-hop；Arena runtime 另外保留对 `ai-core/arena-generation` 纯 Prompt/schema 的 compatibility 出口，并持有 actor resolution、generation executor、D1/R2 terminal fallback、幂等 finalization，以及校验 owner/终态/provenance 后精确复用原 Provider/model 的角色修复服务。BYOK 凭据只在 Provider port 边界和客户端当前 generation 的内存快照中出现，不进入 request hash、D1、Redis、日志或审计。`apps/api` adapter 绑定 Redis active lifecycle 与 package singleton；Next/OpenNext wrapper 绑定同一业务 composition，但当前无条件绑定 unavailable active replay store，只允许读取已完成 D1/R2 terminal，不能创建 generation；non-stream companion 亦复用该 service。低基数 observer 不接受 URL、Provider、SQL、request body、credential 等任意 metadata；`apps/api` 的 `schemaVersion=5` 聚合器已注册 AI、D1、Redis、Arena generation、Arena Room 与 Details/Sublimation fixed operation/placement lifecycle observer；
- Arena shared service 在认证后以原始字节流增量执行 12 MiB JSON body 硬限，并在 runtime prepare 前限制
  32 位 combatant；Hosted runtime 对其他
  高基数数组也设显式上限。D1 adapter 只把最大 96 KiB 的 terminal/finalization manifest 写入既有
  `battle_report_generations.extra_json`，不持久化 producer lease/token 或完整 `updatedCombatants`；
- `@mahoshojo/ai-direct`：导出 runtime-neutral `AiExecutionPort` 与 `SecureVault` port；`execute` 与 `stream` 都显式接收 `AbortSignal`，统一 adapter 的取消语义。`SecureVault` 是**只写加存在性**的端口（`setSecret` / `hasSecret` / `deleteSecret`），刻意不提供明文读取：已持久化的 secret 不得由任何客户端可读回的接口取出，明文读取只存在于平台 executor 内部、组装出站请求的那一刻。Native/Main executor、Endpoint transport policy 与具体 Provider adapter 尚未实现，将在对应 runtime 阶段落地；
- `@mahoshojo/local-library`：导出版本化 `LocalCardRecordV1`、本地/云端副本与 provenance 正交语义、`CardRepository`、单调记录迁移 runner，以及带安全相对路径、条目摘要和原始字节 checksum 的 archive manifest。记录校验会对 JSON payload 做防御性复制，migration 失败不修改调用方原记录；本包不依赖 IndexedDB、SQLite、DOM、文件系统、网络或线上 slot policy。Web IndexedDB、Installed APP SQLite/文件 adapter、真实导入导出与恢复 UI 留待对应 runtime 阶段；
- `@mahoshojo/domain`：导出无平台 runtime 依赖的数据卡模板标识、角色分类、旧数据模板推断、canonical 主色与渐变映射、Game Card Forge document/metadata 领域校验、问卷答案规范化/稳定匹配与统一字数上限，以及 Arena 严格排位 canonical 模型 blacklist/fallback；Game Card 卡面 wire schema 归 `contracts`，Prompt/config 归 `ai-core`，标签与颜色归 Web presentation；`apps/web` 保留 `lib/schemas`、`lib/game-card/config`、`lib/main-color`、`lib/questionnaires`、`lib/questionnaire-limits` 与 `lib/arena/ranked-model-policy` 兼容出口；
- `@mahoshojo/multiplayer-core`：承载 Arena Room Shared Config 的白名单投影、不可变 working copy、typed Proposal diff/selection/conflict/apply 纯逻辑；只依赖 `@mahoshojo/contracts`，不依赖应用、框架、数据库、网络或任何 Node/DOM/Cloudflare runtime。`buildArenaRoomSharedConfig` 的公开输入边界是 `ArenaRoomNormalizedSource`，只负责 normalized source 的白名单投影；`applyArenaProposal` 只接受 `({ roomId, config, revision }, proposalInput, selectedChangeIds?)`，并在 apply 边界拒绝跨房间 Proposal。真实 `BattleStoreState -> normalized source` 投影、stable host-local key/versionToken 映射与 Room authority 回建均已在 `apps/web/lib/arena-room/` 的 Web adapter 层实现，不反向引入本包。

D3.1b/c：`ui-web/questionnaire` 与 `ui-web/character-result` 为 Web/Desktop 共源的问卷面板和角色结果正文。宿主分别管理请求、Markdown 策略与持久化；默认问卷及花名数据由根 `content/` 单点维护，花名选择通过 `domain/flowers` 复用，Hosted 保留兼容出口。

D3.2a：`ui-web/local-cards` 为两端 `/local-library` 共源的本地数据卡列表、详情与回收站，只消费 `CardRepository` 的 `list/delete/restore` 与两端仓储已有的 `purge`；读代次丢弃切换视图后的晚到响应，写操作单飞，维护互斥由宿主负责。

D3.2b-1：`ui-web/card-editor` 为 Web 角色管理与 Desktop 本地编辑共源的递归字段编辑器与路径写入规则；模板转换、schema 校验、原生性、敏感词与万途往返仍归 Web，宿主经插槽注入附件与样式类。

D5.1-T 首片：`domain/tavern-card` 提供 Tavern PNG 编解码、候选选择、规范化、V3
构造、世界书/情景片段与推荐字段纯规则，Web 原出口直接回用。`File` 读取与默认
Logo 的 fetch/canvas 栅格化仍是 Web adapter；cloud/AI 上传与服务端权限不进入纯核。
原始 Tavern JSON 与规范化显示分离，编解码保留未知字段，不提供签名验证或来源提权。

D5.1-T 本地往返：`ui-web/tavern` 从 Web 原导入区抽出文件、候选、品牌与预览，
双端原路径共用原件导出、本地来源和保存反馈；`local-library/imported-unsigned-card`
使用既有 `putIfAbsent` 与摘要契约保存未签名导入副本，墓碑不复活、不提升嵌套签名权威。
Desktop `/tavern` 本片只交付 PNG/JSON 原件与通用角色规则旅程，其他模板与普通卡新建酒馆导出仍另片。

D5.1-T 组队：`domain/team-merge` 与 `ui-web/team` 由 Web 原合并入口和编排页面实际消费，
Desktop 本地旅程注入既有仓储与下载端口。`domain/team-input` 仅约束本地输入和合成预算，
不把来源签名转换为权威；Web 在线验签/重签名、云保存与立绘仍由宿主持有。

D5.1-T 卡牌工坊共源：`domain/card-forge-document`、`domain/game-card-image-crop`、
`domain/game-card-presentation` 为既有文档/裁剪/常量纯核；`ui-web/card-forge` 与
`ui-web/card-forge.css` 提供卡面、裁剪及主题色区段，Web 原入口真实回用。
Desktop 的媒体输入/画布预算与原件下载属于宿主，不能下沉为共享字段长度限制。


D5.1b b1-A 前置：`ai-core/arena-generation` 持有 Arena 纯 Prompt/schema、输入与结果投影，
Hosted 原生产链与 Web `/battle`、`/arena` 的实际 hook 共同回用；不携带 Provider/secret、
随机执行、资格或签名能力。`domain/narrative-history-operations` 复用条目构造/去重/读取投影，
Web 旧 key、migration、hydration 和实际写入仍留宿主。此片不开放 Desktop Arena 页面或 Hosted route。
