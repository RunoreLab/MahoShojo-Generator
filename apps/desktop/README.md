# `@mahoshojo/desktop`

MahoShojo Generator 的本地桌面客户端 runtime。它是独立 app，不是远端网站壳；产品页面、主题与业务能力按共享 package 与 Web 共源，而非直接 import `apps/web`。

当前阶段（2026-10-03）：**D1 执行核、D1.5、D2.0–D2.2、D2.3a/b/c 的存储/归档桥，以及 D2.5a/D2.5b 的共源壳与路由接线、D2.3d 的归档产品 UI 已落地**。首页已是产品页（不再是运行时面板），`/local-library` 提供整库导出与导入，D0 的运行时自述与 Provider 面板移入 `/settings`。整体页面迁移（D3 首页功能卡、百科、`/details` 等）仍未开始。

仍然开放、不记为 PASS 的门禁：`<input type="file">` 在真实 Tauri WebView 中打开原生文件对话框；D2.3 的真实 WebView 内存/响应性与 raw IPC 4 MiB 吞吐/回退；D2.5b 的返回/前进手感与原生窗口关闭（全部路由证据来自 jsdom）；D1 真实 Provider 端点与取消/流。整库**备份与灾难恢复**属 D2.4，回收站 UI 也尚未交付——`/local-library` 提供的是 portable archive，不是备份。

- **D0** skeleton、安全边界与 CI 接线；
- **D0.5** 持久 secret 接入操作系统凭据存储；
- **D1** Direct AI 最薄纵切：Rust 持有出站 HTTP，`Channel<AiStreamEvent>` 流式，`requestId` +
  取消注册表 + exactly-once 终态。**退出门禁尚未闭合**，真实 Provider 端点仍待实测
  （见下方「已知边界」）；
- **D1.5** 内容摘要语义下沉：`canonicalization` / 摘要 / ID 派生的唯一权威实现在
  `@mahoshojo/local-library/digest`，V1 逐字节输出由 golden fixture 冻结；
- **D2.0** 本地库本地卡存储：SQLite `local_card`、keyset 分页、业务级 IPC 与
  `CardRepository` adapter；
- **D2.1** Web Package ZIP blob 持久化：内容寻址 `blob` 表、`local_web_package` 与真实外键
  引用表、原子写入与去重自愈、业务级 IPC 与 `WebPackageRepository` adapter；
- **D2.2a** 并发地基：`LocalLibrary` 单一 managed state、维护窗口、数据目录单实例锁；
- **D2.2b** 完整性审计：六个分桶的只读报告（缺失、摘要/长度不符、无引用 metadata、孤儿文件、
  记录缺引用、外键违规），`audit_local_library` command 与渲染层分组；
- **D2.2c** 孤儿 GC：`collect_local_garbage`，只回收无引用 blob，先删 metadata 后删文件。
- **D2.3a/b/c** portable V2、共享打包/预检导入、Desktop raw 导出与导入桥已落地；真实 WebView 内存/响应性、raw IPC 吞吐/回退门禁仍开放。
- **D2.3d** 双端归档 UI 已接线：`/local-library` 复用 `@mahoshojo/ui-web/local-archive`，Web 用浏览器 adapter、Desktop 用现有窄桥。导出成功只以 native 最终确认判成功；`<input type="file">` 的真机行为待验。
- **D2.5a/D2.5b** 共源基座与路由接线已落地：`packages/ui-web` 提供主题/导航/能力状态/壳/归档视图；Desktop 用 `@tanstack/react-router` + hash history 的三条 code-based 路由。共享边界门禁（`MONO-005-SHARED-UI-RUNTIME` 等）已生效。
- **D2.5c** 审查收口：归档 begin/append 已移出主线程；共享归档操作互斥，Desktop 在途导航/关闭保护已接线。真机证据仍待回传，见下方验收步骤；不宣称 D2.3 / D2.5 完全 PASS。
- **D2.4 / D3** 分别继续备份恢复与页面纵切；不因本轮更新关闭既有未验收项。

## 权威边界

- 产品决策：[Desktop 产品架构与 Web 共源决策](../../docs/decisions/2026-10-02_184000_Desktop产品架构与Web共源决策.md)
- 整体架构：[Desktop 产品架构与共享边界](../../docs/architecture/2026-10-02_184000_Desktop产品架构与共享边界.md)
- 产品规格：[Desktop 产品一致性与本地优先规格](../../docs/specs/2026-10-02_184000_Desktop产品一致性与本地优先规格.md)

目标是熟悉的首页、问卷、角色管理、竞技场与百科，而不是扩建当前调试面板。Desktop 默认本地保存与 Direct，线上能力按需接入；首期不新增数据卡签名或手动申请按钮。未来自动签名需独立可信协议，设置默认关闭；updater 签名要求不变。

- 决策：[Desktop Tauri V1 运行时与本地安全边界决策](../../docs/decisions/2026-09-30_160000_DesktopTauriV1运行时与本地安全边界决策.md)
- 规格：[Desktop 客户端实施规格](../../docs/specs/2026-09-30_160000_Desktop客户端实施规格.md)
- 计划：[Desktop 客户端阶段实施计划](../../docs/plans/2026-09-30_160100_Desktop客户端阶段实施计划.md)

## 结构

```text
apps/desktop/
├─ index.html
├─ vite.config.ts
├─ src/
│  ├─ app/            # 共源产品壳、首页、本地库归档与设置路由
│  ├─ platform/       # 渲染层与 Rust 之间的窄桥
│  └─ styles/
└─ src-tauri/
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json
   ├─ capabilities/main-ui.json
   └─ src/
```

## 图标来源

`src-tauri/icons/` 下的四个资产由站点现成品牌资产生成，**不引入新的美术资源**：

```bash
pnpm exec tauri icon ../web/public/favicon.svg
```

只保留 Windows 与 NSIS 首发所需的 `32x32.png`、`128x128.png`、`128x128@2x.png` 与
`icon.ico`。macOS `icon.icns`、Windows Store `Square*Logo.png` 与 Android/iOS 图标在
进入对应发行阶段时用同一条命令重新生成，不预先提交。

## 本地开发

```bash
pnpm install
pnpm --filter @mahoshojo/desktop run dev:tauri
```

`dev:tauri` 会同时启动 Vite（`http://localhost:1420`）与 Tauri 窗口。

前端单独调试：

```bash
pnpm --filter @mahoshojo/desktop run dev
```

## 类型检查口径

Desktop 通过 workspace 的 source export 直接编译 `@mahoshojo/*` 的源码，因此
`tsconfig.json` 刻意与其它 workspace 保持同一组 `strict` 选项。这里**不**额外启用
`noUncheckedIndexedAccess`：那会让本 app 的类型检查替 `packages/contracts` 等包报错
（例如 `json-value.ts` 的深度守卫），属于跨包的独立决策，不该由一个新 app 单方面引入。
真要收紧应当全仓一起决定。

## 门禁

| 命令 | 覆盖 |
| --- | --- |
| `pnpm --filter @mahoshojo/desktop run build` | 前端类型检查 + Vite 产物（**不含** Rust 编译或打包） |
| `pnpm --filter @mahoshojo/desktop run test` | 渲染层与结构门禁 |
| `pnpm --filter @mahoshojo/desktop run lint` | 渲染层 lint |
| `pnpm --filter @mahoshojo/desktop run check:rust` | `cargo fmt` / `clippy` / `test` |

Rust 门禁同时由 `.github/workflows/desktop-ci.yml` 执行。`build` 脚本刻意不含 `tauri build`：
`workspace:build` 会遍历所有 app，而仓库主 CI runner 没有 Rust 工具链与 webkit 系统依赖。

## 安全边界现状

- `app.security.csp` 显式配置：仅 `'self'` 与必要的 `ipc:`；`script-src` 无 `unsafe-inline`
  与 `unsafe-eval`；`frame-src 'none'` 从结构上禁止主 UI 内出现任何 iframe。
- `withGlobalTauri: false`。
- capability 只有 `main-ui` 一个，使用 `webviews` 粒度而非 `windows`。
- 除 `core:default` 外，仅增加 `core:window:allow-destroy`，供 `onCloseRequested` 在空闲放行后完成窗口销毁；归档在途先 `preventDefault()`。监听注册完成前禁用归档操作，失败明确报错；异步晚到的监听也会释放。
- **未引入任何 Tauri 插件**，因此 renderer 不存在 shell、文件系统、SQL 或 HTTP 通用能力。
- Vite `envPrefix` 只保留 `TAURI_ENV_*`，不暴露 `VITE_`。
- Rust 侧的出站 HTTP 只服务于 Direct AI：endpoint 与 header 只能来自已保存 Profile 的窄投影，
  项目自有域名被拒绝，重定向缺省关闭，`no_proxy`。
- SQLite 只有业务级读写：没有 `query` / `readFile` / `writeFile` 形态的通用 command，
  所有落盘路径、文件名与 SQL 选择器都由 Rust 产生。

## Provider Profile 与 Direct AI

当前阶段（D1）可用的最小面板支持：保存 Profile、查看已保存列表与凭据是否存在、跑一次生成测试。

```text
Profile 草稿
  -> 客户端用 DirectProviderProfileV1Schema 校验
  -> 派生 secret 引用 provider:<id>:api-key
  -> 先写凭据（操作系统凭据存储）
  -> 让 native 独立解析窄投影并回显
  -> 两侧一致才落盘完整 Profile（SQLite）
```

顺序不可反：先凭据后 Profile，反过来的话崩溃会留下"引用存在但取不到值"的 Profile。
删除时反过来——先 Profile 再凭据，因为保留孤儿凭据不会让任何执行路径误用已删除的配置。

明文 API Key 只在录入那一刻存在于输入框与保存调用中，保存后立即从组件状态清除，且本页
**没有任何读回凭据的入口**（`hasProviderSecret` 只返回布尔值）。

已知边界：

- `thinking` 字段当前被 native 的 `deny_unknown_fields` 拒绝，尚未映射到 Provider 参数；
- `anthropic` / `google` adapter 显式拒绝，不会按 OpenAI 语义静默发起请求；
- 真实 Ollama / LM Studio / 公网端点尚未实测，端到端证据来自进程内自建的
  OpenAI-compatible SSE 服务（含"取消真正中止上游 body"的断连观测）。这是 D1 退出门禁
  唯一未闭合的一条，且只能由人在真实 Provider 上确认。

## 本地库（D2.0 / D2.1 / D2.2a）

### 并发模型（D2.2a）

一次 Web 包保存跨**三个**资源：blob 文件系统、blob metadata、包记录与引用行的事务。因此并发
控制分三层，各管一件事，互不替代：

```text
跨进程  数据目录 advisory lock（fs4）    同一数据目录只允许一个 Desktop 进程
跨操作  MaintenanceGate                  维护独占；窗口内写入被拒而不是排队
进程内  Mutex<Connection>（一条）          单次数据库往返的原子性
```

**四个 store 共用一条连接，且只经由一个 managed state（`LocalLibrary`）到达。** 这不只是为了
GC：`save_web_package` 此前先写 blob（释放 blob 锁）再进包事务（取另一把锁），两步之间没有
任何互斥——一条观察路径落在那里就会看到一个"有 metadata、无引用"的 blob，而那正是 GC 的
回收候选。合并成一条连接之后，这个窗口才真正关闭。

单实例用**数据目录**锁而不是 `tauri-plugin-single-instance`：后者按 app id 判定，而 dev 构建
与另一个构建可以有不同 app id 却指向同一个 `app_data_dir`——那正是要防的情况。锁是 OS 持有的
advisory lock，随进程死亡自动释放；锁文件在释放后**仍然存在**，否则第二个进程会新建一把锁、
两个进程各拿一把。锁必须在打开数据库**之前**获取，且句柄被 manage 出 `setup`。

维护窗口内的写入被**拒绝**（`maintenance-busy`）而不是排队。排队同样满足"不观察到中间态"，
但会把 UI 挂起在一个无法解释的等待上；拒绝让 UI 可以立刻提示"本地库正在维护，请稍后重试"。
渲染层用 `isRetryableLocalLibraryError` 判定该 code 是唯一"原样重试就会成功"的类别。

读取路径刻意**不**取许可：GC 只回收无引用 blob，而读取只触达被引用的 blob，因此维护期间读到的
仍是一致状态。要求读也受限只会让用户在备份时无法翻看本地库。

### 存储

`library.sqlite` 里目前有四张表，共享同一份 PRAGMA 与 migration journal（当前 `user_version` 为 4）：

- `provider_profile`（D1）：opaque JSON 文档；
- `local_card`（D2.0）：opaque `document` + `card_type` / `updated_at` / `deleted_at` /
  `content_digest` 四个索引列；
- `blob`（D2.1）：内容寻址的字节，`<data_root>/blobs/<64hex>`（无扩展名，路径只由 `blob_path()`
  决定）与 metadata 一一对应；
- `local_web_package`（D2.1）+ `web_package_archive_ref`：Web 包记录与它的 blob 引用，两条
  **真实外键**分别指向 `local_web_package(id)` 与 `blob(digest)`。

blob 的物理布局是 adapter 内部细节，对外契约与 portable archive 都不依赖它。写入顺序是同目录
临时文件 → flush → 原子 rename → metadata：因此崩溃后**可能**留下无引用 blob（孤儿，允许存在），
但**不会**出现"记录在、文件不在"。已存在且校验通过的 blob 视为成功（去重）；已存在但损坏且本次
持有正确字节时自愈覆盖并返回 `repaired`——这个状态必须透传到 UI，否则存储损坏对用户不可见。
读取时损坏且无正确内容则 fail closed。

### 两种摘要不是一回事

Web 包记录里的 `contentDigest`（= `ref.digest`）是 **manifest** 的摘要，构成领域身份——包 id 由它
派生，派生规则由 `@mahoshojo/local-library` 的 `deriveLocalWebPackageId` 单点实现、Web 与 Desktop
共用，并由记录契约强制。归档 blob 的摘要是**归档字节自身**的摘要，只充当存储地址与完整性校验。
ZIP 除 manifest 外还含文件，两者必然不同，**不要**加"两者必须相等"的校验（`DESK-063`）。归档字节
是否真的属于这条记录，由 TypeScript 侧 `unpackWebPackageZip` 解包后核对；native 不重建 ZIP 与
manifest 的规范化逻辑，也**不在 SQL 里重算 id 派生**——只加 `ref_digest UNIQUE` 作为存储约束。

记录自称的 `archiveByteLength` 会被 native 与实际字节数比对，不一致直接拒绝。

### 读档以 manifest 摘要为键

`readArchive(contentDigest)` 按 **manifest 摘要**查询，而不是按包 id：共享端口与 Web 的 IndexedDB
adapter 都以摘要为键，而摘要不是 `wp_…` 形式的 id。native 经 `local_web_package` →
`web_package_archive_ref` 两跳解析。把参数当包 id 用会让每次读档都落空，表现为"包打不开"——
而两侧单测都绿，因为它们各自用错了自己的那半边形状。

### 二进制传输

D2.3b2-r5 后，`read_web_package_archive` 返回 `tauri::ipc::Response`，渲染层接收 raw `ArrayBuffer`；结构化请求参数与 raw 响应可以共存。读取已改为 `async` + `spawn_blocking`，避免在 command 主线程读文件并计算摘要。

单包保存仍通过结构化请求中的 `{b64, len}` 信封传字节，并核对长度；标准 base64 decoder 拒绝非法尾随内容。整个本地库归档的导出则采用 begin + raw chunk，native 累计到声明长度后完成 fsync/无覆盖发布，UI 必须消费最终完成确认。

输入预算、输出上限与单次 IPC 块上限是三个概念，见 `DESK-070` / `DESK-071b`；当前共享组装仍使用 `zipSync`，不能因为传输已经分块就声称全链路流式或主线程无阻塞。真实 WebView 内存、吞吐与 raw IPC 回退仍待验收。

业务语义全部留在 TypeScript。索引列由渲染层从**已通过 `LocalCardRecordV1Schema` 校验的
记录**投影而来，native 侧再从 document 里重新提取一遍并逐项比对，不一致即拒绝落盘：

```text
已校验的 LocalCardRecordV1
  -> 投影索引列（只取 native 做选择器必需的 5 个字段）
  -> 序列化完整 document
  -> native 提取索引列并与声明值比对
  -> 一致才落盘
```

两层校验都必要：只有第一层的话，一次 `{...record, updatedAt: 伪造值}` 就能让排序与分页
永久错乱。

分页是 `(updated_at, id)` 的 keyset 游标而非 offset。游标在 IPC 上保持不透明，使 Web 的
IndexedDB adapter 未来可独立改进。软删只写 tombstone、**保留** document，使 `restore` 能
真正恢复可用状态；`purge` 才彻底删除。

**不使用 `serde_json::Value` 作为落盘门禁**：实测它会拒绝 `"\ud800"` 这类孤立代理项转义，
而 JavaScript 的 `JSON.stringify` 会产出它、Web 的 IndexedDB 也照常保存它。因此 document 的
自由载荷走 `Box<RawValue>`，保留原始文本而不实例化 `String`，载荷里的孤立代理项被逐字节
保留（见 `local_card.rs` 的兼容性测试与 `fixtures/desktop-local-cards.json`）。

### 完整性审计（D2.2b）

`audit_local_library` 跑一次只读审计，**只报告不修复**——修复只发生在下一次写入的自愈路径上。
一份说"有问题"的报告比一份说"我替你修了"的报告有用得多：后者让用户失去对库状态的判断依据。

六个桶与它们各自的用户可见性：

| 桶 | 含义 | 用户可见损坏 |
| --- | --- | --- |
| `reference-file-missing` | 引用存在，文件不在 | 是 |
| `reference-bytes-mismatch` | 文件在，摘要或长度不符 | 是 |
| `record-without-reference` | 包记录存在但没有引用行 | 是 |
| `unreferenced-metadata` | 有 metadata 无引用（purge 后的回收候选） | 否 |
| `orphan-file` | 有文件无 metadata（崩溃窗口产物） | 否 |
| `foreign-key-violation` | `PRAGMA foreign_key_check` 报出的违规 | 否 |

第五桶单列的原因：外键方向是"引用行 → 包记录"，数据库**不**约束"每个包记录都必须有引用行"，
而缺引用行的包对用户表现为"打不开"（`readArchive` 返回 `null`），与字节损坏无法区分。

后三桶不算损坏：孤儿文件与无引用 metadata 用户都看不见（前者是崩溃窗口产物，后者是 purge
之后的回收候选），把它们算作损坏会让真正要处理的问题被稀释。外键违规同理——它的症状必然
落到前三个桶之一，单独报警等于同一件事报两次。

报告**必须**携带规模分母（被引用 blob 数、metadata 数、包数）：来自空库的「0 个问题」与
来自 500 个包的「0 个问题」含义完全不同。报告**不得**携带文件路径（`DESK-057`）。

审计在 native 侧持有维护窗口并跑在 `spawn_blocking` 上：单次 SQL 查询是原子的，但
"读 metadata → 读文件 → 读 metadata"不是，save 落在中间会报出假的损坏桶；重算每个 blob 的
SHA-256 是 O(字节) 的工作，同步 command 会冻结 WebView。渲染层因此对 `maintenance-busy`
做有界重试。

### 孤儿 GC（D2.2c）

`collect_local_garbage` 只回收**不在任何引用表**中的 blob。判定**不**看
`last_referenced_at`（`DESK-065`）：一个刚被引用、尚未落该时间戳的 blob 在 GC 眼里就是孤儿。

删除顺序固定为"先 metadata 行、后文件"（`DESK-072`）。反过来崩溃后会留下"metadata 在、
文件不在"——正是 `DESK-051` 禁止的悬空记录，且没有任何自愈路径能修它（写入时找不到对应
引用行）。先删行后删文件，崩溃最多留下孤儿文件，而孤儿文件是**允许存在**的。

软删**不**改变可达性（`DESK-055`）：软删只写 tombstone，引用行不动，因此它的字节仍可达、
GC 不会碰它。只有 purge 让它成为回收候选。这条是"恢复一个删掉的包能真正恢复可用状态"的
前提。

**桶五的包，其字节会被 GC 回收**——这是 `DESK-065` 的直接后果，不是 bug。该 digest 确实不
在引用表里；关键在于**这类包在 GC 跑之前就已经打不开**，所以回收不额外造成损失。真正的
损失发生在引用行丢失的那一刻，由审计的桶五暴露给用户。

结果有五个计数：UI 必须区分"候选集是空的"（库干净或用户还没 purge）与"回收到了东西"——
`gcReclaimedSomething` 单列这个判断。`filesRemoved < reclaimed` 表示有些行的文件本来就不在
（桶一的损坏形态），`filesFailed` 表示权限或 I/O 错误导致文件留下成为孤儿。

D2.3 的导入导出平台桥与双端 `/local-library` 用户页面均已接线；D2.4a 已交付 native 整库备份创建与校验列表；D2.4b 重启恢复仍未落地。portable archive 是可移植的自洽列举，不是用于整体替换数据库的备份快照。真机验收步骤见 [D2.5c 收口验收](../../docs/runbooks/2026-10-03_120000_Desktop归档与产品壳真机验收.md)。

## 持久 secret

V1 使用操作系统凭据存储（`keyring`），**不**使用 Stronghold JavaScript API —— 后者要求把
vault master password 交给 renderer，与「已持久化 secret 不可读回」直接冲突。

renderer 可用的能力只有三个：

```text
set_provider_secret(secretRef, value)
has_provider_secret(secretRef)
delete_provider_secret(secretRef)
```

没有明文读取入口，且这条约束同时由三处强制：`SecretStore` trait 上不存在读取方法、
`apps/desktop` 的导出面不含任何读取函数、以及 `@mahoshojo/ai-direct` 的 `SecureVault`
只暴露 `set` / `has` / `delete`。

secret 引用的字符集与长度上限由 `@mahoshojo/contracts/desktop-ipc` 单点定义，
Rust 侧在编译期 `include_str!` 同一份 fixture，两侧测试同时消费，任一侧单方面放宽都会让
另一侧失败。

已知边界：

- Windows Credential Manager 后端已在开发机实测（写入 / 读取 / 删除 / 幂等删除，均无需
  交互式解锁）。
- macOS Keychain 与 Linux Secret Service 后端尚未在真实目标平台验证，属于 D5 发行门禁。
- 触碰真实系统凭据的往返测试默认 `#[ignore]`，本地验证：

  ```bash
  pnpm --filter @mahoshojo/desktop run check:rust -- --ignored
  ```

## 已知边界

- GUI 交互行为无法在无头 CI 中验证，涉及"实际运行结果"的检查在文档中记为未验证并附复现步骤。
  D2.2a 的单实例拒绝启动因此**未经真实双进程验证**：现有断言走的是同进程两次 `acquire`，
  它复现了同一套 OS advisory 锁语义，但不是两个进程。需要在 `dev:tauri` 下手动启动第二个实例
  确认提示可读。
- Windows 上同源 iframe 会继承宿主 IPC（GHSA-57fm-592m-34r7），因此 Web Package 在任何阶段
  都不会放进 iframe；该能力属于 D4 的独立零 capability webview。
- 审计、GC 与 Web 包归档读取已有 `async fn` + `spawn_blocking`；这不代表所有 I/O 或 renderer 工作都不会阻塞。`zipSync` 仍是同步组装，真实响应性尚未验收；D2.4a 备份已通过 async command + spawn_blocking 执行，维护锁的等待也在 blocking worker 内；实际 WebView 响应性仍需真机验收。
