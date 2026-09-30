# `@mahoshojo/desktop`

MahoShojo Generator 的本地桌面客户端 runtime。它是独立 app，不是 `apps/web` 的桌面壳。

当前处于 **D0 骨架阶段**：只验证本地打包 UI、最小 capability 与窄 IPC 是否成立，不提供任何
业务能力。Direct AI、本地库与发行分别属于 D1/D1.5/D2 及之后的阶段。

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
- Rust 侧当前没有出站 HTTP、数据库、文件写入能力；持久 secret 已接入操作系统凭据存储。

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
