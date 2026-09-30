# `@mahoshojo/desktop`

MahoShojo Generator 的本地桌面客户端 runtime。它是独立 app，不是 `apps/web` 的桌面壳。

当前阶段：**D1 执行核 + D1.5 摘要冻结 + D2.0 本地卡存储已落地**。

- **D0** skeleton、安全边界与 CI 接线；
- **D0.5** 持久 secret 接入操作系统凭据存储；
- **D1** Direct AI 最薄纵切：Rust 持有出站 HTTP，`Channel<AiStreamEvent>` 流式，`requestId` +
  取消注册表 + exactly-once 终态。**退出门禁尚未闭合**，唯一缺口是真实 Provider 端点实测
  （见下方「已知边界」）；
- **D1.5** 内容摘要语义下沉：`canonicalization` / 摘要 / ID 派生的唯一权威实现在
  `@mahoshojo/local-library/digest`，V1 逐字节输出由 golden fixture 冻结；
- **D2.0** 本地库本地卡存储：SQLite `local_card`、keyset 分页、业务级 IPC 与
  `CardRepository` adapter。blob、导入导出、备份与 GC 属 D2.1 之后的阶段。

## 权威边界

- 决策：[Desktop Tauri V1 运行时与本地安全边界决策](../../docs/decisions/2026-09-30_160000_DesktopTauriV1运行时与本地安全边界决策.md)
- 规格：[Desktop 客户端实施规格](../../docs/specs/2026-09-30_160000_Desktop客户端实施规格.md)
- 计划：[Desktop 客户端阶段实施计划](../../docs/plans/2026-09-30_160100_Desktop客户端阶段实施计划.md)

## 结构

```text
apps/desktop/
├─ index.html
├─ vite.config.ts
├─ src/
│  ├─ app/            # UI shell（当前只有一个本地运行时面板）
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

## 本地库（D2.0）

`library.sqlite` 里目前有两张表，共享同一份 PRAGMA 与 migration journal：

- `provider_profile`（D1）：opaque JSON 文档；
- `local_card`（D2.0）：opaque `document` + `card_type` / `updated_at` / `deleted_at` /
  `content_digest` 四个索引列。

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

blob、内容寻址区、导入导出与 GC 属 D2.1 之后的阶段，当前**不存在**。

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
- Windows 上同源 iframe 会继承宿主 IPC（GHSA-57fm-592m-34r7），因此 Web Package 在任何阶段
  都不会放进 iframe；该能力属于 D4 的独立零 capability webview。
