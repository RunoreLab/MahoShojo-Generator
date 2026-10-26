# Desktop 许可文本补充

`scripts/generate-desktop-notices.mjs` 优先收集已安装 npm / Cargo 包自带的
LICENSE、COPYING、COPYRIGHT 和 NOTICE。这里仅保存发布包未随附许可文件时的官方原文，
构建过程不向网站逐项下载许可。

`sources.json` 记录 npm 包与原文来源；这些文件于 2026-10-26 从对应官方仓库获取，
保留原版权声明。补充文本并不改变该项目的源码或资产许可证。

`rust-sources.json` 按 crate 名称和版本精确记录补充来源。仓库原文使用发布包
`.cargo_vcs_info.json` 记录的 commit；`tauri-plugin` 的双重许可采用 MIT 选项。
`selectors` 发布包的源码声明 MPL-2.0，随附 Mozilla 官方完整条款，生成清单中的
版本化 crates.io 链接提供对应的原始 crate 源码。Rust 清单保守包含构建和开发依赖，
不表示每项都会链接到最终二进制中。

Vercel AI SDK 的原文是 Apache-2.0 授权通知；同时附上从
<https://www.apache.org/licenses/LICENSE-2.0.txt> 获取的完整 Apache-2.0 条款，
不依赖其他包恰好携带同一许可证。

依赖升级后，如果发布包已附带 LICENSE/NOTICE，生成器自动优先使用包内版本。
若出现其他缺失项，生成器列出准确的包名和版本，先核对该版本的官方来源再增加补充。
