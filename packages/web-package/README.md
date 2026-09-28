# 内置 Web 包的静态源

每个 `presets/<directory>/` 是一个完整 Web 包的创作目录，静态资产按最终包内路径存放。`web-package.json` 仅维护语义字段；文件清单、媒体类型、字节数和 SHA-256 由 `scripts/generate-web-package-presets.mjs` 生成。标准 ZIP 中的 manifest 仍包含完整文件表，协议没有变化。

`preset-catalog.json` 管理发现信息与固定 revision，注册表只包含当前支持的预设，不保留未部署实验包或 active/retained 状态。已有正式包不可在原版本下改内容。新增或修订包应先计算并审阅 digest，再固定在 catalog；生成器拒绝悄悄覆盖已固定身份。`presets/**` 在 `.gitattributes` 中关闭文本换行转换，以保留字节级身份，不能由 Git checkout 自动改写换行。

在仓库根执行 `pnpm generate:web-package-presets` 后提交生成结果；`pnpm check:web-package-presets` 是 CI 的一致性检查。`src/generated/` 仅为跨浏览器/服务器分发的构建产物，不手写资源片段。运行时从该产物读取原始字节并走标准 validator，竞技场、ZIP 导出和重新导入使用同一份内容。新增媒体格式时显式扩展生成器映射；未知格式、符号链接、非法路径或大小写碰撞会失败。

Visual Novel Lite、星屑社区、命运岔路从未部署，已删除其资产、注册记录、专属适配器和兼容别名。未注册的 ID / version / digest 明确解析失败，不会替换为当前包。通用 exact / 显式 compatibility replay、快照、摘要与 ZIP 校验继续保留；JSON 目标测试使用最小本地测试夹具，不注册为产品预设。首方 srcdoc 渲染仍是过渡适配器，不代表任意本地包的通用相对资源解析已经完成。

当前唯一展示预设是「竞技场新闻」：AI 生成完整 HTML，资源包只提供可选素材与交互能力。详情/广告通过同一文档内的 hash 路由，评论/收藏/点赞/投票/订阅均为刷新即重置的内存模拟。具体引用约束与属性用法见 `presets/arena-news/ai/assets.json`；该目录会完整投影给 AI，不要求 AI 读取未投影的组件文件。首方浏览器适配器内联已验证静态 CSS、经典 JS 和图片，HTTPS 资源仍受宿主 CSP 限制。
