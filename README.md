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

**V0.4.0 版本【云端档案×实时战报】重大更新**：引入了用户系统、云端数据卡存储与管理、徽章系统、兑换码功能以及全新的**实时流式战报**生成模式！现在你可以注册账户，将你的创作保存到云端，浏览和使用其他用户分享的角色/情景，并在竞技场中体验更流畅的故事生成！

**V0.3.0 版本【命途未定】更新**：引入了全新的 **随机性** 与 **可能性** 玩法！通过“随机组合”快速生成角色，并在竞技场中加入“随机角色”与“随机判定器”。

**V0.2.0 版本【战斗×成长】更新**：引入了**角色成长循环**！角色可通过参与竞技场积累“历战记录”，并通过“成长升华”功能进化。

输入你的名字、回答问卷、或随机组合，即可生成专属的、可成长的魔法少女角色，并在竞技场中创造属于她们的故事！

## 核心功能

* **魔法少女生成 (基于名字)**：快速生成包含基础设定的魔法少女。
* **奇妙妖精大调查 (深度问卷)**：通过问卷生成包含深度设定的魔法少女。
* **研究院残兽调查 (残兽生成)**：通过问卷生成魔法少女的宿敌——“残兽”。
* **快速随机生成**：一键从预设素材库中随机组合生成角色，无需填写问卷。
* **魔法少女竞技场 (故事生成)**：上传 1-4 位参战者的设定文件（.json），AI 将根据设定、历战记录、情景、用户引导、随机判定结果等生成故事。
    * **新增：实时流式生成模式 (`/battle-stream`)**：体验故事逐句生成的过程！
    * **模式**：经典模式、日常模式、羁绊模式、情景模式。
    * **随机元素**：可加入随机魔法少女/残兽，可设置随机判定事件。
    * **自定义**：支持用户引导、分队对抗、指定字数、选择语言。
    * **历战记录**：可选择是否让 AI 参考角色的过往经历。
* **成长升华**：上传包含“历战记录”的角色，AI 将根据其经历生成“成长后”的新设定。支持选择保留部分原始设定。
* **情景生成**：通过问卷快速生成用于竞技场“情景模式”的自定义故事场景文件。
* **角色管理中心**：
    * **用户系统**：支持注册和登录（基于用户名+唯一密钥）。
    * **云端数据卡**：将你的角色/情景保存到云端，随时随地访问和编辑。
    * **公开分享与浏览**：将你的数据卡设为公开，供他人浏览、点赞、使用。支持按名称、作者、点赞数、使用数等条件筛选。
    * **可视化编辑器**：查看、修改所有设定，管理“历战记录”，处理“原生性”签名状态。支持一键替换曾用名。
    * **回收站**：删除的数据卡会暂存，可恢复或彻底删除。
    * **徽章系统**：展示和管理通过特定活动或成就获得的徽章。
    * **兑换码**：使用兑换码增加数据卡存储槽位上限。
* **立绘生成 (实验性)**：集成第三方 AI 绘图接口，为角色生成立绘参考图。
* **原生性签名系统**：通过数字签名验证数据是否由本生成器直接生成且未被篡改核心内容，保障数据来源可靠性。
* **内容安全策略**：通过环境变量灵活配置内容安全检查（敏感词过滤 + AI 审核）。

## 🚀 技术栈

* **框架**: Next.js 15 (Pages Router), React 19
* **语言**: TypeScript
* **运行时**: Bun (开发与构建), Cloudflare Edge Runtime (生产)
* **数据库**: Cloudflare D1
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

## 📋 开发进度

- [x] AI 生成系统接入
- [x] 多 AI 提供商支持
- [x] 角色生成 Prompt Engineering
- [x] 自适应渐变配色
- [x] 图片保存功能优化
- [x] 图片预加载性能优化
- [x] 深度问卷生成功能
- [x] 角色对战故事生成功能
- [x] 队列系统与请求限流（已删除）
- [x] 用户排队等待界面（已删除）
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
- [ ] 角色卡片模板扩展
- [ ] 将系统通用化，模块化


## 星标情况

[![Star History Chart](https://api.star-history.com/svg?repos=colasama/MahoShojo-Generator&type=Date)](https://www.star-history.com/#colasama/MahoShojo-Generator&Date)

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
│   ├── battle.tsx               # 魔法少女竞技场页
│   ├── sublimation.tsx          # (新) 成长升华页
│   ├── scenario.tsx             # (新) 情景生成页
│   ├── character-manager.tsx    # (新) 角色管理页
│   ├── arrested.tsx             # 逮捕页
│   └── api/
│       ├── generate-magical-girl.ts
│       ├── generate-magical-girl-details.ts
│       ├── generate-canshou.ts
│       ├── generate-battle-story.ts
│       ├── generate-sublimation.ts      # (新) 升华API
│       ├── generate-scenario.ts         # (新) 情景生成API
│       └── verify-origin.ts
├── lib/
│   ├── ai.ts                   # AI 集成和类型定义
│   ├── config.ts               # 环境配置管理
│   └── signature.ts            # 数据签名与验证
├── components/
│   ├── MagicalGirlCard.tsx
│   ├── CanshouCard.tsx
│   └── BattleReportCard.tsx
├── public/
│   ├── questionnaire.json
│   ├── presets/
│   ├── random-assets/ # (新) 随机角色素材库
│   └── ...                     # 其他静态资源
├── types/
│   └── arena.d.ts              # (新) 竞技场相关类型
└── ...                         # 配置文件
```

---

<div style="text-align: center">✨ 为结构化生成献上祝福 ✨</div>
