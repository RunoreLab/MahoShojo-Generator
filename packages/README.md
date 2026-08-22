# 共享 Package 边界占位

`packages/*` 只承载可被多个应用复用、且有明确公共契约的代码。依赖方向为：应用可以依赖共享 package；共享 package 不得导入 `apps/*`。`packages/domain` 未来必须保持纯领域边界，不依赖 Next、React、Hono、Cloudflare、Node、Tauri、Electron、DOM 或数据库 runtime；客户端 package 不得读取服务端秘密、签名或环境模块。

共享 package 必须在自己的 `package.json` 中声明显式 `exports`，消费者只能导入导出的公共入口或已声明子路径，不能把 `src/*` 等内部目录当作稳定 API。

当前 workspace 先采用 source-export/bundler 模式：`exports` 直接指向 `src/*.ts`，`build` 只执行可从 clean checkout 独立运行的 `tsc --noEmit`。其中 `@mahoshojo/config` 用于验证 workspace 配置边界，`@mahoshojo/contracts` 承载可在 Node、Worker 与浏览器消费者间共享的版本化 wire contract、schema 和安全限制。`contracts` 不得读取环境变量，也不得依赖应用、框架或运行时实现。package 中的 `esbuild` devDependency 仅用于固定 Vitest/Vite transform toolchain 的 peer variant，不是业务运行时依赖。

后续发布型 package 再单独设计稳定的 `dist` exports，不把当前 source export 当作发布约定。

本目录不设一个无边界的 `common`/`shared` 倾倒包。新增 package 应按领域职责命名，并同步维护类型、exports、测试和依赖边界。当前真实 package 为：

- `@mahoshojo/config`：仅导出非秘密的 workspace/layout 常量与类型；
- `@mahoshojo/contracts`：导出版本化协议 DTO、Zod schema、错误码和 wire 安全限制，不包含业务执行、存储、鉴权或部署 runtime。
- `@mahoshojo/multiplayer-core`：承载 Arena Room Shared Config 的白名单投影、不可变 working copy、typed Proposal diff/selection/conflict/apply 纯逻辑；只依赖 `@mahoshojo/contracts`，不依赖应用、框架、数据库、网络或任何 Node/DOM/Cloudflare runtime。`buildArenaRoomSharedConfig` 的公开输入边界是 `ArenaRoomNormalizedSource`，只负责 normalized source 的白名单投影；`applyArenaProposal` 只接受 `(state, proposalInput, selectedChangeIds?)`；真实 `BattleStoreState -> normalized source` Web adapter 尚未在本批实现，stable host-local key/versionToken 映射需另批接入，不能由此包猜测。
