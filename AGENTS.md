# Codex 代理操作手册

## 仓库基础规范

### 项目结构与模块划分
- 本项目基于 Next.js + `@opennextjs/cloudflare` + Cloudflare D1 数据库 + Tailwind 4 + Vercel AI SDK 1.x 编写。
- `pages/` 暴露现有 Next.js 页面路由属于 App Router 迁移期遗留主页面入口；`pages/api/` 属于遗留 API 入口，不应再作为新 API 的默认位置。
- `app/` 是目标路由体系；新增 API 默认优先放在 `app/api/**/route.ts`。
- 可复用的卡片与模态组件存放于 `components/`，复杂业务逻辑优先放在所属路由目录，避免组件过度臃肿。
- AI 相关能力封装在 `lib/`（`ai.ts`、`config.ts`、`signature.ts` 等）；共享类型位于 `types/arena.d.ts`；静态资源在 `public/`；全局样式集中于 `styles/`；工具脚本放在 `scripts/`；测试与夹具位于 `tests/`。

### 构建、测试与开发命令
- 使用 `pnpm install` 安装依赖，pnpm 是包管理器与脚本调度入口；当前固定版本为 `pnpm@11.3.0`。
- `pnpm dev` 启动 Turbopack 开发服务器（默认 `http://localhost:3000`）。
- `pnpm build` 与 `pnpm start` 生成并服务生产构建；`pnpm preview` 模拟 Cloudflare Pages 流程。
- `pnpm lint` 执行 Next/ESLint 规则校验，是提交前的强制步骤；`pnpm test`/`pnpm test:watch` 通过 Vitest 执行测试。

### 编码风格与命名约定
- TypeScript 采用 `strict` 配置；React 19 组件文件使用 PascalCase 命名并导出具名函数，除非框架限制不得使用匿名默认导出。
- 优先使用 `camelCase` 工具函数与具描述性的状态枚举；如必须使用 `any`，需注明原因。
- 通过 `@/*` 别名导入模块，避免深层相对路径；布局扩展优先利用 Tailwind 4 工具类与共享渐变样式。

### 全局命名分层规范
- 全局采用“分层统一 + 边界映射”策略：每一层内部只允许一种命名风格，跨层必须显式转换，禁止隐式透传。
- 数据库、SQL、迁移脚本默认使用 `snake_case`。
- TypeScript 业务层、服务层、组件内部变量、函数、props、state、API DTO 字段默认使用 `camelCase`。
- React 组件名、类型、接口、类、枚举名使用 `PascalCase`。
- Hook 名必须以 `use` 开头，并使用 `camelCase`。
- 内容层协议、历史兼容 JSON、外部导入导出格式，按各自 schema 的 canonical 命名保存；跨层转换必须放在 mapper / adapter 边界，不得在业务层零散兼容。
- 常量仅指模块级、语义上稳定且复用的常量；这类常量使用 `UPPER_SNAKE_CASE`。普通 `const` 局部变量仍使用 `camelCase`。
- 普通文件与目录默认使用 `kebab-case`；React 组件文件使用 `PascalCase`；Next.js 保留文件名遵循框架约定
- 同一对象中禁止长期并存语义等价的双字段。
- 对内容层字段允许“兼容读取”，但写回必须遵循当前协议；`created_at/updated_at` 等历史字段视为稳定兼容字段。
- 新增或修改跨层字段时，必须同步更新：schema、mapper、类型定义、API 契约与测试。

### API 的编写
- 该项目部署在 Cloudflare 上，通过 `@opennextjs/cloudflare` 运行于 Cloudflare Workers/Pages 链路；不要引入不兼容的库或特性。
- 新 API 默认使用 App Router Route Handler：路径形如 `app/api/<domain>/<resource>/route.ts`，导出 `GET`、`POST` 等方法，并直接返回 Web `Response`。
- 业务处理函数优先保持 `(req: Request) => Promise<Response>` 的 Web 标准形态，Route Handler 文件只负责 HTTP method 导出、动态参数接入和轻量组装。
- 动态路由迁移时，优先通过 Route Handler 的 `context.params` 显式传参；避免在业务层零散解析 pathname，除非是为了兼容既有公共函数。

### 测试规范
- 测试脚本逻辑基于 Vitest 执行；测试 API 从 `vitest` 导入，禁止新增 `bun:test` 依赖。
- 在 `tests/` 下新建 `*.test.ts` 测试文件（仅针对遗留代码使用 `.test.js`），共用 `tests/test.json` 等夹具。
- 随机逻辑需可复现，参考 `tests/getWeightedRandomFromSeed.test.js`：为辅助函数设定种子，并验证概率分布而非采样结果。
- 每次提交前执行 `pnpm test`、`pnpm lint` 和 `pnpm build`，在 PR 描述中记录重要日志差异；任何结构性变更需同步更新夹具与类型声明。

### 环境与配置提示
- 复制 `env.example` 至 `.env.local` 并填充所需凭据；复杂配置参考 `config/ai-providers.example.json`。
- 徽章或内容脚本通过 `pnpm exec tsx scripts/<name>.ts` 运行。

## 文档规则

- 默认使用中文。
- 正式文档优先落在 `docs/`，不要把关键决策只写在提交信息里。
- 新文档命名规范：yyyy-MM-dd_HHmmss_中文名.md，现存文档若无要求可不遵循。

## 提交与 PR 规范

- 提交标题遵循 Conventional Commit 前缀，如 `feat:`、`fix:`、`docs:`、`chore:`。
- 提交标题以中文为主（可中英混写），并补充中文 description。
- 单次提交聚焦单一主题，不混合结构骨架、运行代码与大量导出资产。
- PR 需说明范围、执行过的命令和仍未验证的部分；新增环境变量或脚本需标注并 @ 相关负责人。

## MCP 调用规则
- 目标：统一管理 MCP 服务的调用，控制查询粒度与速率，确保结果可追溯且安全合规。
- 全局策略：单轮对话只选用一种服务；优先离线能力；必要时说明切换原因。结果需精炼并附来源、时间与局限，失败时按降级策略退回。
- 调用步骤：设定目标与最小必要范围 → 执行调用（遵守速率限制、避免并发）→ 失败重试或降级 → 在答复末尾附“工具调用简报”，说明工具、输入摘要、参数、时间戳与来源。
- 隐私与合规：不得上传敏感信息，遵守 robots/ToS；遇到限流需退避 20 秒并缩小范围。
- 降级策略：若外部服务不可用，提供本地保守答案并标注不确定性。
- 各工具要点：
  - Sequential Thinking：步数 6-10，输出可执行计划与里程碑，不暴露中间推理。
  - Context7：先调用 resolve-library-id，再调用 get-library-docs；tokens 默认 5000，可指定 topic；返回需引用库 ID/版本。
  - Playwright: 用于与动态网页进行交互。核心能力包括页面导航 (goto)、内容提取 (content)、元素交互 (click, fill) 和截图 (screenshot)。主要用于获取 JavaScript 渲染的页面内容或执行需要用户操作才能获取的信息，比如观察前端页面元素是否正确。调用时需明确目标 URL 和要执行的具体操作序列。
  - fetch: 用于发出网络请求，获取静态网页内容或 API 数据。仅适用于非 JavaScript 渲染的页面。相比 Playwright，它更轻量、快速。调用时必须提供明确的 URL。优先于 Playwright 使用，除非目标页面需要执行 JS 才能正确显示内容。
  - mcp-server-time: 用于获取当前服务器的精确时间戳。无须输入参数。返回标准格式的时间信息，用于在结果中标记查询时间或处理与时间相关的任务。
  - mcp-shrimp-task-manager: 用于管理异步或长耗时任务。支持创建任务 (create)、查询任务状态 (status) 和获取任务结果 (get_result)。当需要执行复杂的数据处理、分析或代码执行等可能超时的操作时使用，以避免阻塞当前对话。
  - mcp-deepwiki: 用于查询文档。当问题涉及到某个 GitHub 仓库的文档时，应优先使用此工具。输入为关键词或自然语言问题，工具会返回最相关的知识库条目。相比于通用网络搜索，结果更精确、可信度更高。

---

此模板由全局 AGENTS.md 配置生成，确保所有项目都使用中文进行开发和交流。
