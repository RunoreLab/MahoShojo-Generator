# Web Experience Package 上位抽象与单文件 Overlay 决策

状态：**accepted / Phase 1 内置 Package 实施；不授权生产部署**
日期：2026-09-22
决策标识：`ADR-web-experience-package-single-overlay-v1`

关联文档：

- `docs/specs/2026-09-17_080700_Arena Web战报生成与沙箱渲染规格.md`
- `docs/reports/2026-09-17_121500_Web数据卡Runtime与媒体资产原生支持设计建议.md`
- `apps/web/public/encyclopedia/web-data-card-authoring.md`
- `packages/local-library/src/archive.ts`

---

## 1. 背景

当前 Arena Web V1 采用：

```text
AI
 ↓
完整 HTML document
 ↓
authoritative final
 ↓
sandbox="allow-scripts" iframe/srcdoc
```

这一模式自由度高、基础设施简单，适合一次性页面、实验玩法与强模型自由创作，因此继续保留。

但成熟 Web 玩法开始反复使用同一批：

- JavaScript Runtime；
- CSS；
- 第三方库；
- 图片、立绘、音频与视频；
- schema；
- 资源映射；
- 页面骨架。

如果每次生成都要求模型重新接收、复制和输出这些确定性内容，会产生输入 / 输出 token 浪费、弱模型破坏稳定 Runtime、资源引用漂移和历史重放困难。

2026-09-17 的候选报告提出 `Runtime + Data + Assets`。进一步讨论后认为，单独建立一种 Runtime 类型仍然过窄，更适合采用一个上位的 **Web Experience Package（以下简称 Web Package）** 抽象。

---

## 2. 决策

### 2.1 Web Package 成为未来复用型 Web 体验的上位抽象

Web Package 是一棵已经准备完成、可以由浏览器运行的不可变文件树，可包含：

```text
manifest
HTML
JavaScript
CSS
Runtime
第三方依赖
媒体资产
AI instructions
schema
asset catalog
其它静态文件
```

Runtime 只是 Package 中的一类内容，不再单独形成与 Package 平行的顶层架构。

### 2.2 Package 与 AI Context 必须分离

Package 进入 **Generation Environment**，但完整 Package MUST NOT 因此自动进入模型上下文。

模型只接收 **Package Prompt Projection**，例如：

- Package 名称与用途；
- 唯一生成目标；
- 输出 media type；
- schema；
- Runtime 能力说明；
- semantic asset catalog；
- 必要使用说明。

Runtime 源码、vendor bundle、图片、音频等不需要模型理解的字节 MUST NOT 为了“让 AI 能使用 Package”而重复写入 Prompt。

### 2.3 Package 本体不可被 generation 修改

Package revision MUST 是 immutable。

一次 AI generation 产生：

```text
Immutable Base Package
        +
One Generated Overlay File
        ↓
Derived Web Experience
```

所谓“AI 修改 Package 中某个文件”，在产品语义上表示：

> 本次 generation 的 overlay 在指定 path 上遮蔽 base package 中的原文件。

不得原地修改 canonical Package。

### 2.4 V1 每次 generation 只允许一个可写目标

Manifest 指定唯一：

```text
generation.target
```

AI 一次仍然只产生一个完整文件。

V1 只支持：

```text
generation.mode = "replace"
```

不支持：

- 多文件生成；
- arbitrary text patch；
- unified diff；
- JSON Patch；
- AST patch；
- 同一 generation 写入多个路径。

后续只有在真实需求出现后，才重新评估其它写入模式。

### 2.5 `entry` 与 `generation.target` 必须分离

Web Package 必须分别描述：

```text
entry              浏览器真正打开的入口
generation.target  AI 本次生成的唯一文件
```

二者可以相同，也可以不同。

例如：

```text
entry=index.html
target=index.html
```

表示 Package Assisted Generated Web。

而：

```text
entry=index.html
target=data/story.json
```

表示固定 Runtime + AI Story Data。

Arena Core 不因 target 类型不同而新增 `web-runtime`、`web-data` 等 report format。

### 2.6 `reportFormat` 继续只有现有 Web 语义

Package-backed report 仍然属于：

```text
reportFormat = "web"
```

Package 是 Web report 内部的 artifact / rendering strategy，不成为新的顶层 Arena report format。

当前无 Package 的：

```text
AI → 完整 HTML
```

路径继续存在且保持兼容。

### 2.7 Source Project 与 Runtime Package 分离

创作者开发 Package 时 MAY 使用：

```text
npm
pnpm
Vite
React
Phaser
Pixi
Three.js
其它构建工具
```

但进入 MahoShojo 的 Package MUST 已经是 browser-ready artifact。

MahoShojo V1 不负责：

```text
npm install
dependency resolution
TypeScript compilation
bundling
Node.js execution
WebContainer
```

关键 Runtime 依赖 SHOULD 被 vendor / build 到 Package 中，而不是要求 Arena 在运行时安装依赖。

### 2.8 Package identity 使用 immutable digest

一次 generation snapshot MUST 冻结至少：

```text
package id
package version
package digest
```

其中：

- `id` 表示逻辑身份；
- `version` 表示作者版本；
- `digest` 表示实际不可变内容身份。

历史重放以 digest 为最终依据，不得因作者发布“同名最新版”而自动替换旧 Package。

### 2.9 Package capability 声明不是权限授予

Manifest MAY 声明脚本、音频、网络等能力，用于：

- UI 风险提示；
- compatibility；
- 统计；
- preflight。

但 capability declaration MUST NOT 自动扩大：

```text
iframe sandbox
CSP
host bridge
browser permissions
```

Package 与普通 AI Web 一样继续被视为不可信 Web 内容。

### 2.10 Package Resource Resolver 是必须保留的架构 seam

Package contract MUST 使用逻辑相对路径，而不能绑定具体：

```text
R2 URL
Blob URL
srcdoc
Service Worker
filesystem path
```

Host 通过 `Package Resource Resolver` 把逻辑 Package 实例解析成实际可运行资源空间。

Renderer MAY 最终返回：

```text
srcdoc materialization
```

或：

```text
sandbox package URL
```

Package manifest 本身不得绑定其中一种实现。

---

## 3. 统一后的 Web 模型

未来 Web report 可统一理解为：

```text
A. Generated Web

AI
 ↓
index.html
 ↓
sandbox
```

以及：

```text
B. Package-backed Web

Immutable Package
        +
AI-generated target
        ↓
Derived Experience
        ↓
sandbox
```

其中 Package 自己决定 target 是：

```text
index.html
story.json
report.json
level.json
generated.js
generated.html
...
```

因此不再需要为 `Runtime + Data` 建立独立架构。

---

## 4. 历史与重放

Package-backed Web report SHOULD 持久化逻辑上等价于：

```text
{
  packageRef,
  targetPath,
  targetMediaType,
  generatedContentRef or generatedBytes,
  generatedDigest
}
```

不得为每份历史报告重复保存 Package 中全部 Runtime 和媒体。

但 Package blob 的保留周期 MUST 至少覆盖所有仍可重放的 report 引用。

如果 Package 已被作者删除或更新，已有历史 report 所引用的 immutable revision 仍不得随之变化。

---

## 5. 安全决策

Package 化本身不授权新的 Web 权限。

已有原则继续成立：

```text
sandbox="allow-scripts"
```

且不因此加入：

```text
allow-same-origin
Host Bridge
filesystem
clipboard
arbitrary downloads
top navigation
宿主 DOM/API
```

第三方 / 用户 Package 真正开放前，应独立评估专用 sandbox origin。

第一阶段若只运行仓库自带、开发者控制的 Package，可以使用更简单的 resolver PoC，但不得把这种部署方式直接推广到任意用户上传内容。

---

## 6. 用户拒绝执行 Web 时

Package-backed Web MUST 仍提供非执行式 fallback。

V1 不要求为 JSON target 再生成第二份 Markdown。

建议：

```text
text/html
→ 沿用现有普通文本 / Markdown fallback 思路

application/json
→ 安全 pretty-print / code view

其它文本 media type
→ plain-text/code view
```

Fallback 的目标是：

> 结果仍可查看和排障。

而不是保证完整复制 Package Web 体验。

---

## 7. 导出

Package-backed Web 不应被强制压缩回单 HTML。

长期自然导出形态是：

```text
base package
+
generation overlay
↓
portable Web package / ZIP
```

单 HTML 导出仅在 resolver 能可靠 materialize 时提供。

V1 manifest 暂不冻结 `portableHtml` 等额外能力字段；导出能力可以由 Host 实际判断。

---

## 8. 与多人 Arena 的关系

Web Package 若进入多人模式，应成为 Room generation semantic。

generation 开始时冻结 Package ref。

成员看到的 authoritative final 必须引用同一 Package digest 与同一 generated overlay。

如果 Package 没有扩大现有 Web 权限：

- 不要求新的顶层 consent 模型；
- 继续复用现有 Room Web consent 思路；
- Package 更新不能静默改变已经开始的 generation。

---

## 9. 首阶段实施边界

第一阶段 SHOULD 只验证：

```text
一个 first-party Package
一个 entry
一个 generation.target
mode=replace
一个 Prompt Projection
一个 authoritative overlay
可重复 replay
sandbox render
```

首阶段 SHOULD NOT 同时建设：

- 用户公开 Package 市场；
- arbitrary ZIP upload；
- package stacking；
- package dependency graph；
- npm installer；
- WebContainer；
- 多文件 AI output；
- arbitrary patch；
- Host Bridge；
- Package 自更新；
- 通用插件系统。

---

## 10. 被拒绝的替代方案

### 10.1 继续把 Runtime 全部塞进 Prompt

拒绝。

确定性代码没有必要在每次 generation 中重复输入和输出。

### 10.2 单独建立 `Runtime` 顶层类型

拒绝。

Runtime、assets、libraries 和 AI contract 本质上都属于同一个可复用 Web artifact。

### 10.3 AI 直接修改 canonical Package

拒绝。

会破坏并行生成、历史重放、版本冻结与作者源文件边界。

### 10.4 V1 直接支持 arbitrary patch

拒绝。

没有足够实际需求支撑 patch conflict、partial apply、repair 和版本基准复杂度。

### 10.5 为 Package 新增 `reportFormat`

拒绝。

Package 改变 Web artifact 的组成方式，不改变其作为 Web report 的顶层产品语义。

---

## 11. 与现有文档的关系

本 ADR：

- 不修改 2026-09-17 Arena Web V1 的现行行为；
- 以 V1 规格的 Phase 1 实施说明为实际能力边界，不宣称后续用户导入与公开分享已实现；
- 将 2026-09-17 Runtime 候选报告中的 `Runtime + Data + Assets` 提升为更通用的 Package 抽象；
- 后续 Package 具体 schema、validation、generation contract 与 renderer 要求由 `SPEC-web-experience-package-v1` 规定。

2026-09-22 用户明确要求按所附设计实现并提交 PR。本次接受并实施第 9 节的 first-party Phase 1；用户导入、公开分享、专用 sandbox origin 和 Host Bridge 继续留待后续独立设计。现有无 Package 的 Web V1 仍遵循原规格。
