# 内置 Web 包的静态源

每个 `presets/<directory>/` 是一个完整 Web 包的创作目录，静态资产按最终包内路径存放。`web-package.json` 仅维护语义字段；文件清单、媒体类型、字节数和 SHA-256 由 `scripts/generate-web-package-presets.mjs` 生成。标准 ZIP 中的 manifest 仍包含完整文件表，协议没有变化。

`preset-catalog.json` 管理发现信息、active/retained 状态和固定 revision。只有 active 包出现在新选择与下载列表；retained 包保留原始字节、exact resolver 和历史重放。旧预设不可在原版本下改内容。新增或修订包应先计算并审阅 digest，再固定在 catalog；生成器拒绝悄悄覆盖已固定身份。

在仓库根执行 `pnpm generate:web-package-presets` 后提交生成结果；`pnpm check:web-package-presets` 是 CI 的一致性检查。`src/generated/` 仅为跨浏览器/服务器分发的构建产物，不手写资源片段。运行时从该产物读取原始字节并走标准 validator，竞技场、ZIP 导出和重新导入使用同一份内容。新增媒体格式时显式扩展生成器映射；未知格式、符号链接、非法路径或大小写碰撞会失败。

Visual Novel Lite、星屑社区、命运岔路已退出展示，源目录仅为历史战报兼容保留。其固定内容不再作为新预设的产品示范。首方 srcdoc 渲染仍是过渡适配器，不代表任意本地包的通用相对资源解析已经完成。
