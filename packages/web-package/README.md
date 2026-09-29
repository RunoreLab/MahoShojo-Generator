# Web Package 核心、通用渲染与静态预设

每个 `presets/<directory>/` 是一个完整 Web 包的创作目录，静态资产按最终包内路径存放。`web-package.json` 仅维护语义字段；文件清单、媒体类型、字节数和 SHA-256 由 `scripts/generate-web-package-presets.mjs` 生成。标准 ZIP 中的 manifest 仍包含完整文件表，协议没有变化。

`preset-catalog.json` 管理发现信息与固定 revision，注册表只包含当前支持的预设，不保留未部署实验包或 active/retained 状态。已有正式包不可在原版本下改内容。新增或修订包应先计算并审阅 digest，再固定在 catalog；生成器拒绝悄悄覆盖已固定身份。`presets/**` 在 `.gitattributes` 中关闭文本换行转换，以保留字节级身份，不能由 Git checkout 自动改写换行。

在仓库根执行 `pnpm generate:web-package-presets` 后提交生成结果；`pnpm check:web-package-presets` 是 CI 的一致性检查。`src/generated/` 仅为跨浏览器/服务器分发的构建产物，不手写资源片段。运行时从该产物读取原始字节并走标准 validator，竞技场、ZIP 导出和重新导入使用同一份内容。新增媒体格式时显式扩展生成器映射；未知格式、符号链接、非法路径或大小写碰撞会失败。

Visual Novel Lite、星屑社区、命运岔路从未部署，已删除其资产、注册记录、专属适配器和兼容别名。未注册的 ID / version / digest 明确解析失败，不会替换为当前包。通用 exact / 显式 compatibility replay、快照、摘要与 ZIP 校验继续保留；JSON 目标测试使用最小本地测试夹具，不注册为产品预设。预设与本地包现已统一使用 `renderWebPackageInstance()`；旧新闻专用 materializer 已移除。包身份不是运行白名单。

当前唯一展示预设是「竞技场新闻」：AI 生成完整 HTML，资源包只提供可选素材与交互能力。详情/广告通过同一文档内的 hash 路由，评论/收藏/点赞/投票/订阅均为刷新即重置的内存模拟。具体引用约束与属性用法见 `presets/arena-news/ai/assets.json`；该目录会完整投影给 AI，不要求 AI 读取未投影的组件文件。通用物化器从已校验实例读取资源；HTTPS 资源仍受运行页 CSP、CORS 与浏览器策略限制。

## 入口与客户端传输

- 根导出：验证、ZIP、不可变实例、Prompt Projection、重放、归档导入与错误码。
- `src/archive.ts` / `src/import.ts` / `src/media-types.ts`：信封归一化、缺省导入与共享媒体类型映射；预设生成器复用同一份媒体类型映射。
- `/browser`：`renderWebPackageInstance(instance)`，无预设 ID 分支；返回展示 HTML 与诊断，不修改 Base/Overlay 原始字节。
- `/security`：Base/有效实例能力预检和摘要绑定授权判定；不执行作者代码，不访问网络。启发式规则只在标记无法被标记语言模仿时才报告——`host-page-access` 要求 window/self/globalThis/frames 限定或未被 `.`/`-`/`#` 前置的裸全局，以免把 CSS `top`、`.top` 类名与选择器判成宿主访问；`scripts` 的内联事件属性要求完整属性名就是 `on…` 且位于标签内，`data-one=`、`oneTime = true` 不算；`dynamic-execution` 只匹配可执行的 `data:`/`blob:` 媒体类型，内嵌 base64 图片不算；`site-storage` 要求真实访问点（`document.cookie`、`caches.open` 等），说明文字不算。
- 预检不把提示投影输入（`generation.instructions` / `schema` / `assetCatalog`）与 Markdown 当作运行时资源扫描：其中的代码片段、地址与"不要使用 cookie"之类的说明只是创作参考文本。被跳过的文件数量会在 `uncertainty` 中显式说明，不会静默漏扫。XML 命名空间与 DOCTYPE 标识符不计入网络目的地。规则变更会提升 `WEB_PACKAGE_SCAN_VERSION`，使旧版本签发的长期信任重新确认。
- `/testing/fixtures`：仅测试使用的显式跨 workspace 夹具入口，不进入产品根导出。

HTML/CSS/JavaScript 分别使用 parse5、css-tree、Acorn 解析，三者为 MIT 依赖。相对资源解析以引用文件为基准；CSS 和媒体转为 data URL，模块 Blob URL 在子窗口创建，并由 import map 处理循环及动态导入。局部 fetch 提供 GET/HEAD、正确 MIME、404/405；异步 XHR 支持包内 GET。文件 query 不改变底层 bytes，fragment 保留。`entry` 不必等于生成目标。

Arena 的 `/__web-package__/runner` 只返回固定启动页。随机实例 nonce、准确父/子 window、消息来源校验后，浏览器内发送物化 HTML；服务器不接收 ZIP 或资源文件。仅此路由使用专用 CSP；普通 Web / 主站 CSP 不放宽。不使用 Service Worker，不新增域名，不建设服务器文件托管。

默认 `sandbox="allow-scripts"`，能加载本地包资源但不能读宿主 DOM/存储。独立的 Trusted Same-Origin 授权只改变执行权限，不改变包解析；它具有站点脚本级风险，预检和 iframe 限制不再是可靠的宿主隔离。三秒确认、版本/生成摘要、风险目的地变化、撤销和失败提示由 Web app 持有。

## 本地物化器 V1 的兼容边界

支持单入口文档、经典脚本、嵌套/循环 ESM、动态 import、`import.meta.url/resolve`、import map 的 imports 和前缀别名、CSS URL/@import、图片/srcset、字体及音视频静态引用、常见媒体/script 属性的运行时赋值、包内 fetch、单文档 hash 导航。运行时程序仍须是 browser-ready；构建工具请输出相对路径，例如 Vite 的 `base: './'`。

这不是完整 HTTP 文件服务器或浏览器虚拟机。当前不支持多 HTML 文档跳转、import map scopes/null 映射、Worker/Service Worker、嵌套 iframe/object、`eval/new Function` 或任意动态 CSSOM/innerHTML 内的相对资源重写。多文档入口链接等可检测情况给出诊断；无法可靠解析的入口依赖显示明确错误并保留目标/原包下载。复杂运行时请先 bundle、改用单文档路由，或使用已支持的 DOM 资源属性和模块 URL。外部库与资源不会被自动下载以绕过 CSP/CORS；扫描无法证明它们安全。

包大小仍不增加产品级硬限制；大包物化会有 base64/AST/内存副本开销。预检自身有工作预算，超预算显示“不完整”且不允许持久信任，但不把它当作包导入上限。导入另有一层解压保护上限（`MAX_ARCHIVE_EXPANDED_BYTES`）：fflate 在解压前按 central directory 的 `originalSize` 预分配缓冲，伪造的尺寸字段是直接的内存耗尽向量。它约束的是展开工作量，不是 Web 包的产品大小限制；错误提示中也如此区分。

## 本地 ZIP 导入

导入分两层：信封层（`src/archive.ts`）定位包根目录、剔除归档元数据、约束解压规模；语义层（`src/import.ts`）决定文件表来源、填充 manifest 缺省并执行标准 `verifyWebPackage`。信封对打包方式宽容，对内容严格。

- 根目录已有 `web-package.json` → 整体作为包；否则唯一一层子目录含该文件时剥离该目录（仅接受单个 portable 路径段）。多个候选明确报歧义，嵌套一层以上明确报打包错误，均不猜测。
- 完全没有 `web-package.json` 时整个归档即包，作者路径原样保留，由最浅的 `index.html` 识别入口。
- 包根目录之外的任何文件一律拒绝；`__MACOSX/`、`.DS_Store`、`Thumbs.db`、`desktop.ini` 按固定名单丢弃并在诊断中说明。
- `files` 声明存在时保持权威（未声明/缺少/大小写冲突一律拒绝）；缺失时按归档内容派生，媒体类型取自 `src/media-types.ts` 的共享映射。映射表覆盖常见 Web 资源；仍无法推断的扩展名按 `application/octet-stream` 导入并在诊断中点名，不阻断整个包——真正决定「这段字节会不会被执行」的是渲染器，它对非 JavaScript 媒体类型的 `<script src>` 已经 fail closed。仓库内受审的预设生成器保持严格，未知扩展名在构建期报错。
- 预检是否按文本扫描由内容决定，不由作者声明的 `mediaType` 决定：先在既有体量预算内读取，再尝试严格 UTF-8 解码，解码成功即扫描。把脚本声明成 `image/png` 不再能逃过扫描。
- 只对**缺失**的 manifest 字段做缺省填充（`id` 由内容派生、`version` 为 `1.0.0`、`entry` 自动识别、`generation.target` 默认替换识别出的入口、`generation.mediaType` 默认取目标文件自身的媒体类型）。存在但非法的字段显式失败，默认值不覆盖作者已表达的意图。清单里的未知顶层字段不阻断导入，但会在诊断中点名，避免 `entrys` 这类拼写错误被静默吞掉。
- 面向包作者的失败一律给出中文字段说明与可执行指引，而不是 zod 的英文校验器原文。
- `importWebPackageArchive` 返回 `diagnostics`，逐条说明识别到的包根目录、被丢弃的元数据与每一项缺省填充；UI 必须展示，用户在授权前有权知道包的实际身份来源。
- 失败统一为 `WebPackageImportError`，带稳定 `code` 与面向用户的 `hint`，UI 展示「发生了什么 + 该改什么」而非裸校验器消息。

`unpackWebPackageZip` 保留为不带诊断的兼容入口。与内置预设的 ZIP 往返行为不变：诊断为空、`ref` 相同。决策依据见 `docs/decisions/2026-09-29_114500_WebPackageZIP信封归一化与缺省导入决策.md`。

## 验证命令

```sh
pnpm --filter @mahoshojo/web-package test
pnpm --filter @mahoshojo/web-package build
pnpm --filter @mahoshojo/web run test:browser:web-package
WEB_PACKAGE_BROWSER=firefox pnpm --filter @mahoshojo/web run test:browser:web-package
```

浏览器二进制需本机安装。`WEB_PACKAGE_BROWSER=webkit` 使用相同矩阵；缺少系统依赖不能视为测试通过。设置 `WEB_PACKAGE_NEXT_ORIGIN=http://127.0.0.1:3129` 可验证已启动的本机 Next 生产运行页；测试仅替换宿主夹具页面，运行页、CSP、消息传递使用实际路由，不调用 Provider 或生产 API。
