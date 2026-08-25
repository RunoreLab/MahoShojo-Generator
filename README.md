<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <img src="./apps/web/public/logo.svg" width="300" height="200" alt="MahoGen">
</p>

<div align="center">
  <!-- prettier-ignore-start -->
  <!-- markdownlint-disable-next-line MD036 -->
  <div>✨ 基于 AI 结构化生成的生成器 ✨</div>
  <a href="https://mahoshojo.colanns.me">在线试玩</a> |
  <a href="https://github.com/colasama/MahoShojo-Generator/discussions">交流反馈</a> |
  <a href="https://pd.qq.com/s/brisxifbl">加入腾讯频道</a>
</div>

## ✨ 项目介绍

**魔法少女生成器 (MahoShojo-Generator)** 是一款基于 AI 结构化生成技术的 Web 小游戏，玩家可以创建个性化、可成长的魔法少女（也可能是奇奇怪怪的角色）及相关角色，然后开始紧张刺激的赛博斗蛐蛐或者是创作小故事的活动，甚至还有排位功能！

除此之外，项目也实现了 AI 多渠道轮询、用户系统、数据卡公开分享、敏感词检测等丰富神秘的功能。

📖 查看完整的版本更新历史，请参阅 [CHANGELOG.md](./CHANGELOG.md)

> 当前版本：`v0.8.2`

## ✨ 核心功能

### 角色生成
- **魔法少女生成**：输入名字快速生成基础设定
- **深度问卷生成**：通过奇妙妖精大调查问卷生成深度设定
- **残兽生成**：创建魔法少女的宿敌——残兽
- **流式/非流式切换**：角色生成支持实时 Markdown 或结构化 JSON
- **随机组合**：一键从预设素材库随机生成角色
- **通用角色模板**：支持多种角色模板切换

### 竞技场系统
- **故事生成**：上传 1-10 位角色，AI 生成刺激的对战，或温馨（？）的故事
- **实时流式生成**：实时观看战报生成过程
- **连续战报会话**：本地保存章节链，支持章节规划、续写 / 分支 / 重写最后一章，适合长篇连续剧情
- **素材注入**：可把 JSON 数据卡、万途 Card、历史或问卷作为参考素材加入普通竞技场与连续战报；使用素材时不计严格排位
- **情景卡章节规划**：主情景可为连续战报提供建议或固定章节数，帮助 AI 按章推进并控制终章收束
- **多种模式**：经典/日常/羁绊/情景模式
- **随机元素**：随机角色加入、随机判定事件
- **历战记录**：AI 参考角色过往经历生成故事

### 成长与社交
- **成长升华**：角色通过对战积累经验并进化
- **排位系统**：1v1 对局计算排位分，展示排行榜
- **PVP 卡牌对决**：回合制对战，投票决定胜负
- **个人中心**：展示战报、生成个人资料卡

### 云端与分享
- **用户系统**：注册/登录账户，云端保存角色数据（v0.8.0 起进入旧密钥迁移窗口）
- **公开分享**：分享角色供他人使用，支持点赞和筛选
- **数据卡管理**：可视化编辑器、回收站、徽章系统
- **万途通用卡互通**：档案馆支持把本站角色导出为万途 `character` 卡，也支持把万途角色卡导入为通用角色
- **标签系统**：标签库分类与筛选

### 其他功能
- **情景生成**：自定义故事场景
- **通用情景卡（Markdown）**：更自由的长线舞台设定卡，也可携带连续战报章节规划扩展
- **自由生成**：任意提示词按 Schema 生成角色/情景数据卡
- **酒馆生态联动**：SillyTavern 角色卡 PNG 导入/导出
- **万途生态入口**：顶部导航提供万途驿站、万途竞技场、废土车卡与废土旅途外链入口
- **角色组队卡**：把多张角色卡拼成一张队伍卡
- **魔法茶会**：基于角色卡/情景卡的长期剧情对话（本地会话，支持选项/摘要/角色更新）
- **立绘生成**：AI 绘图接口生成角色立绘（实验性）
- **原生性签名**：验证数据来源与完整性
- **内容安全**：敏感词检测、屏蔽词替换、多层审核机制
- **百科系统**：新手指引、规则说明

## 🚀 技术栈

* **框架**: Next.js 15（App Router 页面与 Route Handlers）, React 19
* **语言**: TypeScript
* **包管理器**: pnpm 11.3.0
* **运行时**: Node.js 22+ (开发、构建与脚本), Cloudflare Pages/Workers (生产，Edge Runtime)
* **数据库**: Cloudflare D1（主库）+ Cloudflare R2
* **AI**: Vercel AI SDK, 支持 OpenAI/Google Gemini 等多种模型
* **样式**: Tailwind CSS 4, shadcn/ui (部分)
* **安全**: Cloudflare Turnstile (验证码)
* **开发工具**: Turbopack (开发模式)

## 🚀 快速开始

### 环境要求

- Node.js 22+（推荐 v24.14.0）
- pnpm 11.3.0（可通过 Corepack 启用）
- Vitest（当前测试运行器）
- AI 提供商 API Key (推荐使用 Google Gemini 系列)
- Cloudflare Turnstile Site Key & Secret Key
- Cloudflare 的一些相关配置（如 D1 数据库绑定）

### 安装

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp apps/web/env.example apps/web/.env.local
```

编辑 `apps/web/.env.local` 配置你的 AI 提供商：

```shell
AI_PROVIDERS_CONFIG='[
  {
    "name": "gemini_provider",
    "apiKey": "your_gemini_api_key_here",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
    "model": "gemini-2.5-flash",
    "type": "google"
  },
  {
    "name": "siliconflow_provider",
    "apiKey": "your_siliconflow_api_key_here",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "model": ["deepseek-ai/DeepSeek-V3.2", "zai-org/GLM-5", "zai-org/GLM-4.6", "Qwen/Qwen3-32B", "moonshotai/Kimi-K2-Instruct-0905"],
    "type": "openai"
  }
]'
```

### 运行

```bash
# 开发模式
pnpm dev

# 生产构建
pnpm build
pnpm start

# Cloudflare Pages 构建（推荐）
pnpm build:cf
pnpm preview
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

Cloudflare Pages 部署环境变量需显式设置 `PNPM_VERSION=11.3.0`，避免构建平台使用默认 pnpm 版本。

## 📋 路线图

查看详细的开发进度和完成功能，请参阅 [CHANGELOG.md](./CHANGELOG.md)

## 🧭 开发规范（关键）

- 命名规范采用“分层统一 + 边界映射”，适用于全项目，不限于鉴权模块。
- 详细说明见 [docs/NAMING_CONVENTIONS_2026-02-28.md](./docs/NAMING_CONVENTIONS_2026-02-28.md)。
- 当前路由统一使用 App Router；历史迁移评估见 [docs/reports/2026-06-03_204053_App_Router迁移评估.md](./docs/reports/2026-06-03_204053_App_Router迁移评估.md)。
- 新增 Web API 默认使用 `apps/web/app/api/**/route.ts` Route Handler；不要新增 `pages/` 或 `pages/api/` 入口。

- [x] 核心 AI 生成系统
- [x] 角色成长与竞技场系统
- [x] 云端存储与用户系统
- [x] 排位系统与排行榜
- [ ] 多人模式
- [ ] 系统通用化与模块化

### 项目结构与模块划分
- 本项目基于 Next.js + `@opennextjs/cloudflare` + Cloudflare D1 数据库 + Tailwind 4 + Vercel AI SDK 编写。
- `apps/web/app/` 是当前统一 Web 路由体系，页面入口使用 `apps/web/app/**/page.tsx`，API 入口使用 `apps/web/app/api/**/route.ts`。
- 可复用的卡片与模态组件存放于 `apps/web/components/`，复杂业务逻辑优先放在所属路由目录，避免组件过度臃肿。
- Web AI 兼容层位于 `apps/web/lib/`；共享类型位于 `apps/web/types/arena.d.ts`；静态资源在 `apps/web/public/`；全局样式集中于 `apps/web/styles/`；Web 运维脚本与 tests 分别位于 `apps/web/scripts/`、`apps/web/tests/`。根 `scripts/` 与 `tests/` 只保留 repository gates/integration tests。

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
- 新 Web API 默认使用 App Router Route Handler：路径形如 `apps/web/app/api/<domain>/<resource>/route.ts`，导出 `GET`、`POST` 等方法，并直接返回 Web `Response`。
- 业务处理函数优先保持 `(req: Request) => Promise<Response>` 的 Web 标准形态，Route Handler 文件只负责 HTTP method 导出、动态参数接入和轻量组装。
- 动态路由迁移时，优先通过 Route Handler 的 `context.params` 显式传参；避免在业务层零散解析 pathname，除非是为了兼容既有公共函数。

### 测试规范
- 测试脚本逻辑基于 Vitest 执行；测试 API 从 `vitest` 导入，禁止新增 `bun:test` 依赖。
- Web 行为测试在 `apps/web/tests/` 下新建 `*.test.ts`（仅针对遗留代码使用 `.test.js`），共用 `apps/web/tests/test.json` 等夹具；跨 app/repository contract 测试留在根 `tests/`。
- 随机逻辑需可复现，参考 `apps/web/tests/getWeightedRandomFromSeed.test.js`：为辅助函数设定种子，并验证概率分布而非采样结果。
- 每次提交前执行 `pnpm test`、`pnpm lint` 和 `pnpm build`，在 PR 描述中记录重要日志差异；任何结构性变更需同步更新夹具与类型声明。

## 📊 统计

[![Stargazers over time](https://starchart.cc/colasama/MahoShojo-Generator.svg?variant=adaptive)](https://starchart.cc/colasama/MahoShojo-Generator)

## 🧡 致谢
<div align="center">
  <p>本项目在线版本的大模型能力由</p>
  <p><b><a href="https://github.com/KouriChat/KouriChat"> 
    <img width="180" src="https://static.kourichat.com/pic/KouriChat.webp"/></br>
    基于 LLM 的情感陪伴程序</br>
    <span style="font-size: 20px">KouriChat</span>
  </a></b></p>
  <p>强力支持</p>
  <p><b>GitHub</b> | <a href="https://github.com/KouriChat/KouriChat">https://github.com/KouriChat/KouriChat</a></p>
  <p><b>项目官网</b> | <a href="https://kourichat.com/">https://kourichat.com/</a></p>
</div>

## 📁 项目结构

```
MahoShojo-Generator/
├── apps/
│   ├── web/                # Next/OpenNext source、tests、assets 与 deploy unit
│   │   ├── app/            # App Router 页面与 Route Handlers
│   │   ├── components/     # Web UI 组件
│   │   ├── lib/            # Web runtime/adapters
│   │   └── public/         # 静态资源
│   ├── api/                # Hono Node API deployment unit
│   └── d1-gateway/         # Cloudflare D1 Gateway Worker
├── packages/               # 显式 exports 的共享领域、contract 与 runtime core
├── config/                 # 跨 runtime route inventory
├── drizzle/                # D1 migration history
├── scripts/                # repository boundary/naming/data tooling
└── tests/                  # repository ownership/integration contracts
```

---

<div style="text-align: center">✨ 为结构化生成献上祝福 ✨</div>

## License

This project is licensed under the Apache License 2.0.

See [LICENSE](LICENSE) for details.
