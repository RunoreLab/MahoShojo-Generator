# Web Experience Package V1 架构规格

状态：**accepted / Phase 1 内置 Package 实施；不授权生产激活**
日期：2026-09-22
规格标识：`SPEC-web-experience-package-v1`
依据决策：`ADR-web-experience-package-single-overlay-v1`

本规格定义 Arena Web Package 的最小契约。本次实现范围为 Phase 1 first-party Package；后续阶段保持设计方向，不代表已实现。

它不改变当前：

```text
reportFormat = markdown | web
```

也不替代现有无 Package 的 Web HTML generation。

## Phase 1 实施范围（2026-09-22）

本次实现内置 `mahoshojo.visual-novel-lite@1.0.0`，入口为 `index.html`，唯一生成目标为 `data/story.json`。Arena 和 `/battle` 的 Web 体验选择器可选“自由生成网页”或 Visual Novel Lite；单人流式/非流式、多人房间和个人历史复用现有生成与展示链路。默认仍为 Markdown。

- `@mahoshojo/contracts/web-package` 定义 manifest、ref、artifact 与 overlay。Phase 1 只解析仓库保留的精确内置 revision；未知 id/version/digest 在调用 Provider 前拒绝，不接受 arbitrary ZIP 或请求内嵌 Package。
- `@mahoshojo/web-package` 持有内置文件、完整性校验、Prompt Projection、目标校验和 resolver。文件 digest 对 exact bytes 计算；Package digest 对规范化 manifest 的 UTF-8 JSON 计算：对象 key 递归排序，`files` 按 path 排序，`capabilities` 排序，无额外空白。每个文件 descriptor 已包含 size 与 digest，manifest 不进入自身文件列表。
- 内置 Draft 2020-12 JSON schema 字节固定保留，验证使用与该 schema 对应的 Zod 规则并测试二者一致。不开放任意用户 JSON Schema 解释器；不支持的 schema revision 拒绝。路径与长度门限以 contract 源码为准。
- Prompt 只包含 Host contract、creator instructions、schema 与 semantic catalog。Runtime、CSS 与 SVG bytes 不进入 Prompt。最终 Meta 必须有效并在输出结尾；剥离控制段后校验 JSON/schema/字节预算，失败即输出契约错误，不额外调用 Provider 修复。
- 持久化正文保存 overlay 原文（包括合法前后空白），`webPackage` descriptor 保存 ref、target path/media type 和 generated digest；单人 `done`/结果、Room result 和 `battleReportRenderSnapshotV1` 均携带 descriptor。D1 终态回退即使没有流式 header，也能由最终 descriptor 恢复 Web 契约。
- first-party resolver 把该固定 Package 的相对 JS/CSS/SVG 引用组装为自包含 `srcdoc`，再校验原 revision 与 overlay digest。它不是任意 Package 的通用 URL 重写器。未来导入用户 Package 时需另行实现资源空间与隔离方案。
- 执行继续要求 authoritative final、本地 Web consent，以及 `sandbox="allow-scripts"`；不新增同源权限、Host Bridge 或 CSP 例外。拒绝执行或校验失败时，JSON 以安全文本展示。该内置包可导出组装后的 HTML，沿用离开 iframe 沙箱的导出提示。
- Shared Config 的 `webPackageRef` 属于生成语义；提案、冲突、host reconciliation 与 snapshot digest 包含其完整身份。Package 选择与格式切换共同发生时按原子组应用。
- 内置 revision 文件须随所有仍可重放的历史版本保留；发布新版时新增 revision，不覆盖原文件或将旧 ref 自动指向新包。本阶段不新增 D1 migration、R2 namespace、环境变量或生产部署操作。

用户本地导入、通用 ZIP 导出、专用 sandbox origin、公开市场和 Host Bridge 均不在本次实现范围。真实付费 Provider 的 token 使用量与弱模型稳定性尚未测量；不把结构上的 Prompt 隔离等同于这些效果已获验证。

---

# 1. 目标

V1 解决一个问题：

> 已经稳定存在的代码、Runtime 和资产如何不再由 AI 每局重新复制，同时仍保持 AI 每次只生成一个文件。

核心模型：

```text
Cards / Scenario / Guidance
            +
Package Prompt Projection
            ↓
           AI
            ↓
Generated Target Payload
            ↓
Validation
            ↓
Immutable Base Package
        +
Single-file Overlay
            ↓
Derived Web Experience
            ↓
Sandbox Renderer
```

---

# 2. 术语

## 2.1 Base Package

不可变的 Package revision。

包含预先存在的 Web 文件、Runtime、媒体、schema 和 AI 辅助资料。

## 2.2 Package Ref

至少包含：

```ts
type WebPackageRef = {
  id: string;
  version: string;
  digest: string;
};
```

`digest` 是不可变内容身份。

## 2.3 Entry

浏览器运行 Derived Experience 时打开的入口文件。

例如：

```text
index.html
game.html
viewer.html
```

## 2.4 Generation Target

AI 当前 generation 唯一允许生成的 Package path。

例如：

```text
index.html
data/report.json
data/story.json
generated/module.js
```

## 2.5 Overlay

AI 最终生成的 target bytes。

Overlay 不修改 Base Package，而是在 Derived Experience 中遮蔽相同 path 的 base file。

## 2.6 Prompt Projection

Package 为 AI 暴露的最小语义接口。

它不是整个 Package 文件树。

## 2.7 Derived Web Experience

```text
Base Package + Overlay
```

解析后的逻辑 Web 文件空间。

---

# 3. 核心不变量

实现 MUST 保证：

1. 一个 generation 最多引用一个 Web Package；
2. Package revision immutable；
3. 一个 generation 只有一个 target；
4. V1 `generation.mode` 只能为 `replace`；
5. AI 不获得 Package 全量文件作为默认 Prompt；
6. target 输出成功前不得修改任何 canonical Package；
7. generation 开始后 Package digest 冻结；
8. authoritative final 前不得执行不完整 target；
9. Package-backed report 仍属于 `reportFormat='web'`；
10. Package 不获得高于普通 Web report 的宿主权限。

---

# 4. Package Manifest

建议 V1 logical manifest：

```json
{
  "format": "mahoshojo-web-package",
  "formatVersion": 1,

  "id": "runorelab.example",
  "version": "1.0.0",
  "name": "Example Web Experience",

  "entry": "index.html",

  "generation": {
    "target": "data/report.json",
    "mode": "replace",
    "mediaType": "application/json",
    "instructions": "ai/instructions.md",
    "schema": "schemas/report.schema.json",
    "assetCatalog": "ai/assets.json"
  },

  "capabilities": [
    "scripts",
    "audio"
  ],

  "files": [
    {
      "path": "index.html",
      "mediaType": "text/html",
      "digest": "sha256:...",
      "size": 8192
    },
    {
      "path": "runtime/app.js",
      "mediaType": "text/javascript",
      "digest": "sha256:...",
      "size": 32768
    }
  ]
}
```

该 JSON 是 contract 方向，不要求在文档阶段冻结每个长度 ceiling。

---

# 5. Manifest 规则

## 5.1 Root identity

MUST：

```text
format = "mahoshojo-web-package"
formatVersion = 1
```

未知 major format version MUST fail closed。

## 5.2 Path

所有 Package path MUST：

- 使用 `/`；
- 为相对路径；
- 不以 `/` 开头；
- 不包含 `.` / `..` path segment；
- 不包含反斜杠；
- 不包含 NUL；
- 在 normalization 后保持唯一；
- 不允许 duplicate path。

实现 SHOULD 复用现有 `local-library` 的 portable safe-path 与 content digest 思想，而不是另造相互矛盾的路径规则。

## 5.3 Entry

`entry` MUST：

- 指向 Base Package 中存在的文件；
- 使用 `text/html` 或未来显式支持的等价 HTML media type。

V1 不支持由不存在的 entry 启动 Package。

## 5.4 Generation target

`generation.target`：

- MAY 指向 Base Package 中已有文件；
- MAY 指向一个在 Base Package 中尚不存在的新路径；
- 在 Derived Experience 中由 Overlay 覆盖 / 创建；
- MUST NOT 指向 Package manifest；
- MUST NOT 改写 Package identity / digest metadata。

`generation.target` MAY 与 `entry` 相同。

## 5.5 Mode

V1：

```json
"mode": "replace"
```

是唯一合法模式。

其它值 MUST 被拒绝。

## 5.6 Generated media type

AI V1 只生成文本型 artifact。

至少可考虑支持：

```text
text/html
text/plain
text/markdown
text/css
text/javascript
application/javascript
application/json
image/svg+xml
```

二进制图片、音频、视频等 MUST NOT 作为 AI generation target。

它们属于 Base Package asset。

---

# 6. File descriptor

Base Package payload file SHOULD 使用：

```ts
type WebPackageFileDescriptor = {
  path: string;
  mediaType: string;
  digest: `sha256:${string}`;
  size: number;
};
```

`digest` MUST 对 exact stored bytes 计算。

Importer MUST 校验：

```text
descriptor digest
descriptor size
actual bytes
```

一致。

Manifest 自身不进入自我引用的 `files[]` digest 循环。

Package-level digest 的 canonical algorithm 可以由后续 contract 实现冻结，但 MUST 满足：

- 同一逻辑 Package 在不同 ZIP compression / timestamp 下 identity 不变；
- 内容变化导致 digest 变化；
- 不能只相信作者提供的 `version`。

---

# 7. Package Prompt Projection

Host MUST 根据 manifest 构建 Prompt Projection。

模型默认只应获得：

```text
package id/name/version
entry
target
target mediaType
生成模式
host 强制输出要求
creator instructions
optional schema
optional semantic asset catalog
```

Host MUST NOT 仅因为文件存在于 Package 就自动把这些内容放进 Prompt：

```text
runtime/*.js
vendor/*
styles/*
images
audio
video
fonts
binary assets
其它无必要 source
```

---

# 8. Prompt 信任边界

必须区分：

```text
Host-generated Package Contract
```

和：

```text
creator-authored Package Instructions
```

Host-generated contract 是系统输出协议的一部分，例如：

```text
唯一 target
media type
schema
不得输出多个文件
Meta trailer
```

creator instructions 仍属于不可信创作者内容。

它们 MUST NOT 覆盖：

- system / safety policy；
- Arena authoritative facts；
- adjudication result；
- winner；
- combatant identity；
- host output contract；
- 用户明确禁止事项；
- 现有写回 authority。

Package Prompt Projection SHOULD 使用明确 delimiter，避免把 Package instruction 与系统规则混为一体。

---

# 9. Provider 输出契约

Package-backed Web 不应为了携带 HTML / JS / JSON 而强制使用：

```text
{ "target": "...escaped string..." }
```

这样的 structured wrapper。

V1 定义逻辑上的：

```text
Generated Target Payload
+
Arena Control Trailer
```

例如：

```text
<target exact text bytes>

<!-- MAHOSHOJO_ARENA_META {...} -->
```

其中：

> `MAHOSHOJO_ARENA_META` 是 generation transport/control metadata，不属于 generation target。

Host MUST：

```text
Provider final output
        ↓
extract authoritative meta
        ↓
strip control trailer
        ↓
remaining target payload
        ↓
target validation
        ↓
overlay
```

因此：

- JSON target 在剥离 trailer 后仍是合法 JSON；
- HTML target 仍兼容现有 Meta 思路；
- Meta marker 永远不得成为 Package target bytes；
- replay 保存的 Overlay 不应重新包含 control trailer。

该语义仍然满足：

> AI 每次只生成一个 Package target file。

Control trailer 不是第二个 Package 文件。

---

# 10. Streaming

Package-backed stream MUST 与当前 Web V1 一样：

> authoritative final 之前不执行生成内容。

生成过程中 MAY 展示：

```text
partial target text
```

但不得：

- 不断修改 Package instance；
- live reload iframe；
- incremental execute JS；
- partial JSON apply；
- partial target 参与 replay authority。

只有：

```text
final output
+
valid authoritative meta
+
valid target
```

完成后，才可创建 Derived Experience。

---

# 11. Target validation

所有 target MUST 先通过通用门禁：

```text
byte budget
target media type
target path contract
Meta extraction
authoritative final
```

之后再执行 media-specific validation。

## 11.1 JSON

如果：

```text
mediaType = application/json
```

MUST：

1. parse JSON；
2. 若 manifest 声明 schema，则执行 schema validation；
3. validation 失败不得 mount Package。

V1 若提供 JSON Schema，SHOULD 只支持一个明确 dialect，例如 Draft 2020-12，避免实现多个不一致 schema dialect。

## 11.2 HTML / JS / CSS / SVG

V1 不要求：

- sanitizer；
- AST proof；
- semantic code validation。

它们继续属于 sandbox 内的不可信 Web source。

但 size / encoding / contract validation 仍需通过。

---

# 12. Validation failure

target validation 失败 SHOULD 被视为：

```text
generation output contract failure
```

不得自动：

```text
fallback 再调用模型生成完整 HTML
```

因为这会：

- 产生第二次 AI generation；
- 改变费用与语义；
- 隐藏真实 Package contract failure。

未来若增加 repair，应独立设计，并保留原始失败证据。

---

# 13. Package Resource Resolver

应用层 SHOULD 提供逻辑 seam，概念上类似：

```ts
interface WebPackageResolver {
  resolvePackage(ref: WebPackageRef): Promise<ResolvedWebPackage>;

  createInstance(
    base: ResolvedWebPackage,
    overlay: WebPackageOverlay
  ): Promise<WebPackageInstance>;

  resolveEntry(
    instance: WebPackageInstance
  ): Promise<WebRenderLocation>;
}

type WebRenderLocation =
  | { kind: 'srcdoc'; html: string }
  | { kind: 'url'; url: string };
```

这只是职责边界，不要求采用该 TypeScript 形状。

核心要求：

> Package contract 不感知最终资源是 srcdoc、HTTP URL、R2、Blob 还是 Native filesystem。

---

# 14. Phase 1 renderer

第一阶段 first-party PoC 可以选择最简单能完整验证 contract 的 renderer。

允许：

```text
first-party controlled package
+
read-only resource surface
```

或：

```text
single-document materialization
```

但如果 first-party PoC 使用主站同源 URL，它 MUST 明确只是开发者控制内容的过渡方案。

任意第三方 / 用户上传 Runtime 上线前 SHOULD 重新评估并优先使用独立 sandbox origin。

---

# 15. Package URL space

长期 renderer SHOULD 允许：

```text
index.html
runtime/app.js
styles/app.css
assets/bg.webp
```

使用普通 relative URL。

Derived Experience 应表现为一棵正常文件树，而不是要求 Package 作者手工知道：

```text
R2 key
generationId
Blob URL
内部 API route
```

例如逻辑：

```text
/<immutable package namespace>/
  index.html
  runtime/app.js
  assets/bg.webp
```

加：

```text
overlay:
  data/report.json
```

relative import / CSS URL / media URL 均应在该 logical namespace 中解析。

---

# 16. External dependencies

关键体验所需的 Runtime dependency SHOULD 被打包。

外部 HTTPS 资源 MAY 继续存在，但：

- 仍受 CSP / CORS / browser policy 限制；
- 不得因为 Package 存在而获得新的网络权限；
- Package SHOULD 对网络失败有降级；
- 正式可重放体验不应依赖“最新版 CDN 资源”。

V1 不提供 npm runtime resolution。

---

# 17. Persistence

Package-backed authoritative result SHOULD 至少能恢复：

```ts
type PackageBackedWebResult = {
  packageRef: {
    id: string;
    version: string;
    digest: string;
  };

  targetPath: string;
  targetMediaType: string;

  generatedDigest: string;

  generatedContent?: string;
  generatedContentRef?: string;
};
```

具体 D1 / R2 representation 不由本规格提前绑定。

---

# 18. Replay

Replay MUST：

```text
读取原 package digest
+
读取原 generated overlay
+
重新 materialize 同一 Derived Experience
```

MUST NOT：

- 调用模型重新生成 target；
- 自动替换 Package 为最新版；
- 自动重新运行 creator build；
- 用相同 version string 下的不同 bytes 替换旧 Package。

---

# 19. Package retention

只要仍有可重放 report 引用某 Package digest：

> 对应 Package blob MUST 保持可解析。

Package 作者删除公开 listing，不应自动删除历史 report 所需 immutable blob。

具体 retention / pin / GC 机制留给存储规格。

---

# 20. Ordinary fallback

用户不执行 Web 时：

### HTML target

继续使用现有普通展示原则。

### JSON target

Host SHOULD：

```text
pretty-print JSON
```

并作为安全文本 / code view 展示。

### 其它文本 target

Host SHOULD 使用 plain-text / code presentation。

V1 不要求 Package 自带第二套 executable fallback Runtime。

---

# 21. Consent

Package-backed Web 如果仍然只有现有：

```text
sandbox="allow-scripts"
```

权限，则不需要仅因 Package 存在而提升 consent version。

如果未来新增：

```text
allow-same-origin
Host Bridge
filesystem
clipboard
download
其它敏感 capability
```

必须单独重新评估 consent。

---

# 22. Export

Package-backed report 的完整 portable export SHOULD 最终表达：

```text
Base Package
+
Overlay
```

例如 ZIP。

V1 不要求所有 Package 都重新压平成单 HTML。

如果 Host 实际能 materialize 自包含 HTML，可以继续提供 HTML export；这属于 renderer/export capability，不进入 Package 核心 identity。

---

# 23. Multiplayer

多人 Room 若启用 Package：

```ts
webPackageRef?: {
  id: string;
  version: string;
  digest: string;
};
```

应属于 Shared Config / generation semantic。

缺失表示：

```text
普通 Generated Web
```

generation start 后：

```text
package ref
```

与其它生成语义一起冻结。

Proposal / diff / reconciliation 不得把 Package digest 更新解释为不影响 generation 的纯 UI 设置。

---

# 24. Package 与数据卡

Web Package SHOULD 是独立可复用资源，而不是某种角色卡字段的私有实现细节。

角色卡 / 情景卡未来 MAY：

- 推荐 Package；
- 引用 Package；
- 提供 Package 使用指导。

但 V1 不要求：

```text
一张卡内嵌完整 Package
```

也不要求立即修改 Wantu Card schema。

---

# 25. Resource budget

Package binary bytes 与 Prompt bytes 必须分开计算。

实现 MUST NOT：

> 为了运行一个 20 MB Package，而把这 20 MB 重新塞进 Arena generation request / Prompt。

现有：

- request byte budget；
- Prompt token budget；
- AI output byte budget；

继续约束对应链路。

Package storage / import 的 size ceiling 是另一套资源预算，应在真正开放用户导入前根据：

```text
R2
客户端内存
解压成本
文件数
网络流量
配额
```

确定，不在本架构草案中拍脑袋冻结。

---

# 26. Import safety

第一阶段不开放 arbitrary user ZIP import。

未来开放时至少需要：

- safe path validation；
- duplicate path rejection；
- file count ceiling；
- total uncompressed byte ceiling；
- per-file ceiling；
- archive traversal / zip-slip protection；
- decompression bomb protection；
- digest verification；
- unsupported manifest fail closed。

这些要求不能因为“iframe 有 sandbox”而省略，因为它们属于导入 / 存储边界，而不是页面执行边界。

---

# 27. 首版明确不做

本规格 V1 不包括：

1. AI 多文件输出；
2. arbitrary patch；
3. JSON Patch；
4. Package stacking；
5. Package dependency graph；
6. runtime npm install；
7. bundler；
8. Node runtime；
9. WebContainer；
10. Host Bridge；
11. Package Marketplace；
12. user-generated Package 自动审核；
13. Runtime 自动升级；
14. Package DOM 成为 Arena authority；
15. Web 页面修改正式 winner；
16. Live incremental Package execution；
17. 强制把现有 Generated Web 重构到 Package engine。

---

# 28. Phase 1 PoC

建议选择一个 first-party 范例，例如：

```text
Visual Novel Lite
或
quequan-game 风格小游戏
```

验证：

```text
Package
├─ index.html
├─ runtime/*
├─ assets/*
├─ ai/instructions.md
├─ ai/assets.json
└─ schemas/report.schema.json

AI
└─ 只生成 data/report.json
```

验收重点不是视觉完成度，而是：

- Runtime 不进入 Prompt；
- media bytes 不进入 Prompt；
- AI 只生成一个 target；
- schema validation 生效；
- overlay 不修改 base；
- replay 固定 package digest；
- relative Package resources 可解析；
- Web consent / sandbox 不回归；
- 弱模型比复制完整 Runtime 更稳定；
- token 明显降低。

---

# 29. 后续阶段

只有 Phase 1 证明价值后才进入：

```text
Phase 2
用户本地导入 Package
Package export/import
dedicated sandbox origin
package storage
```

再之后根据真实需求考虑：

```text
Phase 3
公开分享
媒体资产管理
Package 创作者工具
```

最后若出现明确业务需求，才独立设计：

```text
Phase 4
Typed Host Bridge
```

---

# 30. 测试门禁

实现至少需要覆盖：

## Contract

- manifest strict parse；
- format/version；
- safe paths；
- duplicate path；
- entry exists；
- one target；
- `mode=replace`；
- digest/size；
- unknown version fail closed。

## Prompt

- Runtime bytes 不进入 Prompt；
- asset binary 不进入 Prompt；
- instructions/schema/catalog 正确投影；
- Package creator text 不覆盖 Host contract；
- target/media type 明确。

## Output

- Meta trailer 可从 HTML target 提取；
- Meta trailer 可从 JSON target 提取；
- trailer 不进入 target；
- invalid JSON fail；
- schema invalid fail；
- output byte ceiling 生效。

## Overlay

- base immutable；
- existing target 被 overlay shadow；
- missing target 可由 overlay 创建；
- manifest 不能被 target 覆盖。

## Render

- authoritative final 前不执行；
- relative resource resolution；
- sandbox 保持最小权限；
- ordinary fallback 可读；
- reload 使用同一 authoritative artifact。

## Replay

- package digest 冻结；
- overlay digest 冻结；
- Package 新版本不改变旧 report；
- 无 Provider 再调用。

## Multiplayer

- Package ref 进入 Shared Config；
- snapshot / digest 包含 Package semantic；
- Room proposal/reconciliation 正确；
- 不同成员解析同一 authoritative Package revision。

## Regression

- 无 Package Web 完全保持现状；
- Markdown 完全保持现状；
- current Web consent 保持；
- generation recovery / replay 保持；
- history / personal report 保持；
- current export 行为不因尚未启用 Package 而回归。

---

# 31. 实现退出条件

Phase 1 只有在以下条件同时满足后才可认为架构验证成功：

```text
Package immutable
single target
Prompt Projection
schema validation
overlay replay
resource resolution
sandbox isolation
legacy Web no regression
```

如果 PoC 需要通过：

```text
把整个 Package 再塞进 Prompt
直接修改 canonical files
额外生成多个隐藏文件
给 iframe 开 allow-same-origin
```

才能运行，则说明实现偏离本规格，不应以“功能能跑”作为验收通过依据。
