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

**魔法少女生成器 (MahoShojo-Generator)** 是一款基于 AI 结构化生成技术的 Web 小游戏，玩家可以创建个性化、可成长的魔法少女（也可能是奇奇怪怪的角色）及相关角色，然后开始紧张刺激的赛博斗蛐蛐或者是创作小故事的活动，甚至还有排位功能！

除此之外，项目也实现了 AI 多渠道轮询、用户系统、数据卡公开分享、敏感词检测等丰富神秘的功能。

📖 查看完整的版本更新历史，请参阅 [CHANGELOG.md](./CHANGELOG.md)

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
- **标签系统**：标签库分类与筛选

### 其他功能
- **情景生成**：自定义故事场景
- **通用情景卡（Markdown）**：更自由的长线舞台设定卡
- **自由生成**：任意提示词按 Schema 生成角色/情景数据卡
- **酒馆生态联动**：SillyTavern 角色卡 PNG 导入/导出
- **角色组队卡**：把多张角色卡拼成一张队伍卡
- **魔法茶会**：基于角色卡/情景卡的长期剧情对话（本地会话，支持选项/摘要/角色更新）
- **立绘生成**：AI 绘图接口生成角色立绘（实验性）
- **原生性签名**：验证数据来源与完整性
- **内容安全**：敏感词检测、屏蔽词替换、多层审核机制
- **百科系统**：新手指引、规则说明

## 🚀 技术栈

* **框架**: Next.js 15（Pages Router 为主，局部 App Router）, React 19
* **语言**: TypeScript
* **运行时**: Bun (开发与构建), Cloudflare Pages/Workers (生产，Edge Runtime)
* **数据库**: Cloudflare D1（主库）+ Cloudflare R2
* **AI**: Vercel AI SDK, 支持 OpenAI/Google Gemini 等多种模型 (推荐 `gemini-2.5-flash` 或 `gemini-2.5-flash-lite`)
* **样式**: Tailwind CSS 4, shadcn/ui (部分)
* **安全**: Cloudflare Turnstile (验证码)
* **开发工具**: Turbopack (开发模式)

## 🚀 快速开始

### 环境要求

- Bun (推荐) 或 Node.js 18+
- AI 提供商 API Key (推荐使用 Google Gemini 系列)
- Cloudflare Turnstile Site Key & Secret Key
- Cloudflare 的一些相关配置（如 D1 数据库绑定）

### 安装

```bash
# 安装依赖
bun install

# 配置环境变量
cp env.example .env.local
```

编辑 `.env.local` 配置你的 AI 提供商：

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
bun run dev

# 生产构建
bun run build
bun run start

# Cloudflare Pages 构建（推荐）
bun run build:cf
bun run preview
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

## 📋 路线图

查看详细的开发进度和完成功能，请参阅 [CHANGELOG.md](./CHANGELOG.md)

## 🧭 开发规范（关键）

- 命名规范采用“分层统一 + 边界映射”，适用于全项目，不限于鉴权模块。
- 详细说明见 [docs/NAMING_CONVENTIONS_2026-02-28.md](./docs/NAMING_CONVENTIONS_2026-02-28.md)。

- [x] 核心 AI 生成系统
- [x] 角色成长与竞技场系统
- [x] 云端存储与用户系统
- [x] 排位系统与排行榜
- [x] PVP 对决模式
- [ ] 系统通用化与模块化
- [ ] 更多角色模板扩展


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
├── app/                    # App Router（承载新版 auth 路由）
│   └── api/
│       └── auth/
├── pages/                   # 页面路由
│   ├── index.tsx           # 主页
│   ├── name.tsx            # 魔法少女生成
│   ├── details.tsx         # 深度问卷
│   ├── canshou.tsx         # 残兽生成
│   ├── free.tsx            # 自由生成
│   ├── arena.tsx           # 竞技场
│   ├── pvp.tsx             # PVP 对决
│   ├── ranking.tsx         # 排行榜
│   ├── scenario.tsx        # 情景生成（箱庭物语）
│   ├── character-party.tsx # 角色组队卡
│   ├── tavern.tsx          # 酒馆生态联动
│   ├── magic-tea-party.tsx # 魔法茶会（长期对话）
│   ├── encyclopedia/       # 百科系统
│   ├── character-manager.tsx  # 角色管理
│   └── api/                # API 路由
├── lib/                    # 核心逻辑
│   ├── ai/                 # AI 集成
│   ├── database/           # 数据库访问
│   ├── db/                 # Drizzle schema/repositories
│   ├── d1.ts               # Cloudflare D1
│   └── signature.ts        # 数据签名
├── drizzle/                # D1 迁移 SQL
├── components/             # UI 组件
├── public/                 # 静态资源
│   ├── announcements.json  # 公告
│   ├── encyclopedia/       # 百科 Markdown
│   └── presets/            # 预设数据
└── types/                  # TypeScript 类型定义
```

---

<div style="text-align: center">✨ 为结构化生成献上祝福 ✨</div>
