# 共享 Package 边界占位

`packages/*` 只承载可被多个应用复用、且有明确公共契约的代码。依赖方向为：应用可以依赖共享 package；共享 package 不得导入 `apps/*`。`packages/domain` 未来必须保持纯领域边界，不依赖 Next、React、Hono、Cloudflare、Node、Tauri、Electron、DOM 或数据库 runtime；客户端 package 不得读取服务端秘密、签名或环境模块。

共享 package 必须在自己的 `package.json` 中声明显式 `exports`，消费者只能导入导出的公共入口或已声明子路径，不能把 `src/*` 等内部目录当作稳定 API。

当前 `@mahoshojo/config` 是 source-export/bundler PoC：`exports` 直接指向 `src/index.ts`，`build` 只执行可从 clean checkout 独立运行的 `tsc --noEmit`。其 `esbuild:^0.27.2` devDependency 用于固定 Vitest/Vite transform toolchain 的 peer variant，不是业务运行时依赖。后续发布型 package 再单独设计稳定的 `dist` exports，不把当前 PoC 的 source export 当作发布约定。

本目录不设一个无边界的 `common`/`shared` 倾倒包。新增 package 应按领域职责命名，并同步维护类型、exports、测试和依赖边界。当前唯一真实 PoC 是 `@mahoshojo/config`，仅导出非秘密的 workspace/layout 常量与类型。
