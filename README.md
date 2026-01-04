<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <img src="./public/logo.svg" width="300" height="200" alt="MahoGen">
</p>

<div align="center">
  <!-- prettier-ignore-start -->
  <!-- markdownlint-disable-next-line MD036 -->
  <div>✨ 基于 AI 结构化生成的生成器 ✨</div>
  <a href="https://mahoshojo.colanns.me">在线试玩</a> |
  <a href="https://github.com/colasama/MahoShojo-Generator/discussions">交流反馈</a> |
  <a href="https://pd.qq.com/s/brisxifbl">腾讯频道: pd73230758</a>
</div>

## ✨ 项目介绍

**魔法少女生成器 (MahoShojo-Generator)** 是一款基于 AI 结构化生成技术，用于创建个性化、可成长的魔法少女及相关角色的 Web 应用。本项目使用 Next.js 15 + React 19 + TypeScript 构建，运行于 Cloudflare Edge Runtime，数据存储于 Cloudflare D1，并利用 Vercel AI SDK 与多种大语言模型（推荐 Gemini 系列）进行交互。

**V0.6.0 版本【排位×技术值×标签×百科×排行榜】更新**：新增“排位分 / 技术值”体系与排行榜页面；竞技场/PVP 对局可在满足资格时计入排位（v0.6.0 默认仅计 1v1，宁可漏算不可错算）；引入“定位标签”与标签库，支持筛选与展示；同时上线可维护的 Markdown 百科（含新手指引与规则说明）。此外，战报等大对象支持外部化存储（可选 R2），减少 D1 体积压力。

**V0.5.1 版本【PVP卡牌对决×个人页/个人资料卡】更新**：上线 PVP 房间卡牌对决（大厅/房间/回合/投票/结算等），并新增个人页与“个人资料卡”生成能力，方便展示个人战报与名片信息。（注：该版本当时未同步更新 README/公告，现补记。）

**V0.5.0 版本【流式生成×屏蔽词机制】更新**：竞技场流式战报升级为 Markdown 文本流（实时输出）；新增“屏蔽词”柔性和谐机制（默认遮罩 `❀` / 可定向替换），避免误触合规风险；同时强化敏感词触发后的“输入备份”，在逮捕页可直接预览与下载，尽量避免丢稿。

**V0.4.3 版本【通用角色扩展】更新**：新增「通用角色」模板，档案馆支持一键切换内容模板并自动生成 Markdown 描述，历战记录与签名在转换中保持独立字段；魔法少女/残兽/情景模板也按需补齐嵌套字段，让空白卡片开箱即用。竞技场（含流式模式）现已兼容通用角色，并提供兜底提示词确保跨模板对战依然精彩。

**V0.4.0 版本【云端档案×实时战报】重大更新**：引入了用户系统、云端数据卡存储与管理、徽章系统、兑换码功能以及全新的**实时流式战报**生成模式！现在你可以注册账户，将你的创作保存到云端，浏览和使用其他用户分享的角色/情景，并在竞技场中体验更流畅的故事生成！

**V0.3.0 版本【命途未定】更新**：引入了全新的 **随机性** 与 **可能性** 玩法！通过“随机组合”快速生成角色，并在竞技场中加入“随机角色”与“随机判定器”。

**V0.2.0 版本【战斗×成长】更新**：引入了**角色成长循环**！角色可通过参与竞技场积累“历战记录”，并通过“成长升华”功能进化。

输入你的名字、回答问卷、或随机组合，即可生成专属的、可成长的魔法少女角色，并在竞技场中创造属于她们的故事！

## 核心功能

* **魔法少女生成 (基于名字)**：快速生成包含基础设定的魔法少女。
* **奇妙妖精大调查 (深度问卷)**：通过问卷生成包含深度设定的魔法少女。
* **研究院残兽调查 (残兽生成)**：通过问卷生成魔法少女的宿敌——“残兽”。
* **快速随机生成**：一键从预设素材库中随机组合生成角色，无需填写问卷。
* **魔法少女竞技场 (故事生成)**：上传 1-10 位参战者的设定文件（.json），AI 将根据设定、历战记录、情景、用户引导、随机判定结果等生成故事。
    * **新增：实时流式生成模式**：在竞技场页面中将「生成方式」切换为「流式」，即可实时观看战报生成过程。
    * **模式**：经典模式、日常模式、羁绊模式、情景模式。
    * **随机元素**：可加入随机魔法少女/残兽，可设置随机判定事件。
    * **自定义**：支持用户引导、分队对抗、指定字数、选择语言。
    * **历战记录**：可选择是否让 AI 参考角色的过往经历。
    * **数据库联动**：内置数据卡选择器支持作者、点赞数、使用数等多维筛选；查看详情即得完整描述，并会自动记录公开卡的使用统计与点赞。
* **排行榜与排位系统 (v0.6.0)**：对满足资格的 1v1 对局计算排位分并展示榜单；提供“最高值/近期”等筛选与标签维度浏览。
* **定位标签与百科 (v0.6.0)**：引入标签库（系统维护口径）与数据卡标签选择；新增百科入口（Markdown 可维护），补齐新手指引、排位规则与标签释义。
* **PVP 卡牌对决 (v0.5.1)**：支持创建/加入房间、回合推进、投票与结算，并可生成对局结算卡（在 v0.6.0 起满足资格时也可计入排位）。
* **个人中心与个人资料卡 (v0.5.1)**：个人页展示战报与基础信息，并支持生成个人资料卡用于分享。
* **成长升华**：上传任意模板的设定文件（历战记录可选），可自由切换目标模板（含通用角色）并指定保留字段，AI 会生成“成长后”设定。
* **情景生成**：通过问卷快速生成用于竞技场“情景模式”的自定义故事场景文件。
* **角色管理中心**：
    * **用户系统**：支持注册和登录（基于用户名+唯一密钥）。
    * **云端数据卡**：将你的角色/情景保存到云端，随时随地访问和编辑。
    * **公开分享与浏览**：将你的数据卡设为公开，供他人浏览、点赞、使用。支持按名称、作者、点赞数、使用数等条件筛选。
    * **可视化编辑器**：查看、修改所有设定，管理“历战记录”，处理“原生性”签名状态。支持一键替换曾用名。
    * **回收站**：删除的数据卡会暂存，可恢复或彻底删除。
    * **徽章系统**：展示和管理通过特定活动或成就获得的徽章。
    * **公开审查与状态标识**：提交公开卡自动进入审核队列，通过后才会在广场展示，待审/未通过会在档案中醒目提示。
    * **兑换码**：使用兑换码增加数据卡存储槽位上限，兑换中心支持状态反馈与自动跳转。
    * **账号安全**：Turnstile 全链路校验、密钥加密本地存储与邮箱找回（Resend 邮件服务）共同守护账户。
* **立绘生成 (实验性)**：集成第三方 AI 绘图接口，为角色生成立绘参考图。
* **原生性签名系统**：通过数字签名验证数据是否由本生成器直接生成且未被篡改核心内容，保障数据来源可靠性。
* **内容安全策略**：敏感词检测（触发逮捕）、屏蔽词柔性替换（不触发逮捕）、AI 多档位安全审查、连坐打包校验与公开卡人工审核，并提供灵活的策略配置项。
* **通用角色模板 (v0.4.3)**：编辑器支持模板切换、Markdown 描述转换；竞技场可同时处理多模板对战；新建空白卡片会自动生成全量字段。

## 🚀 技术栈

* **框架**: Next.js 15 (Pages Router), React 19
* **语言**: TypeScript
* **运行时**: Bun (开发与构建), Cloudflare Pages/Workers (生产，Edge Runtime)
* **数据库**: Cloudflare D1（主库）+ Cloudflare R2（可选：大对象外部化）
* **AI**: Vercel AI SDK, 支持 OpenAI/Google Gemini 等多种模型 (推荐 `gemini-1.5-flash` 或 `gemini-2.5-flash-lite`)
* **样式**: Tailwind CSS 4, shadcn/ui (部分)
* **安全**: Cloudflare Turnstile (验证码)
* **开发工具**: Turbopack (开发模式)

## 快速开始 (本地运行)

### 环境要求

* Bun (推荐) 或 Node.js 18+
* 支持的 AI 提供商 API Key (如 Google Gemini)
* Cloudflare Turnstile Site Key & Secret Key (用于注册/登录验证码，可在 Cloudflare 官网免费获取)
* (可选) 签名密钥 `SIGNATURE_SECRET_KEY` (用于本地生成原生签名)

### 安装依赖

```bash
# 推荐使用 Bun
bun install

# 或使用 npm
npm install
```

### 环境配置

复制 `env.example` 为 `.env.local` 并配置你的 AI 提供商：

```bash
cp env.example .env.local
```

编辑 `.env.local`，配置 AI 提供商（支持多提供商自动故障转移）：

```shell
AI_PROVIDERS_CONFIG='[
  {{
    "name": "gemini_provider", 
    "apiKey": "your_gemini_api_key_here",
    "baseUrl": "https://xxx.com/v1",
    "model": "gemini-2.5-flash"
  },
  {
    "name": "gemini_provider", 
    "apiKey": "your_gemini_api_key_here",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
    "model": "gemini-2.5-flash"
  }
]'
```

### 运行开发服务器

```bash
# 使用 Bun（支持 Turbopack）
bun run dev

# 或使用 npm
npm run dev
```

在浏览器中打开 [http://localhost:3000](http://localhost:3000) 查看应用。

### 构建生产版本

```bash
bun run build
bun run start
# 或
npm run build  
npm run start
```

### Cloudflare Pages 构建与本地预览（推荐）

本项目线上部署以 Cloudflare Pages/Workers 为准，建议在本地/CI 用 `next-on-pages` 的链路做一次构建检查：

```bash
# 生成 Cloudflare Pages 产物到 .vercel/output
bun run build:cf

# 本地用 wrangler 启动 Pages dev（会先 build:cf）
bun run preview
```

## 📋 开发进度

- [x] AI 生成系统接入
- [x] 多 AI 提供商支持
- [x] 角色生成 Prompt Engineering
- [x] 自适应渐变配色
- [x] 图片保存功能优化
- [x] 图片预加载性能优化
- [x] 深度问卷生成功能
- [x] 角色对战故事生成功能
- [x] 扩展预设角色库
- [x] 加入残兽生成器！魔法少女太多了，有违自然之道
- [x] 在竞技场中支持残兽参战！
- [x] 立绘 AIGC 生成功能
- [x] 在竞技场中新增【羁绊模式】！
- [x] 历战养成机制 (V0.2.0核心)
- [x] 角色成长升华 (V0.2.0)
- [x] 自定义情景生成 (V0.2.0)
- [x] 角色档案管理 (V0.2.0)
- [x] 竞技场模式扩展（情景模式、分队）(V0.2.0)
- [x] 问卷易用性改进 (V0.2.0)
- [x] 角色模板标识机制 (v0.3.0)
- [x] 随机组合生成角色 (v0.3.0)
- [x] 竞技场随机角色 (v0.3.0)
- [x] 竞技场随机判定器 (v0.3.0)
- [x] 公开数据卡审查与违规拦截 (v0.4.2)
- [x] 数据卡高级筛选与使用/点赞统计 (v0.4.2)
- [x] 徽章管理与兑换中心 (v0.4.1+)
- [x] 密钥找回邮件通道 (v0.4.2)
- [x] 流式生成升级 + 屏蔽词柔性替换 + 输入备份 (v0.5.0)
- [x] PVP 卡牌对决 + 个人中心/个人资料卡 (v0.5.1)
- [x] 排位分 / 技术值 / 排行榜 (v0.6.0)
- [x] 定位标签 / 标签库 / 标签筛选与展示 (v0.6.0)
- [x] Markdown 百科（新手指引/规则/标签释义）(v0.6.0)
- [ ] 角色卡片模板扩展
- [ ] 将系统通用化，模块化


## 星标情况

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
├── pages/
│   ├── _app.tsx
│   ├── index.tsx                # 主页面 - 功能选择
│   ├── name.tsx                 # 魔法少女（基于名字）生成页
│   ├── details.tsx              # 魔法少女（深度问卷）生成页
│   ├── canshou.tsx              # 残兽生成页
│   ├── arena.tsx                # 竞技场（含排位信息展示）
│   ├── arena-stream.tsx         # 竞技场（流式页面）
│   ├── battle.tsx               # 竞技场（兼容旧入口）
│   ├── pvp.tsx                  # PVP 房间大厅
│   ├── pvp/[roomId].tsx         # PVP 房间页
│   ├── ranking.tsx              # 排行榜
│   ├── encyclopedia/index.tsx   # 百科目录
│   ├── encyclopedia/[slug].tsx  # 百科详情
│   ├── sublimation.tsx          # 成长升华页
│   ├── scenario.tsx             # 情景生成页
│   ├── character-manager.tsx    # 角色管理页
│   ├── me.tsx                   # 个人中心
│   ├── arrested.tsx             # 逮捕页
│   └── api/
│       ├── arena/*              # 竞技场：生成/流式/榜单等
│       ├── pvp/*                # PVP：房间/回合/投票/结算等
│       ├── auth/*               # 登录/注册/找回/校验
│       ├── me/*                 # 个人资料/战报/卡片等
│       └── ...                  # 其余业务 API
├── lib/
│   ├── ai/*                     # AI 提供商与封装
│   ├── database/*               # D1 数据访问与 schema
│   ├── d1.ts                    # D1 连接与工具
│   ├── r2.ts                    # R2（大对象外部化，可选）
│   ├── encyclopedia.ts          # 百科索引与渲染
│   └── signature.ts             # 数据签名与验证
├── components/
│   └── ...                      # 可复用组件（卡片/模态框/竞技场/PVP/排行榜等）
├── public/
│   ├── announcements.json       # 站内公告
│   ├── encyclopedia/*           # 百科 Markdown
│   ├── presets/                 # 预设数据卡
│   └── ...                      # 其他静态资源
├── types/
│   └── arena.d.ts              # (新) 竞技场相关类型
├── config/                      # 运行时配置（如战报存储策略）
├── scripts/                     # 运维/初始化脚本
├── tests/                       # bun 测试
└── ...                         # 配置文件
```

---

<div style="text-align: center">✨ 为结构化生成献上祝福 ✨</div>
